# Paul Miller Porsche Daily VIN Tracker & Scraper (Apify Actor)

A high-performance Apify Actor designed to crawl, scrape, and monitor **all vehicle inventory** at **Paul Miller Porsche** (Parsippany, NJ). It automatically tracks every vehicle by **VIN**, detects **daily inventory changes** (new arrivals, sold/removed vehicles, price drops, and spec updates), and records full pricing history over time.

---

## 🚀 Key Features

- **100% VIN Coverage**: Uses dynamic sitemap discovery to find every active vehicle detail page (New, Certified Pre-Owned, and Used Porsche inventory).
- **Persistent State Across Runs**: Uses an Apify Named Key-Value Store (`PORSCHE_PAUL_MILLER_STORE`) to compare today's crawl against yesterday's snapshot.
- **Daily Diff & Change Detection**:
  - `NEW_ARRIVAL`: Vehicles added to the dealership today.
  - `PRICE_DROP` / `PRICE_INCREASE`: Vehicles with updated pricing (calculates price difference and updates price history).
  - `SOLD_OR_REMOVED`: Vehicles that disappeared from the dealership lot since the last run.
  - `MODIFIED`: Mileage or classification changes.
  - `UNCHANGED`: Active vehicles with identical specs.
- **Days on Lot & Price History**: Tracks `firstSeen`, `lastSeen`, total days in stock (`daysOnLot`), and a chronological `priceHistory` array for every VIN.
- **Rich Specs Extraction**: Extracts VIN, Stock Number, MSRP, Sale Price, Mileage, Trim, Engine, Transmission, Drivetrain, Exterior & Interior Colors, Factory Packages/Options, and Image URLs.
- **Automated Alerts (Optional)**: Can send a JSON webhook payload to Slack, Discord, or Zapier when price drops or new inventory are detected.

---

## 📊 Extracted Data Schema

Each vehicle item pushed to the Apify Dataset has the following structure:

```json
{
  "vin": "WP1AA2A53TLB07942",
  "stockNumber": "260349",
  "inventoryType": "NEW",
  "year": 2026,
  "make": "Porsche",
  "model": "Macan",
  "trim": null,
  "bodyStyle": "SUV",
  "price": 73260,
  "msrp": 73260,
  "salePrice": 73260,
  "askingPrice": 73260,
  "mileage": 0,
  "exteriorColor": "Volcano Grey Metallic",
  "interiorColor": "Standard Interior in Black",
  "engine": "2.0L I4 Turbocharged",
  "transmission": "7-Speed Porsche Doppelkupplung (PDK)",
  "drivetrain": "All-Wheel Drive",
  "fuelEconomy": "19/25",
  "options": [
    "Premium Package Plus",
    "Panoramic Roof System",
    "14-Way Power Seats with Memory Package",
    "LED Headlights with Porsche Dynamic Light System Plus",
    "Rear Heated Seats",
    "Surround View ($1240)",
    "Heated Steering Wheel ($280)",
    "Wheel Center Caps with Colored Porsche Crest ($200)"
  ],
  "photos": [
    "https://pictures.dealer.com/p/paulmillerporscheparsippany/..."
  ],
  "url": "https://www.paulmillerporsche.com/new/Porsche/2026-Porsche-Macan-parsippany-new-jersey-dfe5c34bac1851fd6fc6447aa3ce6495.htm",
  "status": "ACTIVE",
  "changeType": "PRICE_DROP",
  "oldPrice": 74500,
  "priceDiff": -1240,
  "firstSeen": "2026-08-20",
  "lastSeen": "2026-08-23",
  "daysOnLot": 3,
  "priceHistory": [
    { "date": "2026-08-20", "price": 74500 },
    { "date": "2026-08-23", "price": 73260, "diff": -1240 }
  ],
  "updatedAt": "2026-08-23T19:15:00.000Z"
}
```

In addition to individual vehicle records, each run generates a `DAILY_SUMMARY` report:

