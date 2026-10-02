// Request parsing + statement building for POST /api/inventory/sweep — extracted from deals_api_server.js
// (which starts a real server when imported) so it can be unit-tested.
//
// The sweep retires (sets removed_at on) the rows of a store that were not seen since a cutoff: vehicles the
// crawl no longer lists. It used to take exactly one store per call, and inventory-sync.mjs made one call per
// store — 1,500-3,500 sequential requests a night, each one a separate statement, a separate cache
// invalidation, and a separate chance to hit a timeout on a loaded box. It now also takes `dealerIds`, a
// batch of stores handled by ONE UPDATE and ONE invalidation. The single-store form is unchanged (same SQL,
// same response), so a box still running the previous client keeps working.

export const MAX_SWEEP_STORES = 200;

/**
 * @param {any} body the parsed JSON body
 * @param {{ toInt: (v: any) => number | null, toStr: (v: any, n: number) => string | null }} h conversion helpers from the server
 * @returns {{ ok: true, dealerIds: number[], seenAfter: Date, sources: string[], batch: boolean } | { ok: false, error: string }}
 */
export function parseSweepRequest(body, { toInt, toStr }) {
  const seenAfter = typeof body?.seenAfter === "string" ? new Date(body.seenAfter) : null;
  if (!seenAfter || Number.isNaN(seenAfter.getTime())) return { ok: false, error: "dealerId and seenAfter (ISO) are required" };
  const sources = Array.isArray(body.sources) ? body.sources.map((x) => toStr(x, 16)).filter(Boolean) : [];

  const hasBatch = body.dealerIds !== undefined && body.dealerIds !== null;
  const hasSingle = body.dealerId !== undefined && body.dealerId !== null;
  if (hasBatch && hasSingle) return { ok: false, error: "send dealerId or dealerIds, not both" };

  if (hasBatch) {
    if (!Array.isArray(body.dealerIds) || body.dealerIds.length === 0) return { ok: false, error: "dealerIds must be a non-empty array of store ids" };
    if (body.dealerIds.length > MAX_SWEEP_STORES) return { ok: false, error: `dealerIds is limited to ${MAX_SWEEP_STORES} stores per call` };
    const ids = [];
    for (const raw of body.dealerIds) {
      const id = toInt(raw);
      if (id == null) return { ok: false, error: "dealerIds must all be integers" };
      ids.push(id);
    }
    return { ok: true, dealerIds: [...new Set(ids)], seenAfter, sources, batch: true };
  }

  // dealerId 0 is the "no store matched" bucket — sweeping it retires rows that a later sync re-filed under a real store.
  const id = toInt(body?.dealerId);
  if (id == null) return { ok: false, error: "dealerId and seenAfter (ISO) are required" };
  return { ok: true, dealerIds: [id], seenAfter, sources, batch: false };
}

/** The UPDATE for a parsed request. One store keeps the exact statement the single-store sweep always used. */
export function buildSweepStatement({ dealerIds, seenAfter, sources }) {
  const args = [];
  let sql;
  if (dealerIds.length === 1) {
    sql = "UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id = ? AND removed_at IS NULL AND last_seen_at < ?";
    args.push(dealerIds[0], seenAfter);
  } else {
    // A plain single-column IN-list: unlike a (vin, dealer_id) row-value IN-list (see handleInventoryBulk's
    // options DELETE), MariaDB turns this into index ranges on idx_inv_stock_dealer_id (removed_at, dealer_id).
    sql = "UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id IN (?) AND removed_at IS NULL AND last_seen_at < ?";
    args.push(dealerIds, seenAfter);
  }
  if (sources.length) {
    sql += " AND source IN (?)";
    args.push(sources);
  }
  return { sql, args };
}
