# Daytime new-cars job: plan (2026-10-08, revision 2)

**Status: plan only. Nothing here has crawled into the database, synced, or taken a lock.**
The Larry H. Miller pilot is on hold. This revision redirects the job to **adding cars we
don't have**, using the same isolated daytime-job design. It was built from read-only SSH to
boxes 1, 3 and 4 (box 2 untouched), our rosters, the 2026-09-12 roster archive, web search,
Toyota's public dealer pages, and one plain homepage GET per store with a website
(no retries, no bypass).

Files in this PR:

| File | What |
|---|---|
| [`megadealer_new_stores.csv`](megadealer_new_stores.csv) | 434 stores missing from our rosters, with fetch result, platform, parser and estimated cars |
| [`megadealer_retry_candidates.csv`](megadealer_retry_candidates.csv) | 234 stores that crawled zero or were skipped (not by a bot block) 3+ nights running |
| [`megadealer_pilot_stores.csv`](megadealer_pilot_stores.csv) | the proposed 20-store pilot |
| [`megadealer_stores.csv`](megadealer_stores.csv) | revision 1: 390 group stores that are **already crawled** (kept for reference) |

## What changed from revision 1

Revision 1 found that the franchised stores of the mega-groups are already in our rosters, so
re-crawling them adds about zero cars. This revision lists stores that are genuinely not in the
rosters, and stores that are in the rosters but produced nothing.

## 1. Stores missing from our rosters

Method: diff the 2026-09-12 roster archive (`TrimScout-crawl-archive-2026-09-12/*_dealer_build`)
against the live crawl rosters (union of `dealers/*/*.json` on boxes 1/3/4: 17,191 domains).
A store counts as missing if its domain is not in the roster **and** no roster store in the same
state has the same normalized name. Treat the non-TX Toyota and Stellantis counts as an
**upper bound**: some are the same rooftop under a different domain. The pilot's dry run
(section 6) is what settles that.

Plain-fetch results are indicative only. The same probe reads Akamai on sites the nightly
production client passes (Asbury: 35 Akamai on plain fetch, 31 of 32 pass the nightly gate), so
"Akamai" below means unknown. Cloudflare agrees between the two, so those are real blocks.

| Category | Stores | Plain pass | Akamai (unknown) | Cloudflare | No site / not fetched | Est. cars, pass | Est. cars, Akamai |
|---|---|---|---|---|---|---|---|
| Brand gap: Toyota | 151 | 58 | 48 | 42 | 3 | 14,400 | 11,900 |
| Brand gap: Genesis (not a crawled brand) | 198 | 66 | 74 | 57 | 1 | 3,300 | 3,700 |
| Brand gap: Stellantis | 59 | 7 | 37 | 1 | 14 | 1,100 | 5,800 |
| Used-only chains | 6 | 4 | 1 | 0 | 0 (+1 other WAF) | 870 | n/a |
| NJ/NY/PA independents | 7 | 3 | 0 | 0 | 4 | 510 | n/a |
| Land Rover / Jaguar (not a crawled brand) | 13 | 0 | 0 | 0 | 13 | n/a | n/a |

Cars per store: Toyota 248 and Stellantis 158 are the **medians of our own crawled stores**
(183 and 1,025 stores). Genesis 50 is an **assumption**: there is no crawled Genesis store to
measure. Independents use third-party counts (CarEdge, DealerRater), unverified.

### 1a. The TX Toyota stores

Toyota's own dealer pages list 85 TX dealers (checked across about 70 large-city hub pages, then a
sweep of 125 small-town pages that added none). **14** are not in our roster, not 18. I can't
reproduce the other 4; if you have their names I'll check them.

| Store | City | Plain fetch | Platform |
|---|---|---|---|
| **Bruner Toyota** | Early | pass | DealerOn |
| Platinum Toyota of Texoma | Denison | pass | Team Velocity |
| Toyota of Del Rio | Del Rio | pass | Team Velocity |
| Stewart Toyota | Corsicana | Akamai (unknown) | undetected |
| Toyota of Mt. Pleasant | Mt. Pleasant | Akamai (unknown) | undetected |
| Loving Toyota | Lufkin | Akamai (unknown) | undetected |
| Bryan College Station Toyota | Bryan | Akamai (unknown) | undetected |
| Tegeler Toyota | Brenham | Akamai (unknown) | undetected |
| Mitchell Toyota | San Angelo | Akamai (unknown) | undetected |
| Huntsville Toyota | Huntsville | Akamai (unknown) | undetected |
| Robbins Toyota | Nash | **Cloudflare** | undetected |
| Group 1 Toyota Southwest Houston | Houston | **Cloudflare** | undetected |
| Toyota of Victoria | Victoria | **Cloudflare** | undetected |
| Toyota of Paris | Paris | not fetched (no site known) | n/a |

