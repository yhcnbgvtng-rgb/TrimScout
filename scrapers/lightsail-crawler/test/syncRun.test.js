// The write phase end to end against a fake deals API that models what matters about the real one: an upsert
// stamps last_seen_at, a sweep retires rows of the given stores that were last seen before the cutoff. That
// lets these tests assert the properties that decide whether a night's inventory is right — above all that a
// run which dies and is picked up again never retires a vehicle that is still listed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../../scripts/box/syncHttp.js';
import { LockLostError, SweepAbortError } from '../../../scripts/box/syncSweep.js';
import { runWritePhase, configFromEnv, BULK_PATH, STATS_PATH } from '../../../scripts/box/syncRun.js';
import { RUN_STATE_VERSION } from '../../../scripts/box/syncCheckpoint.js';

const T0 = Date.parse('2026-10-02T06:00:00Z');
const vin = (i) => `1HGBH41JXMN${String(i).padStart(6, '0')}`;
const makeRows = (n, stores = 4) => Array.from({ length: n }, (_, i) => ({ vin: vin(i), dealerId: (i % stores) + 1, dealerName: `Dealer ${(i % stores) + 1}`, source: 'nightly', note: 'x'.repeat(40) }));
const cfg = (over = {}) => ({ ...configFromEnv({}), batchRows: 10, progressMs: 0, bulkRetries: 0, ...over });
const retryable = () => new ApiError('/api/inventory/bulk -> 500 Internal server error', { status: 500, retryable: true });

function memoryStore(initial = null) {
  const store = { data: initial, saves: 0, load: () => (store.data ? JSON.parse(JSON.stringify(store.data)) : null), save: (s) => { store.data = JSON.parse(JSON.stringify(s)); store.saves++; }, clear: () => { store.data = null; } };
  return store;
}

// An in-memory stand-in for the deals API + its table. `clock.t` is the box's clock in ms. `fail.*` can be
// changed between attempts to "heal" the API.
function fakeDeals({ clock, rows = [], timings = null, bulkFail = null, sweepFail = null, statsFail = false, batchSweep = true } = {}) {
  const db = new Map(); // `${vin}|${dealerId}` -> { dealerId, lastSeen, removed }
  for (const r of rows) db.set(`${r.vin}|${r.dealerId}`, { dealerId: r.dealerId, lastSeen: r.lastSeen, removed: false });
  const calls = { bulk: [], sweep: [], stats: 0 };
  const fail = { bulk: bulkFail, sweep: sweepFail, stats: statsFail };
  const api = async (path, body) => {
    if (path === BULK_PATH) {
      const vehicles = JSON.parse(body).vehicles;
      calls.bulk.push(vehicles.map((v) => v.vin));
      if (fail.bulk && fail.bulk(calls.bulk.length)) throw retryable();
      for (const v of vehicles) db.set(`${v.vin}|${v.dealerId}`, { dealerId: v.dealerId, lastSeen: clock.t, removed: false });
      return { upserted: vehicles.length, optionSetsReplaced: 1, optionSetsKept: 2, optionSetsUnchanged: 3, optionRowsWritten: 4, optionJunkDropped: 5, ...(timings ? { timings } : {}) };
    }
    if (path === STATS_PATH) {
      calls.stats++;
      if (fail.stats) throw retryable();
      return { total: db.size, vins: db.size, inStock: [...db.values()].filter((r) => !r.removed).length, dealers: 4, byState: [{ state: 'NJ', n: 1 }] };
    }
    // sweep
    calls.sweep.push(body);
    if (body.dealerIds && !batchSweep) throw new ApiError('/api/inventory/sweep -> 400 dealerId and seenAfter (ISO) are required', { status: 400 });
    if (fail.sweep && fail.sweep(body)) throw retryable();
    const stores = new Set(body.dealerIds || [body.dealerId]);
    let removed = 0;
    for (const r of db.values()) if (stores.has(r.dealerId) && !r.removed && r.lastSeen < Date.parse(body.seenAfter)) { r.removed = true; removed++; }
    return { removed };
  };
  return { api, db, calls, fail, active: () => [...db.entries()].filter(([, r]) => !r.removed).map(([k]) => k.split('|')[0]) };
}

