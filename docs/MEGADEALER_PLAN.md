# Mega-dealer group crawl: plan (2026-10-08)

**Status: plan only. Nothing here has crawled into the database, synced, or taken a lock.**
Everything below came from read-only SSH to boxes 1, 3 and 4, our own dealer rosters, and one
plain homepage GET per matched store (no retries, no bypass). Box 2 was not touched.
Store-level data: [`megadealer_stores.csv`](megadealer_stores.csv) (390 stores).

## Hard rules (from the brief, restated as design constraints)

1. Mega-dealers never join the nightly 22:00 crawl or its chain.
2. Separate daytime job: own schedule, own lock `megadealer-crawl`, own logs, own failure log.
3. A failure there never stops, delays or retries the nightly crawl or sync.
4. It never runs between 21:30 and the end of the box's nightly sync.

Two traps in the existing code that a naive implementation would hit:

- **Lock name collision.** `scripts/check-crawl-gate.mjs` treats every `driver*.lock` in the
  runs dir as "a crawl is running" and holds the nightly sync back. A lock or run label that
  ends up as `driver-megadealer*.lock` in the real runs dir would therefore delay the nightly
  sync. The mega job must run from its **own isolated working directory**
  (`~/megadealer/`, own `data/`, own `daily_crawl_runs/`) and its lock must live there as
  `megadealer-crawl.lock`. Same isolated-cwd pattern as the 2026-10-04 recovery wave.
- **Sync reads every `*.json` in `data/inventory`.** The 2026-10-03 stale-shard incident came
  from exactly that. The mega sync must be pointed at the isolated directory only, so it can
  never re-upsert or sweep nightly shards, and the nightly sync can never see mega shards.
  How the sync client takes its input dir needs confirming in a read-only code pass before GO
  (not yet verified; see Open items).

## 1. Roster: what I could and could not build

Group corporate location pages (AutoNation, Lithia, Penske, Group 1, EchoPark, Hendrick, Ken
Garff, Holman) return 403 to plain fetches (Akamai / Cloudflare), and web search returns no
complete lists. Per the decision for this step, I did **not** work around that. The roster is
therefore a **lower bound**: every store already in our rosters whose domain or name carries a
group marker (e.g. `autonation`, `koons|coggin|nalley|mcdavid`, `hendrick`, `^dch|quirk|lithia`,
`garff`, `catena`, `^openroad`). The roster source is the union of `dealers/<state>/<brand>.json`
on boxes 1, 3 and 4: 68,603 rows, 17,191 unique domains.

| Group | Stores matched | Top states | Notes |
|---|---|---|---|
| Lithia / Driveway (incl. Quirk, DCH) | 65 | CA 14, ME 13, MA 12, NJ 7 | DCH folded in here (Lithia owns DCH); no `driveway` store sites exist, Driveway is one national site |
| Asbury (incl. Koons, Coggin, Nalley, McDavid) | 64 | FL 15, GA 14, MD 12, VA 12 | |
| Group 1 | 64 | TX 37, GA 7, FL 4, LA 4 | |
| Hendrick | 62 | NC 33, SC 10, GA 5, AL 3 | |
| AutoNation | 56 | CA 12, GA 9, TX 6, CO 5 | |
| Larry H. Miller | 30 | AZ 9, UT 7, NM 6, CO 4 | Dealerships belong to Asbury since 2021; kept separate as asked |
| Ken Garff | 24 | UT 16, AZ 3, WY 3, CO 2 | |
| Ray Catena | 8 | NJ 6, NY 2 | |
| Holman | 8 | NJ 6, CO 1, OH 1 | |
| Open Road (NJ) | 7 | NJ 7 | Not the Canadian openroadauto.com |
| Penske Automotive | 2 | CA 2 | Almost nothing identifiable by name |
| Sonic / EchoPark | 0 | - | `capitol*` stores are not provably Sonic; EchoPark is used-only and absent from OEM locators |
| Berkshire Hathaway Automotive | 0 | - | `berkshiremazda.com` (MA) is not BHA; no marker available |
| Morgan | 0 | - | name too generic to match safely |

**Every matched store is `crawled = yes`.** That is the main finding, and it changes what the
job can add:

- Franchised stores of the 25 brands we crawl come from the OEM dealer locators, so most of a
  group's franchised stores are already in the nightly rosters, just not labelled by group
  (AutoNation sells Toyota/Honda/Ford under names without "AutoNation" in them).
