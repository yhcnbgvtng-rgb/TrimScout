// Last-seen staleness rule: off by default, hide < retire, retire only sets removed_at and never touches a car with an open RFQ/quote/deal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { staleRuleConfig, perBrandSql, buildRetireStatement, spareCountSql, summarize, OPEN_VINS_SQL, DEFAULT_HIDE_DAYS, DEFAULT_RETIRE_DAYS } from '../src/staleRule.js';

describe('staleRuleConfig', () => {
  it('is off unless STALE_RULE is exactly 1', () => {
    for (const v of [undefined, '', '0', 'true', 'yes']) assert.equal(staleRuleConfig({ STALE_RULE: v }).enabled, false, String(v));
    assert.equal(staleRuleConfig({ STALE_RULE: '1' }).enabled, true);
  });
  it('defaults to hide 4 / retire 14 and ignores junk', () => {
    assert.deepEqual(staleRuleConfig({}), { enabled: false, hideDays: DEFAULT_HIDE_DAYS, retireDays: DEFAULT_RETIRE_DAYS });
    assert.equal(staleRuleConfig({ STALE_RULE_HIDE_DAYS: '1; DROP' }).hideDays, 4);
    assert.equal(staleRuleConfig({ STALE_RULE_HIDE_DAYS: '1' }).hideDays, 4);
  });
  it('keeps retire at least 3 days after hide', () => {
    assert.equal(staleRuleConfig({ STALE_RULE_HIDE_DAYS: '10', STALE_RULE_RETIRE_DAYS: '11' }).retireDays, 13);
  });
});

describe('queries', () => {
  it('per-brand count is a read-only SELECT on the live-car seen index', () => {
    const sql = perBrandSql(4);
    assert.match(sql, /^SELECT /);
    assert.ok(sql.includes('removed_at IS NULL') && sql.includes('idx_inv_stock_seen') && sql.includes('INTERVAL 4 DAY'));
    assert.throws(() => perBrandSql('4; DROP TABLE x'));
    assert.throws(() => perBrandSql(0));
  });
  it('retire only sets removed_at, on live cars past the line, and skips open VINs', () => {
    const st = buildRetireStatement([1, 2], 14, ['VIN1', 'VIN2']);
    assert.match(st.sql, /^UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE /);
    assert.ok(!/stale_at|last_seen_at =|price/.test(st.sql.split('WHERE')[0]));
    assert.ok(st.sql.includes('removed_at IS NULL') && st.sql.includes('INTERVAL 14 DAY') && st.sql.includes('vin NOT IN (?)'));
    assert.deepEqual(st.args, [[1, 2], ['VIN1', 'VIN2']]);
  });
  it('with no open VINs there is no empty NOT IN ()', () => {
    const st = buildRetireStatement([1], 14, []);
    assert.ok(!st.sql.includes('NOT IN'));
    assert.deepEqual(st.args, [[1]]);
  });
  it('the open-VIN guard covers rfq, quote, invite, deal request and deal', () => {
    for (const t of ['rfq_requests', 'rfq_quotes', 'rfq_invites', 'deal_requests', 'deals']) assert.ok(OPEN_VINS_SQL.includes(`FROM ${t}`), t);
    assert.ok(OPEN_VINS_SQL.includes("status IN ('collecting','picked')") && OPEN_VINS_SQL.includes('superseded_at IS NULL'));
    assert.ok(spareCountSql(14).includes(OPEN_VINS_SQL));
  });
  it('summarize totals and sorts per brand and per box', () => {
    const s = summarize([{ make: 'Kia', box: 'box1', cars: 5 }, { make: 'Ford', box: 'box2', cars: 9 }, { make: 'Kia', box: 'box2', cars: 3 }]);
    assert.equal(s.total, 17);
    assert.deepEqual(s.byBrand, [{ make: 'Ford', cars: 9 }, { make: 'Kia', cars: 8 }]);
    assert.deepEqual(s.byBox, [{ box: 'box2', cars: 12 }, { box: 'box1', cars: 5 }]);
  });
});

describe('2026-10-16-stale-rule.mjs box patch', () => {
  const src = fs.readFileSync(new URL('../../../scripts/box/2026-10-16-stale-rule.mjs', import.meta.url), 'utf8');
  it('dry run is the default and --apply refuses with the flag off', () => {
    assert.match(src, /apply && !cfg\.enabled/);
    assert.match(src, /const apply = args\.includes\("--apply"\)/);
  });
  it('dry run uses the reader account, only apply uses the writer', () => {
    assert.match(src, /apply \? env\.DB_USER : env\.DB_READER_USER/);
  });
});
