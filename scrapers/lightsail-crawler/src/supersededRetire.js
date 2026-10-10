// Request parsing + statement building for POST /api/inventory/superseded — extracted from deals_api_server.js (which starts a real
// server when imported) so it can be unit-tested.
//
// Why: the crawl keys a night's vehicles by VIN, so when several sites list the same cars (a dealer group pooling its inventory, a used
// car shown on a sister store's site) the last store to claim a VIN wins and the car is uploaded under that one store. The rows the
// same VIN had under the OTHER stores are never refreshed again, and the sweep only retires stores that uploaded something that night,
// so they stay "in stock" as duplicates (found 2026-10-10: Nissan of Marietta's 758 cars, 571 of them now filed under Nissan South
// Morrow; Berman Nissan's 864 under Berman Subaru) and the stores look like they scraped zero.
//
// The rule: for every (vin, store) pair this run uploaded, retire the same VIN's rows under any OTHER store that this run did not
// refresh (last_seen_at < seenAfter). A row a run just wrote is never touched, so a VIN legitimately uploaded under two stores keeps both.

export const MAX_SUPERSEDE_PAIRS = 500;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * @param {any} body
 * @param {{ toInt: (v: any) => number | null, toStr: (v: any, n: number) => string | null }} h
 * @returns {{ ok: true, pairs: [string, number][], seenAfter: Date, dryRun: boolean, sourceBox: string|null, foreignBefore: Date|null } | { ok: false, error: string }}
 */
export function parseSupersedeRequest(body, { toInt, toStr }) {
  const seenAfter = typeof body?.seenAfter === "string" ? new Date(body.seenAfter) : null;
  if (!seenAfter || Number.isNaN(seenAfter.getTime())) return { ok: false, error: "seenAfter (ISO) is required" };
  if (!Array.isArray(body.pairs) || body.pairs.length === 0) return { ok: false, error: "pairs must be a non-empty array of [vin, storeId]" };
  if (body.pairs.length > MAX_SUPERSEDE_PAIRS) return { ok: false, error: `pairs is limited to ${MAX_SUPERSEDE_PAIRS} per call` };
  const seen = new Set();
  const pairs = [];
  for (const p of body.pairs) {
    const vin = Array.isArray(p) && typeof p[0] === "string" ? p[0].trim().toUpperCase() : "";
    const id = Array.isArray(p) ? toInt(p[1]) : null;
    if (!VIN_RE.test(vin) || id == null || id <= 0) return { ok: false, error: "every pair must be [17-character VIN, positive store id]" };
    const key = `${vin}|${id}`;
    if (!seen.has(key)) { seen.add(key); pairs.push([vin, id]); }
  }
  // Same cross-box protection as the sweep: with sourceBox, a row another box wrote since foreignBefore is left alone.
  const sourceBox = typeof body?.sourceBox === "string" ? toStr(body.sourceBox, 16) : null;
  const foreignBefore = typeof body?.foreignBefore === "string" ? new Date(body.foreignBefore) : null;
  if (sourceBox && (!foreignBefore || Number.isNaN(foreignBefore.getTime()))) return { ok: false, error: "sourceBox needs foreignBefore (ISO)" };
  return { ok: true, pairs, seenAfter, dryRun: body.dryRun === true, sourceBox: sourceBox || null, foreignBefore: sourceBox ? foreignBefore : null };
}

/** The UPDATE (or, for a dry run, the matching COUNT) for a parsed request. Joins the uploaded pairs to the table on its (vin, dealer_id) primary key. */
export function buildSupersedeStatement({ pairs, seenAfter, dryRun = false, sourceBox = null, foreignBefore = null }) {
  const derived = pairs.map(() => "SELECT ? AS vin, ? AS keep_id").join(" UNION ALL ");
  const args = pairs.flat();
  let where = "i.removed_at IS NULL AND i.dealer_id <> k.keep_id AND i.last_seen_at < ? AND i.source = 'nightly'";
  args.push(seenAfter);
  if (sourceBox && foreignBefore) {
    where += " AND (i.source_box = ? OR i.source_box IS NULL OR i.last_seen_at < ?)";
    args.push(sourceBox, foreignBefore);
  }
  const sql = dryRun
    ? `SELECT COUNT(DISTINCT i.vin, i.dealer_id) AS n FROM dealer_inventory i JOIN (${derived}) k ON k.vin = i.vin WHERE ${where}`
    : `UPDATE dealer_inventory i JOIN (${derived}) k ON k.vin = i.vin SET i.removed_at = CURRENT_TIMESTAMP WHERE ${where}`;
  return { sql, args };
}