```json
{
  "recordType": "DAILY_SUMMARY",
  "dealership": "Paul Miller Porsche",
  "date": "2026-08-23",
  "timestamp": "2026-08-23T19:15:00.000Z",
  "stats": {
    "totalActiveInventory": 302,
    "averagePrice": 104500,
    "newArrivalsCount": 4,
    "soldOrRemovedCount": 2,
    "priceDropsCount": 3,
    "priceIncreasesCount": 0,
    "modifiedCount": 0,
    "unchangedCount": 295
  }
}
```

---

## 🛠️ Deployment & Execution Options

### Option 1: Deploy to Apify via Apify CLI (Recommended)

1. Install the Apify CLI:
   ```bash
   npm install -g apify-cli
   ```
2. Log in to your Apify account:
   ```bash
   apify login
   ```
3. Inside this directory, build and deploy the Actor:
   ```bash
   apify push
   ```

### Option 2: Connect via GitHub
1. Push this folder to a GitHub repository.
2. In the [Apify Console](https://console.apify.com/), navigate to **Actors** -> **Create new** -> **Git repository**.
3. Link your GitHub repository. Apify will automatically build the container from `Dockerfile`.

### Option 3: Run Locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the crawler:
   ```bash
   npm start
   ```
   Outputs will be stored locally in the `storage/` folder (`storage/datasets/default` and `storage/key_value_stores`).

---

## ⏰ Setting up Daily Automated Tracking on Apify

To automatically monitor changes every day without manual intervention:

1. Open your Actor in the **Apify Console**.
2. Click the **Schedules** tab (or go to **Actors** -> **Schedules** -> **Add schedule**).
3. Set Cron Expression to `0 6 * * *` (Runs every morning at 6:00 AM UTC).
4. Select your Actor as the target.
5. In Actor Input, you can keep default parameters or provide a `notifyWebhookUrl` for daily Slack/Discord alerts.

---

## ⚙️ Input Configuration

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `sitemapUrl` | String | `https://www.paulmillerporsche.com/sitemap.xml` | Discovery endpoint for all inventory |
| `storeName` | String | `PORSCHE_PAUL_MILLER_STORE` | Named KV store to persist state between runs |
| `includeSold` | Boolean | `true` | Include sold/removed vehicles in dataset output |
| `notifyWebhookUrl` | String | `""` | Optional webhook endpoint for daily summary alerts |
| `maxConcurrency` | Integer | `10` | Number of simultaneous page requests |
| `proxyConfiguration` | Object | `{ "useApifyProxy": false }` | Apify proxy settings |

---

## NJ Lightsail box (ubuntu@98.92.140.11)

New Jersey–only inventory crawler. One brand per process. Authorized **single-franchise** rooftops only.

**Brands IN:** Toyota, Lexus, Kia, Honda, Acura, Nissan, Infiniti, Subaru, Mazda, Volkswagen, Audi, BMW, Mercedes-Benz, Volvo, Porsche, Mini, Mitsubishi.

**Brands OUT:** Ford, Lincoln, Chevy, GMC, Buick, Cadillac, Chrysler, Dodge, Jeep, Ram, Hyundai, Genesis, Tesla, Rivian, Lucid, Hummer.

Skip megadealer multi-franchise groups (Open Road, AutoNation, …) and used superstores (CarMax, Carvana, …). Keep single-franchise authorized rooftops even when the parent company owns other desks (e.g. Paul Miller Porsche).

### Live progress monitor

Persisted to `data/run_progress.json` so a browser refresh does not lose counters.

```bash
cd scrapers/lightsail-crawler
npm run progress
# http://0.0.0.0:3001/           HTML status
# http://0.0.0.0:3001/progress.json
```

Bind address is `0.0.0.0:3001` (`CRAWLER_PROGRESS_PORT` / `CRAWLER_PROGRESS_HOST` override). The inventory dashboard on `:3000` also serves `/progress` and `/progress.json`.

Shows: current brand, dealers done/total, vehicles seen, price drops, new arrivals, skipped-for-bot-protection count, last error, startedAt, ETA.

### Dealer bot-protection report (PDF + JSON)

Normal `node:https` client only. **Detect and report — do not bypass.** Classifications: `NONE`, `CLOUDFLARE`, `VERCEL_CHECKPOINT`, `HTTP_403`, `HTTP_429`, `DNS_DEAD`, `HTTP_404`, `HTTP_5XX`, `CONN_RESET`, `TIMEOUT`, `TLS`, `OTHER`. A sitemap 404 is retried against the homepage before `HTTP_404` is recorded. Challenge pages still stop the probe.

```bash
cd scrapers/lightsail-crawler
npm run bot-report                          # all in-scope NJ rooftops
node scripts/dealer-bot-report.mjs --brand=Toyota
```

Writes `data/reports/dealer-bot-report-<state>-<brand>-<date>.{json,pdf}` and `dealer-bot-report-<state>-latest.{json,pdf}` (state is always in the filename so running NJ then NY the same day never overwrites the other). PDF opens with a one-page summary (classification table, per-brand pass rates, ready-to-crawl NONE/200 list), then the rooftop table: OK (Y/N), brand, dealer, domain, class, WAF vendor, HTTP, notes. No sales-email column — inbox harvest is crawl-time only. Excluded brands are refused.

Public sales inboxes (`sales@`, `info@`, `internet@`, `bdc@`, …) are collected during `standalone.js` from homepage / contact / staff / about / mailto / schema.org only — no login, no WAF bypass, no third-party listings. Saved on the dealer record as `salesEmail`, `emailSourceUrl`, `collectedAt` (`data/dealer_contacts.json` and MariaDB `dealers.sales_email` when configured). A labeled Internet Sales / BDC / Sales Manager address is kept as `secondaryEmail` when both exist. See `../../docs/DEALER_ALLOWLIST_STRATEGY.md` for HTTP_403 vs Cloudflare.

Refresh official locator dumps, then per-brand files. Do **not** invent `brandofcity.com` hosts; a 403 from Honda/Acura/etc. is recorded, not bypassed:

```bash
npm run fetch-oem-locators   # writes dealers/oem-dumps/ from official brand locators
npm run write-nj-dealers
npm run write-ny-dealers
# node scripts/dealer-bot-report.mjs --state=NJ   # detect-only; run on Lightsail, not this VM
# node scripts/dealer-bot-report.mjs --state=NY
```

Sources per brand: `../../docs/DEALER_ALLOWLIST_STRATEGY.md`.

Window sticker (Monroney) URLs on public VDPs are stored as `windowStickerUrl` / `windowStickerSource` / `collectedAt` (MariaDB `vehicles.window_sticker_url`). The PDF is not downloaded in this pass. Challenge pages are skipped.

### Daily crawl: price history + DOM

Each brand run still writes `priceHistory` / today-vs-yesterday diffs (`PRICE_DROP` / `PRICE_INCREASE` / `UNCHANGED` / `NEW` / `SOLD`; inventory records keep `NEW_ARRIVAL` as the existing changeType).

DOM capture (gzipped compact vehicle node, keyed by VIN+date):

- Blob path: `data/dom_blobs/<VIN>/<YYYY-MM-DD>.html.gz`
- Hash + price index (kept indefinitely): `data/dom_index.json` and MariaDB `vehicle_dom_snapshots` when `DB_HOST` is set
- If today's DOM hash matches yesterday's, only the hash is stored — the blob is not rewritten
- Full HTML blobs are retained **7 days**; hashes and prices are kept indefinitely

Challenge / WAF / captcha pages are **skipped and logged**. This package must not implement WAF/captcha/challenge bypass, fingerprint spoofing, or bot-protection evasion.

`daysOnLot` ("days on market") is computed for every brand from each vehicle's `firstSeen`/current run date — see `inventory_merge.js` — and is carried in `national_inventory_latest.json`/`inventory_latest.json`/`snapshots/latest_snapshot.json`. It is unrelated to the DOM-snapshot feature two paragraphs up (`dom_store.js`/`data/dom_blobs/`), which is raw-HTML capture for scraping-audit purposes, not the days-on-market metric.

`data/daily_changes/daily_changes_<date>.json` (see `daily_changes.js`) is keyed `states.<STATE>.brands.<BRAND>` — one slot per state/brand run that day, merged in rather than overwritten, so a multi-brand, multi-state day doesn't lose every brand but the last one. Each brand's slot carries a complete `priceChanges` list (date + old/new price + delta for every vehicle that changed price that run, not just a top-50 sample) alongside the existing bounded `topPriceDrops` convenience view.

**All calendar-date bucketing is the Eastern calendar date, not UTC.** `<date>` above (and in `firstSeen`/`lastSeen`/`soldDate`, DOM-blob retention, `run_date` in the MariaDB `scrape_runs` table, and every filename below) comes from `easternDateStamp()` in `src/date_utils.js`, never from `new Date().toISOString().slice(0,10)`. That distinction matters because `toISOString()` always returns a UTC instant regardless of the process's `TZ` — a run anywhere near midnight (UTC or Eastern; they're never simultaneous) would otherwise file itself under the wrong calendar day. Precise instants (`generatedAt`, `startedAt`/`endedAt`/`finishedAt`, `submittedAt`, `collectedAt`, `updatedAt`) are unaffected by this and correctly stay real UTC ISO instants — only *which day* something is filed under changes, never how precisely a moment itself is recorded.

