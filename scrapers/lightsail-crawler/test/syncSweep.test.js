// The sweep phase: batched store sweeps with a per-store fallback, poison-store isolation, a hard stop when
// the deals API is plainly down (cursor kept, so a re-run resumes instead of redoing upserts), and ordered
// progress even with several batches in flight. Driven against a fake API; nothing here touches a database.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../../scripts/box/syncHttp.js';
import { runSweep, SweepAbortError, LockLostError, isBatchSweepUnsupported, SWEEP_PATH } from '../../../scripts/box/syncSweep.js';

const fast = { sleep: async () => {}, retry: { batch: { retries: 3, delayMs: 0 }, store: { retries: 1, delayMs: 0 } } };
const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const serverError = () => new ApiError('/api/inventory/sweep -> 500 Internal server error', { status: 500, retryable: true });
const unsupported = () => new ApiError('/api/inventory/sweep -> 400 dealerId and seenAfter (ISO) are required', { status: 400, retryable: false });

function fakeApi({ batchSupported = true, failBatch = null, failStore = null, delay = () => 0, removedPerStore = 2, onCall = null } = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const api = async (path, body) => {
    assert.equal(path, SWEEP_PATH);
    calls.push(body);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (onCall) onCall(body, calls.length);
      const wait = delay(body);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (body.dealerIds) {
        if (!batchSupported) throw unsupported();
        if (failBatch && failBatch(body)) throw serverError();
        return { removed: body.dealerIds.length * removedPerStore, stores: body.dealerIds.length };
      }
      if (failStore && failStore(body.dealerId)) throw serverError();
      return { removed: removedPerStore };
    } finally { inFlight--; }
  };
  return { api, calls, maxInFlight: () => maxInFlight };
}

describe('batched sweep', () => {
  it('sweeps the stores in sorted batches, one call per batch, with the run\'s cutoff and sources', async () => {
    const f = fakeApi();
    const r = await runSweep({ api: f.api, stores: [30, 10, 20, 40, 50], startedAt: '2026-10-02T10:00:00.000Z', batchStores: 2, ...fast });
    assert.deepEqual(f.calls.map((c) => c.dealerIds), [[10, 20], [30, 40], [50]]);
    for (const c of f.calls) { assert.equal(c.seenAfter, '2026-10-02T10:00:00.000Z'); assert.deepEqual(c.sources, ['nightly']); assert.equal(c.dealerId, undefined); }
    assert.deepEqual({ removed: r.removed, sweptStores: r.sweptStores, failed: r.failedStores, batchCalls: r.batchCalls, storeCalls: r.storeCalls, mode: r.mode }, { removed: 10, sweptStores: 5, failed: [], batchCalls: 3, storeCalls: 0, mode: 'batch' });
  });

  it('does ~60x fewer calls than the one-call-per-store loop it replaces', async () => {
    const f = fakeApi();
    await runSweep({ api: f.api, stores: ids(3208), startedAt: 'x', batchStores: 50, ...fast });
    assert.equal(f.calls.length, 65);
  });

  it('reports progress after each batch as the sorted-list position, in order, with running totals', async () => {
    const f = fakeApi();
    const progress = [];
    await runSweep({ api: f.api, stores: ids(7), startedAt: 'x', batchStores: 3, onProgress: (p) => progress.push(p), ...fast });
    assert.deepEqual(progress.map((p) => p.nextIndex), [3, 6, 7]);
    assert.deepEqual(progress.map((p) => p.removed), [6, 12, 14]);
  });

  it('resumes at the saved position and carries the earlier totals', async () => {
    const f = fakeApi();
    const r = await runSweep({ api: f.api, stores: ids(10), startedAt: 'x', batchStores: 4, startIndex: 4, removed: 100, ...fast });
    assert.deepEqual(f.calls.map((c) => c.dealerIds), [[5, 6, 7, 8], [9, 10]]);
    assert.equal(r.removed, 100 + 12);
    assert.equal(r.sweptStores, 10);
  });

  it('retries the stores an earlier attempt skipped before continuing — and a store that still fails stays skipped', async () => {
    const f = fakeApi({ failStore: (id) => id === 3 });
    const logs = [];
    const progress = [];
    const r = await runSweep({ api: f.api, stores: ids(10), startedAt: 'x', batchStores: 4, startIndex: 4, removed: 100, failedStores: [2, 3], log: (m) => logs.push(m), onProgress: (p) => progress.push(p), ...fast });
    const perStore = f.calls.filter((c) => c.dealerId !== undefined).map((c) => c.dealerId);
    assert.deepEqual(perStore.slice(0, 3), [2, 3, 3], 'store 2 swept; store 3 tried twice (one retry) and failed again');
    assert.deepEqual(f.calls.filter((c) => c.dealerIds).map((c) => c.dealerIds), [[5, 6, 7, 8], [9, 10]]);
    assert.deepEqual(r.failedStores, [3]);
    assert.equal(r.removed, 100 + 2 + 12);
    assert.equal(r.sweptStores, 9);
    assert.deepEqual(progress[0], { nextIndex: 4, removed: 102, failedStores: [3] }, 'the recovered store is saved right away');
    assert.ok(logs.some((m) => /retried the 2 stores the earlier attempt skipped: 1 swept now, 1 still failing/.test(m)));
  });

  it('skipped stores that fail again never trip the "API is down" stop', async () => {
    const f = fakeApi({ failStore: (id) => id <= 6 });
    const r = await runSweep({ api: f.api, stores: ids(10), startedAt: 'x', batchStores: 4, startIndex: 8, failedStores: [1, 2, 3, 4, 5, 6], maxConsecutiveStoreFailures: 3, ...fast });
    assert.deepEqual(r.failedStores, [1, 2, 3, 4, 5, 6]);
    assert.equal(r.sweptStores, 4);
  });

  it('a fully swept list resumes to a no-op', async () => {
    const f = fakeApi();
    const r = await runSweep({ api: f.api, stores: ids(4), startedAt: 'x', batchStores: 2, startIndex: 4, removed: 8, ...fast });
    assert.equal(f.calls.length, 0);
    assert.deepEqual({ removed: r.removed, mode: r.mode }, { removed: 8, mode: 'none' });
  });

  it('de-duplicates and ignores non-numeric ids', async () => {
    const f = fakeApi();
    await runSweep({ api: f.api, stores: [3, 3, 1, NaN, 2], startedAt: 'x', batchStores: 10, ...fast });
    assert.deepEqual(f.calls.map((c) => c.dealerIds), [[1, 2, 3]]);
  });
});

