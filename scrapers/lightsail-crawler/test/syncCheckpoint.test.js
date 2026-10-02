// inventory-sync.mjs had no resume — a crash redid the whole file from row 0. This checkpoint is
// purely an optimization on top of already-idempotent upserts: a second run against the SAME
// source file skips rows already covered, a run against a DIFFERENT file starts at 0.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFileIdentity, sortRows, makeCheckpoint, resumeFrom,
  RUN_STATE_VERSION, MAX_RESUME_AGE_MS, newRunState, parseRunState, upsertStartIndex,
} from '../../../scripts/box/syncCheckpoint.js';

const rowsFixture = [
  { vin: 'VIN3', dealerId: 1 },
  { vin: 'VIN1', dealerId: 2 },
  { vin: 'VIN2', dealerId: 1 },
  { vin: 'VIN4', dealerId: 0 },
];

describe('computeFileIdentity', () => {
  it('is stable regardless of shard order', () => {
    const a = [{ path: 'NJ.json', size: 100, mtimeMs: 5 }, { path: 'NY.json', size: 200, mtimeMs: 6 }];
    const b = [{ path: 'NY.json', size: 200, mtimeMs: 6 }, { path: 'NJ.json', size: 100, mtimeMs: 5 }];
    assert.equal(computeFileIdentity(a), computeFileIdentity(b));
  });

  it('changes when a shard is resized/rewritten (new crawl content)', () => {
    const a = [{ path: 'NJ.json', size: 100, mtimeMs: 5 }];
    const b = [{ path: 'NJ.json', size: 101, mtimeMs: 5 }];
    assert.notEqual(computeFileIdentity(a), computeFileIdentity(b));
  });
});

describe('sortRows', () => {
  it('orders by (dealerId, vin) deterministically', () => {
    assert.deepEqual(sortRows(rowsFixture).map((r) => `${r.dealerId}:${r.vin}`), ['0:VIN4', '1:VIN2', '1:VIN3', '2:VIN1']);
  });
});

describe('resumeFrom / makeCheckpoint', () => {
  it('a second start on the same file skips dealers/rows already completed', () => {
    const sorted = sortRows(rowsFixture);
    const identity = 'fileA';
    const checkpoint = makeCheckpoint(identity, sorted[1]); // last completed = dealer 1 / VIN2
    const remaining = resumeFrom(sorted, checkpoint, identity);
    assert.deepEqual(remaining.map((r) => `${r.dealerId}:${r.vin}`), ['1:VIN3', '2:VIN1']);
  });

  it('a different file ignores the old checkpoint and starts at 0', () => {
    const sorted = sortRows(rowsFixture);
    const checkpoint = makeCheckpoint('fileA', sorted[1]);
    const remaining = resumeFrom(sorted, checkpoint, 'fileB');
    assert.deepEqual(remaining, sorted);
  });

  it('no checkpoint at all starts at 0', () => {
    const sorted = sortRows(rowsFixture);
    assert.deepEqual(resumeFrom(sorted, null, 'fileA'), sorted);
  });

  it('a checkpoint at the very last row resumes to an empty remainder', () => {
    const sorted = sortRows(rowsFixture);
    const checkpoint = makeCheckpoint('fileA', sorted.at(-1));
    assert.deepEqual(resumeFrom(sorted, checkpoint, 'fileA'), []);
  });
});

