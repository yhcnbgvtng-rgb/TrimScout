# Zero-scrape staleness

**Problem.** The nightly sweep only runs for stores that scraped at least one vehicle (`inventorySweep.js`), so a store that
scrapes *zero* keeps all its old cars in stock forever.

**Rule** (`src/zeroScrape.js`). If a store scraped nothing for 3 nights in a row (its newest `last_seen_at` is older than
`runStart − 60h`) while its platform is healthy, its live cars get `stale_at = now`. They are **hidden from buyer search**
(`inStock=1` adds `stale_at IS NULL`; the admin sheet passes `includeStale=1`) and are **not removed** (`removed_at` untouched).
Any later upsert of the car clears `stale_at`, so a recovered store un-hides itself.

**Healthy platform.** Cohort = stores on the same crawl box with the same main make (falls back to the whole box when the make
cohort has fewer than 5 peers). Nothing is marked unless ≥60% of the peers scraped last night; otherwise it is our outage, not a
dead store.

**Rollout (all gated, code only in this PR).**
1. Deploy `deals_api_server.js` + `zeroScrape.js` + `inventoryListQuery.js` to the deals box and restart deals-api (adds the
   nullable `stale_at` column).
2. Ship the `lib/inventoryApi.ts` + admin route change (admin keeps seeing stale cars).
3. `ZERO_SCRAPE_STALE=1 ZERO_SCRAPE_DRY_RUN=1` in the sync env for a night: the sync logs the would-be result, nothing is written.
4. Drop `ZERO_SCRAPE_DRY_RUN` to enable.

The server aggregate reads every live row (up to 120 s). Run it only when the fleet is idle.

**Not covered.** Facet / catalog / market-pulse counts still include stale cars (those queries are covered-index scans on
`removed_at` and adding `stale_at` would break the cover); they overcount by the stale share until a follow-up adds `stale_at`
to those indexes.

`zero_scrape_stores_2026-10-09.csv` lists the stores that already meet the rule (read-only SELECTs, 2026-10-09 evening).
