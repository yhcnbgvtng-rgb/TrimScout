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

// ---- sweep guards (audit 2026-10-27: 32,068 of 81,268 retirements had the same VIN live at another store, ~23% of a week's retirements came back) ----
// All three are OPT-IN per request, so a client that predates them (no new fields) gets byte-for-byte the old statement:
//   protectElsewhere   true  -> never retire a row whose VIN has a live row at ANOTHER store that was seen more recently than this one
//                              (sister rooftops share one group inventory; a blocked night on one site then a good night on the next re-homes the VIN).
//                              "More recently" keeps two stale copies from shielding each other forever: only the older one is protected.
//   minMisses          N>=2  -> a stale row is retired only on the N-th sweep, in distinct runs, that found it missing (sweep_miss_count / sweep_miss_at).
//   minFreshRatio      0..1  -> skip a store whose fresh rows (seen since seenAfter) are under that share of its live rows, once it has minLiveForRatio
//                              live rows: a crawl that returned a fraction of the store is a partial crawl, not 87% of a lot selling overnight.
// A "healthy crawl" is a run that actually swept the store: the client leaves stores whose crawl hit 403/429/5xx out of the request, and the ratio guard
// skips the rest, so a skipped night neither retires nor counts as a miss.
export const MAX_MIN_MISSES = 5;
export const DEFAULT_MIN_LIVE_FOR_RATIO = 10;

/**
 * @param {any} body the parsed JSON body
 * @param {{ toInt: (v: any) => number | null, toStr: (v: any, n: number) => string | null }} h conversion helpers from the server
 * @returns {{ ok: true, dealerIds: number[], seenAfter: Date, sources: string[], batch: boolean } | { ok: false, error: string }}
 */
export function parseSweepRequest(body, { toInt, toStr }) {
  const seenAfter = typeof body?.seenAfter === "string" ? new Date(body.seenAfter) : null;
  if (!seenAfter || Number.isNaN(seenAfter.getTime())) return { ok: false, error: "dealerId and seenAfter (ISO) are required" };
  const sources = Array.isArray(body.sources) ? body.sources.map((x) => toStr(x, 16)).filter(Boolean) : [];
  // Cross-box protection (optional; a client that predates it sends neither field and gets the old behaviour).
  // `sourceBox` is the box running this sync; with `foreignBefore` it says: retire a stale row only if THIS box wrote it
  // (or nobody recorded who did) OR it hasn't been seen at all since foreignBefore — a row another box wrote more
  // recently than that belongs to that box's crawl, which this sync knows nothing about.
  const sourceBox = typeof body?.sourceBox === "string" ? toStr(body.sourceBox, 16) : null;
  const foreignBefore = typeof body?.foreignBefore === "string" ? new Date(body.foreignBefore) : null;
  if (sourceBox && (!foreignBefore || Number.isNaN(foreignBefore.getTime()))) return { ok: false, error: "sourceBox needs foreignBefore (ISO)" };
  const ownership = sourceBox ? { sourceBox, foreignBefore } : {};
  const g = parseGuards(body, { toInt });
  if (!g.ok) return g;
  const guards = g.guards;

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
    return { ok: true, dealerIds: [...new Set(ids)], seenAfter, sources, ...ownership, ...guards, batch: true };
  }

  // dealerId 0 is the "no store matched" bucket — sweeping it retires rows that a later sync re-filed under a real store.
  const id = toInt(body?.dealerId);
  if (id == null) return { ok: false, error: "dealerId and seenAfter (ISO) are required" };
  return { ok: true, dealerIds: [id], seenAfter, sources, ...ownership, ...guards, batch: false };
}

function parseGuards(body, { toInt }) {
  const guards = {};
  if (body?.minMisses !== undefined && body.minMisses !== null) {
    const n = toInt(body.minMisses);
    if (n == null || n < 1 || n > MAX_MIN_MISSES) return { ok: false, error: `minMisses must be an integer from 1 to ${MAX_MIN_MISSES}` };
    if (n > 1) guards.minMisses = n;
  }
  if (body?.protectElsewhere !== undefined && body.protectElsewhere !== null) {
    if (typeof body.protectElsewhere !== "boolean") return { ok: false, error: "protectElsewhere must be true or false" };
    if (body.protectElsewhere) guards.protectElsewhere = true;
  }
  if (body?.minFreshRatio !== undefined && body.minFreshRatio !== null) {
    const r = Number(body.minFreshRatio);
    if (!Number.isFinite(r) || r < 0 || r > 1) return { ok: false, error: "minFreshRatio must be a number from 0 to 1" };
    if (r > 0) {
      guards.minFreshRatio = r;
      const live = body.minLiveForRatio === undefined || body.minLiveForRatio === null ? DEFAULT_MIN_LIVE_FOR_RATIO : toInt(body.minLiveForRatio);
      if (live == null || live < 1) return { ok: false, error: "minLiveForRatio must be a positive integer" };
      guards.minLiveForRatio = live;
    }
  }
  return { ok: true, guards };
}

