// The "superseded rows" step of inventory-sync.mjs, after the sweep: for every (VIN, store) pair this run uploaded, ask the deals API to
// retire the same VIN's rows under other stores that this run did not refresh (supersededRetire.js has the why). Best effort and
// idempotent: a failed batch is logged and skipped, never fails the sync, and a re-run only retires rows that are still stale.
// OFF unless RETIRE_SUPERSEDED=1; RETIRE_SUPERSEDED_DRY_RUN=1 only counts what it would retire.

export const SUPERSEDED_PATH = "/api/inventory/superseded";
export const SUPERSEDED_BATCH_PAIRS = 500;

/** Distinct [vin, storeId] pairs for the rows that matched a directory store (store 0 is "no store matched": never a keeper), in a stable order. */
export function supersedePairs(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const id = Number(r.dealerId);
    if (!r.vin || !Number.isInteger(id) || id <= 0) continue;
    const key = `${r.vin}|${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([r.vin, id]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
}

/**
 * @param {object} p
 * @param {(path: string, body: object) => Promise<any>} p.api
 * @param {object[]} p.rows               the mapped vehicles that were uploaded
 * @param {string} p.seenAfter            the run's sweep cutoff (ISO): rows refreshed since then are never touched
 * @param {string|null} [p.sourceBox]
 * @param {string|null} [p.foreignBefore]
 * @param {boolean} [p.dryRun]
 * @param {(msg: string) => void} [p.log]
 * @param {() => boolean} [p.isLockLost]
 * @returns {Promise<{ pairs: number, calls: number, retired: number, wouldRetire: number, failedCalls: number }>}
 */
export async function runSupersede({ api, rows, seenAfter, sourceBox = null, foreignBefore = null, dryRun = false, log = console.log, isLockLost = () => false, batchPairs = SUPERSEDED_BATCH_PAIRS }) {
  const pairs = supersedePairs(rows);
  const out = { pairs: pairs.length, calls: 0, retired: 0, wouldRetire: 0, failedCalls: 0 };
  for (let i = 0; i < pairs.length; i += batchPairs) {
    if (isLockLost()) { log("[sync] superseded-rows step stopped: the sync lock is no longer held"); break; }
    out.calls++;
    try {
      const r = await api(SUPERSEDED_PATH, { pairs: pairs.slice(i, i + batchPairs), seenAfter, dryRun, ...(sourceBox && foreignBefore ? { sourceBox, foreignBefore } : {}) });
      if (dryRun) out.wouldRetire += Number(r?.wouldRetire) || 0;
      else out.retired += Number(r?.retired) || 0;
    } catch (err) {
      out.failedCalls++;
      log(`[sync] superseded-rows batch ${out.calls} failed (non-fatal): ${err.message}`);
      // A deals API that predates this endpoint (404) will fail every batch the same way; stop after the first.
      if (/ 404 /.test(String(err.message))) { log("[sync] superseded-rows step skipped: this deals API does not have the endpoint"); break; }
    }
  }
  return out;
}