### Daily driver: NJ + NY + FL + GA + TX + SC, every brand, one job

```bash
cd scrapers/lightsail-crawler
npm run daily-crawl   # node scripts/run-daily-crawl.mjs
```

Runs every state in `src/states.js`'s `SUPPORTED_STATES` (NJ, NY, FL, GA, TX, then SC as of 2026-09-16) — that array is the only place a state list should ever be hardcoded; nothing else in this driver, `dealer-bot-report.mjs`, or `standalone.js` special-cases a particular state. As of 2026-09-15, up to `MAX_CONCURRENT_STATES` (2, matching the crawl box's 2 vCPUs) states run **at once** via `runStatesWithBoundedConcurrency()` — a small worker pool, not the fully sequential one-state-then-the-next behavior of earlier runs; see that function's own comment in `scripts/run-daily-crawl.mjs` for how states are scheduled into the two slots, and the "Concurrency safety" note below for why running two states' crawls at the same time doesn't corrupt the shared data files. Each state's own pipeline is unchanged: regenerate `dealers/<state>/<brand>.json` from the OEM-locator dumps (`write-nj-dealers` / `write-ny-dealers` / `write-fl-dealer-files.mjs` / `write-ga-dealer-files.mjs` / `write-tx-dealer-files.mjs` / `write-sc-dealer-files.mjs` — standalone.js reads these static files, not the locator dumps directly, so they have to be refreshed every run or a locator fix/addition since the last run is silently missed), refresh that state's bot-protection classification (`dealer-bot-report.mjs --state=<X>`), then loop `src/standalone.js` once per brand that had at least one `NONE`/200 dealer in that state's report (`CRAWLER_DEALERS_FILE`/`CRAWLER_BRAND`/`CRAWLER_STATE` env vars, same invocation shape as a manual run) — brands within one state still run one at a time; that was never the bottleneck. One brand hanging or erroring is caught, logged, and skipped — it never stops the rest of the state or any other state running concurrently in the other slot. With SC added, the pool now cycles 6 states through 2 concurrent slots rather than 5 — no change to `runStatesWithBoundedConcurrency()` itself was needed; it already schedules an arbitrary-length `states` list, confirmed by `test/run_daily_crawl.test.js`'s bounded-concurrency tests, which now exercise a 6-state list.

