// The admin analytics + homepage market-pulse payloads run MEDIAN(days_on_lot) OVER (...) — a full scan of dealer_inventory that evicts the
// buyer search's hot pages from the buffer pool. They used to sit behind invCached, which every bulk upsert/sweep clears, so while the crawl
// pushed (hours, every night) they rescanned on nearly every page load. This is their own stale-while-revalidate cache (stableCache.js):
// writes do NOT invalidate it, an expired entry is served at once while ONE background refresh recomputes, and it survives a restart.
import { createStableCache } from "./stableCache.js";

export const STATS_CACHE_MS = 30 * 60_000;
// Filtered analytics keys (state/make/dealer/model/dates) are open-ended; cap them so the persisted file stays small.
export const STATS_CACHE_MAX_ENTRIES = 40;

export function createStatsCache(opts = {}) {
  return createStableCache({ ttlMs: STATS_CACHE_MS, maxEntries: STATS_CACHE_MAX_ENTRIES, ...opts }).get;
}

/**
 * Fire-and-forget: ask the cache for each key once so a restart never leaves it cold. A fresh persisted entry returns at once, an expired one
 * is served while its background refresh runs, and a missing one computes now. Never throws and never blocks the caller (returns the promise
 * for tests only); one failing key does not stop the others.
 */
export function warmStatsCache(get, jobs, { log = console } = {}) {
  return Promise.all(jobs.map(async ({ key, compute }) => {
    try { await get(key, compute); log.log(`stats cache: warmed ${key}`); }
    catch (err) { log.error(`stats cache: warm of ${key} failed: ${err.message}`); }
  }));
}