- So re-crawling the matched 390 stores in the daytime adds **about zero new cars**. It would
  only improve freshness.
- New cars can only come from stores **outside** the OEM locators: used-only chains (EchoPark,
  Driveway, CarMax-style), brands we don't crawl (Land Rover, Jaguar, Genesis, Maserati, Alfa,
  Bentley, etc.), and group-owned stores whose locator domain differs from the group's own.
  I can't enumerate those without the group lists.

Rough published US store counts, **from memory and unverified** (sources blocked): AutoNation
~240, Lithia ~450, Penske ~150, Group 1 ~150, Sonic ~100 plus EchoPark ~45, Asbury ~150 plus
LHM ~60, Hendrick ~90, BHA ~80, Ken Garff ~60, Holman ~80, Morgan ~50, Ray Catena ~20, Open
Road NJ ~20. Treat "published minus matched" as an upper bound on unseen stores, not as a
count of missing stores.

## 2. Platform and blocks

Platform comes from the VDP URL shape in our own shards when the store has inventory on boxes
1/3/4 (no fetch needed), otherwise from the one homepage fetch.

| URL shape | Platform | Parser we have |
|---|---|---|
| `/new/Make/2026-....htm` | Dealer.com | Yes (Strategy 1, DDC.dataLayer) |
| `/new-City-2026-Make-...-VIN` (one path segment) | DealerOn | Yes (Strategy 2, schema.org JSON-LD) |
| `/viewdetails/...` | Dealer Inspire | Generic only (Strategy 2 / 3) |
| `/inventory/...` | Dealer Inspire / DealerFire / Sincro style | Generic only |
| anything else | custom | Generic only |

Fleet-wide, of 5,762 hosts with inventory: 2,681 single-segment (DealerOn-style), 2,640
Dealer.com, 366 Dealer Inspire, 56 explicit DealerOn, the rest unclassified. The crawler has no
per-platform parser beyond these two strategies plus the generic fallback.

Blocks have two signals and they disagree, so both are in the CSV:

- `nightly_gate`: the real result from last night's bot-protection reports on boxes 1/3/4 (the
  production client). This is the one that decides whether a store gets crawled.
- `plain_fetch`: my one Python GET of the homepage. It reads **Akamai** much more often than
  production does (Asbury: 35 Akamai on plain fetch, yet 31 of 32 pass the nightly gate), so
  treat a plain-fetch Akamai as "unknown", not "blocked". Cloudflare agrees in both.

| Group | Nightly gate (probed stores) | Plain fetch | Platforms seen |
|---|---|---|---|
| Asbury | 31 pass / 1 Cloudflare | 19 pass, 35 Akamai, 2 CF, 8 unreachable | DealerOn 12, Dealer.com 5, Team Velocity 2 |
| Larry H. Miller | 16 pass / 0 | 25 Akamai, 5 unreachable | Dealer.com 8 |
| Open Road NJ | not in box1/3/4 reports | 7 pass | DealerOn 5 |
| AutoNation | not in box1/3/4 reports | 48 Akamai, 2 CF, 6 unreachable | undetected |
| Lithia (incl. Quirk, DCH) | 7 pass / 19 Cloudflare | 10 pass, 32 CF, 21 unreachable | DealerOn 6, Dealer.com 5 |
| Penske | not in reports | 1 pass, 1 CF | DealerOn 1 |
| Hendrick | 6 pass / 27 CF / 3 HTTP 403 | 36 CF, 7 other WAF, 18 unreachable | Dealer.com 5 |
| Holman | 2 pass / 5 CF | 6 CF | Dealer.com 1 |
| Group 1 | 2 pass / 32 CF | 54 CF, 10 unreachable | undetected |
| Ken Garff | 1 pass / 12 CF | 22 CF, 2 unreachable | Dealer.com 1 |
| Ray Catena | 0 pass / 8 CF | 7 CF | undetected |

The "unreachable" rows (6 to 21 per group) are TLS or DNS failures on the bare domain, not
blocks. They are probably `www`-only hosts; I did not retry, to stay at one fetch per store.

## 3. Size

For stores with inventory on boxes 1/3/4 the count is the ACTIVE row count in last night's
shards. That covers only 31 of 390 stores because the rest sit in states whose shards live on
box 2 (not touched) or are Cloudflare-blocked.