describe('a deals API that predates the batch form', () => {
  it('recognizes its 400 and falls back to per-store sweeps — same result, and never asks for a batch again', async () => {
    const f = fakeApi({ batchSupported: false });
    const logs = [];
    const r = await runSweep({ api: f.api, stores: ids(6), startedAt: 'x', batchStores: 3, log: (m) => logs.push(m), ...fast });
    assert.equal(f.calls.filter((c) => c.dealerIds).length, 1, 'exactly one probe');
    assert.deepEqual(f.calls.filter((c) => c.dealerId !== undefined).map((c) => c.dealerId), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual({ removed: r.removed, sweptStores: r.sweptStores, mode: r.mode }, { removed: 12, sweptStores: 6, mode: 'per-store' });
    assert.ok(logs.some((m) => /no batched sweep yet/.test(m)));
  });

  it('isBatchSweepUnsupported matches only that exact 400', () => {
    assert.equal(isBatchSweepUnsupported(unsupported()), true);
    assert.equal(isBatchSweepUnsupported(new ApiError('/x -> 400 dealerIds must all be integers', { status: 400 })), false);
    assert.equal(isBatchSweepUnsupported(serverError()), false);
    assert.equal(isBatchSweepUnsupported(new Error('dealerId and seenAfter')), false);
  });
});

describe('failures', () => {
  it('a batch that keeps failing is re-run store by store, so only the poison store is skipped', async () => {
    const f = fakeApi({ failBatch: (b) => b.dealerIds.includes(3), failStore: (id) => id === 3 });
    const logs = [];
    const r = await runSweep({ api: f.api, stores: ids(6), startedAt: 'x', batchStores: 3, log: (m) => logs.push(m), ...fast });
    assert.deepEqual(r.failedStores, [3]);
    assert.equal(r.sweptStores, 5);
    assert.equal(r.removed, 10, 'the other five stores were still swept');
    assert.equal(r.mode, 'mixed');
    assert.ok(logs.some((m) => /isolate/.test(m)) && logs.some((m) => /sweep failed for store 3/.test(m)));
  });

  it('a transient batch failure is retried and succeeds without any per-store calls', async () => {
    let n = 0;
    const f = fakeApi({ failBatch: () => ++n <= 2 });
    const r = await runSweep({ api: f.api, stores: ids(4), startedAt: 'x', batchStores: 4, ...fast });
    assert.equal(f.calls.length, 3);
    assert.deepEqual({ removed: r.removed, failed: r.failedStores, mode: r.mode }, { removed: 8, failed: [], mode: 'batch' });
  });

  it('when stores keep failing back to back the API is down: stop with the cursor, do not skip the rest and call it done', async () => {
    const f = fakeApi({ failBatch: (b) => b.dealerIds[0] > 4, failStore: (id) => id > 4 });
    const progress = [];
    await assert.rejects(
      runSweep({ api: f.api, stores: ids(12), startedAt: 'x', batchStores: 4, onProgress: (p) => progress.push(p), maxConsecutiveStoreFailures: 3, ...fast }),
      (err) => {
        assert.ok(err instanceof SweepAbortError);
        assert.match(err.message, /3 stores in a row failed/);
        assert.equal(err.nextIndex, 4, 'resume point = start of the batch that did not finish');
        return true;
      }
    );
    assert.deepEqual(progress.map((p) => p.nextIndex), [4], 'only the batch that completed was recorded');
    assert.equal(f.calls.filter((c) => c.dealerId !== undefined).length, 3 * 2, 'each failing store tried twice (1 retry), then it stopped');
  });

  it('isolated failures spread out between successes never trip the stop', async () => {
    const f = fakeApi({ failBatch: () => true, failStore: (id) => id % 3 === 0 });
    const r = await runSweep({ api: f.api, stores: ids(12), startedAt: 'x', batchStores: 4, maxConsecutiveStoreFailures: 2, ...fast });
    assert.deepEqual(r.failedStores, [3, 6, 9, 12]);
    assert.equal(r.sweptStores, 8);
  });

  it('a lost lock stops the sweep before the next call (never a second writer)', async () => {
    const f = fakeApi();
    let lost = false;
    await assert.rejects(
      runSweep({ api: f.api, stores: ids(9), startedAt: 'x', batchStores: 3, assertLock: () => { if (lost) throw new LockLostError(); }, onProgress: (p) => { if (p.nextIndex >= 3) lost = true; }, ...fast }),
      LockLostError
    );
    assert.equal(f.calls.length, 1);
  });
});

describe('concurrency', () => {
  it('runs up to `concurrency` batches at once — after the first one has settled whether batching is supported', async () => {
    const order = [];
    const f = fakeApi({ delay: () => 20, onCall: (b) => order.push(b.dealerIds[0]) });
    const r = await runSweep({ api: f.api, stores: ids(20), startedAt: 'x', batchStores: 2, concurrency: 3, ...fast });
    assert.equal(f.maxInFlight(), 3);
    assert.equal(order[0], 1, 'the first batch goes out alone');
    assert.equal(r.removed, 40);
    assert.equal(r.sweptStores, 20);
  });

  it('the cursor only advances over a finished prefix: a slow early batch holds it back', async () => {
    // batch 1 (stores 3-4) is slow; batches 2 and 3 finish first but must not move the cursor past it.
    const f = fakeApi({ delay: (b) => (b.dealerIds[0] === 3 ? 60 : 5) });
    const progress = [];
    await runSweep({ api: f.api, stores: ids(8), startedAt: 'x', batchStores: 2, concurrency: 3, onProgress: (p) => progress.push(p.nextIndex), ...fast });
    assert.deepEqual(progress, [2, 4, 6, 8]);
  });

  it('on an abort with batches in flight the saved cursor still never skips an unfinished batch', async () => {
    const f = fakeApi({ delay: (b) => (b.dealerIds[0] === 3 ? 50 : 1), failBatch: (b) => b.dealerIds[0] === 3, failStore: (id) => id === 3 || id === 4 });
    const progress = [];
    await assert.rejects(runSweep({ api: f.api, stores: ids(10), startedAt: 'x', batchStores: 2, concurrency: 3, maxConsecutiveStoreFailures: 2, onProgress: (p) => progress.push(p.nextIndex), ...fast }), SweepAbortError);
    assert.ok(progress.every((n) => n <= 2), `cursor moved past the failed batch: ${progress}`);
  });
});