const run = (over) => runWritePhase({ log: () => {}, sleep: async () => {}, config: cfg(), now: () => over.clock.t, fileIdentity: 'shards-A', ...over });

describe('a normal run', () => {
  it('upserts every row once in size-capped batches, sweeps, reads the totals, and clears its saved state', async () => {
    const clock = { t: T0 };
    const rows = makeRows(25);
    const d = fakeDeals({ clock });
    const store = memoryStore();
    const r = await run({ rows, api: d.api, store, clock });
    assert.deepEqual(d.calls.bulk.map((b) => b.length), [10, 10, 5]);
    assert.deepEqual(d.calls.bulk.flat().sort(), rows.map((x) => x.vin).sort(), 'every vehicle exactly once');
    assert.equal(r.upserted, 25);
    assert.equal(r.skippedRows, 0);
    assert.equal(r.resumed, false);
    assert.equal(r.live.inStock, 25);
    assert.equal(d.calls.stats, 1);
    assert.equal(store.data, null, 'state removed after a complete run');
    assert.ok(store.saves >= 4, 'state was saved as it went');
  });

  it('uploads in (store, vin) order and caps each request by bytes as well as rows', async () => {
    const clock = { t: T0 };
    const d = fakeDeals({ clock });
    await run({ rows: makeRows(30), api: d.api, store: memoryStore(), clock, config: cfg({ batchRows: 1000, batchMaxBytes: 700 }) });
    const flat = d.calls.bulk.flat();
    assert.equal(flat.length, 30);
    assert.ok(d.calls.bulk.length > 3, 'the byte cap split what the row cap alone would have sent in one request');
    const byStore = (v) => Number(makeRows(30).find((r) => r.vin === v).dealerId);
    assert.deepEqual(flat.map(byStore), flat.map(byStore).slice().sort((a, b) => a - b));
  });

  it('sweeps stores in batches with a cutoff 10 minutes before the run started, then the no-store bucket', async () => {
    const clock = { t: T0 };
    const d = fakeDeals({ clock });
    await run({ rows: makeRows(20, 4), api: d.api, store: memoryStore(), clock, config: cfg({ sweepBatchStores: 3 }) });
    assert.deepEqual(d.calls.sweep.map((s) => s.dealerIds || s.dealerId), [[1, 2, 3], [4], 0]);
    assert.equal(d.calls.sweep[0].seenAfter, new Date(T0 - 10 * 60_000).toISOString());
  });

  it('reports the deals API\'s own timings and counters', async () => {
    const clock = { t: T0 };
    const logs = [];
    const d = fakeDeals({ clock, timings: { upsertMs: 100, optionsMs: 60, optionsReadMs: 5, daysMs: 20, totalMs: 190 } });
    const r = await run({ rows: makeRows(25), api: d.api, store: memoryStore(), clock, log: (m) => logs.push(m) });
    assert.equal(r.timings.server.requests, 3);
    assert.equal(r.timings.server.optionsMs, 180);
    assert.deepEqual(r.optionStats, { setsReplaced: 3, setsKept: 6, setsUnchanged: 9, rowsWritten: 12, junkDropped: 15 });
    assert.ok(logs.some((m) => /deals API time inside those requests/.test(m)));
    assert.ok(logs.some((m) => /factory options: 3 vehicles replaced .* 9 unchanged/.test(m)));
  });

  it('keeps the "upserted N/M" progress line existing log readers look for', async () => {
    const clock = { t: T0 };
    const logs = [];
    await run({ rows: makeRows(25), api: fakeDeals({ clock }).api, store: memoryStore(), clock, log: (m) => logs.push(m) });
    assert.ok(logs.some((m) => /upserted 10\/25/.test(m)) && logs.some((m) => /upserted 25\/25/.test(m)));
  });
});

