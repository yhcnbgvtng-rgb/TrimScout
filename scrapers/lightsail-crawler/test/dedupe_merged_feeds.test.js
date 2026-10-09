import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planDedupe, MERGED_FEED_GROUPS } from '../src/dedupeMergedFeeds.js';

const A = 1, B = 2, C = 3;
const row = (vin, dealerId, stockNumber = null, lastSeenAt = '2026-10-03T12:00:00Z') => ({ vin, dealerId, stockNumber, lastSeenAt });
const RUN = '2026-10-10T12:00:00Z';
const FRESH = '2026-10-10T15:00:00Z';

describe('planDedupe', () => {
  it('a VIN held by one rooftop is left alone and counted', () => {
    const p = planDedupe([row('V1', A), row('V2', B)], { rooftopIds: [A, B] });
    assert.deepEqual({ once: p.counts.heldOnce, shared: p.counts.shared, retire: p.counts.rowsToRetire }, { once: 2, shared: 0, retire: 0 });
  });

  it('review policy: a shared VIN with no evidence is UNRESOLVED and nothing is retired', () => {
    const p = planDedupe([row('V1', A, 'X1'), row('V1', B, 'X1')], { rooftopIds: [A, B], tie: 'review' });
    assert.equal(p.counts.unresolved, 1);
    assert.equal(p.counts.rowsToRetire, 0);
    assert.deepEqual(p.decisions[0].retire, []);
    assert.equal(p.decisions[0].rule, 'unresolved');
  });

  it('hub policy: the largest rooftop keeps the tie, the other rows would be retired', () => {
    const rows = [row('V1', A), row('V1', B), row('V2', B), row('V3', B), row('V4', A)];
    const p = planDedupe(rows, { rooftopIds: [A, B], tie: 'hub' });
    assert.equal(p.hub, B);
    const d = p.decisions.find((x) => x.vin === 'V1');
    assert.deepEqual({ keep: d.keep, retire: d.retire, rule: d.rule }, { keep: B, retire: [A], rule: 'hub' });
    assert.equal(p.counts.hub, 1);
  });

  it('fresh rule: after a re-crawl the only rooftop that still lists the VIN keeps it, whatever the tie policy', () => {
    const rows = [row('V1', A, null, '2026-10-03T00:00:00Z'), row('V1', B, null, FRESH)];
    const p = planDedupe(rows, { rooftopIds: [A, B], tie: 'review', runStart: RUN });
    assert.deepEqual({ keep: p.decisions[0].keep, retire: p.decisions[0].retire, rule: p.decisions[0].rule }, { keep: B, retire: [A], rule: 'fresh' });
  });

  it('fresh rule needs exactly one fresh holder: two fresh holders fall through to the next rule', () => {
    const rows = [row('V1', A, null, FRESH), row('V1', B, null, FRESH)];
    assert.equal(planDedupe(rows, { rooftopIds: [A, B], tie: 'review', runStart: RUN }).decisions[0].rule, 'unresolved');
  });

  it('without runStart the fresh rule is skipped entirely', () => {
    const rows = [row('V1', A, null, '2026-10-03T00:00:00Z'), row('V1', B, null, FRESH)];
    assert.equal(planDedupe(rows, { rooftopIds: [A, B], tie: 'review' }).decisions[0].rule, 'unresolved');
  });

  it('stock-prefix rule: a prefix that points to one rooftop among one-rooftop VINs decides a shared VIN', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(row(`A${i}`, A, `HM${i}`), row(`B${i}`, B, `HN${i}`));
    rows.push(row('S1', A, 'HM900'), row('S1', B, 'HM900'));
    const p = planDedupe(rows, { rooftopIds: [A, B], tie: 'review' });
    assert.deepEqual(p.learnedPrefixes, { HM: A, HN: B });
    const d = p.decisions.find((x) => x.vin === 'S1');
    assert.deepEqual({ keep: d.keep, retire: d.retire, rule: d.rule }, { keep: A, retire: [B], rule: 'stock' });
  });

  it('a prefix is not learned from too few examples or from a mixed one', () => {
    const few = [row('A1', A, 'HM1'), row('A2', A, 'HM2'), row('S', A, 'HM9'), row('S', B, 'HM9')];
    assert.deepEqual(planDedupe(few, { rooftopIds: [A, B] }).learnedPrefixes, {});
    const mixed = [];
    for (let i = 0; i < 5; i++) mixed.push(row(`A${i}`, A, `HM${i}`), row(`B${i}`, B, `HM${i + 10}`));
    assert.deepEqual(planDedupe(mixed, { rooftopIds: [A, B] }).learnedPrefixes, {}, '50/50 is not a signal');
  });

  it('a learned rooftop that is not one of the VIN\'s holders is ignored', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(row(`A${i}`, A, `HM${i}`));
    rows.push(row('S', B, 'HM9'), row('S', C, 'HM9'));
    assert.equal(planDedupe(rows, { rooftopIds: [A, B, C] }).decisions[0].rule, 'unresolved');
  });

  it('requireFreshKeeper: never retires a row in favor of a stale keeper', () => {
    const rows = [row('V1', A, null, '2026-10-03T00:00:00Z'), row('V1', B, null, '2026-10-03T00:00:00Z'), row('V2', B), row('V3', B)];
    const p = planDedupe(rows, { rooftopIds: [A, B], tie: 'hub', runStart: RUN, requireFreshKeeper: true });
    const d = p.decisions.find((x) => x.vin === 'V1');
    assert.deepEqual({ rule: d.rule, retire: d.retire }, { rule: 'blocked-stale-keeper', retire: [] });
    assert.equal(p.counts.rowsToRetire, 0);
    assert.equal(p.counts.blockedStaleKeeper, 1);
  });

  it('three rooftops holding one VIN: one keeper, two rows retired', () => {
    const rows = [row('V1', A), row('V1', B), row('V1', C), row('V2', A), row('V3', A)];
    const p = planDedupe(rows, { rooftopIds: [A, B, C], tie: 'hub' });
    assert.deepEqual(p.decisions.find((d) => d.vin === 'V1').retire.sort(), [B, C]);
    assert.equal(p.counts.rowsToRetire, 2);
  });

  it('rows of a dealer outside the group are ignored', () => {
    const p = planDedupe([row('V1', A), row('V1', 99)], { rooftopIds: [A, B], tie: 'hub' });
    assert.equal(p.counts.shared, 0);
  });

  it('the shipped groups: McGovern (4 rooftops), Fred Beans Hyundai (incl. Abington), Johnson Lexus', () => {
    assert.deepEqual(MERGED_FEED_GROUPS['mcgovern-hyundai'].rooftopIds.slice().sort(), [11951, 11952, 11953, 12087]);
    assert.deepEqual(MERGED_FEED_GROUPS['fred-beans-hyundai'].rooftopIds.slice().sort(), [12094, 12240, 12243]);
    assert.deepEqual(MERGED_FEED_GROUPS['johnson-lexus'].rooftopIds.slice().sort(), [7513, 7515]);
  });
});
