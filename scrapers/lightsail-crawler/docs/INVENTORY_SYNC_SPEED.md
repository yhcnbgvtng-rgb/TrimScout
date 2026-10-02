# Inventory sync: speed and resilience

The nightly sync copies each crawl box's inventory into the deals box's database (`dealer_inventory` and its
side tables). Four boxes do it, one at a time (the shared sync lock), and each takes about three hours. When it
dies partway — it has, repeatedly — the next run starts over.

This PR changes how the sync client and the deals API do that work. **Nothing in it is deployed.** Merging only
puts the code on `main`; boxes are patched by hand, and only through the gated checklist at the bottom.

## 1. What the sync costs today

Measured on the live fleet, 2026-10-02, from existing logs and two reads of a running sync's progress counter (nothing was run or changed for this):

| | |
|---|---|
| box2's sync held the lock | 06:13 → 09:34 ET = **3h21m** for 763,570 vehicles (deals-api `[sync-lock]` log) |
| box3 upsert rate, running now | **66 rows/s** averaged since it took the lock; 83 rows/s over a 4-minute window |
| one 2,000-row request | ≈ 24–30 s of server work at that rate |
| upserts per night | ~350 requests per box, ~24 s of server work each; **the fixed per-request overhead is a fraction of a second** |
| sweep | 3,208 (box2, 09-30) – 3,458 (10-02) one-store calls per box per night, then one `/stats` call |
| factory options written per box-night | **283,873 vehicles → 3,707,758 facet rows deleted and re-inserted** (box2 log, 09-30), against 704,962 main-table upserts |
| nights that ended without a summary line | 9 of 32 box-nights from 09-24 to 10-01 (crash, kill, or superseded by a manual rerun) |
| `HeadersTimeoutError` crashes | 7 in the logs of 09-28 → 10-01 (box1 ×2, box2, box3 ×2, box4 ×2) |

Two conclusions follow from those numbers, and they decide what this PR does and does not do:

1. **Round trips are not where the time goes.** With ~24 s of server work per request, the batch size is worth at
   most 1–3%. The upsert phase is database work — `dealer_inventory` has ~41 secondary indexes and every night's
   upsert rewrites `last_seen_at`, `days_on_lot`, `price_diff` and friends, which sit in about seven of them —
   plus the facet-table churn above.
2. **The expensive thing is rewriting data that didn't change.** A vehicle's dealer-listed options almost never
   change overnight, yet every vehicle with options had its whole set deleted and re-inserted, every night.

## 2. What changes