describe('resuming after a crash during the upserts', () => {
  it('continues at the next row — nothing is sent twice, nothing is missed — and reuses the sweep cutoff', async () => {
    const clock = { t: T0 };
    const rows = makeRows(45);
    const d = fakeDeals({ clock, bulkFail: (n) => n === 3 });
    const store = memoryStore();
    await assert.rejects(run({ rows, api: d.api, store, clock }), /Internal server error/);
    assert.equal(store.data.phase, 'upsert');
    assert.equal(store.data.upsert.rows, 20);
    const cutoff = store.data.startedAt;
    const sentBefore = d.calls.bulk.length;

    clock.t = T0 + 3 * 3_600_000; // picked up three hours later
    d.fail.bulk = null;
    const r = await run({ rows, api: d.api, store, clock });
    assert.equal(r.resumed, true);
    assert.equal(r.skippedRows, 20);
    const delivered = d.calls.bulk.filter((b, i) => i < 2 || i >= sentBefore).flat(); // calls 1-2 succeeded, call 3 failed, then the resume
    assert.deepEqual(delivered.slice().sort(), rows.map((x) => x.vin).sort(), 'the union is every row exactly once');
    assert.ok(d.calls.bulk.every((b) => b.length > 0), 'no empty requests (the old loop sent empty batches past the end of a resumed list)');
    assert.equal(d.calls.sweep[0].seenAfter, cutoff, 'the resumed sweep uses the ORIGINAL cutoff');
    assert.equal(store.data, null);
  });

  it('REGRESSION: a resumed run never retires a vehicle that is still listed', async () => {
    // Four stores, 40 listed vehicles, plus 5 vehicles in store 1 that the crawl no longer lists (last seen yesterday).
    const clock = { t: T0 };
    const rows = makeRows(40);
    const stale = Array.from({ length: 5 }, (_, i) => ({ vin: vin(900 + i), dealerId: 1, lastSeen: T0 - 24 * 3_600_000 }));
    const d = fakeDeals({ clock, rows: stale, bulkFail: (n) => n === 3 });
    const store = memoryStore();
    await assert.rejects(run({ rows, api: d.api, store, clock }));
    const writtenByFirstAttempt = [...d.db.values()].filter((r) => r.lastSeen === T0).length;
    assert.equal(writtenByFirstAttempt, 20);

    clock.t = T0 + 3 * 3_600_000;
    d.fail.bulk = null;
    const resumed = await run({ rows, api: d.api, store, clock });
    assert.equal(resumed.skippedRows, writtenByFirstAttempt);
    const active = new Set(d.active());
    for (const r of rows) assert.ok(active.has(r.vin), `${r.vin} is still listed but was retired`);
    for (const x of stale) assert.ok(!active.has(x.vin), `${x.vin} is no longer listed and should have been retired`);

    // The test has teeth: the cutoff this run recomputed at resume time (the old behavior) would be LATER than
    // the first attempt's rows' last_seen_at, so every one of them would have been swept as stale.
    assert.ok(clock.t - 10 * 60_000 > T0, 'a cutoff recomputed at resume time post-dates the rows the first attempt wrote');
  });

  it('a different crawl output (a new night\'s files) ignores the saved state and runs in full', async () => {
    const clock = { t: T0 };
    const rows = makeRows(30);
    const d = fakeDeals({ clock, bulkFail: (n) => n === 2 });
    const store = memoryStore();
    await assert.rejects(run({ rows, api: d.api, store, clock }));
    const d2 = fakeDeals({ clock });
    const r = await run({ rows, api: d2.api, store, clock, fileIdentity: 'shards-B' });
    assert.equal(r.resumed, false);
    assert.equal(d2.calls.bulk.flat().length, 30);
  });

  it('the same files but a changed store assignment (a rooftop added to the directory meanwhile) also starts over', async () => {
    const clock = { t: T0 };
    const rows = makeRows(30);
    const d = fakeDeals({ clock, bulkFail: (n) => n === 2 });
    const store = memoryStore();
    await assert.rejects(run({ rows, api: d.api, store, clock }));
    const reassigned = rows.map((r, i) => (i === 3 ? { ...r, dealerId: 99 } : r));
    const d2 = fakeDeals({ clock });
    const r = await run({ rows: reassigned, api: d2.api, store, clock });
    assert.equal(r.resumed, false);
    assert.equal(d2.calls.bulk.flat().length, 30);
  });

  it('ignores a v1 checkpoint left by the previous client', async () => {
    const clock = { t: T0 };
    const store = memoryStore({ fileIdentity: 'shards-A', lastDealerId: 2, lastVin: vin(5) });
    const d = fakeDeals({ clock });
    const r = await run({ rows: makeRows(20), api: d.api, store, clock });
    assert.equal(r.resumed, false);
    assert.equal(d.calls.bulk.flat().length, 20);
  });

  it('retries a failing upsert request in place before giving up, then keeps its place', async () => {
    const clock = { t: T0 };
    const waits = [];
    const d = fakeDeals({ clock, bulkFail: (n) => n <= 2 });
    const r = await run({ rows: makeRows(10), api: d.api, store: memoryStore(), clock, config: cfg({ bulkRetries: 3 }), sleep: async (ms) => { waits.push(ms); } });
    assert.equal(r.upserted, 10);
    assert.deepEqual(waits, [5000, 7500]);
  });
});