// A row is "protected" while the same VIN is live at another store and was seen more recently than this row. Written as a LEFT JOIN rather than a
// NOT EXISTS subquery on the table being updated: MariaDB before 10.3.2 (and MySQL) refuses a subquery on the UPDATE target, a join works everywhere.
// The join can only add the one NULL-extended row per candidate (that is what `o.vin IS NULL` keeps), so it never multiplies the rows updated.
const PROTECT_JOIN_SQL = " LEFT JOIN dealer_inventory o ON o.vin = a.vin AND o.dealer_id <> a.dealer_id AND o.removed_at IS NULL AND o.last_seen_at > a.last_seen_at";
// The miss counter only means something while the row is still absent: a re-upload sets last_seen_at past sweep_miss_at (the run's cutoff), which ends the streak.
const missStreak = (c) => `(${c("sweep_miss_at")} IS NOT NULL AND ${c("last_seen_at")} < ${c("sweep_miss_at")})`;

/** `UPDATE ... SET <set>` head and the shared "which rows are candidates" WHERE for the retire and the miss-count statements. */
function candidateUpdate(parsed, set, setArgs = []) {
  const { dealerIds, seenAfter, sources, sourceBox = null, foreignBefore = null, protectElsewhere = false } = parsed;
  // Unprotected requests keep unqualified column names, so their SQL stays byte-for-byte what it always was.
  const c = protectElsewhere ? (n) => `a.${n}` : (n) => n;
  const args = [...setArgs];
  let sql = "UPDATE dealer_inventory" + (protectElsewhere ? " a" + PROTECT_JOIN_SQL : "") + " SET " + set(c);
  if (dealerIds.length === 1) {
    sql += ` WHERE ${c("dealer_id")} = ? AND ${c("removed_at")} IS NULL AND ${c("last_seen_at")} < ?`;
    args.push(dealerIds[0], seenAfter);
  } else {
    // A plain single-column IN-list: unlike a (vin, dealer_id) row-value IN-list (see handleInventoryBulk's
    // options DELETE), MariaDB turns this into index ranges on idx_inv_stock_dealer_id (removed_at, dealer_id).
    sql += ` WHERE ${c("dealer_id")} IN (?) AND ${c("removed_at")} IS NULL AND ${c("last_seen_at")} < ?`;
    args.push(dealerIds, seenAfter);
  }
  if (sources.length) {
    sql += ` AND ${c("source")} IN (?)`;
    args.push(sources);
  }
  // Never retire a row another box has written since foreignBefore. `source` is "nightly" for every box, so it cannot
  // tell boxes apart; source_box (the box whose sync last wrote the row) can. Found 2026-10-07: box3's sync retired 30+
  // Brownsville Toyota rows box2 had written that morning, because box3's own (stale) file didn't contain them.
  if (sourceBox && foreignBefore) {
    sql += ` AND (${c("source_box")} = ? OR ${c("source_box")} IS NULL OR ${c("last_seen_at")} < ?)`;
    args.push(sourceBox, foreignBefore);
  }
  if (protectElsewhere) sql += " AND o.vin IS NULL";
  return { sql, args, c };
}

/**
 * The UPDATE that retires rows for a parsed request. Without guard fields it is exactly the statement the sweep always ran. With
 * minMisses >= 2 it only retires a row whose previous absence was counted by an EARLIER run (sweep_miss_at < seenAfter) and whose count has
 * reached minMisses - 1; the miss-count statements (buildMissStatements) is what records the earlier absences.
 */
export function buildSweepStatement(parsed) {
  const u = candidateUpdate(parsed, (c) => `${c("removed_at")} = CURRENT_TIMESTAMP`);
  if (!(parsed.minMisses > 1)) return { sql: u.sql, args: u.args };
  const { c } = u;
  return {
    sql: `${u.sql} AND ${missStreak(c)} AND ${c("sweep_miss_at")} < ? AND ${c("sweep_miss_count")} >= ?`,
    args: [...u.args, parsed.seenAfter, parsed.minMisses - 1],
  };
}

