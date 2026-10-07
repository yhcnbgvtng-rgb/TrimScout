# Sync freshness and safe sweeps (2026-10-07)

Why live cars were marked sold and sold cars stayed in stock, what changed, and how to roll it out. Code: `scripts/box/syncFreshness.js`, `inventory-sync.mjs`, `syncRun.js`, `syncSweep.js`, `scrapers/lightsail-crawler/src/inventorySweep.js`.

## Root cause (traced, read-only, 2026-10-07)

Two independent behaviours of the nightly sync, both confirmed on one store — **Brownsville Toyota (dealer 7100, TX)**.

### A. Dead cars stay "in stock" with `last_seen` = today — the sync re-stamps stale shard records

Example VIN `2T36DRBV1TW029650` (RAV4 XLE Premium).

| Step | Evidence |
|---|---|
| Dealer no longer lists it | Not among the 12 new RAV4s on `brownsvilletoyota.com/searchnew.aspx?Model=RAV4` (all pages) |
| Our DB says in stock, seen today | `removed_at` NULL, `last_seen_at` 2026-10-07, `source_box` box3 |
| It is in box3's shard | `~/nj-scraper/scrapers/lightsail-crawler/data/inventory/TX.json` (411 MB, mtime 2026-10-07 06:23), exactly once, `status: ACTIVE` |
| …but the record is 11 days old | `updatedAt = 2026-09-26T08:01:16Z`; **all 152** Brownsville Toyota records in that file have `updatedAt 2026-09-26` |
| box3's last Texas Toyota crawl was that day | newest `logs/tx-toyota-*.log` on box3 is `tx-toyota-2026-09-26.log`; Toyota TX has since been crawled by **box2** (`tx-toyota-shard2-2026-10-04/05/06.log`) — TX is on both boxes' `CRAWL_STATES` |
| The sync uploaded it anyway | `sync-2026-10-06.log` (box3, run 08:39–10:57 ET): "716276 vehicles in file, 664994 active with a valid VIN", `"upserted":664994` |
| Why uploading = "seen now" | `inventory-sync.mjs` filtered only on `status === ACTIVE` + a valid VIN (no age check; the mapped row doesn't even carry `updatedAt`). `handleInventoryBulk` does `ON DUPLICATE KEY UPDATE … last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL` for every row it receives |

**Step that did it: the upsert phase of the sync.** It also *revives* cars the sweep had already retired.

### B. Live cars marked removed — the store-wide sweep retires rows another box wrote

Example VIN `2T36DRBV0TW031177` (RAV4 XLE Premium) — **listed on the dealer's site right now**, marked removed.

| Step | Evidence |
|---|---|
| DB | `removed_at` 2026-10-07 10:38:58 ET; `last_seen_at` 05:47:25 ET; `source_box` box2 |
| box2 wrote it that morning | box2 held the sync lock 09:31–10:53 UTC (05:31–06:53 ET); 05:47 falls inside |
| box3 retired it | box3 held the lock 12:39–14:57 UTC (08:39–10:57 ET); 10:38:58 falls inside. **30+ Brownsville rows** (not just RAV4s), all `last_seen` 05:47:25, were retired in that same second |
| box3 never had it | the VIN occurs **0 times** in box3's `TX.json` |
| Scale of that one run | `"sweptStores":3043 … "removed":134515` |
| Why the sweep can do this | `buildSweepStatement`: `UPDATE … SET removed_at = NOW WHERE dealer_id IN (…) AND removed_at IS NULL AND last_seen_at < <run start> [AND source IN ('nightly')]`. It filters on `source` (every box writes `nightly`), **not on which box wrote the row**, and sweeps every store the run uploaded anything for |

**Step that did it: the sweep phase of box3's sync**, retiring box2's rows because box3's own (stale) file didn't contain them.

### What this does and does not say about the size wall

TX.json is now 411 MB, under the ~512 MB V8 string limit, so for Brownsville the wall is **not** the direct cause; the cause is *ownership drift*: Toyota-TX moved to box2 and box3 kept an old copy that its sync keeps replaying. The wall is real elsewhere (many `tx-*`/other box3 job logs show `Invalid string length` / heap / exit-null in the last 10 days) and has the same *effect* (a failed merge leaves old records that the sync then re-stamps), which the same fix covers.

### Not proven
No per-row audit log exists, so the two chains above are reconstructed from timestamps, lock ownership, the shard contents and the code, not from a log line naming each VIN.

## What changed

1. **Freshness (A).** Only records with `updatedAt` within `SYNC_MAX_RECORD_AGE_HOURS` (default **30**) are uploaded. Missing/unparseable `updatedAt` = not fresh. 100% of sampled shard records carry `updatedAt`. Stale records are skipped and logged ("skipped N ACTIVE record(s) the crawl has not refreshed…, most: <store> (n)"). A store with no fresh upload is never swept.
2. **Cross-box protection (B).** The sweep sends `sourceBox` (this box) and `foreignBefore` (run start − `SYNC_FOREIGN_GRACE_HOURS`, default **48**). The deals API then retires a stale row only if `source_box` = this box, or NULL (written before tracking), or it hasn't been seen since `foreignBefore`. So box3 can no longer retire a row box2 wrote 5 hours ago; a foreign row nobody has refreshed for 2 nights does still retire, which is how dead cars age out. Clients that don't send the fields get the old behaviour.
3. **Fail closed on bad files.** A shard that is not a complete JSON array (first non-space byte `[`, last `]`) is **skipped whole**: nothing uploaded, none of its stores swept, run exits **3**. A shard over `SYNC_SHARD_MAX_MB` (default **480**, just under the V8 limit) uploads its fresh records but **none of its stores are swept**.

Durable fix for the wall itself: **per-brand (state × brand) shard files** — the single cumulative per-state file is what hits the limit and what keeps stale records alive. Compact JSON is already effectively in place (one record per line) and only delays the limit. Not in this PR: it is a crawler (`standalone.js`) change. The three rules above make the wall non-destructive in the meantime.

## Deploy plan (idle window; nothing here has been deployed)

Pre-conditions: sync lock free (`grep '\[sync-lock\]' ~/.pm2/logs/deals-api-out.log | tail -2` ends in a release), no crawl/sync/sweep running, no long query on the deals box.

1. **Deals box** — `scripts/box/2026-10-07-safe-sweep-server.sh` (replaces `inventorySweep.js`, restarts deals-api; backup + rollback in the script). Safe alone: nothing changes until a client sends the new fields.
2. **Each crawl box, when that box has no sync running** — `scripts/box/2026-10-07-sync-client-update.sh`. **box1, box3 and box4 still run the old single-file client (292 lines, installed 2026-10-01); only box2 runs the modular client.** The script installs all ten files of the modular client's import closure; it does not restart anything (the nightly wrapper starts a fresh `node` each night). box2's installed files are byte-identical to `main` before this change.
3. **Prove each box before its first night** with `node inventory-sync.mjs <dir> --dry-run` (no lock, no writes): read the stale-skip line, any SKIPPING/over-limit lines, the sweep plan.
4. **Order of boxes:** box2 first (already modular), then box3, box4, box1. Watch the first nightly summary on each: `removed` should drop sharply from the 134k seen on box3.

Self-healing afterwards: the next nightly sync that has a fresh record for a car revives it (`removed_at = NULL`) — so live cars wrongly retired today come back when their owning box next syncs; dead cars stop being re-stamped and retire once a sweep of their store runs with them unseen for 48h. No manual repair is needed except for stores no box refreshes (e.g. Bruner Toyota has 0 new cars in the DB while the dealer lists 52).

## Blast radius

- **Dual-crawled states (from the four crontabs): 19** — AL, CA, GA, IA, IN, LA, MA, MI, MN, MO, NC, NJ, NY, OH, OK, PA, TN, TX, VA. 31 are single-box.
- **One box3 run:** 134,515 rows retired across 3,043 stores (not all wrong — it also retires genuinely sold cars).
- **Sampled (new cars, dealer site vs DB, 2026-10-07 afternoon):** Brownsville Toyota, Family Toyota of Arlington / Burleson, Fox Toyota of El Paso — **61–73%** of the cars each dealer lists were marked removed; **53–436** in-stock cars per store were not listed by the dealer. 4 stores of 84 TX Toyota stores; not extrapolated.
- boxes 1/3/4 run the old client, which has the same two behaviours every night.