**Concurrency safety for the shared data files** (`national_inventory_latest.json`, `inventory_latest.json`, `enriched_cache.json`, `snapshots/latest_snapshot.json`, `daily_changes/daily_changes_<date>.json`): with two states' brand processes now able to run at once, two of them can read-modify-write these same files around the same moment — a classic lost-update race where whichever write lands second silently discards the first, even though each process's own merge logic (already fixed once — see `inventory_merge.js`/`daily_changes.js`) is individually correct. `src/shared_data_lock.js` fixes this with a short-lived exclusive file lock (`data/shared_data.lock`, atomic `open(..., 'wx')` create, PID-liveness + age-based stale reclaim so a crashed holder can never permanently block a future run) taken by `standalone.js` and `enricher.js` immediately around their own read-fresh → merge → write of these files — the expensive crawling/enrichment work itself stays fully concurrent; only that brief update serializes. This is a different lock from the driver-overlap guard below: that one stops a second whole invocation of this script; `shared_data_lock.js` is what makes two states *within* one invocation safe to run at the same time.

Adding GA (2026-09-15) surfaced a real bug in the shared OEM-locator dedup key (`src/oem_locator.js`), not something GA-specific: the map keyed rooftops by `make+name` only, with no state, so a dealer group that reuses the exact same trading name in two different states (confirmed real, distinct rooftops — "Kia Autosport" in Pensacola, FL and Columbus, GA; "Rick Case Kia" in Sunrise, FL and Duluth, GA) silently collapsed into one entry and dropped the other. Fixed by scoping the dedup key to `state|make+name` (`stateScopedKey()`); `applyCuratedOverlay()` was updated to match its state-less `CURATED_OVERLAY` entries by scanning make+name across all state-scoped entries instead of a single key lookup. This restored two previously-hidden rooftops in the already-live NJ/FL data too (Crown Acura, FL; Prestige Subaru, NJ) — additive only, nothing removed.