Measured: Asbury 371 cars/store (n=7), Hendrick 290 (n=8), Lithia 456 (n=6), LHM 164 (n=8).
Everything else uses the fleet average of **221 cars/host** (1,270,666 active rows over 5,762
hosts). I did not use the homepage for listing counts: homepages rarely show a trustworthy
count, and one fetch per store was the cap.

## 4. Ranking (provisional, low confidence)

Order is "existing parser and not blocked first", then size. Because every matched store is
already crawled, the "new cars" column is **0 for the matched set**; the estimate that matters
is the unseen remainder, which I can't count. Do not read this as a forecast of added cars.

| # | Group | Stores matched | Est. in-stock (matched) | Gate | Parser needed |
|---|---|---|---|---|---|
| 1 | Asbury (incl. LHM below) | 64 | 23,700 | 31/32 pass | Existing (Dealer.com, DealerOn) |
| 2 | Larry H. Miller | 30 | 4,900 | 16/16 pass | Existing (Dealer.com) |
| 3 | Open Road NJ | 7 | 1,500 | plain pass 7/7 | Existing (DealerOn) |
| 4 | AutoNation | 56 | 12,400 | unknown (plain: Akamai) | Likely existing; platform undetected |
| 5 | Lithia (Quirk, DCH) | 65 | 29,600 | 7/26 pass | Existing; 73% Cloudflare |
| 6 | Penske | 2 | 400 | unknown | Unknown; roster not identifiable |
| 7 | Hendrick | 62 | 18,000 | 6/36 pass | Existing; 92% blocked |
| 8 | Holman | 8 | 1,800 | 2/7 pass | Existing; blocked |
| 9 | Group 1 | 64 | 14,100 | 2/34 pass | Undetected; 94% Cloudflare |
| 10 | Ken Garff | 24 | 5,300 | 1/13 pass | Existing; blocked |

Not rankable: Sonic/EchoPark, BHA, Morgan (no roster), Ray Catena (0/8 pass, Cloudflare).
Blocked groups (Group 1, Hendrick, Garff, Holman, Catena, most of Lithia) stay out of the
schedule: no bypass, and the existing allowlisting route is in `DEALER_ALLOWLIST_STRATEGY.md`.

## 5. Box capacity (boxes 1, 3, 4)

Idle snapshot at 16:25 ET Thursday 2026-10-08 (vmstat, 3 samples): all three at 96 to 100%
CPU idle, load 0.00.

| Box | vCPU | RAM total | RAM available | CPU idle | Notes |
|---|---|---|---|---|---|
| box1 | 2 | 7.8 GB | 6.9 GB (1.7 free + 3.2 cache + 2.5 buffers) | 96 to 98% | has a local mariadbd (87 MB RSS) |
| box3 | 4 | 15.8 GB | 14.9 GB | 100% | |
| box4 | 4 | 15.8 GB | 14.9 GB | 100% | |

Peak RAM and CPU during the crawl are **not instrumented** (`box-report.json` samples free
memory once, at report time), so I can't state a measured crawl-time peak. Disk is fine (box1
133 GB free, box3/4 280 GB free).

