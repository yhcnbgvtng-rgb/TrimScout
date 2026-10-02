// POST /api/inventory/sweep now also takes `dealerIds` (a batch of stores, one UPDATE). The single-store form
// must stay byte-for-byte what it always was, because a box still running the previous sync client uses it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSweepRequest, buildSweepStatement, MAX_SWEEP_STORES } from '../src/inventorySweep.js';

// The same conversions the server passes in (INV_INT / INV_STR in deals_api_server.js).
const toInt = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
const toStr = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const parse = (body) => parseSweepRequest(body, { toInt, toStr });
const SEEN = '2026-10-02T09:50:00.000Z';

describe('parseSweepRequest — the original single-store form', () => {
  it('accepts dealerId + seenAfter (+ sources) exactly as before', () => {
    const r = parse({ dealerId: 12, seenAfter: SEEN, sources: ['nightly'] });
    assert.deepEqual({ ok: r.ok, ids: r.dealerIds, batch: r.batch, sources: r.sources }, { ok: true, ids: [12], batch: false, sources: ['nightly'] });
    assert.equal(r.seenAfter.toISOString(), SEEN);
  });

  it('dealerId 0 (the "no store matched" bucket) is valid', () => {
    assert.deepEqual(parse({ dealerId: 0, seenAfter: SEEN }).dealerIds, [0]);
  });

  it('keeps the original validation message for everything it always rejected', () => {
    const want = { ok: false, error: 'dealerId and seenAfter (ISO) are required' };
    assert.deepEqual(parse({ seenAfter: SEEN }), want);
    assert.deepEqual(parse({ dealerId: 'abc', seenAfter: SEEN }), want);
    assert.deepEqual(parse({ dealerId: 5 }), want);
    assert.deepEqual(parse({ dealerId: 5, seenAfter: 'not a date' }), want);
    assert.deepEqual(parse({}), want);
    assert.deepEqual(parse(null), want);
  });

  it('cleans sources the way the server always did', () => {
    assert.deepEqual(parse({ dealerId: 1, seenAfter: SEEN, sources: ['nightly', '', null, '  manual  ', 7] }).sources, ['nightly', 'manual']);
    assert.deepEqual(parse({ dealerId: 1, seenAfter: SEEN, sources: 'nightly' }).sources, []);
  });
});

describe('parseSweepRequest — batches', () => {
  it('accepts dealerIds, de-duplicated, and marks the request as a batch', () => {
    const r = parse({ dealerIds: [5, 3, 5, 9], seenAfter: SEEN, sources: ['nightly'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.dealerIds, [5, 3, 9]);
    assert.equal(r.batch, true);
  });

  it('rejects what could not be one valid UPDATE', () => {
    assert.match(parse({ dealerIds: [], seenAfter: SEEN }).error, /non-empty array/);
    assert.match(parse({ dealerIds: 'x', seenAfter: SEEN }).error, /non-empty array/);
    assert.match(parse({ dealerIds: [1, 'x'], seenAfter: SEEN }).error, /integers/);
    assert.match(parse({ dealerIds: ids(MAX_SWEEP_STORES + 1), seenAfter: SEEN }).error, /limited to 200/);
    assert.match(parse({ dealerIds: [1], dealerId: 2, seenAfter: SEEN }).error, /not both/);
    assert.equal(parse({ dealerIds: [1, 2], seenAfter: 'nope' }).error, 'dealerId and seenAfter (ISO) are required');
  });

  it('accepts exactly the maximum', () => {
    assert.equal(parse({ dealerIds: ids(MAX_SWEEP_STORES), seenAfter: SEEN }).ok, true);
  });
});

describe('buildSweepStatement', () => {
  const seenAfter = new Date(SEEN);

  it('one store: the exact statement the single-store sweep always ran', () => {
    const { sql, args } = buildSweepStatement({ dealerIds: [12], seenAfter, sources: ['nightly'] });
    assert.equal(sql, 'UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id = ? AND removed_at IS NULL AND last_seen_at < ? AND source IN (?)');
    assert.deepEqual(args, [12, seenAfter, ['nightly']]);
  });

  it('one store without sources has no source clause', () => {
    const { sql, args } = buildSweepStatement({ dealerIds: [0], seenAfter, sources: [] });
    assert.equal(sql, 'UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id = ? AND removed_at IS NULL AND last_seen_at < ?');
    assert.deepEqual(args, [0, seenAfter]);
  });

  it('several stores: one UPDATE with a single-column IN-list, the same filters, args in placeholder order', () => {
    const { sql, args } = buildSweepStatement({ dealerIds: [3, 5, 9], seenAfter, sources: ['nightly'] });
    assert.equal(sql, 'UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id IN (?) AND removed_at IS NULL AND last_seen_at < ? AND source IN (?)');
    assert.deepEqual(args, [[3, 5, 9], seenAfter, ['nightly']]);
    assert.equal((sql.match(/\?/g) || []).length, args.length);
  });

  it('never builds a row-value IN-list (MariaDB cannot range-scan those on this table)', () => {
    const { sql } = buildSweepStatement({ dealerIds: [1, 2], seenAfter, sources: [] });
    assert.doesNotMatch(sql, /\(\s*\w+\s*,\s*\w+\s*\)\s+IN/i);
  });
});

function ids(n) { return Array.from({ length: n }, (_, i) => i + 1); }
