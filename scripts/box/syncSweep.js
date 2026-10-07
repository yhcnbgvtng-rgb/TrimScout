// The sweep phase of inventory-sync.mjs: after every vehicle in the crawl output has been upserted, retire
// (set removed_at on) the rows of each swept store that were NOT seen since the run's cutoff — vehicles
// the crawl no longer lists. Orchestration only; the rows themselves are changed by the deals API.
//
// What changed from the old loop (one POST per store, 1,500-3,500 of them, strictly in sequence):
//   - Stores go out in batches (`dealerIds`), one UPDATE per ~50 stores instead of one per store: ~60x
//     fewer round trips, and ~60x fewer times the deals API drops its aggregate caches mid-sweep (every
//     call that retired a row did, so a buyer hitting /stats during the sweep paid a cold full-table scan
//     again and again). A deals API that predates the batch form answers 400 "dealerId and seenAfter ...
//     are required"; that is detected on the first call and the sweep falls back to the per-store form, so
//     deploy order between the API and the boxes doesn't matter.
//   - A batch that fails (after its retries) is re-run store by store, so one poisonous store is skipped
//     and logged — as before — instead of taking a whole batch down with it.
//   - If stores keep failing back to back the deals API is down or wedged, not one bad store: the sweep
//     STOPS (SweepAbortError) with its cursor intact rather than skipping the rest of the list and
//     reporting success. The next run on the same crawl output resumes at the cursor (see
//     syncCheckpoint.js) and does not touch the upserts again. Nothing here re-launches itself.
//   - Progress is reported per completed batch, as the length of the finished prefix of the sorted store
//     list, so a resume never skips a batch that didn't finish — even with concurrency > 1.
//   - `concurrency` > 1 runs that many batches at once. Still ONE sync holding the lock (never a second
//     writer); the only new exposure is two UPDATEs contending inside the database, so it defaults to 1.
//
// Sweeping is idempotent: re-running a batch (retries, a resume that redoes the one in-flight batch) only
// retires rows that are still stale, so none of the above can remove a row that shouldn't be.

import { ApiError, withRetry, isTimeout, heavyCallShouldRetry } from "./syncHttp.js";

export const SWEEP_PATH = "/api/inventory/sweep";

export class SweepAbortError extends Error {
  constructor(message, { nextIndex = 0 } = {}) {
    super(message);
    this.name = "SweepAbortError";
    this.nextIndex = nextIndex;
  }
}

export class LockLostError extends Error {
  constructor(message = "the sync lock is no longer held by this run — another sync may be writing; stopping before the next write") {
    super(message);
    this.name = "LockLostError";
  }
}

// What a deals API that predates the `dealerIds` form says to it (handleInventorySweep's original validation).
export const isBatchSweepUnsupported = (err) => err instanceof ApiError && err.status === 400 && /dealerId and seenAfter/i.test(err.message);

/**
 * @param {object} p
 * @param {(path: string, body: object) => Promise<{removed?: number}>} p.api  already bound to the deals API
 * @param {number[]} p.stores        store ids to sweep (non-zero; store 0 is handled by the caller)
 * @param {string} p.startedAt       the run's sweep cutoff (ISO) — rows last seen before it are retired
 * @param {number} [p.startIndex]    resume cursor: index into the SORTED store list of the first unswept store
 * @param {number} [p.removed]       rows retired by earlier attempts, carried into the total
 * @param {number[]} [p.failedStores] stores skipped by earlier attempts, carried into the result
 * @param {(p: {nextIndex: number, removed: number, failedStores: number[]}) => void} [p.onProgress] sync; called after each batch completes, in order
 * @returns {Promise<{removed: number, sweptStores: number, failedStores: number[], batchCalls: number, storeCalls: number, mode: 'batch'|'per-store'|'mixed'|'none'}>}
 */
