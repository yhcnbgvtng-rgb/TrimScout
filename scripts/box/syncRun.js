// The write phase of inventory-sync.mjs (everything after the sync lock is held): upsert every vehicle,
// sweep the stores, read the live totals. Orchestration with injected I/O — the HTTP client, the state
// file, the clock and the logger are all passed in — so the whole phase, including crashing and resuming
// partway, is unit-tested against a fake deals API without touching a real one.
//
// Phases, persisted after every batch (see syncCheckpoint.js):
//   upsert  -> POST /api/inventory/bulk in size-capped batches, in (dealerId, vin) order
//   sweep   -> retire rows not seen since the run's cutoff, store batch by store batch (syncSweep.js)
//   stats   -> best-effort read of the live totals, only for the summary line
// A run that dies in any phase leaves its state behind; running the same command again (while the crawl
// output on disk is unchanged) continues from there — an upsert that stopped at row 412,000 starts at row
// 412,001, and one that died during the sweep skips the upserts entirely. State for a different crawl
// output (a new night's files) is ignored, so a stale file can never leak into a new night's run. Nothing
// in here restarts a failed run on its own.

import { createHash } from "node:crypto";
import { sortRows, newRunState, parseRunState, upsertStartIndex, MAX_RESUME_AGE_MS } from "./syncCheckpoint.js";
import { takeBatch, DEFAULT_BATCH_ROWS, DEFAULT_BATCH_MAX_BYTES } from "./syncBatching.js";
import { withRetry, heavyCallShouldRetry } from "./syncHttp.js";
import { runSweep, SWEEP_PATH, LockLostError } from "./syncSweep.js";

export const BULK_PATH = "/api/inventory/bulk";
export const STATS_PATH = "/api/inventory/stats";

/** Tunables, from the environment. Every value is clamped, so a typo can't ask for an unsafe request. */
export function configFromEnv(env = process.env) {
  const int = (name, def, min, max) => {
    const v = Number(env[name]);
    return env[name] !== undefined && env[name] !== "" && Number.isFinite(v) && v >= min ? Math.min(max, Math.floor(v)) : def;
  };
  return {
    batchRows: int("SYNC_BATCH_ROWS", DEFAULT_BATCH_ROWS, 1, 10_000),
    batchMaxBytes: int("SYNC_BATCH_MAX_BYTES", DEFAULT_BATCH_MAX_BYTES, 64 * 1024, 20 * 1024 * 1024), // server limit is 30MB
    sweepBatchStores: int("SYNC_SWEEP_BATCH_STORES", 50, 1, 200),
    sweepConcurrency: int("SYNC_SWEEP_CONCURRENCY", 1, 1, 4),
    progressMs: int("SYNC_PROGRESS_MS", 60_000, 0, 3_600_000),
    bulkRetries: int("SYNC_BULK_RETRIES", 6, 0, 20),
    maxResumeAgeMs: int("SYNC_MAX_RESUME_AGE_MS", MAX_RESUME_AGE_MS, 60_000, 30 * 24 * 3_600_000),
    // Multiplies every retry delay (0..1). Only for tests, which cannot wait out 5-60s of backoff.
    retryScale: Math.min(1, Math.max(0, Number.isFinite(Number(env.SYNC_RETRY_SCALE)) && env.SYNC_RETRY_SCALE !== undefined && env.SYNC_RETRY_SCALE !== "" ? Number(env.SYNC_RETRY_SCALE) : 1)),
  };
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const fmtDur = (ms) => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(2)}h` : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}min` : `${(ms / 1000).toFixed(1)}s`);

/**
 * @param {object} p
 * @param {object[]} p.rows           mapped vehicles (unsorted)
 * @param {string} p.fileIdentity     identity of the crawl output these rows came from (path/size/mtime of each shard)
 * @param {(path: string, body?: object|string, opts?: object) => Promise<any>} p.api  already bound to the deals API
 * @param {{load: () => any, save: (state: object) => void, clear: () => void}} p.store  the run-state file
 * @param {() => boolean} [p.isLockLost]  true once the heartbeat has found the sync lock is no longer ours
 */