| # | Change | Where | Effect |
|---|---|---|---|
| 1 | **Options diff-write.** The facet rows a vehicle *should* have are compared with the rows it *has*; only vehicles whose set differs get the same DELETE + INSERT as before. | `deals_api_server.js` (`handleInventoryBulk`), `src/inventoryOptionsDiff.js` | Cuts the largest single source of writes (see §3). Same end state as rewriting everything. `INVENTORY_OPTIONS_DIFF_WRITE=0` turns it off. |
| 2 | **Size-capped batches.** Requests are capped by bytes (12 MB) as well as rows (2,000); `--dry-run` prints how a real crawl output splits. | `syncBatching.js` | Keeps every request far below the API's 30 MB body limit however heavy the vehicles are. Default row cap unchanged (see §1.1). `SYNC_BATCH_ROWS` / `SYNC_BATCH_MAX_BYTES` to tune. |
| 3 | **Batched sweep.** `dealerIds` (≤ 200 stores, default 50) sweeps a batch in one UPDATE and one cache invalidation. A batch that fails is retried store by store, so a poison store is skipped without taking its neighbors down. | `inventorySweep.js`, `syncSweep.js` | ~3,300 calls → ~70. Every call that retired a row also dropped the API's aggregate caches, so a buyer hitting `/stats` mid-sweep paid a cold full-table scan again and again. |
| 4 | **Own transport with real deadlines.** `node:http`, 20 min for bulk and sweep, 20 s for lock calls, a retryable/non-retryable verdict on every failure. | `syncHttp.js` | `fetch()` gives up on any response that takes > 300 s to *start* and cannot be told otherwise — the `HeadersTimeoutError` crashes. The server keeps running the abandoned statement, so the retry also piled a second copy of it on top of the first. 4xx errors fail at once instead of burning the retry budget. A request that waits out its *whole* deadline is retried once, not again, and a sweep batch that does so stops the run with its place saved (a stalled database; splitting the batch would only queue more statements behind the stalled one) — every attempt holds the lock the other three boxes are waiting for. |
| 5 | **Resumable run, phase by phase.** Progress (phase, upsert cursor, sweep cursor, **sweep cutoff**) is saved after every request. Running the same command again resumes: finished upserts are not repeated; a run that died in the sweep goes straight back to the sweep. Stores skipped by the earlier attempt are retried first. | `syncCheckpoint.js`, `syncRun.js` | A sweep failure no longer costs hours of re-upserting. **Also fixes two bugs in the old resume path** (§4). |
| 6 | **Stop instead of limping on.** A lost lock stops the run before its next write (the heartbeat used to log it and carry on — two writers). Five stores failing in a row stops the sweep with its place saved, instead of skipping the rest and reporting success. The final `/stats` call, which only feeds a log line, can no longer fail a finished sync. | `syncRun.js`, `syncSweep.js` | "One writer at a time" is enforced by the client, not just hoped for. Nothing restarts a stopped run on its own. |
| 7 | **Numbers in the log.** Timestamps; per-phase wall time; per-request p50/p95; the deals API's own time split into main upsert / options / price days; options unchanged vs replaced. | `syncRun.js`, `deals_api_server.js` (`timings` in the bulk response) | Turns the open question in §3 into a measurement on the first night. |
| 8 | Small things in the same code: the API decoded request bodies per chunk, so multi-byte characters straddling a chunk boundary became `U+FFFD` (now decoded as a stream); the client's default API host was a dead IP (now box2's static IP — each box's `.env` sets it anyway); `scripts/box/sync-lock-probe.mjs` for the gate. | `readBody`, `inventory-sync.mjs` | |

**Concurrency is unchanged: one sync at a time, one writer.** Items 3 and 5 only change what that one writer
sends. `SYNC_SWEEP_CONCURRENCY` (default 1, max 4) can run several sweep batches at once under the single lock
holder; the only new exposure is two UPDATEs contending inside the database, so leave it at 1 until a night with
batching has been observed.

**Skipping "no-delta" stores was considered and not built.** The sweep's UPDATE for a store with nothing to
retire is as cheap as any query that could find that out first, so detection would add a call per store to save
one. Batching removes the per-store overhead instead.

## 3. Before / after

| Per box, per night (~700k vehicles) | Before | After |
|---|---|---|
| Upsert requests | ~350 × 2,000 rows | ~350 (default; byte-capped) |
| Sweep requests | 3,208–3,458, one store each | ~65–70 (50 stores each) + the store-0 bucket |
| API cache invalidations during the sweep | up to ~3,300 | ≤ ~70 |
| Option facet rows rewritten | **3.7M** (every vehicle with options) | only vehicles whose set changed |
| Longest wait for a response before giving up | 300 s (cannot be changed) | 20 min for bulk/sweep |
| Run dies in the sweep | next run redoes the upserts (or crashes, §4) | next run skips them, continues at the saved store |
| A skipped store | silently left for tomorrow | logged, saved, retried first on resume |

**What this should do to the time, and how sure that is.** There is no staging database, so *none of the speed-up
is measured*; the numbers below are a model, and the first night's log replaces them.

- The sweep change removes round trips and cache churn. Of a ~3-hour run the sweep and final totals account for
  roughly 8–48 minutes (what is left after the upsert phase at the measured 66–83 rows/s); batching shrinks the
  per-call part of that, not the work of retiring rows.