Last week, chain nights starting 22:00 ET on 10-03 to 10-07 (the schedule from PR #375). Times
are ET. Sync log timestamps are UTC; I converted them. "Sync end" is the last write to the
night's sync log.

| Night | box1 crawl | box1 sync end | box3 expansion | box3 core | box3 sync end | box4 expansion | box4 core | box4 sync end |
|---|---|---|---|---|---|---|---|---|
| 10-03 | 22:00 to 06:25 | 08:26 | 22:00 to 05:50 | 05:50 to 08:04 | 11:53 | 22:00 to 04:20 | 04:20 to 08:36 | 14:37 |
| 10-04 | 22:00 to 07:28 | 08:27 | 22:00 to 06:09 | 06:09 to 07:59 | 11:28 | 22:00 to 04:25 | 04:25 to 09:16 | 14:20 |
| 10-05 | 22:00 to 06:40 | 07:43 | 22:00 to 05:54 | 05:54 to 07:34 | 12:54 | 22:00 to 05:02 | 05:02 to 10:16 | 15:58 |
| 10-06 | 22:00 to 06:27 | 07:47 | 22:00 to 06:23 | 06:23 to 08:37 | 10:57 | 22:00 to 04:05 | 04:05 to 10:38 | 13:42 |
| 10-07 | 22:00 to 07:22 | 10:07 | 22:00 to 05:22 | about 05:22 to 06:50 | 09:19 | 22:00 to 05:00 | (not pulled) | 13:13 |

Latest sync end seen: **box1 10:07, box3 12:54, box4 15:58**. The syncs share one lock and run
one after another, which is why box4 is always last. Measured sync detail, 10-07: box3
06:57 to 09:19 (508,272 rows at about 73 rows/s, 2,106 stores swept in 19.0 min); box4
11:09 to 13:13 (534,423 rows at about 90 rows/s, 2,133 stores swept in 18.6 min); box1
07:25 to 10:07 (224,111 rows at about 108 rows/s, 785 stores in 7.4 min). Those totals include
waiting on the shared sync lock.

## 6. Time estimates

Crawl: `stores x s_per_rooftop x max(1, cars/151) / concurrency`. Base `s_per_rooftop` from the
10-07 box reports: box3 and box4 27.5 s mean (p50 26.6, p90 39.1) at concurrency 4; box1 about
38 s at concurrency 2 (1,782 rooftops in 9.37 h). The 151 is cars per rooftop at that base
(554,553 vehicles over 3,675 rooftops). p90 = 1.42 x p50. This assumes time scales linearly
with car count; there is no per-platform timing in the reports, so "same platform average" is
not available and this is the closest proxy.

Sync: rows / 4,400 per min (low end of the measured 73 to 108 rows/s) + stores / 110 per min
(measured 106 to 111) + 15 min fixed. The 15 min is an **assumption** (JSON load, factory-option
phase); I did not isolate it from lock wait. Lock wait is extra and is why the skip rule exists.

| Group | Stores | Cars | Crawl box1 | Crawl box3/4 p50 | Crawl box3/4 p90 | Sync |
|---|---|---|---|---|---|---|
| Asbury | 64 | 23,700 | 0.83 h | 0.30 h | 0.43 h | 21 min |
| Larry H. Miller | 30 | 4,900 | 0.17 h | 0.06 h | 0.09 h | 16 min |
| Open Road NJ | 7 | 1,500 | 0.05 h | 0.02 h | 0.03 h | 15 min |
| AutoNation | 56 | 12,400 | 0.43 h | 0.16 h | 0.22 h | 18 min |
| Lithia | 65 | 29,600 | 1.04 h | 0.37 h | 0.53 h | 22 min |
| Penske | 2 | 400 | 0.02 h | 0.01 h | 0.01 h | 15 min |
| Hendrick | 62 | 18,000 | 0.63 h | 0.23 h | 0.32 h | 20 min |
| Holman | 8 | 1,800 | 0.06 h | 0.02 h | 0.03 h | 15 min |
| Group 1 | 64 | 14,100 | 0.49 h | 0.18 h | 0.25 h | 19 min |
| Ken Garff | 24 | 5,300 | 0.19 h | 0.07 h | 0.10 h | 16 min |

Even the whole 390-store set is about 1.6 h of crawl on box1 and well under 1 h on box3/4. The
time budget is not the constraint; the sync lock and the late nightly sync on box4 are.

## 7. Schedule

Windows, from the latest nightly sync end seen last week, to the 20:30 ET finish line:

| Box | Nightly sync done by (worst case) | Gate opens | Window to 20:30 | Heap | Concurrency |
|---|---|---|---|---|---|
| box1 | 10:07 | 11:00 | 9.5 h | `--max-old-space-size=2048` | 2 |
| box3 | 12:54 | 13:30 | 7.0 h | `--max-old-space-size=3072` | 3 |
| box4 | 15:58 | 16:30 | 4.0 h | `--max-old-space-size=3072` | 3 |

Heap choices are judgement, not measured: nightly jobs set no explicit limit, Node 22's default
is size-dependent, and a per-state shard hit the roughly 512 MB V8 string limit on 2026-10-04.
The mega job writes small per-batch shards (under 30k rows) so it stays far from that wall.
Leave at least 1.5 GB free on box1 for mariadbd and the OS.

Assignment, by what passes the nightly gate and the window:

- **box1, 11:00 gate:** Asbury (64) then Larry H. Miller (30). About 1.0 h crawl, about 25 min sync.
  Longest window and these two have verified passing gates and existing parsers.
- **box3, 13:30 gate:** AutoNation (56), Open Road NJ (7), Lithia stores that pass the gate
  (7 now). About 0.3 h crawl.
- **box4, 16:30 gate:** reserve. Only batches that fit a 3 h window; first candidate is EchoPark
  or Penske once a roster exists.
- Not scheduled: Group 1, Hendrick, Ken Garff, Holman, Ray Catena and the Cloudflare part of
  Lithia (blocked; no bypass).

Skip rules, checked in this order at batch start, each logging one line to
`megadealer-failures-<date>.log` and exiting 0:

1. Wall clock is past 21:30 ET minus the projected crawl-plus-sync time, i.e. the batch could
   not finish by 20:30: skip. Hard stop regardless: **nothing starts after 18:30**.
2. This box's nightly sync has not finished: the newest `~/inventory-sync/logs/sync-*.log` must
   have its final `{"upserted":...}` summary line, **and** `check-crawl-gate.mjs` against the
   real runs dir must exit 0 (no nightly crawl, chain or sync active). Otherwise skip.
3. Any box holds the shared sync lock right now: do not crawl-then-queue; skip. (Avoids
   stacking a mega sync in front of the next nightly.)
4. `megadealer-crawl.lock` already held: skip.
5. Free memory below 2.5 GB (box1) or 5 GB (box3/4): skip.

Mid-run guards: abort the crawl at 19:45 ET and do not start the sync after 20:15 (give the sync
about 15 min); if the shared sync lock is not acquired by 21:00, drop the batch and leave the
shards in the isolated dir. A sync that starts will finish before 21:30 for batches of this size
(estimates above are 15 to 22 min). The mega job never retries a failed batch the same day.

Own artifacts: lock `~/megadealer/data/megadealer-crawl.lock`; logs
`~/megadealer/logs/megadealer-<date>.log`; failures
`~/megadealer/logs/megadealer-failures-<date>.log`. A failure there exits non-zero only within
its own wrapper; nothing in the nightly crontab, chain or gate reads these files.

## 8. Pilot (proposed, not started)

- **Group:** Larry H. Miller, 20 of its 30 stores (AZ, UT, NM, CO). All 16 probed pass the
  nightly gate, all Dealer.com (existing Strategy 1), measured 164 cars/store.
- **Box:** box1, gate 11:00 ET, concurrency 2, heap 2048.
- **Size:** 20 stores x about 164 cars = about 3,300 rows. Crawl about 12 min on box1
  (20 x 38 s x 1.09 / 2 = 7.6 min p50, about 11 min p90). Sync about 15 min of fixed cost.
- **What it proves:** the isolated-directory job, the lock and skip rules, and the failure log.
  It also tells us how many VINs a daytime pass finds that the nightly row set doesn't have
  (compare against `dealer_inventory` read-only).
- **What it does not prove:** that mega groups add new cars. As the finding in section 1 says,
  these stores are already in the nightly roster, so the expected new-VIN count is small, and
  the real number is the answer to whether daytime refresh is worth anything. If you'd rather
  pilot something that can add inventory, that needs a roster of non-locator stores first.

## Open items before GO

1. **Roster source.** Without group lists the remaining upside can't be counted. Options: you
   export a list (e.g. MarketCheck dealer groups), or I read each group's public location page
   in the built-in browser, one page per group, like a person would.
2. **Sync input directory.** Confirm read-only how `sync_lightsail_inventory.js` and
   `run_sync_when_safe.sh` pick their input directory, so the mega sync can't see nightly shards.
3. **Allowlisting** for the Cloudflare-fronted groups (Group 1, Hendrick, Garff, Holman,
   Catena, most of Lithia), per `DEALER_ALLOWLIST_STRATEGY.md`.
4. **AutoNation platform and gate** are unknown from here (plain fetch shows Akamai; production
   result unknown because their states sit on box 2).
5. The 6 to 21 "unreachable" stores per group are likely `www` host issues; worth a one-fetch
   recheck with `www.` once approved.
6. Published store counts in section 1 are from memory and unverified.

Data sources: `dealers/*/*.json` on boxes 1/3/4; `data/inventory/*.json` ACTIVE counts
(boxes 1/3/4 only, 31 of 390 stores); `data/reports/dealer-bot-report-*-2026-10-0[4-8].json`;
`data/runs/<date>/<label>/box-report.json`; `~/inventory-sync/logs/sync-*.log`.
