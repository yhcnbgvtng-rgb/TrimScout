// Server-side half of onePerVin (onePerVin.js is the pure half): reads the VINs held by 2+ visible rows and turns the rows that lose the
// rule into the facet-subtraction buckets. Kept out of deals_api_server.js so that file stays the one the sweep-guards install package pins;
// the few lines that call this are the box patch in docs/box-patches/2026-10-28-one-per-vin/. Display-only: nothing is written.
import { planVinLosers, loserBuckets } from "./onePerVin.js";
import { adjustFacetLists } from "./retailFacets.js";

/**
 * The rows that LOSE the one-listing-per-VIN rule: found as VINs held by 2+ visible rows (a GROUP BY over the primary key, one first-character
 * slice at a time so each statement stays small), then ranked from the VINs' rows by primary-key prefix. Cached stale-while-revalidate per
 * window by the caller's stableCached; a failure is NOT cached.
 * @param {{ pool: any, stableCached: Function, withPoolTimeout: Function, statementSeconds: () => number, waitMs: () => number, retailOnlyFacets: boolean }} deps
 */
export async function vinLoserRows(deps, days) {
  const { pool, stableCached, withPoolTimeout, statementSeconds, waitMs, retailOnlyFacets } = deps;
  return stableCached(`vin-losers:${days || 0}`, async () => {
    const run = async (sql, args) => (await withPoolTimeout(
      pool.query(`SET STATEMENT max_statement_time=${statementSeconds()} FOR ${sql}`, args),
      waitMs(),
      "Timed out waiting for an available database connection or a slow query"
    ))[0];
    const visible = `removed_at IS NULL AND stale_at IS NULL${retailOnlyFacets ? " AND (cond IS NULL OR cond <> 'wholesale')" : ""}${days ? " AND last_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)" : ""}`;
    const vArgs = days ? [days] : [];
    const losers = [];
    for (const c of "0123456789ABCDEFGHJKLMNPRSTUVWXYZ") {
      const dupVins = (await run(`SELECT vin FROM dealer_inventory WHERE vin >= ? AND vin < ? AND ${visible} GROUP BY vin HAVING COUNT(*) > 1`, [c, String.fromCharCode(c.charCodeAt(0) + 1), ...vArgs])).map((r) => r.vin);
      for (let i = 0; i < dupVins.length; i += 500) {
        const rows = await run(`SELECT vin, dealer_id, last_seen_at, price, make, state, model, trim FROM dealer_inventory WHERE vin IN (?) AND ${visible}`, [dupVins.slice(i, i + 500), ...vArgs]);
        losers.push(...planVinLosers(rows.map((r) => ({ vin: r.vin, dealerId: r.dealer_id, lastSeenAt: r.last_seen_at, price: r.price, make: r.make, state: r.state, model: r.model, trim: r.trim }))));
      }
    }
    return losers;
  });
}

/**
 * Facet lists with the duplicate-VIN losers subtracted (and, with `dealerIds`, only that store set's losers — the contact filter). `wholesaleStale`
 * are the buckets the caller already subtracts (or null). A failed read leaves the counts as they were and says so (`applied: false`).
 */
export async function facetsOnePerVin(deps, lists, f, { days = null, dealerIds = null, hidden = null } = {}) {
  let lb = null;
  try { lb = loserBuckets(await vinLoserRows(deps, days), dealerIds); } catch (err) { console.error(`${new Date().toISOString()} duplicate-VIN buckets unavailable, facet counts left unadjusted: ${err.message}`); }
  const all = hidden || lb ? [...(hidden || []), ...(lb || [])] : null;
  return { lists: all ? adjustFacetLists(lists, all, f) : lists, applied: lb !== null };
}