- The options diff-write removes the facet-table rewrite for unchanged vehicles. Per vehicle per night, counting
  B-tree operations: the main row ≈ 8 (clustered + the ~7 secondary indexes that change), price days ≈ 5, and
  options ≈ 0.40 (share of vehicles with options) × 13 rows × 2 (delete + insert) × 3 indexes ≈ 31. On that
  model options are ~70% of the work, so if ≥ 90% of option sets are unchanged night to night (expected, not
  known) the upsert phase would take roughly 40% of what it does now — **~2–2.5× faster**.
  If the database time is dominated by something else (fsync, buffer-pool misses on the main table) the gain is
  smaller; the worst case is that it saves little and costs one extra read of ~2,600 small rows per 200
  vehicles.
- The first real run prints `deals API time inside those requests: … = main upsert … + options … (of which
  reading existing sets …) + price days …` and `factory options: N vehicles replaced … M unchanged`. Those two
  lines are the before/after. Compare against the box's previous night: lock held (deals-api log), rows/s.

## 4. Two bugs in the old resume path (reproduced against `main`)

The old client kept a checkpoint of how far the upsert loop had got and, on a rerun against the same files,
skipped those rows. Run against a local fake API with a checkpoint in place:

1. **A large resumed file crashes after its upserts and never reaches the sweep.** The loop is bounded by the
   full row count but slices the shorter remainder, so it ends with an empty batch and
   `makeCheckpoint(undefined)` throws `TypeError: Cannot read properties of undefined (reading 'dealerId')`
   (5,100 rows, 3,000 skipped: requests `[2000, 100, 0]`, exit 1, no sweep calls).
2. **A small one reaches the sweep and retires every vehicle it skipped.** The sweep removes rows of a store that
   were not seen since a cutoff, and the resumed run computed that cutoff from *its own* start — hours after the
   skipped rows were written (90 rows, 40 skipped: `removed: 40`, `inStock: 50` of 90 listed).

Bug 1 is what has been hiding bug 2 at real sizes. Fixing the loop alone would have switched the second one on
across hundreds of thousands of vehicles. The cutoff is now chosen once per crawl output, saved with the
progress, and reused by every attempt on it. State is ignored when the shard files differ, when any row's store
assignment differs (a rooftop added to the directory meanwhile changes ids and with them the sort order), when
it is older than 48 h, or when it is a v1 checkpoint.

## 5. Compatibility

Boxes and the deals API are updated at different moments, so every combination works:

| | old API | new API |
|---|---|---|
| **old client** | today | works: same bulk and single-store sweep; ignores the new response fields |
| **new client** | works: the first batched sweep gets the old API's 400 (`dealerId and seenAfter … are required`), the client switches to per-store sweeping and says so; no `timings` / `unchanged` counters, which it treats as zero | batched sweep, diff-write, timings |

The new client is tested against both API behaviors with the real `inventory-sync.mjs` run as a child process
against a fake API (`test/inventory_sync_e2e.test.js`); the single-store sweep statement an old client sends is
asserted byte-for-byte unchanged (`test/inventorySweep.test.js`).

## 6. Settings

All optional; the defaults are what runs if nothing is set. Values are clamped to safe ranges.