describe('resuming after a crash during the sweep', () => {
  it('does not touch the upserts again, retries the stores it had to skip, continues at the saved store, and reuses the cutoff', async () => {
    const clock = { t: T0 };
    const rows = makeRows(60, 12); // 12 stores, swept 3 per call
    const down = (b) => (b.dealerIds ? b.dealerIds[0] >= 4 : b.dealerId >= 4); // the API dies after the first batch
    const d = fakeDeals({ clock, sweepFail: down });
    const store = memoryStore();
    const config = cfg({ batchRows: 100, sweepBatchStores: 3 });
    await assert.rejects(run({ rows, api: d.api, store, clock, config }), (err) => err instanceof SweepAbortError);
    // Batch 1 (stores 1-3) finished; batch 2's stores (4-6) were skipped one by one before the run gave up in batch 3.
    assert.equal(store.data.phase, 'sweep');
    assert.equal(store.data.sweep.nextIndex, 6);
    assert.deepEqual(store.data.sweep.failedStores, [4, 5, 6]);
    assert.equal(d.calls.bulk.length, 1, 'the upserts ran once');
    const cutoff = store.data.startedAt;

    clock.t = T0 + 2 * 3_600_000; // picked up later, after the API is healthy again
    d.fail.sweep = null;
    const sweepsBefore = d.calls.sweep.length;
    const r = await run({ rows, api: d.api, store, clock, config });
    assert.equal(r.resumed, true);
    assert.equal(d.calls.bulk.length, 1, 'no upserts on a sweep resume');
    const resumedSweeps = d.calls.sweep.slice(sweepsBefore);
    assert.deepEqual(resumedSweeps.map((s) => s.dealerIds || s.dealerId), [4, 5, 6, [7, 8, 9], [10, 11, 12], 0], 'skipped stores first, then where it left off, then the no-store bucket');
    assert.ok(resumedSweeps.every((s) => s.seenAfter === cutoff), 'same cutoff');
    assert.deepEqual(r.failedStores, []);
    assert.equal(r.sweptStores, 12);
    assert.equal(store.data, null);
  });
});