At 248 cars each: 14 stores, about 3,470 cars if all were reachable; 3 are confirmed
reachable now (about 740).

### 1b. Used-only chains and independents

| Store | Result | Platform | Cars |
|---|---|---|---|
| EchoPark (about 40 hubs, one national site) | 403 Akamai | n/a | unknown |
| CarMax (NJ 6, PA 5, one national site) | 403 other WAF | n/a | unknown |
| Driveway (Lithia, national online) | pass | Dealer Inspire | unknown, not per-store |
| CarShop Hatfield / Chester Springs / Robinson (Penske used-only, PA) | pass | Dealer.com | 332 / 300 / 237 |
| J & S Autohaus III and 6 (NJ, one site `jsautohaus.com`) | pass | Dealer.com | 301 + 211 |
| NJ State Auto Used Cars 158, Stockton Auto Sales II 156, Platinum Pre-owned Carlisle (PA) 155, Jersey Car Direct 108 | not fetched, site unknown | n/a | as listed |
| AutoLenders (NJ/PA multi-showroom) | pass | undetected | unknown |

EchoPark and CarMax each run **one national site**, so they are one parser build, not
per-store work, and both block the plain probe. NY and PA independents with 100+ cars: web
search found PA ones (the three CarShops, Platinum Pre-owned) but **no NY dealer with a
verified count**; that needs a data source, not more searching. Land Rover / Jaguar: 13 NJ/NY/PA
stores found by name with no websites located; they need the JLR locator.

Parsers: Dealer.com and DealerOn (schema.org) are existing. Team Velocity, Dealer Inspire and
the rest use only the generic fallbacks, so expect lower yield until proven on a pilot store.

### 1c. Brands we don't crawl

Our crawl brands are the 25 in `src/brands.js`. Not crawled: **Genesis** (198 stores in our
archive roster, 197 not in the crawl), Land Rover, Jaguar, Alfa Romeo, Maserati, Bentley,
Lamborghini, Ferrari, Aston Martin, Rolls-Royce, Polestar, Lotus. Only Genesis has a roster
today; the others have no roster to diff against, so only the 13 NJ/NY/PA JLR stores are listed.

## 2. Daytime retry list: zero or skipped 3+ nights in a row

Source: per-dealer lines in the nightly logs on boxes 1/3/4 for nights 2026-10-03 to 10-07
(3,076 dealer-brand records parsed). Bot-block skips (Cloudflare, 403, 429, challenge pages)
are excluded. **234 stores** had 3 or more bad nights in a row (216 of them all 5):

| Last-night result | Stores | Retry helps? |
|---|---|---|
| No inventory URLs detected | 100 | Rarely; sitemap or discovery problem |
| Extracted 0 vehicles | 38 | Rarely; may be genuinely empty |
| Skipped: HTTP 5xx | 42 | **Yes, if transient** |
| Skipped: connection reset / timeout / TLS | 8 / 6 / 6 | **Yes, if transient** |
| Skipped: DNS dead / HTTP 404 | 27 / 5 | **No**; roster fix, not a retry |
| Skipped: other | 2 | Inspect |

The daytime retry list proper is the **62 transient skips** (5xx, reset, timeout, TLS) plus
whatever a second pass recovers from the 138 no-URL/zero stores. 202 are marked retry-worthy in
[`megadealer_retry_candidates.csv`](megadealer_retry_candidates.csv).

**Car counts.** `cars_last_good_crawl` is the active-row count from our shards, but only **18
of the 202** could be matched to a shard record (4,475 cars); a store that has failed for days
often has no surviving record, and box 2's states aren't readable. For the other 184 the CSV
uses the brand median and says so in `cars_basis`. Total if everything recovered: about 37,600
cars, a ceiling, not a forecast. Recovering only the 62 transient skips: about 13,200.

