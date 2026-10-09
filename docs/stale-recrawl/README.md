# Targeted re-crawl plan for stale dealers (2026-10-09) — PLAN ONLY, nothing launched

Input: `~/Desktop/stale-dealers-2026-10-09.csv` — 629 dealers whose in-stock cars were all last seen before 2026-10-07 (116,189 cars; 108,500 stamped 2026-10-03 by the stale re-stamp, so their real last crawl is older). Everything here was read from the database (SELECT-only, 20 s cap, no timeouts) and from crawl log files on the four boxes. No dealer page was fetched, no lock taken, nothing written to a box.

## Corrected totals (116,189 cars / 629 dealers)
| Bucket | Dealers | Cars | Meaning |
|---|---|---|---|
| No crawl log for its state+brand since 9/27 on any box | 484 | 94,516 | the job did not run (12 dealers / 1,045 cars are in state+brand pairs with **no log of any date** on any box: Genesis in 10 states, Hyundai AK, Cadillac MD: no job exists) |
| Job ran since 9/27 but the dealer is not in its recent log | 47 | 8,894 | dropped from the dealer list or the job died before reaching it |
| **To crawl** | **531** | **103,410** | |
| Held: skipped / blocked / aborted since 9/27 | 35 | 5,497 | re-running repeats it: 16 started and never finished (2,852 cars), 15 "no inventory URLs" (2,449), 4 Cloudflare 403 (196) |
| Held: crawled since 9/27 but rows still stale | 63 | 7,282 | a sync/shard question — a re-crawl would not fix it |

The earlier 85,409 / 30,780 split undercounted the no-log side: it matched states and makes by name, so Jeep/Ram/Dodge (log name `stellantis`), shard logs and Genesis were misfiled. Corrected: 94,516 cars in 484 dealers have no recent job log.

## Job unit
A job is one state+brand, run as `CRAWLER_DEALERS_FILE=<subset file> CRAWLER_BRAND=<brand> CRAWLER_STATE=<ST> node src/standalone.js` — a subset dealers file, no code change. The 12 no-job dealers (Genesis etc.) and the 47 dropped dealers need their dealer entries built from `dealership_contacts` (website column). Crawl into an **isolated data dir** (the box1 recovery-wave pattern) so the follow-up sync uploads only these records.

## Files
- `job_list_balanced.csv` — Plan B: balanced by cars, whole state+brand jobs, largest first per lane.
- `job_list_keep_on_last_box.csv` — Plan A: every dealer stays on the box whose log (else DB `source_box`) last shows it.
- `held_skipped_blocked_or_crawled.csv` — the 98 held dealers with the last log outcome.

## Estimates (rates from last night's logs: box2 377, box3 481 pages per job-minute; box1/box4 assumed 430; +15% for retries, +0.4 min per dealer; requests = cars + 5 per dealer)
See the table in the report; wall time shown for 4 and for 2 concurrent jobs per box (the nightly runs 2 states at once; 4 is the optimistic case on 4 vCPU). Sync after: ~11.5 ms of deals-API time per row (box logs: 10.2–12.9) + sweep of the touched stores ≈ 22 min for all four boxes, run one after another under the lock.

## The eight unnamed dealers (all are real, named in `dealership_contacts`; the earlier lookup missed them because the admin API's in-stock filter hides them)
| id | Dealer | Cars | Finding | Recommendation |
|---|---|---|---|---|
| 3902 | Dave Smith Motors, Kellogg ID (Ram 842, Jeep 138, Dodge 13, Chrysler 7) | 1,000 | single real store, no VIN overlap, first seen 9/23 | re-crawl |
| 7513 | Johnson Lexus of Raleigh NC | 940 | real; 12 of 25 sampled VINs also live at sister Johnson Lexus of Durham (7515, seen 10/09); 121 rows already retired 9/23 | re-crawl; a VIN seen at Durham but not Raleigh should retire at Raleigh |
| 11249 | Mercedes-Benz of Coconut Creek FL | 2,887 | real, but 2,142 of the cars are condition **wholesale** (not retail); 19/25 sampled VINs also appear at Pembroke Pines (0 live) and Pompano (15 live) | re-crawl; review the wholesale rows (likely not buyer-facing stock) |
| 11784 | Jenkins Hyundai of Jacksonville FL | 1,816 | real store; only stray 1-VIN overlaps with other Jenkins rooftops | re-crawl |
| 11953 | McGovern Hyundai Route 93, Wilmington MA | 1,230 | **merged rooftops**: 20 of 25 sampled VINs also live at McGovern Concord (12087); the group shares one inventory page across Rt 93 / Concord / Rt 2 / Milford | re-crawl, then dedupe: one VIN belongs to one rooftop |
| 12087 | McGovern Hyundai of Concord, Bow NH | 1,401 | same group feed: overlaps Rt 93 (20), Rt 2 (4), Milford (1) | re-crawl together with 11953 |
| 12243 | Fred Beans Hyundai of Mechanicsburg PA | 978 | **merged rooftops**: 21 of 25 VINs also live at Fred Beans Flemington (12094), 2 at Abington | re-crawl, then dedupe |
| 12483 | Crain Kia of Fort Smith AR | 1,246 | real store; 76 rows retired 9/25; no overlaps | re-crawl |

None looks like a retired dealer: all have a contact row updated 2026-09-12 to 2026-10-09 and a website. All were first seen 9/18–9/23 and last stamped 10/03. Whether each website is still live was not checked (no fetches).