// ---- run state v2 ----------------------------------------------------------------------------------------
// The v1 checkpoint only remembered how far the upsert loop got, and a resumed run recomputed the sweep cutoff
// from its own start time: rows the earlier attempt had written (and the resume skipped) were then older than
// the cutoff and got swept as "no longer listed". v2 persists the cutoff and the phase.
describe('run state v2', () => {
  const NOW = Date.parse('2026-10-02T12:00:00Z');
  const startedAt = '2026-10-02T09:50:00.000Z';
  const identity = 'shards#abc123';
  const fresh = () => newRunState({ fileIdentity: identity, startedAt, now: NOW });

  it('a new state starts in the upsert phase with the sweep cutoff recorded', () => {
    const st = fresh();
    assert.equal(st.version, RUN_STATE_VERSION);
    assert.equal(st.startedAt, startedAt);
    assert.equal(st.phase, 'upsert');
    assert.deepEqual(st.upsert, { lastDealerId: null, lastVin: null, rows: 0 });
    assert.deepEqual(st.sweep, { nextIndex: 0, removed: 0, failedStores: [], store0Done: false });
  });

  it('round-trips through JSON, keeping the cutoff, phase and cursors', () => {
    const st = fresh();
    st.phase = 'sweep';
    st.upsert = { lastDealerId: 77, lastVin: 'ZZZ', rows: 12345 };
    st.sweep = { nextIndex: 300, removed: 9, failedStores: [4, 8], store0Done: true };
    const back = parseRunState(JSON.parse(JSON.stringify(st)), identity, { now: NOW + 3600_000 });
    assert.deepEqual(back, { ...st, startedAt: new Date(startedAt).toISOString() });
  });

  it('ignores a v1 checkpoint (no cutoff recorded) — a full run is always safe', () => {
    assert.equal(parseRunState({ fileIdentity: identity, lastDealerId: 5, lastVin: 'X' }, identity, { now: NOW }), null);
  });

  it('ignores state for a different crawl output, a stale one, and anything malformed', () => {
    assert.equal(parseRunState(fresh(), 'other#xyz', { now: NOW }), null);
    assert.equal(parseRunState(fresh(), identity, { now: Date.parse(startedAt) + MAX_RESUME_AGE_MS + 1 }), null);
    assert.ok(parseRunState(fresh(), identity, { now: Date.parse(startedAt) + MAX_RESUME_AGE_MS - 1 }));
    assert.equal(parseRunState({ ...fresh(), phase: 'done' }, identity, { now: NOW }), null);
    assert.equal(parseRunState({ ...fresh(), startedAt: 'not a date' }, identity, { now: NOW }), null);
    for (const junk of [null, undefined, 'x', 42, [], {}]) assert.equal(parseRunState(junk, identity, { now: NOW }), null);
  });

  it('coerces damaged sub-objects to safe defaults instead of trusting them', () => {
    const st = parseRunState({ ...fresh(), upsert: 'oops', sweep: { nextIndex: -5, removed: 'x', failedStores: ['3', 'a', 9] } }, identity, { now: NOW });
    assert.deepEqual(st.upsert, { lastDealerId: null, lastVin: null, rows: 0 });
    assert.deepEqual(st.sweep, { nextIndex: 0, removed: 0, failedStores: [3, 9], store0Done: false });
  });
});

describe('upsertStartIndex', () => {
  const sorted = sortRows([
    { vin: 'A1', dealerId: 0 }, { vin: 'B1', dealerId: 0 }, { vin: 'A2', dealerId: 3 }, { vin: 'C2', dealerId: 3 },
    { vin: 'D2', dealerId: 3 }, { vin: 'A9', dealerId: 9 },
  ]);

  it('is 0 when nothing has been upserted yet', () => {
    assert.equal(upsertStartIndex(sorted, { lastDealerId: null, lastVin: null, rows: 0 }), 0);
    assert.equal(upsertStartIndex(sorted, null), 0);
  });

  it('points at the first row strictly after the cursor, within and across stores', () => {
    assert.equal(upsertStartIndex(sorted, { lastDealerId: 0, lastVin: 'A1' }), 1);
    assert.equal(upsertStartIndex(sorted, { lastDealerId: 3, lastVin: 'C2' }), 4);
    assert.equal(upsertStartIndex(sorted, { lastDealerId: 3, lastVin: 'D2' }), 5); // store boundary
    assert.equal(upsertStartIndex(sorted, { lastDealerId: 9, lastVin: 'A9' }), 6); // everything done
    assert.equal(upsertStartIndex(sorted, { lastDealerId: 5, lastVin: 'Q' }), 5); // cursor between stores
  });

  it('agrees with resumeFrom for every possible cursor position', () => {
    for (let k = 0; k < sorted.length; k++) {
      const cursor = makeCheckpoint('f', sorted[k]);
      const viaSlice = sorted.length - resumeFrom(sorted, cursor, 'f').length;
      assert.equal(upsertStartIndex(sorted, cursor), viaSlice, `cursor at row ${k}`);
    }
  });

  it('works on a large sorted list (binary search)', () => {
    const big = sortRows(Array.from({ length: 50_000 }, (_, i) => ({ vin: `V${String(i * 7 % 50_000).padStart(8, '0')}`, dealerId: i % 40 })));
    for (const k of [0, 1, 777, 25_000, 49_999]) {
      assert.equal(upsertStartIndex(big, makeCheckpoint('f', big[k])), k + 1);
    }
  });
});