describe('safety', () => {
  it('stops before the next write once the heartbeat says the lock is gone — never a second writer', async () => {
    const clock = { t: T0 };
    const d = fakeDeals({ clock });
    let lost = false;
    const api = async (p, b) => { const r = await d.api(p, b); if (p === BULK_PATH && d.calls.bulk.length === 2) lost = true; return r; };
    await assert.rejects(run({ rows: makeRows(50), api, store: memoryStore(), clock, isLockLost: () => lost }), LockLostError);
    assert.equal(d.calls.bulk.length, 2);
    assert.equal(d.calls.sweep.length, 0);
  });

  it('a lock lost during the sweep also stops it', async () => {
    const clock = { t: T0 };
    const d = fakeDeals({ clock });
    let lost = false;
    const api = async (p, b) => { if (p !== BULK_PATH && p !== STATS_PATH) lost = true; return d.api(p, b); };
    await assert.rejects(run({ rows: makeRows(20, 8), api, store: memoryStore(), clock, isLockLost: () => lost, config: cfg({ batchRows: 100, sweepBatchStores: 2 }) }), LockLostError);
    assert.equal(d.calls.sweep.length, 1);
  });

  it('the final totals only feed a log line: if they fail the sync is still complete and its state is cleared', async () => {
    const clock = { t: T0 };
    const logs = [];
    const store = memoryStore();
    const r = await run({ rows: makeRows(10), api: fakeDeals({ clock, statsFail: true }).api, store, clock, log: (m) => logs.push(m) });
    assert.equal(r.live, null);
    assert.ok(logs.some((m) => /live totals unavailable/.test(m)));
    assert.equal(store.data, null);
  });

  it('works against a deals API that has no batched sweep and no timings (previous version)', async () => {
    const clock = { t: T0 };
    const d = fakeDeals({ clock, batchSweep: false });
    const r = await run({ rows: makeRows(20, 5), api: d.api, store: memoryStore(), clock });
    assert.equal(r.sweepMode, 'per-store');
    assert.equal(r.upserted, 20);
    assert.equal(r.timings.server.requests, 0);
  });

  it('one poison store is skipped and reported; the run still completes', async () => {
    const clock = { t: T0 };
    const d = fakeDeals({ clock, sweepFail: (b) => (b.dealerIds ? b.dealerIds.includes(3) : b.dealerId === 3) });
    const r = await run({ rows: makeRows(20, 5), api: d.api, store: memoryStore(), clock });
    assert.deepEqual(r.failedStores, [3]);
    assert.equal(r.sweepFailed, 1);
    assert.equal(r.sweptStores, 4);
  });
});

describe('configFromEnv', () => {
  it('defaults match the previous behavior (2000-row requests, one store sweep at a time)', () => {
    const c = configFromEnv({});
    assert.equal(c.batchRows, 2000);
    assert.equal(c.sweepConcurrency, 1);
    assert.equal(c.sweepBatchStores, 50);
    assert.ok(c.batchMaxBytes <= 15 * 1024 * 1024);
  });

  it('reads overrides, and clamps anything unsafe or nonsensical instead of trusting it', () => {
    const c = configFromEnv({ SYNC_BATCH_ROWS: '3000', SYNC_BATCH_MAX_BYTES: '99999999999', SYNC_SWEEP_BATCH_STORES: '5000', SYNC_SWEEP_CONCURRENCY: '64', SYNC_PROGRESS_MS: 'abc', SYNC_BULK_RETRIES: '-3' });
    assert.equal(c.batchRows, 3000);
    assert.equal(c.batchMaxBytes, 20 * 1024 * 1024, 'never above 20MB — the server refuses 30MB');
    assert.equal(c.sweepBatchStores, 200);
    assert.equal(c.sweepConcurrency, 4);
    assert.equal(c.progressMs, 60_000);
    assert.equal(c.bulkRetries, 6);
    assert.equal(configFromEnv({ SYNC_BATCH_ROWS: '0' }).batchRows, 2000);
  });
});

void RUN_STATE_VERSION;