/**
 * The UPDATEs that count this run's absence for rows that are missing but not yet due for retirement ([] when minMisses < 2). Run them AFTER the retire
 * statement, in order. Two statements instead of one because a multi-table UPDATE (the protect join) does not promise left-to-right assignment, so no
 * assignment here may read a column another assignment in the same statement writes:
 *   restart    rows whose absence streak is new or was broken by a re-upload  -> count 1, sweep_miss_at = this run's cutoff
 *   increment  rows already counted by an EARLIER run and still short of the threshold -> count + 1, sweep_miss_at = this run's cutoff
 * Both skip a row this run already counted (sweep_miss_at >= seenAfter), so a resumed or retried batch counts nothing twice.
 */
export function buildMissStatements(parsed) {
  if (!(parsed.minMisses > 1)) return [];
  const restart = candidateUpdate(parsed, (c) => `${c("sweep_miss_count")} = 1, ${c("sweep_miss_at")} = ?`, [parsed.seenAfter]);
  const inc = candidateUpdate(parsed, (c) => `${c("sweep_miss_count")} = ${c("sweep_miss_count")} + 1, ${c("sweep_miss_at")} = ?`, [parsed.seenAfter]);
  return [
    { sql: `${restart.sql} AND NOT ${missStreak(restart.c)}`, args: restart.args },
    { sql: `${inc.sql} AND ${missStreak(inc.c)} AND ${inc.c("sweep_miss_at")} < ? AND ${inc.c("sweep_miss_count")} < ?`, args: [...inc.args, parsed.seenAfter, parsed.minMisses - 1] },
  ];
}

/** Per-store live and fresh row counts for the partial-crawl guard (stores listed in dealerIds only). */
export function buildFreshnessCountsStatement({ dealerIds, seenAfter, sources }) {
  const args = [seenAfter, dealerIds];
  let sql = "SELECT dealer_id AS dealerId, COUNT(*) AS live, SUM(last_seen_at >= ?) AS fresh FROM dealer_inventory WHERE dealer_id IN (?) AND removed_at IS NULL";
  if (sources.length) {
    sql += " AND source IN (?)";
    args.push(sources);
  }
  sql += " GROUP BY dealer_id";
  return { sql, args };
}

/** Stores to skip: enough live rows to judge, and fewer than minFreshRatio of them seen since the cutoff. */
export function partialCrawlStores(counts, { minFreshRatio, minLiveForRatio = DEFAULT_MIN_LIVE_FOR_RATIO }) {
  const out = [];
  for (const c of counts) {
    const dealerId = Number(c.dealerId);
    const live = Number(c.live) || 0;
    const fresh = Number(c.fresh) || 0;
    if (dealerId > 0 && live >= minLiveForRatio && fresh < minFreshRatio * live) out.push({ dealerId, live, fresh });
  }
  return out.sort((a, b) => a.dealerId - b.dealerId);
}

/**
 * Runs a parsed sweep request. `query(sql, args)` resolves to `[result]` like mysql2's pool.query. A request without guard fields makes the one
 * statement it always made and returns just `removed`; with guards it also returns `skipped` (stores skipped by the partial-crawl guard, with their
 * live and fresh counts) and `counted` (rows whose absence was recorded but not yet retired).
 */
export async function runSweepRequest(query, parsed) {
  let working = parsed;
  let skipped = [];
  if (parsed.minFreshRatio) {
    // Store 0 ("no store matched") has no crawl of its own to be partial, so it is never ratio-checked.
    const judged = parsed.dealerIds.filter((id) => id > 0);
    if (judged.length) {
      const st = buildFreshnessCountsStatement({ dealerIds: judged, seenAfter: parsed.seenAfter, sources: parsed.sources });
      const [rows] = await query(st.sql, st.args);
      skipped = partialCrawlStores(rows || [], parsed);
      if (skipped.length) {
        const skip = new Set(skipped.map((s) => s.dealerId));
        working = { ...parsed, dealerIds: parsed.dealerIds.filter((id) => !skip.has(id)) };
      }
    }
  }
  const guarded = Boolean(parsed.minFreshRatio || parsed.minMisses > 1 || parsed.protectElsewhere);
  if (working.dealerIds.length === 0) return { removed: 0, counted: 0, skipped, guarded };
  const stmt = buildSweepStatement(working);
  const [result] = await query(stmt.sql, stmt.args);
  let counted = 0;
  for (const miss of buildMissStatements(working)) {
    const [m] = await query(miss.sql, miss.args);
    counted += m.affectedRows || 0;
  }
  return { removed: result.affectedRows, counted, skipped, guarded };
}
