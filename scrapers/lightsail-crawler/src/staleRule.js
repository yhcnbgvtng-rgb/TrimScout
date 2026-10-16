// Last-seen staleness rule for cars at stores the nightly sweep never reads (bot-protection 403s, dead sites, failed syncs).
// The sweep (inventorySweep.js) only retires cars of a store that scraped at least one vehicle, so a store that scrapes zero keeps
// every car in stock with an ever older last_seen_at. We never bypass the 403s; instead cars age out by what we last SAW:
//
//   hide    last seen more than STALE_RULE_HIDE_DAYS ago -> out of buyer search/counts/facets (the web sends seenWithinDays; rows untouched)
//   retire  last seen more than STALE_RULE_RETIRE_DAYS ago -> removed_at set, EXCEPT a car with an open RFQ / quote / deal on it
//
// OFF unless STALE_RULE=1. Off means: web keeps the shipped 7-day hide (lib/lastConfirmed.ts), nothing retires, the CLI refuses --apply.
// Everything here is pure (SQL text + arithmetic) so it is unit-tested without a database.

export const DEFAULT_HIDE_DAYS = 4;
export const DEFAULT_RETIRE_DAYS = 14;
/** Retire only runs for cars this many days older than the hide line, so hide always comes first. */
export const MIN_RETIRE_GAP_DAYS = 3;

/** @param {Record<string, string|undefined>} env */
export function staleRuleConfig(env = process.env) {
  const enabled = env.STALE_RULE === "1";
  const int = (raw, dflt, lo, hi) => {
    if (raw === undefined || raw === "") return dflt;
    const n = Number(raw);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
  };
  const hideDays = int(env.STALE_RULE_HIDE_DAYS, DEFAULT_HIDE_DAYS, 2, 30);
  const retireRaw = int(env.STALE_RULE_RETIRE_DAYS, DEFAULT_RETIRE_DAYS, 3, 90);
  const retireDays = Math.max(retireRaw, hideDays + MIN_RETIRE_GAP_DAYS);
  return { enabled, hideDays, retireDays };
}

/**
 * VINs that must never be retired: an open RFQ (collecting/picked), an unexpired un-superseded quote, an invite still invited/quoted
 * (vehicle_json.vin), an active deal request's reference car, or any live deal's matched car. Read-only SELECT, one VIN per row.
 */
export const OPEN_VINS_SQL =
  "SELECT vin FROM rfq_requests WHERE deleted_at IS NULL AND status IN ('collecting','picked') AND vin <> '' " +
  "UNION SELECT vin FROM rfq_quotes WHERE deleted_at IS NULL AND superseded_at IS NULL AND expires_at > NOW() AND vin <> '' " +
  "UNION SELECT JSON_UNQUOTE(JSON_EXTRACT(vehicle_json, '$.vin')) FROM rfq_invites WHERE deleted_at IS NULL AND status IN ('invited','quoted') AND vehicle_json IS NOT NULL " +
  "UNION SELECT reference_vin FROM deal_requests WHERE deleted_at IS NULL AND status = 'active' AND reference_vin <> '' " +
  "UNION SELECT matched_vin FROM deals WHERE deleted_at IS NULL AND matched_vin IS NOT NULL AND matched_vin <> ''";

const days = (n) => {
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error(`bad day count: ${n}`);
  return n;
};

/** Per-brand count of live cars the hide line (or retire line) would take out. Index-only range on idx_inv_stock_seen plus a row lookup for make. */
export function perBrandSql(nDays) {
  return `SELECT COALESCE(NULLIF(make, ''), '(blank)') AS make, source_box AS box, COUNT(*) AS cars FROM dealer_inventory FORCE INDEX (idx_inv_stock_seen) WHERE removed_at IS NULL AND last_seen_at < NOW() - INTERVAL ${days(nDays)} DAY GROUP BY make, source_box ORDER BY cars DESC`;
}

/**
 * The retire statement for one batch of dealers (bounded; the CLI walks dealer ids). Only sets removed_at, only on live cars past the
 * retire line, never a VIN in `openVins`. A later sighting of the car re-inserts it through the normal upsert, which clears removed_at.
 */
export function buildRetireStatement(dealerIds, retireDays, openVins) {
  if (!Array.isArray(dealerIds) || !dealerIds.length) throw new Error("dealerIds required");
  const guard = openVins.length ? " AND vin NOT IN (?)" : "";
  return {
    sql: `UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id IN (?) AND removed_at IS NULL AND last_seen_at < NOW() - INTERVAL ${days(retireDays)} DAY${guard}`,
    args: openVins.length ? [dealerIds, openVins] : [dealerIds],
  };
}

/** Count of cars the retire line would spare because of an open RFQ/quote/deal (counts only). */
export function spareCountSql(retireDays) {
  return `SELECT COUNT(*) AS spared FROM dealer_inventory i WHERE i.removed_at IS NULL AND i.last_seen_at < NOW() - INTERVAL ${days(retireDays)} DAY AND i.vin IN (${OPEN_VINS_SQL})`;
}

/** @param {{make:string, box:string|null, cars:number}[]} rows -> { total, byBrand:[{make,cars}], byBox:[{box,cars}] } sorted descending */
export function summarize(rows) {
  const sum = (key) => {
    const m = new Map();
    for (const r of rows) m.set(r[key] ?? "?", (m.get(r[key] ?? "?") || 0) + Number(r.cars));
    return [...m].map(([k, cars]) => ({ [key]: k, cars })).sort((a, b) => b.cars - a.cars);
  };
  return { total: rows.reduce((s, r) => s + Number(r.cars), 0), byBrand: sum("make"), byBox: sum("box") };
}
