import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSupersedeRequest, buildSupersedeStatement, MAX_SUPERSEDE_PAIRS } from '../src/supersededRetire.js';
import { supersedePairs, runSupersede, SUPERSEDED_PATH } from '../../../scripts/box/syncSuperseded.js';

const h = { toInt: (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null), toStr: (v, n) => (v == null ? null : String(v).slice(0, n)) };
const V1 = '3N1AB8DV9SY397089', V2 = '3N1CN8EV2SL847404';
const body = (o = {}) => ({ pairs: [[V1, 13429], [V2, 13429]], seenAfter: '2026-10-10T01:00:00Z', ...o });

describe('parseSupersedeRequest', () => {
  it('accepts valid pairs, upper-cases VINs and de-duplicates', () => {
    const r = parseSupersedeRequest(body({ pairs: [[V1.toLowerCase(), 13429], [V1, '13429'], [V2, 7]] }), h);
    assert.equal(r.ok, true);
    assert.deepEqual(r.pairs, [[V1, 13429], [V2, 7]]);
    assert.equal(r.dryRun, false);
  });
  it('rejects a missing/invalid cutoff, empty or oversized pairs, bad VINs and store 0', () => {
    assert.equal(parseSupersedeRequest({ pairs: [[V1, 1]] }, h).ok, false);
    assert.equal(parseSupersedeRequest(body({ pairs: [] }), h).ok, false);
    assert.equal(parseSupersedeRequest(body({ pairs: Array.from({ length: MAX_SUPERSEDE_PAIRS + 1 }, (_, i) => [V1, i + 1]) }), h).ok, false);
    assert.equal(parseSupersedeRequest(body({ pairs: [['SHORT', 1]] }), h).ok, false);
    assert.equal(parseSupersedeRequest(body({ pairs: [[V1, 0]] }), h).ok, false, 'store 0 (no store matched) is never a keeper');
  });
  it('needs foreignBefore whenever sourceBox is sent', () => {
    assert.equal(parseSupersedeRequest(body({ sourceBox: 'box4' }), h).ok, false);
    assert.equal(parseSupersedeRequest(body({ sourceBox: 'box4', foreignBefore: '2026-10-08T00:00:00Z' }), h).ok, true);
  });
});

describe('buildSupersedeStatement', () => {
  const parsed = parseSupersedeRequest(body(), h);
  it('retires only un-refreshed, still-live nightly rows of the same VIN under a different store', () => {
    const { sql, args } = buildSupersedeStatement(parsed);
    assert.match(sql, /^UPDATE dealer_inventory i JOIN \(SELECT \? AS vin, \? AS keep_id UNION ALL SELECT \? AS vin, \? AS keep_id\) k ON k\.vin = i\.vin SET i\.removed_at = CURRENT_TIMESTAMP/);
    assert.match(sql, /i\.removed_at IS NULL AND i\.dealer_id <> k\.keep_id AND i\.last_seen_at < \? AND i\.source = 'nightly'/);
    assert.deepEqual(args.slice(0, 4), [V1, 13429, V2, 13429]);
    assert.ok(args[4] instanceof Date);
    assert.equal(args.length, 5);
  });
  it('adds the cross-box protection the sweep has when sourceBox is given', () => {
    const p = parseSupersedeRequest(body({ sourceBox: 'box4', foreignBefore: '2026-10-08T00:00:00Z' }), h);
    const { sql, args } = buildSupersedeStatement(p);
    assert.match(sql, /AND \(i\.source_box = \? OR i\.source_box IS NULL OR i\.last_seen_at < \?\)/);
    assert.equal(args[5], 'box4');
  });
  it('a dry run counts the same rows and changes nothing', () => {
    const { sql } = buildSupersedeStatement({ ...parsed, dryRun: true });
    assert.match(sql, /^SELECT COUNT\(DISTINCT i\.vin, i\.dealer_id\) AS n FROM dealer_inventory i JOIN/);
    assert.doesNotMatch(sql, /UPDATE/);
  });
});

describe('supersedePairs / runSupersede', () => {
  const rows = [
    { vin: V2, dealerId: 13429 }, { vin: V1, dealerId: 13429 }, { vin: V1, dealerId: 13429 },
    { vin: V1, dealerId: 0 }, { vin: V1, dealerId: null }, { vin: null, dealerId: 5 },
  ];
  it('keeps distinct matched-store pairs only, sorted', () => {
    assert.deepEqual(supersedePairs(rows), [[V1, 13429], [V2, 13429]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  });
  it('sends batches, totals what the API retired and passes the cutoff and ownership guard', async () => {
    const calls = [];
    const many = Array.from({ length: 1200 }, (_, i) => ({ vin: `1HGCM82633A${String(i).padStart(6, '0')}`, dealerId: 10 }));
    const out = await runSupersede({ api: async (p, b) => { calls.push({ p, b }); return { retired: 3 }; }, rows: many, seenAfter: 'T', sourceBox: 'box2', foreignBefore: 'F', log: () => {} });
    assert.deepEqual(calls.map((c) => c.b.pairs.length), [500, 500, 200]);
    assert.ok(calls.every((c) => c.p === SUPERSEDED_PATH && c.b.seenAfter === 'T' && c.b.sourceBox === 'box2' && c.b.foreignBefore === 'F' && c.b.dryRun === false));
    assert.equal(out.retired, 9);
  });
  it('dry run sums wouldRetire; a failing batch is logged and skipped; a 404 stops after one call', async () => {
    const dry = await runSupersede({ api: async () => ({ wouldRetire: 4 }), rows, seenAfter: 'T', dryRun: true, log: () => {} });
    assert.equal(dry.wouldRetire, 4);
    const logs = [];
    let n = 0;
    const flaky = await runSupersede({ api: async () => { if (n++ === 0) throw new Error('boom'); return { retired: 1 }; }, rows: Array.from({ length: 600 }, (_, i) => ({ vin: `1HGCM82633A${String(i).padStart(6, '0')}`, dealerId: 1 })), seenAfter: 'T', log: (m) => logs.push(m) });
    assert.equal(flaky.failedCalls, 1);
    assert.equal(flaky.retired, 1);
    let calls404 = 0;
    const old = await runSupersede({ api: async () => { calls404++; throw new Error('/api/inventory/superseded -> 404 not found'); }, rows: Array.from({ length: 1200 }, (_, i) => ({ vin: `1HGCM82633A${String(i).padStart(6, '0')}`, dealerId: 1 })), seenAfter: 'T', log: () => {} });
    assert.equal(calls404, 1);
    assert.equal(old.failedCalls, 1);
  });
  it('stops when the sync lock is lost', async () => {
    let calls = 0;
    await runSupersede({ api: async () => { calls++; return { retired: 0 }; }, rows, seenAfter: 'T', isLockLost: () => true, log: () => {} });
    assert.equal(calls, 0);
  });
});