| Variable | Default | |
|---|---|---|
| `SYNC_BATCH_ROWS` | 2000 (max 10000) | rows per upsert request |
| `SYNC_BATCH_MAX_BYTES` | 12 MB (max 20 MB) | request body cap; the API refuses 30 MB |
| `SYNC_SWEEP_BATCH_STORES` | 50 (max 200) | stores per sweep call |
| `SYNC_SWEEP_CONCURRENCY` | 1 (max 4) | sweep batches at once; leave at 1 |
| `SYNC_BULK_RETRIES` | 6 | re-attempts of a failed upsert request (5 s growing ×1.5, capped 60 s) |
| `SYNC_BULK_TIMEOUT_MS`, `SYNC_SWEEP_TIMEOUT_MS`, `SYNC_STATS_TIMEOUT_MS` | 20 min, 20 min, 3 min | per-call deadlines |
| `SYNC_PROGRESS_MS` | 60000 | progress line interval |
| `SYNC_CHECKPOINT_PATH` | `~/.inventory-sync-checkpoint.json` | saved run state |
| `SYNC_MAX_RESUME_AGE_MS` | 48 h | older state is ignored |
| `INVENTORY_OPTIONS_DIFF_WRITE` (deals API) | on | `0` = rewrite every option set, as before |

Flags: `--dry-run` reads the shards and the dealership directory, prints the request and sweep plan and the
process's memory use, and sends nothing — no lock, no writes. `--no-resume` ignores saved state.

## 7. Deploy checklist

**Gate — every box idle and the lock free. If any line fails, stop; change nothing; report which box.**

Run all of it twice, at least two minutes apart. The second pass must also be clean.

1. **No crawl, sync or sweep on any box.** On each of box1–box4:
   ```bash
   pgrep -af 'node .*scripts/run-daily-crawl\.mjs|^node inventory-sync\.mjs|run_sync_when_safe|run_nightly_chain|run_core_crawl_when_safe' | grep -v pgrep   # must print nothing
   for f in ~/nj-scraper/scrapers/lightsail-crawler/data/daily_crawl_runs/driver*.lock; do [ -f "$f" ] && echo "$f $(cat "$f")"; done                         # every pid listed must be dead
   ```
2. **No other writer on box2:** `pgrep -af 'backfill|remap|catalog-facets'` prints nothing (and `DISABLE_FACET_REBUILD=1` is still in the `deals-api` environment: `tr '\0' '\n' < /proc/$(pm2 pid deals-api)/environ | grep ^DISABLE_FACET`).
3. **The shared lock is free** (two clean probes). The probe needs only `syncHttp.js` + `sync-lock-probe.mjs` and the deals API's URL and key, so run it from a checkout of this repo (`TRIMSCOUT_DEALS_HOST=52.202.234.65 TRIMSCOUT_API_KEY=… node scripts/box/sync-lock-probe.mjs`), or copy those two files to `/tmp` on box2 — **not** into `~/inventory-sync/`, which is a deploy and must wait for the gate. `FREE` (exit 0) both times; `HELD` or "could not tell" is a stop.
4. **Time.** At least 90 minutes before the next 22:00 crawl start, so there is room to verify and, if needed, roll back.

**Prepare (no production change).**

5. On the merge commit: `cd scrapers/lightsail-crawler && npm test`; `node --check` on every file below.
6. Files — server (box2, `/opt/trimscout-deals/src/`): `deals_api_server.js`, `inventorySweep.js`, `inventoryOptionsDiff.js`.
   **`deals_api_server.js` on `main` also contains #370 (factory-options normalize), which is merged but not yet deployed**, so deploying it deploys #370's write path too: also copy `inventoryOptionRows.js` and `factoryOptionAllowlist.js`, and read #370's own IDLE checklist (its backfill is separate and stays separate). Compare what is on the box with `main` first: `md5sum /opt/trimscout-deals/src/*.js` against the repo.
   Clients (every box, `~/inventory-sync/`), all together, never one alone: `inventory-sync.mjs`, `syncRun.js`, `syncSweep.js`, `syncHttp.js`, `syncBatching.js`, `syncCheckpoint.js`, `sync-lock-probe.mjs` (`syncLockWait.js` and `syncLockHeartbeat.js` are unchanged; `run_sync_when_safe.sh` is unchanged).
7. Back up every file that will be replaced: `cp -p f f.bak.$(date +%Y%m%d-%H%M%S)`.

**Server (box2) — recommended first; either order is safe (§5).**

