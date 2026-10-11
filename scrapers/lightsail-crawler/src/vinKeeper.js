// One in-stock row per VIN: request parsing, the keeper decision and the statements for POST /api/inventory/duplicate-vins — extracted from
// deals_api_server.js (which starts a real server when imported) so it can be unit-tested.
//
// Why (measured on the live table 2026-10-11): 176,027 VINs are in stock under two or more stores (391,783 rows; 215,756 surplus). The crawl
// keeps ONE record per VIN per state shard, so a car listed by several sites (a dealer group pooling its inventory, a used car shown on a
// sister store's site, a neighbouring state's store) is uploaded under whichever store claimed it last that night — and under a second
// store when the same VIN sits in a second state shard or in another box's shard. Nothing ever retires the other store's row:
//   * supersededRetire.js (#449) deliberately keeps every row a run just refreshed ("a VIN uploaded under two stores keeps both"), and
//     protects rows another box refreshed within 48h, so a VIN two shards/boxes keep uploading stays double forever;
//   * the sweep only visits stores that uploaded something, so a store whose cars all moved to a sister site is never swept;
//   * the next night's upload sets removed_at = NULL again on whatever it uploads, so a row retired by hand comes back.
//
// The rule: among a VIN's live nightly rows keep exactly one, chosen only from stored facts so every box and every night picks the same one
// (no ping-pong between boxes):
//   1. a row refreshed within the freshness window (last_seen_at >= foreignBefore) beats one that is not — a car listed only by a store that
//      stopped listing it never outranks a store that still does;
//   2. a row filed under a real store (dealer_id > 0) beats the "no store matched" bucket (0);
//   3. the incumbent: the earliest first_seen_at (the store that has had the car longest keeps it);
//   4. the lowest dealer_id, so the choice is total.
// Only source = 'nightly' rows take part; rows from any other source are neither keepers nor retired.
// For merged-feed groups with real evidence (stock-number prefix, a one-rooftop re-crawl) use dedupeMergedFeeds.js first; this rule is a stable
// convention, not evidence of where the car physically is.

export const MAX_DUPLICATE_VINS = 500;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const ts = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Date.parse(String(v).replace(" ", "T")));

/**
 * @param {any} body
 * @param {{ toStr: (v: any, n: number) => string | null }} h
 * @returns {{ ok: true, vins: string[], foreignBefore: Date, dryRun: boolean } | { ok: false, error: string }}
 */
export function parseDuplicateVinRequest(body, { toStr: _toStr } = {}) {
  const foreignBefore = typeof body?.foreignBefore === "string" ? new Date(body.foreignBefore) : null;
  if (!foreignBefore || Number.isNaN(foreignBefore.getTime())) return { ok: false, error: "foreignBefore (ISO) is required" };
  if (!Array.isArray(body.vins) || body.vins.length === 0) return { ok: false, error: "vins must be a non-empty array of VINs" };
  if (body.vins.length > MAX_DUPLICATE_VINS) return { ok: false, error: `vins is limited to ${MAX_DUPLICATE_VINS} per call` };
  const vins = [];
  const seen = new Set();
  for (const raw of body.vins) {
    const vin = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!VIN_RE.test(vin)) return { ok: false, error: "every entry must be a 17-character VIN" };
    if (!seen.has(vin)) { seen.add(vin); vins.push(vin); }
  }
  return { ok: true, vins, foreignBefore, dryRun: body.dryRun === true };
}

/**
 * Decide, per VIN, which live nightly row stays. Pure.
 * @param {Array<{ vin: string, dealerId: number, firstSeenAt?: Date|string|null, lastSeenAt?: Date|string|null, source?: string|null, removedAt?: any }>} rows
 * @param {{ foreignBefore: Date|string }} opts
 * @returns {{ keep: Array<[string, number]>, retire: Array<[string, number]>, vinsWithDuplicates: number }}
 */
export function planVinKeepers(rows, { foreignBefore }) {
  const cutoff = ts(foreignBefore);
  if (cutoff == null || Number.isNaN(cutoff)) throw new Error("planVinKeepers needs foreignBefore");
  const byVin = new Map();
  for (const r of rows) {
    if (r.removedAt != null || (r.source != null && r.source !== "nightly")) continue;
    const vin = String(r.vin || "").toUpperCase();
    if (!vin) continue;
    if (!byVin.has(vin)) byVin.set(vin, []);
    byVin.get(vin).push({ vin, dealerId: Number(r.dealerId), first: ts(r.firstSeenAt), last: ts(r.lastSeenAt) });
  }
  const rank = (a, b) => {
    const fa = a.last != null && a.last >= cutoff ? 1 : 0, fb = b.last != null && b.last >= cutoff ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const sa = a.dealerId > 0 ? 1 : 0, sb = b.dealerId > 0 ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const ia = a.first ?? Infinity, ib = b.first ?? Infinity;
    if (ia !== ib) return ia - ib;
    return a.dealerId - b.dealerId;
  };
  const keep = [], retire = [];
  let vinsWithDuplicates = 0;
  for (const [vin, list] of [...byVin].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort(rank);
    keep.push([vin, list[0].dealerId]);
    if (list.length > 1) vinsWithDuplicates++;
    for (const r of list.slice(1)) retire.push([vin, r.dealerId]);
  }
  return { keep, retire, vinsWithDuplicates };
}

/** Live nightly rows of the given VINs (primary-key prefix lookups; the table's PK is (vin, dealer_id)). */
export function buildRowsSelect(vins) {
  return {
    sql: `SELECT vin, dealer_id AS dealerId, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, source FROM dealer_inventory WHERE removed_at IS NULL AND source = 'nightly' AND vin IN (${vins.map(() => "?").join(", ")})`,
    args: [...vins],
  };
}

/** Retires the planned (vin, dealer_id) pairs by primary key; re-checks removed_at so a concurrent change is never double-counted. */
export function buildRetireStatement(pairs) {
  const conds = pairs.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ");
  return { sql: `UPDATE dealer_inventory FORCE INDEX (PRIMARY) SET removed_at = CURRENT_TIMESTAMP WHERE removed_at IS NULL AND source = 'nightly' AND (${conds})`, args: pairs.flat() };
}
