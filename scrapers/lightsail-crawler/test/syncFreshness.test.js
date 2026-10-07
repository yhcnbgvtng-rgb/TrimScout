// The two failure modes traced on 2026-10-07 (Brownsville Toyota TX), plus the shard-integrity rule.
//   1. STALE RE-STAMP: a shard record last refreshed 11 days ago must not be uploaded as if seen now.
//   2. CROSS-BOX SWEEP: one box's sweep must not retire rows another box wrote since foreignBefore.
//   3. FAIL CLOSED: a truncated shard is not read; an over-size shard is read but never swept.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isFreshRecord, freshnessConfig, checkShardStructure, shardPlan, sweepableStores, foreignBeforeIso, DEFAULT_MAX_RECORD_AGE_HOURS } from '../../../scripts/box/syncFreshness.js';
import { runSweep } from '../../../scripts/box/syncSweep.js';
import { parseSweepRequest, buildSweepStatement } from '../src/inventorySweep.js';

const NOW = Date.parse('2026-10-07T17:00:00Z');
const HOUR = 3600_000;
const MAX = DEFAULT_MAX_RECORD_AGE_HOURS * HOUR;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-'));
const write = (name, text) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };

describe('failure mode 1 — stale shard records are never re-stamped as fresh', () => {
  it('the Brownsville case: a record last refreshed 2026-09-26 is not fresh on 2026-10-07', () => {
    assert.equal(isFreshRecord({ vin: '2T36DRBV1TW029650', status: 'ACTIVE', updatedAt: '2026-09-26T08:01:16.071Z' }, NOW, MAX), false);
  });
  it('a record refreshed by last night\'s crawl is fresh', () => {
    assert.equal(isFreshRecord({ updatedAt: '2026-10-07T06:23:00Z' }, NOW, MAX), true);
    assert.equal(isFreshRecord({ updatedAt: new Date(NOW - 29 * HOUR).toISOString() }, NOW, MAX), true);
  });
  it('the age limit is the boundary', () => {
    assert.equal(isFreshRecord({ updatedAt: new Date(NOW - MAX - 1000).toISOString() }, NOW, MAX), false);
  });
  it('missing, empty or garbage updatedAt is NOT fresh (fail closed)', () => {
    for (const bad of [undefined, null, '', 'yesterday', 0, {}]) assert.equal(isFreshRecord({ updatedAt: bad }, NOW, MAX), false);
    assert.equal(isFreshRecord(null, NOW, MAX), false);
  });
  it('a clock a few minutes ahead is tolerated; a date far in the future is not', () => {
    assert.equal(isFreshRecord({ updatedAt: new Date(NOW + 5 * 60_000).toISOString() }, NOW, MAX), true);
    assert.equal(isFreshRecord({ updatedAt: new Date(NOW + 3 * HOUR).toISOString() }, NOW, MAX), false);
  });
  it('a store whose records are ALL stale uploads nothing, so it is never swept', () => {
    const records = Array.from({ length: 152 }, (_, i) => ({ dealerId: 7100, vin: `V${i}`, updatedAt: '2026-09-26T08:01:16Z' }));
    const freshStores = records.filter((r) => isFreshRecord(r, NOW, MAX)).map((r) => r.dealerId);
    assert.deepEqual(sweepableStores(freshStores), []);
  });
});