export async function runWritePhase({ rows, fileIdentity, api, store, isLockLost = () => false, log = console.log, config = configFromEnv({}), now = Date.now, sleep }) {
  const assertLock = () => {
    if (isLockLost()) throw new LockLostError();
  };
  const sorted = sortRows(rows);

  // ---- run state: resume on the same crawl output, otherwise start fresh -------------------------------
  // The cursor is a position in the sorted row list, so it only means anything if the list is the same list.
  // Shard files unchanged is not quite enough: each row's store id comes from the dealership directory read
  // at the start of the run, and a rooftop added in between changes ids — and with them the sort order. So
  // the identity also covers every row's (vin, store) pair.
  const digest = createHash("sha1");
  for (const r of sorted) digest.update(`${r.vin}:${r.dealerId ?? 0}\n`);
  const runIdentity = `${fileIdentity}#${digest.digest("hex")}`;
  let state = parseRunState(store.load(), runIdentity, { now: now(), maxAgeMs: config.maxResumeAgeMs });
  const resumed = state !== null;
  if (resumed) {
    log(`[sync] resuming an earlier run on this same crawl output (phase: ${state.phase}; sweep cutoff ${state.startedAt} is reused, so rows that run already wrote are not swept as stale)`);
  } else {
    // The sweep compares against the deals box's clock; give it a 10-minute margin so a few seconds of clock
    // skew between machines can't sweep rows this very run just wrote.
    state = newRunState({ fileIdentity: runIdentity, startedAt: new Date(now() - 10 * 60 * 1000).toISOString(), now: now() });
    store.save(state);
  }
  const persist = () => {
    state.updatedAt = new Date(now()).toISOString();
    store.save(state);
  };

  // ---- upsert -------------------------------------------------------------------------------------------
  const t0 = now();
  let upserted = 0;
  let skippedRows = 0;
  const optionStats = { setsReplaced: 0, setsKept: 0, setsUnchanged: 0, rowsWritten: 0, junkDropped: 0 };
  const server = { upsertMs: 0, optionsMs: 0, optionsReadMs: 0, daysMs: 0, totalMs: 0, requests: 0 };
  const batchWallMs = [];
  let upsertMs = 0;
  if (state.phase === "upsert") {
    const startIndex = upsertStartIndex(sorted, state.upsert);
    skippedRows = startIndex;
    if (startIndex > 0) log(`[sync] skipping ${startIndex} rows already upserted by the earlier run on this crawl output`);
    let i = startIndex;
    const tUpsert = now();
    let lastLogAt = tUpsert;
    let rowsAtLastLog = startIndex;
    while (i < sorted.length) {
      assertLock();
      const batch = takeBatch(sorted, i, { maxRows: config.batchRows, maxBytes: config.batchMaxBytes });
      const tb = now();
      // A batch is a plain upsert keyed on (VIN, dealer_id), so resending it after a failed attempt is always
      // safe. Retried patiently, with growing spacing: failures here have been lock waits and deadlocks from
      // other work touching the table, which clear on their own (confirmed live 2026-09-28).
      const r = await withRetry(() => api(BULK_PATH, batch.body), {
        retries: config.bulkRetries,
        delayMs: 5000 * config.retryScale,
        factor: 1.5,
        maxDelayMs: 60_000 * config.retryScale,
        sleep,
        shouldRetry: heavyCallShouldRetry(),
        onRetry: ({ attempt, retries, waitMs, err }) => log(`[sync] bulk upsert attempt ${attempt}/${retries + 1} failed (${err.message}); retrying in ${Math.round(waitMs / 1000)}s`),
      });
      batchWallMs.push(now() - tb);
      upserted += r?.upserted ?? 0;
      // `?? 0` so this stays compatible with a deals box that predates these counters.
      optionStats.setsReplaced += r?.optionSetsReplaced ?? 0;
      optionStats.setsKept += r?.optionSetsKept ?? 0;
      optionStats.setsUnchanged += r?.optionSetsUnchanged ?? 0;
      optionStats.rowsWritten += r?.optionRowsWritten ?? 0;
      optionStats.junkDropped += r?.optionJunkDropped ?? 0;
      if (r && r.timings) {
        server.requests++;
        for (const k of ["upsertMs", "optionsMs", "optionsReadMs", "daysMs", "totalMs"]) server[k] += Number(r.timings[k]) || 0;
      }
      i += batch.count;
      const last = sorted[i - 1];
      // Only after the batch's own call has succeeded — a cursor saved earlier could point past rows the
      // deals box never got.
      state.upsert = { lastDealerId: last.dealerId ?? 0, lastVin: last.vin, rows: i };
      persist();
      const t = now();
      if (config.progressMs === 0 || t - lastLogAt >= config.progressMs || i >= sorted.length) {
        const rate = ((i - rowsAtLastLog) / Math.max(1, t - lastLogAt)) * 1000;
        log(`  upserted ${i}/${sorted.length} (${rate.toFixed(1)} rows/s; last batch ${batch.count} rows, ${(batch.bytes / 1048576).toFixed(1)}MB, ${fmtDur(batchWallMs[batchWallMs.length - 1])})`);
        lastLogAt = t;
        rowsAtLastLog = i;
      }
    }
    upsertMs = now() - tUpsert;
    state.phase = "sweep";
    persist();
  }
  const sortedBatchMs = batchWallMs.slice().sort((a, b) => a - b);
  log(`[sync] factory options: ${optionStats.setsReplaced} vehicles replaced (${optionStats.rowsWritten} rows, ${optionStats.junkDropped} junk sentences dropped), ${optionStats.setsUnchanged} unchanged (left as-is), ${optionStats.setsKept} kept as-is (no options extracted this run)`);
  if (batchWallMs.length) {
    log(`[sync] upsert phase: ${upserted} rows in ${fmtDur(upsertMs)} (${((upserted / Math.max(1, upsertMs)) * 1000).toFixed(1)} rows/s) over ${batchWallMs.length} requests; per-request p50 ${fmtDur(quantile(sortedBatchMs, 0.5))}, p95 ${fmtDur(quantile(sortedBatchMs, 0.95))}`);
  }
  if (server.requests) {
    log(`[sync] deals API time inside those requests: ${fmtDur(server.totalMs)} total = main upsert ${fmtDur(server.upsertMs)} + options ${fmtDur(server.optionsMs)} (of which reading existing sets ${fmtDur(server.optionsReadMs)}) + price days ${fmtDur(server.daysMs)}`);
  }

  // ---- sweep --------------------------------------------------------------------------------------------
  const stores = [...new Set(rows.map((r) => r.dealerId).filter(Boolean))];
  const tSweep = now();
  const sweep = await runSweep({
    api: (path, body) => api(path, body),
    stores,
    startedAt: state.startedAt,
    batchStores: config.sweepBatchStores,
    concurrency: config.sweepConcurrency,
    startIndex: state.sweep.nextIndex,
    removed: state.sweep.removed,
    failedStores: state.sweep.failedStores,
    onProgress: ({ nextIndex, removed, failedStores }) => {
      state.sweep.nextIndex = nextIndex;
      state.sweep.removed = removed;
      state.sweep.failedStores = failedStores;
      persist();
    },
    assertLock,
    log,
    sleep,
    retry: { batch: { retries: 3, delayMs: 5000 * config.retryScale, factor: 2, maxDelayMs: 60_000 * config.retryScale }, store: { retries: 1, delayMs: 3000 * config.retryScale } },
  });
  let removed = sweep.removed;
  // The store-0 bucket holds vehicles whose store wasn't in the directory at sync time; once a rooftop is added
  // they re-file under it, and the stale bucket rows are retired here.
  if (!state.sweep.store0Done) {
    try {
      assertLock();
      removed += (await withRetry(() => api(SWEEP_PATH, { dealerId: 0, seenAfter: state.startedAt, sources: ["nightly"] }), { retries: 1, delayMs: 3000 * config.retryScale, sleep }))?.removed ?? 0;
    } catch (err) {
      if (err instanceof LockLostError) throw err;
      /* box predates store-0 sweeps, or this one failed too — not fatal either way */
    }
    state.sweep.store0Done = true;
    state.sweep.removed = removed;
    persist();
  }
  const sweepMs = now() - tSweep;
  log(`[sync] sweep phase: ${sweep.sweptStores}/${stores.length} stores in ${fmtDur(sweepMs)} (${sweep.batchCalls} batch calls, ${sweep.storeCalls} single-store calls, mode ${sweep.mode}), ${removed} vehicles retired${sweep.failedStores.length ? `, ${sweep.failedStores.length} stores skipped (first: ${sweep.failedStores.slice(0, 10).join(", ")})` : ""}`);

  // ---- live totals: only feeds the summary line, so it can never fail the sync ------------------------------
  let live = null;
  const tStats = now();
  try {
    assertLock();
    const stats = await withRetry(() => api(STATS_PATH), { retries: 1, delayMs: 3000 * config.retryScale, sleep });
    live = { rows: stats.total, vins: stats.vins, inStock: stats.inStock, stores: stats.dealers, byState: (stats.byState || []).slice(0, 8) };
  } catch (err) {
    if (err instanceof LockLostError) throw err;
    log(`[sync] live totals unavailable (${err.message}) — the sync itself is complete`);
  }

  // Reached only on full success — a run that died anywhere above leaves its state in place so the next
  // run on the same crawl output resumes from it.
  store.clear();
  return {
    upserted,
    skippedRows,
    resumed,
    sweptStores: sweep.sweptStores,
    sweepFailed: sweep.failedStores.length,
    failedStores: sweep.failedStores,
    removed,
    live,
    optionStats,
    timings: { upsertMs, sweepMs, statsMs: now() - tStats, totalMs: now() - t0, requests: batchWallMs.length, p50RequestMs: quantile(sortedBatchMs, 0.5), p95RequestMs: quantile(sortedBatchMs, 0.95), server },
    sweepMode: sweep.mode,
    startedAt: state.startedAt,
  };
}