Adding TX (2026-09-15) needed no further changes to that dedup fix or anything else in the pipeline — `standalone.js`, `dealer-bot-report.mjs`, and `run-daily-crawl.mjs` picked TX up purely from `src/states.js` plus the new `tx_policy.js`/`write-tx-dealer-files.mjs`/loader-registry entries, exactly as the generalization was meant to work. The same state-scoped dedup key immediately caught another real cross-state collision on the first TX fetch — "Five Star Subaru" is a genuinely distinct rooftop in both Oneonta, NY (`fivestarcars.com`) and Grapevine, TX (`subarugrapevine.net`) — confirming the fix generalizes to a 5th state, not just GA's original two. Texas's OEM-locator zip seeds (`TX_ZIPS` in `fetch-oem-dealer-locators.mjs`) use 20 points rather than GA's 16, split across every major metro (Dallas, Fort Worth, and Plano separately for DFW; Houston split into downtown/Woodlands/Sugar Land) plus far-flung regional hubs (El Paso, Lubbock, Amarillo, Midland, the Rio Grande Valley, Laredo) — a single zip's 50-120mi locator radius does not come close to covering a state this size. Audi and Volvo were re-verified fresh for TX, not assumed empty from the NJ/NY/FL/GA precedent: both still return Akamai's `errors.edgesuite.net` "Access Denied" page even through a real patchright browser render (not just a plain fetch), the same signature as the already-confirmed Honda/Nissan block — a genuine IP-level bot-protection wall, not a TX-specific or JS-hydration gap, so it was expected (and confirmed) to behave identically for TX.