export async function runSweep({
  api,
  stores,
  startedAt,
  sources = ["nightly"],
  // Cross-box protection (see syncFreshness.js): only retire rows this box wrote, or rows nobody has seen since foreignBefore.
  sourceBox = null,
  foreignBefore = null,
  batchStores = 50,
  concurrency = 1,
  startIndex = 0,
  removed = 0,
  failedStores = [],
  onProgress = () => {},
  assertLock = () => {},
  log = () => {},
  sleep,
  retry = { batch: { retries: 3, delayMs: 5000, factor: 2, maxDelayMs: 60_000 }, store: { retries: 1, delayMs: 3000 } },
  maxConsecutiveStoreFailures = 5,
}) {
  // The dealership directory API returns ids as strings ("123"), and Number.isFinite("123") is false — without this
  // coercion every store was dropped, so the sweep made no calls and reported mode "none" (seen on box2, 2026-10-05).
  const asStoreId = (id) => (typeof id === "string" && /^\d+$/.test(id.trim()) ? Number(id) : id);
  const ownership = sourceBox && foreignBefore ? { sourceBox, foreignBefore } : {};
  const sorted = [...new Set(stores.map(asStoreId))].filter((id) => Number.isFinite(id)).sort((a, b) => a - b);
  const batches = [];
  for (let i = Math.min(startIndex, sorted.length); i < sorted.length; i += batchStores) batches.push({ start: i, ids: sorted.slice(i, i + batchStores) });

  let supportsBatch = null; // null = not known yet
  let consecutiveStoreFailures = 0;
  let batchCalls = 0;
  let storeCalls = 0;
  let usedBatch = false;
  let usedPerStore = false;
  let totalRemoved = removed;
  const failed = new Set(failedStores);

  // `counts: false` is for stores an earlier attempt already skipped: a genuinely poisonous store fails the same
  // way again, which says nothing about whether the API is down, so those never count toward the stop below.
  const sweepOneStore = async (id, { counts = true } = {}) => {
    assertLock();
    storeCalls++;
    usedPerStore = true;
    try {
      const r = await withRetry(() => api(SWEEP_PATH, { dealerId: id, seenAfter: startedAt, sources, ...ownership }), { ...retry.store, sleep, shouldRetry: heavyCallShouldRetry() });
      if (counts) consecutiveStoreFailures = 0;
      return { removed: r?.removed ?? 0, ok: true };
    } catch (err) {
      if (err instanceof LockLostError) throw err;
      if (isTimeout(err)) throw new SweepAbortError(`the sweep of store ${id} got no response within its deadline, twice (${err.message}) — the deals API or its database is stalled, so the sweep stops here with its place saved`);
      log(`[sync] sweep failed for store ${id} after retry, skipping (will sweep next run): ${err.message}`);
      if (!counts) return { removed: 0, ok: false };
      consecutiveStoreFailures++;
      if (consecutiveStoreFailures >= maxConsecutiveStoreFailures) {
        throw new SweepAbortError(`${consecutiveStoreFailures} stores in a row failed to sweep (last: ${err.message}) — the deals API looks down or wedged, so the sweep stops here instead of skipping the rest`);
      }
      return { removed: 0, ok: false };
    }
  };

  const sweepBatch = async (batch) => {
    if (supportsBatch !== false) {
      assertLock();
      batchCalls++;
      try {
        const r = await withRetry(() => api(SWEEP_PATH, { dealerIds: batch.ids, seenAfter: startedAt, sources, ...ownership }), {
          ...retry.batch,
          sleep,
          shouldRetry: heavyCallShouldRetry(),
          onRetry: ({ attempt, retries, waitMs, err }) => log(`[sync] sweep batch (stores #${batch.start}-${batch.start + batch.ids.length - 1}) attempt ${attempt}/${retries + 1} failed (${err.message}); retrying in ${Math.round(waitMs / 1000)}s`),
        });
        supportsBatch = true;
        usedBatch = true;
        consecutiveStoreFailures = 0;
        return { removed: r?.removed ?? 0, failedIds: [] };
      } catch (err) {
        if (err instanceof LockLostError) throw err;
        // A batch that waited out its whole deadline (twice) means a stalled database, not one bad store: splitting
        // it into per-store calls would only queue more statements behind the stalled one.
        if (isTimeout(err)) throw new SweepAbortError(`a sweep batch (stores #${batch.start}-${batch.start + batch.ids.length - 1}) got no response within its deadline, twice (${err.message}) — the deals API or its database is stalled, so the sweep stops here with its place saved`, { nextIndex: batch.start });
        if (isBatchSweepUnsupported(err)) {
          supportsBatch = false;
          log("[sync] the deals API has no batched sweep yet — sweeping store by store (same result, more calls)");
        } else {
          log(`[sync] sweep batch (stores #${batch.start}-${batch.start + batch.ids.length - 1}) failed (${err.message}) — retrying its ${batch.ids.length} stores one by one to isolate the problem`);
        }
      }
    }
    let removedHere = 0;
    const failedIds = [];
    for (const id of batch.ids) {
      const r = await sweepOneStore(id);
      removedHere += r.removed;
      if (!r.ok) failedIds.push(id);
    }
    return { removed: removedHere, failedIds };
  };

  // Stores an earlier attempt had to skip are tried again first — a resume after the API recovered is exactly
  // when they will work. Whatever still fails stays in the skipped list.
  if (failed.size) {
    const carried = [...failed].sort((a, b) => a - b);
    let recovered = 0;
    for (const id of carried) {
      const r = await sweepOneStore(id, { counts: false });
      if (r.ok) { failed.delete(id); totalRemoved += r.removed; recovered++; }
    }
    log(`[sync] retried the ${carried.length} stores the earlier attempt skipped: ${recovered} swept now, ${carried.length - recovered} still failing`);
    onProgress({ nextIndex: Math.min(startIndex, sorted.length), removed: totalRemoved, failedStores: [...failed] });
  }

  // Batches are handed out in order; each completed one is recorded, and the cursor only advances over the
  // contiguous finished prefix.
  const completed = new Map();
  let nextBatch = 0;
  let cursorBatch = 0;
  let abortError = null;
  const advanceCursor = () => {
    while (completed.has(cursorBatch)) {
      const r = completed.get(cursorBatch);
      completed.delete(cursorBatch);
      totalRemoved += r.removed;
      for (const id of r.failedIds) failed.add(id);
      const b = batches[cursorBatch];
      cursorBatch++;
      onProgress({ nextIndex: b.start + b.ids.length, removed: totalRemoved, failedStores: [...failed] });
    }
  };
  const worker = async () => {
    for (;;) {
      if (abortError) return;
      const idx = nextBatch++;
      if (idx >= batches.length) return;
      try {
        completed.set(idx, await sweepBatch(batches[idx]));
      } catch (err) {
        abortError = abortError || err;
        return;
      }
      advanceCursor();
    }
  };
  // The first batch runs alone: it settles whether the API supports the batch form before any parallel
  // calls are made (a 400 from several at once would all be handled as "unsupported", which is fine, but
  // there is no reason to find out the noisy way).
  if (batches.length) {
    const first = nextBatch++;
    try {
      completed.set(first, await sweepBatch(batches[first]));
      advanceCursor();
    } catch (err) {
      abortError = err;
    }
  }
  if (!abortError) await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, batches.length)) }, worker));
  if (abortError) {
    if (abortError instanceof SweepAbortError) abortError.nextIndex = batches[cursorBatch] ? batches[cursorBatch].start : sorted.length;
    throw abortError;
  }

  return {
    removed: totalRemoved,
    sweptStores: sorted.length - failed.size,
    failedStores: [...failed],
    batchCalls,
    storeCalls,
    mode: usedBatch && usedPerStore ? "mixed" : usedBatch ? "batch" : usedPerStore ? "per-store" : "none",
  };
}
