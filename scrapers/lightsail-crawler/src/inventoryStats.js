// GET /api/inventory/stats: the admin Vehicles sheet header and the sync's "live totals" log line.
//
// Live on box2 2026-10-27 the endpoint answered 503 on every call (cold or warm: a failed compute caches nothing). One query was the cause: the "movement"
// aggregate, `SUM(change_type = ...), SUM(price_diff ...), SUM(window_sticker_url IS NOT NULL), SUM(removed_at >= now-1d) ... WHERE removed_at IS NULL OR
// removed_at >= now-1d`. The OR defeats every index (EXPLAIN: type ALL, ~4.4M rows) and it ran past even a 150 s cap. The other four queries take 0.9-8.5 s.
//
// What changed (EXPLAINs and timings from box2, reader account, 20 s cap, in docs/box-patches/2026-10-28-stats-movement-split/STEPS.md):
//   - Each movement figure is its own query, bounded by an index:
//       priceDrops / priceIncreases  live rows,  idx_inv_stock_diff (removed_at, price_diff)   range, index only   ~0.1 s
//       arrivals                     live rows,  idx_inv_removed + idx_inv_change              intersect, index only  ~2-4 s
//       removedToday                 removed in the last day, removed_at range                 range, index only   ~0.4 s
//   - The figures are now about the cars IN STOCK (the sheet puts them beside "In stock" and "Removed (24h)"). The old query also summed arrivals and price
//     moves over the cars removed in the last day; reading those needs a row lookup per removed car (324k of them) and ran past 20 s on its own, so it is dropped.
//   - withSticker has no index (a VARCHAR(700) that no index covers), so it is the one figure that still needs a table scan. It runs in the BACKGROUND
//     budget (120 s) on its own schedule, is never waited on, and the payload carries its last good value (null until the first success). The admin sheet
//     does not render it.
//   - One failed query never wipes the cache: a part that fails reuses its own last good value and the payload says so in `stale`. Only a part that has
//     never succeeded since the process started (a cold, broken database) fails the request, as before.
//
// 2026-10-28 (box2, 20 s cap): the `totals` query took 21.6 s. It is COUNT(DISTINCT dealer_id), COUNT(DISTINCT vin) and MAX over all ~4.4M rows, and the
// distinct counts have no index to ride. It is split the same way:
//   - total / inStock   one index-only pass over idx_inv_removed (`COUNT(*), SUM(removed_at IS NULL)`), no row lookups, in the request path
//   - lastSeenAt        `MAX(last_seen_at)` is a one-row read of idx_inv_last_seen, in the request path
//   - dealers / vins    the distinct counts run in the BACKGROUND budget (120 s), single flight, every 30 min, last good value kept (null until the first
//                       success). They move slowly. Admin sheet and the sync summary tolerate null.
//
// Pure of the server: the query function, the background runner and the clock are injected, so it is unit-testable.

const T = "dealer_inventory";

