# Plan: move NY from box1's crawl list to box2's (cron lists only), install on Paul's GO

Nothing here has been run on a box. Everything below was learned read-only on 2026-10-31 (box1 and box2 `run-all-*`, sync logs, deals-api `[sync-lock]` lines, `crontab -l`, `uptime`, `free`, `ls`). Times are ET; sync-log timestamps are UTC (EDT until Nov 1 02:00, then EST: the cron lines use `CRON_TZ=America/New_York` so 22:00 stays 22:00).

## 1. Why
Box1 (2 vCPU, `CRAWLER_MAX_CONCURRENT_STATES=2`) projected 14.5 h in its own preflight and actually ran 14.65 h (10-28), 17.94 h (10-29), and the 10-30 run was still going at 18.5 h with NY 48,406 s, OH 28,262 s, VA 27,810 s. Box2 (4 vCPU, 6 states at once) ran 6.3 h, 6.6 h, 9.7 h and is critical-path-bound by CA (22.8k to 34.9k s), so it has room for one more large state without getting later.

Seconds per state (the `==== ST: done (..., Ns)` line of `run-all-<start date>.log`; a state occupies one of the box's slots for that long):

| State | b1 10-28 | b1 10-29 | b1 10-30 | | State | b2 10-28 | b2 10-29 | b2 10-30 |
|---|---|---|---|---|---|---|---|---|
| NY | 26,872 | 26,865 | 48,406 | | CA | 22,832 | 23,648 | 34,882 |
| OH | 15,961 | 16,828 | 28,262 | | TX | 13,896 | 14,254 | 25,211 |
| VA | 13,710 | 13,009 | 27,810 | | PA | 10,942 | 11,112 | 27,535 |
| AZ | 11,019 | 11,791 | 16,942 | | NC | 8,239 | 8,713 | 19,370 |
| IA | 5,357 | 9,196 | running | | GA | 7,361 | 7,628 | 11,714 |
| LA | 5,227 | 8,260 | not started | | MD | 4,903 | 5,046 | 9,411 |
| CT | 4,901 | 10,556 | not started | | IN | 4,244 | 4,421 | 6,439 |
| KS | 4,862 | 6,745 | not started | | TN | 4,071 | 4,361 | 7,944 |
| MN | 4,737 | 6,717 | running | | AL | 3,603 | 3,417 | 5,684 |
| ID | 4,117 | 5,452 | not started | | VT | 3,513 | 3,260 | 4,396 |
| RI | 3,421 | 3,385 | 6,893 | | OR | 3,105 | 2,818 | 4,421 |
| DE | 3,012 | 4,149 | not started | | CO | 3,043 | 3,257 | 6,166 |
| AK | 1,201 | 3,018 | not started | | WV, ME, OK | 2,306 / 2,049 / 1,984 | 2,347 / 2,104 / 2,450 | 2,358 / 3,383 / 2,779 |
| **Wall** | **14.65 h** | **17.94 h** | **>18.5 h, running** | | NV, MT, ND, WY | 1,717 / 1,700 / 961 / 740 | 1,633 / 1,863 / 1,114 / 788 | 3,633 / 2,239 / 1,990 / 928 |
| | | | | | **Wall** | **6.3 h** | **6.6 h** | **9.7 h** |

10-30 was about 1.8x slower than 10-29 on both boxes (box1's five finished states: 1.79x; box2 total state-seconds 1.73x). The cause is not identified here and is **not** fixed by moving states.

## 2. The move (the PR changes only this)
- box1 `CRAWL_STATES`: `AK,AZ,CT,DE,IA,ID,KS,LA,MN,OH,RI,VA` (NY removed). `CRAWLER_MAX_CONCURRENT_STATES=2` unchanged.
- box2 `CRAWL_STATES`: `AL,CA,CO,GA,IN,MD,ME,MT,NC,ND,NV,NY,OK,OR,PA,TN,TX,VT,WV,WY` (NY added). `CRAWLER_MAX_CONCURRENT_STATES=6` unchanged.
- No concurrency change on any box. Box1 stays at 2: the repo's own rule (`CAPACITY_SLA.md`, "max concurrency" table) says 2 for a 2-vCPU box, and box1 already shows load 2.34 on 2 vCPUs mid-crawl; memory is not the limit (7.8 GB total, 2.5 GB used, 5.3 GB available, no swap) but CPU is.

Simulated wall time (2 slots on box1, 6 slots on box2, states claimed longest-first, box2's NY cost = box1's NY seconds / 1.9, the box1:box2 seconds-per-dealer-job ratio measured on 10-29):

| Night shape | box1 now | box1 NY gone | box2 now | box2 + NY |
|---|---|---|---|---|
| 10-28 | 14.5 h | **10.8 h** (ends ~08:50) | 6.3 h | 6.3 h (ends ~04:20) |
| 10-29 | 17.5 h | **13.8 h** (ends ~11:50) | 6.6 h | 6.6 h (ends ~04:35) |
| 10-30 pattern (1.8x) | ~31 h | 24.6 h | 9.7 h | 9.7 h (ends ~07:40) |

Box1 clears 14 h on both normal nights, with only 0.2 h to spare on the 10-29 shape. A second move (OH next: 11.8 h on the 10-29 shape, box2 unchanged on normal nights, +0.7 h on a 10-30 night) is the follow-up if 13.8 h is too tight; it is not in this PR. A 1.8x night is not rescued by any rebalance (NY+OH+CT still 18.7 h): that needs the slowdown cause.

## 3. Fit with box2's sync, the analytics run and deals-api (from the logs)
- Box2's own sync starts when its crawl lock frees and ran 04:27 to 05:48 (10-28), 04:37 to 05:42 (10-29), 07:47 to 10:12 (10-30). Add about 10 to 15 min for NY's rows (box1's NY shard is 173 MB).
- The fleet's syncs are serialized on the deals-api sync lock in the order box2, box3, box4, box1 (10-28 night: box2 04:27 to 05:48, box3 06:53 to 08:16, box4 08:16 to 09:45, box1 12:41 to 13:03; 10-29 night: box2 04:37 to 05:42, box3 06:06 to 07:11, box4 09:45 to 11:06, box1 16:01 to 16:32). Moving NY makes box1's sync shorter, box2's slightly longer.
- The dealer-analytics job (`docs/DEALER_ANALYTICS_NIGHTLY.md`) only starts between 06:00 and 18:00 ET, after the sync and with no crawl running; its planned cron is hourly `15 10-17`. It is not in box2's crontab today (a run did take the sync lock 12:54 to 13:30 ET today). Box2 crawl + NY ends 04:35 normal, 07:40 slow; sync then ends about 06:00 / 10:30. So the first analytics pass is 10:15 normally and 11:15 after a slow night. No collision.
- deals-api busy hours (sync-lock held, which is when uploads and sweeps hit MariaDB): about 04:30 to 10:15 for box2, box3, box4, then the afternoon for box1. This plan moves none of that earlier.

## 4. Install window and rules
- Install a box only after that box's own sync has finished (`pgrep -f run_sync_when_safe` empty and no `[sync-lock] ... by ip-172-26-<its ip>` held) and before 21:30 ET. If box1's crawl or sync is still running at 21:30, skip that night.
- Needs Paul's typed GO per box. Read-only until then. No restart of anything, no `pm2`, no sync-lock change, no dealer fetch, no edits to `crawler.sh`, `.env*`, `node_modules`, or `inventory-sync`.
- Order: **box1 first, then box2**. Box1 alone leaves NY uncrawled for at most one night (the sync's 30 h stale rule leaves the existing rows alone). Box2 alone would crawl NY on both boxes the same night. If box2 cannot be done, run the box1 rollback.
- Realistic first night: box1's 10-30 run is projected to finish around 05:00 ET on Nov 1 and its sync after that, so tonight's window is very likely missed (tonight's 22:00 cron on box1 will also find the previous run's driver lock held; check that, it is outside this PR). The first plausible install day is Nov 1 or Nov 2.

## 5. Steps (each box; replace `<BOX>`)
SSH as in `docs/BOXES.md` (box1 and box3/4 via box2).
1. Gate (read-only): `date`; `pgrep -af "run-daily-crawl|standalone|run_sync_when_safe"` empty; `crontab -l | md5sum` and save `crontab -l > ~/crontab.<BOX>.pre-ny-rebalance.txt`; `md5sum` it and write it in the PR.
2. Expect exactly these two lines to change (header `CRAWL_STATES=` line and the `0 22` command's `CRAWL_STATES=`), nothing else. Build the new file with `sed` on the saved copy, then `diff` against the saved copy: only those two lines may differ.
   - box1: `AK,AZ,CT,DE,IA,ID,KS,LA,MN,NY,OH,RI,VA` becomes `AK,AZ,CT,DE,IA,ID,KS,LA,MN,OH,RI,VA`
   - box2: `...,ND,NV,OK,...` becomes `...,ND,NV,NY,OK,...`
3. `crontab <new file>`, then `crontab -l | diff - <new file>` must be empty.
4. **box1 only:** move the NY shard out of the sync's reach so a stale copy is never uploaded: `mkdir -p ~/nj-scraper/scrapers/lightsail-crawler/data/quarantine-ny-<date> && mv ~/nj-scraper/scrapers/lightsail-crawler/data/inventory/NY.json` (and any `NY__*.json`) into it. The sync reads every `*.json` in `data/inventory`, which is how the 2026-10-03 stale-shard incident happened; the quarantine directory is outside it. Do not delete anything.
5. Tell Paul: box done, md5 before and after, quarantine path.

## 6. Verify the next morning (read-only)
- `run-all-<date>.log` first lines: box1 preflight lists 12 states, box2 lists 20; box2 runs NY alongside CA.
- Box1 wall below 14 h; box2 end and sync end before about 10:15 ET; sync log `sweep guards` line has no new `skipped for a 403/429/5xx` spike on NY stores; NY row counts in the sync summary stay near their previous level (box2 has no prior NY shard: its first NY run starts without carry-forward, effect on run time unmeasured).
- Unchecked: box1 runs `CRAWLER_LITE_NIGHTLY=shadow`, box2 does not, and the two crawler checkouts differ by hand patches (box2 received the box4 catch-up, box1 did not), so NY dealers get box2's code path for the first time.

## 7. Rollback (any time, same rules)
1. Box2 first: restore `~/crontab.box2.pre-ny-rebalance.txt` with `crontab <file>`; check `md5sum` equals the recorded one. If box2 already crawled NY, move its `data/inventory/NY*.json` and `NY__*.json` into a quarantine directory outside `data/inventory` so the sync cannot upload them stale.
2. Box1: restore its saved crontab the same way; move `NY.json` back from the quarantine directory only if box1 has not yet crawled NY since (otherwise leave it quarantined; box1 re-creates it).
3. Nothing else was changed, so nothing else needs undoing. No restart is needed: crons read their new line at the next 22:00.