8. Copy the files, then `node --check` each one on the box.
9. Restart **without** `--update-env`, which would overwrite stored variables such as `DISABLE_FACET_REBUILD`: `pm2 restart deals-api`. Confirm: `pm2 list` online; `/health` → ok; the `DISABLE_FACET_REBUILD` line from step 2 is still there; no errors in `pm2 logs deals-api --lines 50`.
10. Smoke tests that change nothing: an empty upsert, `curl -s -X POST -H "X-Trimscout-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{"vehicles":[]}' http://127.0.0.1:3004/api/inventory/bulk` → `upserted:0` and a `timings` object; a batched sweep with a cutoff in the year 2000 for one real store id → `{"removed":0,"stores":1}`.
11. Check the query plans (read-only): `EXPLAIN UPDATE dealer_inventory SET removed_at = NOW() WHERE dealer_id IN (<~50 real store ids>) AND removed_at IS NULL AND last_seen_at < '2000-01-01' AND source IN ('nightly')` should be `range` on an `idx_inv_stock_*` index with a row estimate near the stores' in-stock size, not `ALL`; and `EXPLAIN SELECT vin, dealer_id, canonical_key, label, code FROM dealer_inventory_options WHERE (vin='…' AND dealer_id=…) OR (…)` should be `range` on the primary key. **If either is a full scan, stop: roll the server back and report** (the options one can be switched off alone with `INVENTORY_OPTIONS_DIFF_WRITE=0`; the sweep batch size can be set to 1 on the clients).

**Clients (box1–box4).**

12. Copy the files into `~/inventory-sync/`, `chmod +x` the two `.mjs` entry points, `node --check` each.
13. On each box: `set -a; . ~/inventory-sync/.env; set +a; node ~/inventory-sync/inventory-sync.mjs ~/nj-scraper/scrapers/lightsail-crawler/data/inventory --dry-run`. Reads only. Check: the vehicle and store counts match the box's last run, no request body near 12 MB, memory (`rss`) comfortably under what the box has. A stale `~/.inventory-sync-checkpoint.json` from the old client is harmless (ignored).

**The first night.**

14. Do not start anything by hand. Let the scheduled run go. In each box's log (`ls -t ~/inventory-sync/logs/sync-*.log | head -1`) look for: the `upsert phase` line (rows/s — before: 66–83), `deals API time inside those requests`, `factory options: … N unchanged`, the `sweep phase` line (`mode batch`, ~65–70 batch calls), and the final JSON line. Compare lock-held time with the previous night's (`grep sync-lock ~/.pm2/logs/deals-api-out.log` on box2).
15. If a run stops (`STOPPED:` / `FAILED:` in the log), its progress is saved. Look at why first; running the same command again resumes it, and **only a person decides that** — nothing retries it automatically.

**Rollback.** Clients: put the `.bak` files back (the old client works against the new API). Server: put the `.bak` files back and `pm2 restart deals-api` (the new client works against the old API). The diff-write alone: `INVENTORY_OPTIONS_DIFF_WRITE=0`, set so that the other stored variables survive the restart.

## 8. Not in this PR

- **Skipping unchanged vehicles entirely** (a delta sync). `days_on_lot` changes every night, so "unchanged" needs the API to derive it from `crawl_first_seen` first.
- **The price-days history rewrite.** The crawler appends a point only when a price changes, so it averages ~2.5 rows per vehicle; small next to the options churn. The new `daysMs` timing will say whether it ever matters.
- **Database settings** (`innodb_flush_log_at_trx_commit`, buffer pool size, the number of secondary indexes on `dealer_inventory`). Probably the biggest remaining lever and a decision for the person who owns that box; the new timings show how much of the run is database time.
- Parallel upserts. Two writers on overlapping key ranges is how the 2026-09-23 deadlocks happened, and the connection pool (5) is shared with buyer traffic.
- The Stellantis remap, the options backfill (#370), the lite-crawl work, and the admin Vehicles UI.