Adding SC (2026-09-16) is the smallest state yet and needed no pipeline changes beyond the same mechanical set: `src/states.js`, `sc_policy.js`, `write-sc-dealer-files.mjs`, and the two loader-registry entries. Unlike GA and TX, no real cross-state dealer-group name collision turned up in SC's own locator fetch (checked make+name against every other state's in-repo dumps) — not evidence the dedup fix stopped mattering, just that this particular batch of locator rows happened not to exercise it. SC's OEM-locator zip seeds (`SC_ZIPS` in `fetch-oem-dealer-locators.mjs`) use only 8 points — SC is a compact state (~32,000 sq mi, smaller than GA and far smaller than TX) with its dealer network concentrated in a few metros: Charleston, Columbia, Greenville/Spartanburg, the Myrtle Beach/coastal corridor, Hilton Head, plus Rock Hill (Charlotte NC exurbs) and Florence (Pee Dee region) as the remaining regional hubs. Fetch results confirm the seed count was right, not just convenient — every metro seeded returned real rooftops, and the in-repo nationwide Acura/Porsche dumps (unaffected by the new zip seeds, since those two are copied in-repo dumps, not zip-queried) already independently corroborated the same metros (Charleston, Columbia, Greenville, Hilton Head) before the new fetch ran at all. SC came back with 72 in-scope rooftops across 11 brands with a working locator (Toyota 20, Kia 10, Volkswagen 8, Mercedes-Benz 7, Mazda 6, Subaru 5, Lexus 4, Porsche 4, Acura 3, Mitsubishi 3, Mini 2 — Honda/Nissan/Infiniti/Audi/BMW/Volvo stay empty, the same brand-wide dead ends as every prior state), 35 of which came back `NONE`/200-ready on a live `dealer-bot-report.mjs --state=SC` run from a worktree (Porsche came back entirely `VERCEL_CHECKPOINT`/`DNS_DEAD` and Mercedes-Benz entirely `TLS`/`CLOUDFLARE` this run — both brand-specific hosting issues on those particular SC rooftops' domains, not an SC-specific locator or policy problem). The raw Subaru and Volkswagen locator dumps for SC each include an `AutoNation` rooftop (Hilton Head) that `acceptScDealer`'s megadealer filter correctly drops, same as every other state — confirmed with a real fetched-not-invented row in `test/nj_ops.test.js`'s SC block, not just a synthetic one. A live single-brand crawl (Mini, both of SC's 2 dealers — Century MINI in Greenville and MINI of Charleston) was run from a worktree to confirm the whole pipeline — locator fetch, policy filter, bot-report, `standalone.js`, VIN enrichment — produces real inventory end to end for SC, not just dealer metadata: 116 live vehicles found (108 from Century MINI, 8 from MINI of Charleston), all 116 newly enriched with 0 cache hits and 0 errors. That run's own output files (`data/national_inventory_latest.json` etc. — the same shared, committed baseline every state's brand run writes into) were deliberately **not** committed here, matching the FL/GA/TX precedent: only the original NJ/NY full-nationwide runs (2026-09-14) are checked into `data/` as the baseline; every state added since has verified its pipeline with a live sample run from a worktree without committing that run's output over the shared baseline, leaving a real full run on the box itself as the source of truth for `data/`.

Per-brand console output goes to `logs/<state>-<brand>-<date>.log` (and `logs/<state>-write-dealers-<date>.log` / `logs/<state>-bot-report-<date>.log` for the two support steps); anything under `logs/` older than 30 days is deleted at the start of every run, so this doesn't accumulate forever. The structured, durable record of the whole run — every step's exit code/duration, which brands were skipped and why, and each brand's vehicle/price-change/sold counts pulled back out of that day's `daily_changes` file — is written to `data/daily_crawl_runs/summary_<date>.json` and `data/daily_crawl_runs/latest.json` and kept indefinitely (small JSON, not logs).

**Overlap guard:** `main()` takes a PID-file lock at `data/daily_crawl_runs/driver.lock` before doing anything else and releases it in a `finally` when the run ends. If cron fires while a previous invocation (manual or cron) is still running, the new process logs why and exits `0` immediately — it never runs concurrently against the shared data files, and it never errors loudly for what's an expected occasional occurrence. A lock file left behind by a run that crashed or was `kill -9`'d without cleanup is detected as stale (its PID is no longer alive) and silently reclaimed by the next run. This needs no crontab change — it's a plain Node-side check inside the script cron already calls directly.

### Scheduler (one brand at a time per state; up to 2 states at once)

~6–8 in-process page workers (`CRAWLER_CONCURRENCY`, default 8). Chromium is recycled every ~10 dealers (`CRAWLER_PATCHRIGHT_RECYCLE_AFTER`, default 10) if a browser is used for a non-challenge empty sitemap. On this NJ box set `CRAWLER_PATCHRIGHT_FALLBACK=false` so crawls stay HTTP-only.

The daily driver (previous section) still runs brands one at a time within a given state, but — as of 2026-09-15 — no longer runs states fully sequentially: up to `MAX_CONCURRENT_STATES` (2) states' brand loops overlap. The box's crontab still only needs one job line for the whole NJ+NY+FL+GA+TX run (this is internal to the one driver process, not a crontab change) — plus a `TZ=` line above it, which matters for two separate reasons: it's what makes the job *fire* at the intended Eastern wall-clock time regardless of the box's system timezone, and (easy to miss) it's also what makes the `$(date +\%F)` in the log-filename redirect below resolve to the Eastern calendar date rather than the box's system timezone's date — otherwise that one shell-level date could disagree with every Eastern-calendar-date filename the Node process itself writes (see "Daily driver" above):

```cron
TZ=America/New_York

# Progress monitor (once at boot via systemd/pm2 is better than cron)
@reboot cd /home/ubuntu/lightsail-crawler && node src/progress_server.js

# NJ, NY, FL, GA, TX, then SC, every brand: see "Daily driver" above. Safe to leave in
# place even if a previous run is still going (e.g. it ran long, or a
# manual run is mid-crawl) — the driver's own PID-file lock (see "Daily
# driver" above) makes an overlapping fire a clean no-op instead of a
# second concurrent crawl against the same shared files.
#
# NJ took ~1h45m (168 in-scope dealers) and NY ~2h38m (275 dealers) on
# 2026-09-14's manual run — both ~0.6 min/dealer. FL adds ~320 in-scope
# dealers (write-fl-dealer-files.mjs, 2026-09-14: bigger than NY — Acura
# 20 vs NY's 16, Porsche 18 vs NY's 13, Toyota 45 vs NY's 56 but from more
# cities), which projects to another ~3h10m at the same per-dealer rate.
# That puts the combined NJ+NY+FL run at roughly 7.5h, not the ~4-5h a
# 2am start was sized for — a 2am start would now finish past 9:30am,
# no longer "well before anyone checks data that morning". Moved the
# start to 9pm ET the previous evening so a ~7.5h run (plus some margin
# for FL's projection being an estimate, not a measured run) still lands
# by ~5-6am. Re-time this comment once FL has actually run once and its
# real duration is known, and pull the start back later again if it
# turns out shorter than projected.
#
# GA (added 2026-09-15, write-ga-dealer-files.mjs / src/ga_policy.js) adds
# 127 in-scope rooftops across every brand with a working locator (Acura
# 9, Porsche 3, Lexus 8, Toyota 33, Mercedes-Benz 12, Mitsubishi 8, Kia 18,
# Subaru 12, Mazda 11, Volkswagen 11, Mini 2 — Honda/Nissan/Infiniti/Audi/
# Volvo/BMW stay empty, same brand-wide dead ends as NJ/NY/FL), 70 of
# which came back NONE/200-ready on a live dealer-bot-report run. Real
# timing was only measured for a 13-dealer sample (Porsche+Mini+Lexus,
# ~7.5 min total) run from a worktree, not the box — enrichment time
# scales with each dealer's live vehicle count, not dealer count, so that
# sample cannot be safely extrapolated per-dealer to the other ~114
# rooftops the way FL was extrapolated from NJ/NY above. Do not add GA's
# runtime to this box's schedule from an estimate — wait for GA's first
# real full run on the box and re-time this comment against that, the
# same way the FL note above is still waiting on FL's real number.
#
# TX (added 2026-09-15, write-tx-dealer-files.mjs / src/tx_policy.js) is
# TX's own escalation of the same lesson: 312 in-scope rooftops across
# every brand with a working locator (Toyota 66, Volkswagen 45, Mazda 43,
# Subaru 29, Mercedes-Benz 28, Kia 23, Mitsubishi 23, Lexus 15, Porsche
# 17, Acura 14, Mini 8, BMW 1 — Honda/Nissan/Infiniti/Audi/Volvo stay
# empty, same brand-wide dead ends as NJ/NY/FL/GA), 163 of which came back
# NONE/200-ready on a live dealer-bot-report run. Real timing was only
# measured for two brands, run from a worktree, not the box: Porsche (17
# dealers) took 10m40s for 2,025 active vehicles (1,636 newly enriched,
# 389 cache hits, ~0.32s/vehicle, ~119 vehicles/dealer); Mini (8 dealers,
# 4 of them skipped by bot protection as the report predicted) took 3m25s
# for 436 vehicles (all newly enriched, ~0.47s/vehicle, ~55 vehicles/
# dealer already-crawled). Two brands, 25 dealers, 2,461 vehicles, ~14m
# combined — and the per-dealer vehicle count already varies ~2x between
# just these two brands, which is the clearest evidence yet that
# enrichment time is driven by live vehicle count, not dealer count or
# state size. Do not multiply either sample's per-dealer time by TX's
# other ~146 ready rooftops (Toyota's 38 ready alone almost certainly
# carries a materially different vehicle-count profile than Porsche's or
# Mini's — untested here). Do NOT add TX's runtime to this box's schedule
# from an estimate — that is a scheduling conversation for the user once
# TX has a real full run's number, not something to project from a
# two-brand sample. Note that TX alone (312 rooftops) already approaches
# FL's dealer count, and adding it as a fifth state to a schedule where
# NJ+NY+FL+GA already runs ~7h55m against an 11pm ET start needs the
# user's own call on timing, not an assumption baked into this comment.
#
# SC (added 2026-09-16, write-sc-dealer-files.mjs / src/sc_policy.js) is
# the smallest state added yet: 72 in-scope rooftops across every brand
# with a working locator (Toyota 20, Kia 10, Volkswagen 8, Mercedes-Benz 7,
# Mazda 6, Subaru 5, Lexus 4, Porsche 4, Acura 3, Mitsubishi 3, Mini 2 —
# Honda/Nissan/Infiniti/Audi/BMW/Volvo stay empty, same brand-wide dead
# ends as NJ/NY/FL/GA/TX), 35 of which came back NONE/200-ready on a live
# dealer-bot-report run (Porsche and Mercedes-Benz's SC rooftops came back
# entirely rate-limited/TLS-blocked this particular run — worth a rerun
# before scheduling, not assumed permanently dead like Honda/Nissan).
# Real timing was only measured for one brand (Mini, both of SC's 2
# dealers), run from a worktree, not the box: 116 vehicles, all newly
# enriched, 0 errors. That is a two-dealer sample against SC's real
# ready-brand mix of 35 rooftops across 9 brands — do NOT add SC's runtime
# to this box's schedule from that sample, for the same reason GA's and
# TX's notes above insist on a real full run's number: enrichment time
# tracks live vehicle count per dealer, not dealer count, and Toyota's 7
# ready SC rooftops almost certainly carry a different vehicle-count
# profile than Mini's 2. SC's 72 rooftops are small next to TX's 312 or
# GA's 127, so it should add comparatively little to the combined
# schedule once real numbers exist — but "comparatively little" is not
# a number, and this comment will not invent one.
0  21 * * * cd /home/ubuntu/lightsail-crawler && mkdir -p logs && node scripts/run-daily-crawl.mjs >> logs/run-all-$(date +\%F).log 2>&1
```

### Tests

```bash
cd scrapers/lightsail-crawler
npm test
```