describe('failure mode 2 — a sweep does not retire rows another box wrote recently', () => {
  const params = { dealerIds: [7100], seenAfter: new Date('2026-10-07T12:29:00Z'), sources: ['nightly'] };
  it('without the new fields the statement is byte-for-byte the old one (old clients unaffected)', () => {
    const { sql } = buildSweepStatement(params);
    assert.equal(sql, 'UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id = ? AND removed_at IS NULL AND last_seen_at < ? AND source IN (?)');
  });
  it('with sourceBox + foreignBefore, rows from other boxes are protected until they have gone unseen past foreignBefore', () => {
    const foreignBefore = new Date('2026-10-05T12:29:00Z');
    const { sql, args } = buildSweepStatement({ ...params, sourceBox: 'box3', foreignBefore });
    assert.match(sql, /AND source IN \(\?\) AND \(source_box = \? OR source_box IS NULL OR last_seen_at < \?\)$/);
    assert.deepEqual(args, [7100, params.seenAfter, ['nightly'], 'box3', foreignBefore]);
  });
  it('the batch form carries it too', () => {
    const { sql } = buildSweepStatement({ ...params, dealerIds: [1, 2, 3], sourceBox: 'box3', foreignBefore: new Date() });
    assert.match(sql, /dealer_id IN \(\?\)/);
    assert.match(sql, /source_box = \?/);
  });
  it('the API accepts and validates the new fields', () => {
    const toInt = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
    const toStr = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    const ok = parseSweepRequest({ dealerIds: [7100, 7101], seenAfter: '2026-10-07T12:29:00Z', sources: ['nightly'], sourceBox: 'box3', foreignBefore: '2026-10-05T12:29:00Z' }, { toInt, toStr });
    assert.equal(ok.ok, true);
    assert.equal(ok.sourceBox, 'box3');
    assert.equal(ok.foreignBefore.toISOString(), '2026-10-05T12:29:00.000Z');
    const bad = parseSweepRequest({ dealerId: 1, seenAfter: '2026-10-07T12:29:00Z', sourceBox: 'box3' }, { toInt, toStr });
    assert.equal(bad.ok, false, 'sourceBox without foreignBefore would protect nothing — reject it');
    assert.equal(parseSweepRequest({ dealerId: 1, seenAfter: '2026-10-07T12:29:00Z' }, { toInt, toStr }).sourceBox, undefined);
  });
  it('the sync run sends them on every sweep call (batch and per-store)', async () => {
    const calls = [];
    const api = async (p, body) => { calls.push(body); return { removed: 0 }; };
    await runSweep({ api, stores: [1, 2, 3], startedAt: '2026-10-07T12:29:00.000Z', sourceBox: 'box3', foreignBefore: '2026-10-05T12:29:00.000Z', sleep: async () => {} });
    assert.ok(calls.length > 0);
    for (const c of calls) { assert.equal(c.sourceBox, 'box3'); assert.equal(c.foreignBefore, '2026-10-05T12:29:00.000Z'); }
  });
  it('foreignBefore is the run start minus the grace period', () => {
    assert.equal(foreignBeforeIso('2026-10-07T12:29:00.000Z', 48 * HOUR), '2026-10-05T12:29:00.000Z');
  });
});

describe('failure mode 3 — a truncated or over-size state file is not synced as complete', () => {
  it('a well-formed array passes', () => {
    assert.deepEqual(checkShardStructure(write('ok.json', '[\n{"vin":"A"},\n{"vin":"B"}\n]\n')), { ok: true });
    assert.deepEqual(checkShardStructure(write('empty.json', '[]')), { ok: true });
  });
  it('a file cut off mid-record is rejected', () => {
    const r = checkShardStructure(write('cut.json', '[\n{"vin":"A"},\n{"vin":"B","dealerNa'));
    assert.equal(r.ok, false);
    assert.match(r.reason, /truncated/);
  });
  it('an empty file, a non-array file and a missing file are rejected', () => {
    assert.equal(checkShardStructure(write('zero.json', '')).ok, false);
    assert.equal(checkShardStructure(write('obj.json', '{"a":1}')).ok, false);
    assert.equal(checkShardStructure(path.join(tmp, 'nope.json')).ok, false);
  });
  it('plan: broken -> skip entirely; over the limit -> upload fresh but never sweep; otherwise normal', () => {
    const max = 480 * 1048576;
    assert.equal(shardPlan({ sizeBytes: 1000, structure: { ok: false, reason: 'x' }, maxBytes: max }).action, 'skip');
    const big = shardPlan({ sizeBytes: 507 * 1048576, structure: { ok: true }, maxBytes: max });
    assert.equal(big.action, 'noSweep');
    assert.match(big.reason, /507MB is over the 480MB limit/);
    assert.equal(shardPlan({ sizeBytes: 411 * 1048576, structure: { ok: true }, maxBytes: max }).action, 'normal');
  });
  it('stores that came from an over-size shard are removed from the sweep list', () => {
    const excluded = new Set([7100, 7101]);
    assert.deepEqual(sweepableStores([7100, 7101, 7102, 7102, 0, null], excluded), [7102]);
  });
});

describe('configuration', () => {
  it('defaults: 30h record age, 48h foreign grace, 480MB shard limit', () => {
    const c = freshnessConfig({});
    assert.equal(c.maxRecordAgeMs, 30 * HOUR);
    assert.equal(c.foreignGraceMs, 48 * HOUR);
    assert.equal(c.shardMaxBytes, 480 * 1048576);
  });
  it('is overridable, and ignores nonsense', () => {
    assert.equal(freshnessConfig({ SYNC_MAX_RECORD_AGE_HOURS: '12' }).maxRecordAgeMs, 12 * HOUR);
    assert.equal(freshnessConfig({ SYNC_MAX_RECORD_AGE_HOURS: '-3' }).maxRecordAgeMs, 30 * HOUR);
    assert.equal(freshnessConfig({ SYNC_SHARD_MAX_MB: 'abc' }).shardMaxBytes, 480 * 1048576);
  });
});
