// The admin "Reachable by quote request" counts, kept OUT of the MEDIAN analytics path. The first cut put a per-vehicle GROUP BY dealer_id that also
// aggregated i.dealer_name and four dealership_contacts columns inside computeInventoryAnalytics: dealer_name is in neither dealer_id index, so every
// in-stock car needed a row lookup plus a join (the by-dealer comment in deals_api_server.js measured that shape at 32 s cold vs 223 ms covered), and a cold
// call ran past 120 s on box2 (2026-10-30, rolled back). Here the counts come from two cheap, separately cached reads, overlaid on the cached stats payload:
//   1. the dealer directory (dealership_contacts, one row per rooftop): classified once in JS with the shared rule (quoteReachable.js);
//   2. the dealer ids in scope: SELECT dealer_id ... WHERE removed_at IS NULL GROUP BY dealer_id, answered from the (removed_at, dealer_id) index alone.
// Nothing here touches the stats cache, and a failure leaves the stats payload exactly as it was (the page then shows its "not updated" label).
import { reachabilityBucket, stampGroupDomains } from "./quoteReachable.js";

export const REACHABLE_CACHE_MS = 30 * 60_000;
export const DIRECTORY_SQL = "SELECT id, dealer_name AS dealerName, contact_email AS contactEmail, website, domains_json AS domainsJson, email_opt_out AS emailOptOut FROM dealership_contacts WHERE is_test = 0";

/** The WHERE of computeInventoryAnalytics, for the same filters (already sanitised by the handler). Only i.* columns: no join is needed. */
export function scopeSql(f) {
  const where = [], args = [];
  if (f.state) { where.push("i.state = ?"); args.push(f.state); }
  if (f.make) { where.push("i.make = ?"); args.push(f.make); }
  if (f.dealerId != null) { where.push("i.dealer_id = ?"); args.push(f.dealerId); }
  if (f.model) { where.push("i.model = ?"); args.push(f.model); }
  if (f.from) { where.push("i.last_seen_at >= ?"); args.push(f.from); }
  if (f.to) { where.push("i.first_seen_at <= ?"); args.push(f.to + " 23:59:59"); }
  where.push("i.removed_at IS NULL", "i.dealer_id > 0");
  return { sql: `SELECT i.dealer_id AS dealerId FROM dealer_inventory i WHERE ${where.join(" AND ")} GROUP BY i.dealer_id`, args };
}

/** Directory rows -> Map(String(id) -> "reachable" | "unverified" | "none"), one pass with group domains stamped across the whole directory. */
export function bucketsFromDirectory(rows) {
  const stamped = stampGroupDomains((rows || []).map((r) => ({ ...r, emailOptOut: Boolean(Number(r.emailOptOut || 0)), domains: r.domainsJson })));
  const out = new Map();
  for (const r of stamped) out.set(String(r.id), reachabilityBucket(r));
  return out;
}

/** Pure: the stats payload with the reachable counts and each byDealer row's emailStatus/hasEmail taken from `buckets` for the dealers in `ids`. */
export function overlayReachable(stats, ids, buckets) {
  let reachable = 0, unverified = 0;
  for (const id of ids) {
    const b = buckets.get(String(id));
    if (b === "reachable") reachable++;
    else if (b === "unverified") unverified++;
  }
  const bucketOf = (id) => buckets.get(String(id)) || "none";
  return {
    ...stats,
    coverage: { ...(stats && stats.coverage), dealersReachable: reachable, dealersUnverified: unverified, dealersWithEmail: reachable },
    dom: stats && stats.dom && Array.isArray(stats.dom.byDealer)
      ? { ...stats.dom, byDealer: stats.dom.byDealer.map((r) => ({ ...r, emailStatus: bucketOf(r.dealerId), hasEmail: bucketOf(r.dealerId) === "reachable" })) }
      : (stats && stats.dom),
  };
}

/**
 * The analytics response: `stats` (from the stats cache, untouched) plus the reachable overlay. `cache` is its OWN stale-while-revalidate cache
 * (createStableCache().get, in memory), `run(sql, args)` returns rows with the server's statement cap and pool wait applied. Never throws.
 */
export async function withReachableCoverage({ stats, f, cache, run, log = console }) {
  try {
    const buckets = await cache("reach-directory", async () => bucketsFromDirectory(await run(DIRECTORY_SQL, [])));
    const ids = await cache(`reach-ids:${JSON.stringify(f)}`, async () => {
      const { sql, args } = scopeSql(f);
      return (await run(sql, args)).map((r) => r.dealerId);
    });
    return overlayReachable(stats, ids, buckets);
  } catch (err) {
    log.error(`reachable coverage: left off the analytics response: ${err.message}`);
    return stats;
  }
}
