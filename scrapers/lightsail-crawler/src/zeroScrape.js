// Zero-scrape staleness: a store whose cars the crawl stopped seeing, while the rest of its platform is still being seen.
//
// The nightly sweep (inventorySweep.js) only runs for stores that scraped at least one vehicle that night — "this store's
// listing no longer shows the car" is only a statement about a store we actually read. A store that scrapes ZERO is therefore
// never swept, and its old cars stay in stock forever (found 2026-10-09: 300 stores / ~94.8k live cars last seen 6+ nights ago).
//
// We cannot retire those cars (zero can mean "the dealer's site broke", not "everything sold"), so the rule is softer:
// after ZERO_SCRAPE_NIGHTS consecutive nights with nothing scraped, the store's live cars get `stale_at` set. A stale car stays
// in the table (removed_at untouched, still in the admin sheet) but is hidden from buyer search. The next upsert of the car clears
// stale_at (deals_api_server.js), so a store that comes back un-hides itself with no extra step.
//
// "Platform otherwise healthy": if the whole box or the whole make cohort scraped nothing, that is an outage of ours, not a
// dead store, and nothing is marked. Cohort = stores on the same crawl box with the same make; a store needs enough peers for
// the check to mean anything, else its box is the cohort.

export const ZERO_SCRAPE_NIGHTS = 3;
const NIGHT_MS = 24 * 3600_000;
// The nightly syncs stamp last_seen_at at different clock times, so "N nights" is measured with half a night of grace.
const GRACE_MS = 12 * 3600_000;
export const MIN_PEERS = 5;
export const HEALTHY_SHARE = 0.6;

/** A store is zero-scrape if its newest last_seen_at is older than this. runStart = when tonight's sync started. */
export function zeroScrapeCutoff(runStart, nights = ZERO_SCRAPE_NIGHTS) {
  return new Date(runStart.getTime() - nights * NIGHT_MS + GRACE_MS);
}

/**
 * @param {{ dealerId:number, sourceBox:string|null, make:string|null, lastSeen:Date, live:number, alreadyStale?:boolean }[]} stores one per (store, make)
 * @param {{ runStart: Date, nights?: number }} opts
 * @returns {{ stale: number[], held: { dealerId:number, reason:string }[], cutoff: Date }}
 */
export function classifyZeroScrape(stores, { runStart, nights = ZERO_SCRAPE_NIGHTS }) {
  const cutoff = zeroScrapeCutoff(runStart, nights);
  const recent = new Date(runStart.getTime() - NIGHT_MS); // "scraped last night" for the health check
  // Per store: newest sighting across all its makes; per cohort: how many distinct stores were seen last night.
  const byStore = new Map();
  for (const s of stores) {
    const cur = byStore.get(s.dealerId) || { dealerId: s.dealerId, sourceBox: s.sourceBox || "?", make: s.make || "?", lastSeen: 0, live: 0, liveByMake: new Map(), alreadyStale: true };
    cur.lastSeen = Math.max(cur.lastSeen, s.lastSeen.getTime());
    cur.live += s.live;
    cur.liveByMake.set(s.make || "?", (cur.liveByMake.get(s.make || "?") || 0) + s.live);
    cur.alreadyStale = cur.alreadyStale && !!s.alreadyStale;
    byStore.set(s.dealerId, cur);
  }
  for (const st of byStore.values()) st.make = [...st.liveByMake.entries()].sort((a, b) => b[1] - a[1])[0][0]; // its main make
  const cohort = (keyOf) => {
    const m = new Map();
    for (const st of byStore.values()) {
      const k = keyOf(st);
      const c = m.get(k) || { stores: 0, seen: 0 };
      c.stores++;
      if (st.lastSeen >= recent.getTime()) c.seen++;
      m.set(k, c);
    }
    return m;
  };
  const byBoxMake = cohort((st) => `${st.sourceBox}|${st.make}`);
  const byBox = cohort((st) => st.sourceBox);

  const stale = [], held = [];
  for (const st of byStore.values()) {
    if (st.lastSeen >= cutoff.getTime() || st.alreadyStale) continue;
    const bm = byBoxMake.get(`${st.sourceBox}|${st.make}`);
    const c = bm.stores - 1 >= MIN_PEERS ? bm : byBox.get(st.sourceBox);
    // The store itself is never "seen", so it is excluded from the peer count.
    const peers = c.stores - 1;
    const share = peers > 0 ? c.seen / peers : 0;
    if (peers < MIN_PEERS || share < HEALTHY_SHARE) held.push({ dealerId: st.dealerId, reason: peers < MIN_PEERS ? "too few peers to judge platform health" : `platform unhealthy (${Math.round(share * 100)}% of peers scraped last night)` });
    else stale.push(st.dealerId);
  }
  return { stale, held, cutoff };
}

/** The aggregate the classifier reads: one row per (store, make) of live cars. Heavy — run once, after the nightly sync. */
export const ZERO_SCRAPE_AGGREGATE_SQL =
  "SELECT dealer_id AS dealerId, source_box AS sourceBox, make, MAX(last_seen_at) AS lastSeen, COUNT(*) AS live, MIN(stale_at IS NOT NULL) AS alreadyStale " +
  "FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id, source_box, make";

export function buildMarkStaleStatement(dealerIds, cutoff) {
  return { sql: "UPDATE dealer_inventory SET stale_at = CURRENT_TIMESTAMP WHERE dealer_id IN (?) AND removed_at IS NULL AND stale_at IS NULL AND last_seen_at < ?", args: [dealerIds, cutoff] };
}

export function parseZeroScrapeRequest(body) {
  const runStart = typeof body?.runStart === "string" ? new Date(body.runStart) : null;
  if (!runStart || Number.isNaN(runStart.getTime())) return { ok: false, error: "runStart (ISO) is required" };
  const nights = body.nights === undefined ? ZERO_SCRAPE_NIGHTS : Math.round(Number(body.nights));
  if (!Number.isFinite(nights) || nights < 2 || nights > 14) return { ok: false, error: "nights must be 2..14" };
  return { ok: true, runStart, nights, dryRun: body.dryRun === true };
}