Limits: boxes 1/3/4 logs only (box 2's states excluded), 5 nights of logs. Related, not acted
on: the 2026-10-07 box 3 logs show **193 store crawls that hit the 1,000-vehicle cap**
(`Found 1000 vehicle URLs`), so those stores are truncated.

## 3. Isolation design (unchanged) and the sync input directory, confirmed

The daytime job runs from its own working directory with its own lock, logs and failure log, and
a lock name that cannot match `driver*.lock`.

**Confirmed from `scripts/box/inventory-sync.mjs` and `run_sync_when_safe.sh`:**

- The sync's input directory is a **positional argument**: `node inventory-sync.mjs <dir>`
  (line 64; it reads every `*.json` in that dir only, line 83). The nightly waiter hard-codes
  `.../lightsail-crawler/data/inventory`. So the daytime job calls `inventory-sync.mjs` directly
  on `~/megadealer/data/inventory`, never `run_sync_when_safe.sh`.
- Three more settings must be overridden or the daytime sync would touch nightly state:
  - `SYNC_CHECKPOINT_PATH`: defaults to the shared `~/.inventory-sync-checkpoint.json`. Set it to
    `~/megadealer/.sync-checkpoint.json`, or a daytime run would clobber or resume the nightly one.
  - `SWEEP_RETIRED_DIR`: defaults to `~/sweep-retired`. Set it under `~/megadealer/`.
  - `TRIMSCOUT_BOX_LABEL`: set to e.g. `box1-day`. Sweeps only retire rows written by the same
    box label, or rows nobody has refreshed since the foreign grace window, so the daytime sweep
    cannot retire nightly rows. It also tags these rows in the admin Vehicles "Box" column.
- The sync lock is **not a file**: it is a lock on the deals box
  (`/api/ops/sync-lock/acquire`), shared by all boxes, owner `<host>-<dirname>-<pid>`. The
  daytime sync queues behind any nightly sync like any other box. The skip rule "do not start if
  the sync lock is held" must call the lock API read-only (`sync-lock-probe.mjs` exists for this
  but takes the lock with a throwaway owner; use a status read, to be confirmed at build).
- The crawl lock `~/megadealer/data/megadealer-crawl.lock` is a plain file in the isolated dir.
  `check-crawl-gate.mjs` only reads the real runs dir, so it never sees it.
- **Stores not in the dealership directory** (every store in this plan) are matched by domain
  or name against `/api/dealerships`; unmatched vehicles are **kept but filed under store 0**
  (log line "kept, keyed to store 0"). They are visible but not tied to a rooftop. Adding the
  rooftops to the directory first is a **production write and needs your GO**; without it the
  pilot's cars land in store 0.
- Store-0 sweep: the sync also sweeps store 0 with this run's `sourceBox` filter. Because the
  daytime label is distinct, it can only retire daytime-written store-0 rows (or foreign rows
  older than the grace window, which are stale anyway). Verify with `--dry-run` before the
  first real run.

## 4. Box capacity and schedule (unchanged from revision 1)

Idle snapshot Thursday 16:25 ET: box1 2 vCPU / 7.8 GB (6.9 GB available), box3 and box4 4 vCPU /
15.8 GB (14.9 GB available), all 96 to 100% idle. Peak RAM/CPU during crawl is not instrumented.

Latest nightly sync end last week (chain nights 10-03 to 10-07, ET): **box1 10:07, box3 12:54,
box4 15:58**. Syncs share one lock and run one after another.

| Box | Gate opens | Window to 20:30 | Heap | Concurrency |
|---|---|---|---|---|
| box1 | 11:00 | 9.5 h | `--max-old-space-size=2048` | 2 |
| box3 | 13:30 | 7.0 h | `--max-old-space-size=3072` | 3 |
| box4 | 16:30 | 4.0 h | `--max-old-space-size=3072` | 3 |

Skip rules, in order, each logging one line to `megadealer-failures-<date>.log` and exiting 0:

1. The batch can't finish crawl plus sync by 20:30. Nothing starts after 18:30.
2. This box's nightly sync isn't finished: newest `~/inventory-sync/logs/sync-*.log` lacks its
   final `{"upserted":...}` line, or `check-crawl-gate.mjs` against the real runs dir exits non-zero.
3. The shared sync lock is held by any box.
4. `megadealer-crawl.lock` is already held.
5. Free memory below 2.5 GB (box1) or 5 GB (box3/4).

Mid-run: abort the crawl at 19:45; don't start the sync after 20:15; if the sync lock isn't
acquired by 21:00, drop the batch and leave shards in the isolated dir. Nothing runs between
21:30 and the end of the box's nightly sync. A failure never retries the same day and never
touches the nightly crontab, chain or gate.

Time model: crawl = stores x (box1 38 s | box3/4 27.5 s) x max(1, cars/151) / concurrency; sync
= rows / 4,400 per min + stores / 110 per min + 15 min fixed (assumed, not isolated from lock
wait). Even all 434 new stores is under 3 h of crawl on box1; the sync lock and box4's late
nightly sync are the constraint, not crawl time.

Proposed assignment: **box1 takes the new-store batches** (longest window, earliest nightly
sync), **box3 takes the transient-retry list** (52 stores, about 1 h), box4 stays in reserve.

## 4b. Top 20 new stores by estimated cars (not blocked, existing parser)

Only stores that pass the plain fetch and run on DealerOn or Dealer.com. Blocked and
Akamai-unknown sites are skipped, not worked around. Toyota rows are all the **same 248
estimate** (median of our crawled Toyota stores), so their order among themselves is
alphabetical by state, not a real ranking.