export const STATS_SQL = {
  totals: `SELECT COUNT(*) AS total, SUM(removed_at IS NULL) AS inStock FROM ${T}`,
  lastSeen: `SELECT MAX(last_seen_at) AS lastSeenAt FROM ${T}`,
  distinct: `SELECT COUNT(DISTINCT dealer_id) AS dealers, COUNT(DISTINCT vin) AS vins FROM ${T}`,
  byMake: `SELECT make, COUNT(*) AS n FROM ${T} WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100`,
  // Reads state directly (denormalized onto dealer_inventory in PR #296), not a JOIN into dealership_contacts.
  byState: `SELECT state, COUNT(*) AS n FROM ${T} WHERE removed_at IS NULL AND state IS NOT NULL GROUP BY state ORDER BY n DESC`,
  byCond: `SELECT cond, COUNT(*) AS n FROM ${T} WHERE removed_at IS NULL GROUP BY cond`,
  priceDrops: `SELECT COUNT(*) AS n FROM ${T} WHERE removed_at IS NULL AND price_diff < 0`,
  priceIncreases: `SELECT COUNT(*) AS n FROM ${T} WHERE removed_at IS NULL AND price_diff > 0`,
  arrivals: `SELECT COUNT(*) AS n FROM ${T} WHERE change_type = 'NEW_ARRIVAL' AND removed_at IS NULL`,
  removedToday: `SELECT COUNT(*) AS n FROM ${T} WHERE removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
  withSticker: `SELECT COUNT(*) AS n FROM ${T} WHERE removed_at IS NULL AND window_sticker_url IS NOT NULL`,
};

export const STICKER_REFRESH_MS = 6 * 60 * 60_000; // the sticker coverage figure moves slowly
export const STICKER_RETRY_MS = 60 * 60_000; // after a failed scan, do not start another for an hour (it is the one table scan)
export const DISTINCT_REFRESH_MS = 30 * 60_000;
export const DISTINCT_RETRY_MS = 15 * 60_000;

const count = (rows) => Number(rows?.[0]?.n ?? 0);

/**
 * @param {{ query: (sql: string) => Promise<any[]>, runBackground?: (fn: () => Promise<any>) => Promise<any>, now?: () => number, log?: { log: Function, error: Function },
 *           stickerRefreshMs?: number, stickerRetryMs?: number, distinctRefreshMs?: number, distinctRetryMs?: number }} deps  query resolves to the rows of the statement (not mysql2's [rows, fields] pair).
 */
export function createInventoryStats({ query, runBackground = (fn) => fn(), now = Date.now, log = console, stickerRefreshMs = STICKER_REFRESH_MS, stickerRetryMs = STICKER_RETRY_MS, distinctRefreshMs = DISTINCT_REFRESH_MS, distinctRetryMs = DISTINCT_RETRY_MS }) {
  const good = new Map(); // part name -> last good value
  let sticker = { value: null, at: null, failedAt: null, running: null };
  let distinct = { value: null, at: null, failedAt: null, running: null }; // value: { dealers, vins }

  /** Run one part. A failure reuses that part's last good value and records it in `stale`; with no last good value the failure propagates. */
  async function part(name, stale, fn) {
    try {
      const value = await fn();
      good.set(name, value);
      return value;
    } catch (err) {
      if (!good.has(name)) throw err;
      log.error(`inventory stats: ${name} failed (${err.message}); serving its last good value`);
      stale.push(name);
      return good.get(name);
    }
  }

  function refreshSticker() {
    if (sticker.running) return;
    const t = now();
    if (sticker.at != null && t - sticker.at < stickerRefreshMs) return;
    if (sticker.failedAt != null && t - sticker.failedAt < stickerRetryMs) return;
    sticker.running = (async () => {
      try {
        const rows = await runBackground(() => query(STATS_SQL.withSticker));
        sticker = { ...sticker, value: count(rows), at: now(), failedAt: null };
      } catch (err) {
        sticker = { ...sticker, failedAt: now() };
        log.error(`inventory stats: withSticker scan failed (${err.message}); retry in ${Math.round(stickerRetryMs / 60000)} min, last good value kept`);
      } finally { sticker.running = null; }
    })();
    sticker.running.catch(() => {});
  }

  function refreshDistinct() {
    if (distinct.running) return;
    const t = now();
    if (distinct.at != null && t - distinct.at < distinctRefreshMs) return;
    if (distinct.failedAt != null && t - distinct.failedAt < distinctRetryMs) return;
    distinct.running = (async () => {
      try {
        const rows = await runBackground(() => query(STATS_SQL.distinct));
        distinct = { ...distinct, value: { dealers: Number(rows?.[0]?.dealers ?? 0), vins: Number(rows?.[0]?.vins ?? 0) }, at: now(), failedAt: null };
      } catch (err) {
        distinct = { ...distinct, failedAt: now() };
        log.error(`inventory stats: dealers/vins distinct scan failed (${err.message}); retry in ${Math.round(distinctRetryMs / 60000)} min, last good value kept`);
      } finally { distinct.running = null; }
    })();
    distinct.running.catch(() => {});
  }

  async function compute() {
    const stale = [];
    const one = async (name) => (await query(STATS_SQL[name]))[0];
    const tot = await part("totals", stale, () => one("totals"));
    const seen = await part("lastSeen", stale, () => one("lastSeen"));
    const byMake = await part("byMake", stale, () => query(STATS_SQL.byMake));
    const byState = await part("byState", stale, () => query(STATS_SQL.byState));
    const byCond = await part("byCond", stale, () => query(STATS_SQL.byCond));
    const n = async (name) => part(name, stale, async () => count(await query(STATS_SQL[name])));
    const arrivals = await n("arrivals");
    const priceDrops = await n("priceDrops");
    const priceIncreases = await n("priceIncreases");
    const removedToday = await n("removedToday");
    refreshDistinct(); // fire and forget: never part of the response time
    refreshSticker();
    const out = {
      total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: distinct.value?.dealers ?? null, vins: distinct.value?.vins ?? null, lastSeenAt: seen.lastSeenAt, byMake, byState, byCond,
      movement: { arrivals, priceDrops, priceIncreases, withSticker: sticker.value, removedToday },
    };
    if (stale.length) out.stale = stale;
    return out;
  }

  return { compute, peekDistinct: () => ({ value: distinct.value, at: distinct.at, failedAt: distinct.failedAt, running: Boolean(distinct.running) }), peekSticker: () => ({ value: sticker.value, at: sticker.at, failedAt: sticker.failedAt, running: Boolean(sticker.running) }) };
}