| # | Store | State | Platform | Est. cars |
|---|---|---|---|---|
| 1 | J & S Autohaus (III + 6, one site) | NJ | Dealer.com | 512 (301 + 211, third-party) |
| 2 | CarShop Hatfield | PA | Dealer.com | 332 (third-party) |
| 3 | CarShop Chester Springs | PA | Dealer.com | 300 (third-party) |
| 4 to 20 | Toyota: Sunny King, Toyota of Dothan (AL); Phil Wright (AR); Findlay Prescott (AZ); Chuck Patterson, Mid-City (CA); Bev Smith, Gettel Ocala, Marianna, Panama City, Vero Beach, Village (FL); Motor Inn Carroll (IA); Monken Mt. Vernon, Newbold, Woodrum Macomb (IL); Bob Rohrman (IN) | various | DealerOn / Dealer.com | 248 each (estimate) |

CarShop's three stores share one site (`carshop.com`), so they are one crawl target with three
inventories. Bruner and the other reachable TX Toyotas rank just below on the same 248 estimate.

## 5. Platform detection recap

New stores that pass the plain fetch, by platform: Toyota 41 DealerOn / 5 Team Velocity / 4
Dealer.com / 8 undetected; Genesis 34 DealerOn / 12 Team Velocity / 9 Dealer.com / 1 Dealer
Inspire / 1 CDK / 9 undetected; Stellantis 5 Dealer.com / 2 undetected. DealerOn and Dealer.com
(about 70% of passing stores) use existing parsers.

## 6. Pilot (proposed, waiting for your GO)

**20 new stores on box1**, all pass the plain fetch, all on DealerOn or Dealer.com except the two
Team Velocity TX Toyotas (included on purpose, to test the generic fallback):

- 3 TX Toyota that pass: Bruner (Early), Platinum Toyota of Texoma, Toyota of Del Rio
- 7 other Toyota: Central City (PA), Sunny King and Toyota of Dothan (AL), Phil Wright (AR),
  Findlay Prescott (AZ), Chuck Patterson and Mid-City (CA)
- 9 Genesis: Cherry Hill (NJ); Brooklyn, Buffalo, Smithtown (NY); Monroeville (PA); Mesquite,
  Clear Lake, NW San Antonio, Grubbs Grapevine (TX)
- 1 independent: J & S Autohaus (NJ), two stores on one site

Full list with URLs: [`megadealer_pilot_stores.csv`](megadealer_pilot_stores.csv).

| Item | Estimate |
|---|---|
| Estimated new cars | **about 3,400** (Toyota 10 x 248 = 2,480; Genesis 9 x 50 = 450 assumed; J&S 512) |
| Confidence | Toyota medium (median of our crawled Toyota stores); Genesis low (assumed 50); J&S low (third-party count) |
| Crawl | about 9 min p50, 13 min p90 on box1 at concurrency 2 |
| Sync | about 16 min (4,400 rows, 20 stores, 15 min fixed) |
| Window | gate 11:00 ET, finished well before 12:00 on a normal day |

Steps at GO, in order, each a separate approval:

1. **Gate check** with the production bot-protection probe (not my Python probe) on the 20
   domains, in the isolated dir. Any store the production client can't reach is swapped for the
   next passing one.
2. Create `~/megadealer/` on box1 (dirs, config, the overrides in section 3). `--dry-run` the
   sync against an empty shard to confirm it touches nothing.
3. Crawl the 20 stores into `~/megadealer/data/inventory`.
4. **Dry-run the sync**; compare the VINs against `dealer_inventory` (read-only) to count how
   many are actually new. This also settles whether any of the 20 are duplicate rooftops.
5. Decide on adding the 20 rooftops to the dealership directory (production write) before the
   real sync, so the cars aren't filed under store 0.
6. Real sync, then check the nightly logs are unchanged.

Not in the pilot: Cloudflare stores (no bypass), Akamai-unknown stores until step 1 clears them,
EchoPark/CarMax (national sites, blocked, need their own parser work), and the retry list
(second pilot).

## Open items

1. The 4 TX Toyota stores between my 14 and your 18.
2. Genesis cars per store is an assumption (50); the pilot measures it.
3. No NY independents with counts; Land Rover / Jaguar and the other uncrawled brands have no
   roster.
4. Non-TX Toyota and Stellantis "missing" counts include some domain variants of rooftops we
   already crawl.
5. Directory write (section 3) needs approval before any real sync of new stores.
6. Box 2 states are absent from the retry analysis.
7. Revision 1's caveats still stand for the group stores (roster lower bound, group sites blocked).
