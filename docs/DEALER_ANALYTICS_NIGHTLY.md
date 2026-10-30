# Dealer Analytics: nightly job (PR 1, code only)

Feeds the admin Dealer Analytics page (PRs 2 and 3). **Nothing here is installed, created or scheduled until Paul says GO.** Read `docs/BOXES.md` before touching a box.

## Why the job derives price changes from `dealer_inventory_days`, not `price_diff`

Checked read-only on box2, 2026-10-30, with 21 dealers sampled across five size bands (including dealer 2187, which showed zero changes on 10-25 and 10-30). `dealer-analytics-probe.mjs --price-diff` reproduces it.

| Check | Result |
|---|---|
| `price_diff` rows (2,746) whose exact old→new change exists in the days table | **95.3%** (2,618) |
| same new price exists in the days table | 99.8% (2,741) |
| the change is on `DATE(last_seen_at)` | **0%** |

Under the 98% bar, and the date attribution is unusable: `price_diff` persists on rows after the night it happened (the stale carry-forward re-upsert bumps `last_seen_at` and leaves the old `price_diff`), so a job reading it cannot say *when* a change happened and would re-date old changes. 123 of dealer 2200's 300 rows also carry an `old_price` that differs from the previous day's stored price (the crawler's own reference). The days table is the reliable source, so the job diffs consecutive days rows per (VIN, store).

Caveat that stays: a zero-change day is not proof of a quiet day. 10-25 and 10-30 show 0 changes for dealer 2187 although it cuts about 25 cars on most days; those rows are probably carried forward. A change is dated the first day the VIN is *observed* at the new price, never lost.

## What it creates (4 new tables; no existing table is altered)

| Table | Key | Rows | Purpose |
|---|---|---|---|
| `dealer_price_changes` | `(dealer_id, changed_on, vin)` | about 80k to 110k/day (measured, about 10 MB/day); backfill about 2.5M | one row per observed change: `prev_on`, `old_price`, `new_price` |
| `dealer_daily_summary` | `(dealer_id, day)` | about 9,500/day | units, make count, `is_group_bucket`, new/used, avg price, avg DOM, age buckets 0-30/31-60/61-90/90+, added/removed (day and 7d), drop units and average $/% drop (7d, 30d) |
| `market_price_daily` | `(day, make, model, year, cond)` | about 22k/day (measured: 289 makes) | units, dealer count and average price per make/model/year/condition |
| `dealer_analytics_runs` | `(day, started_at)` | 1/day | completion marker (makes the cron idempotent) and "data as of" for the page |

`day` is the UTC date at run time, the same convention as `dealer_inventory_days.seen_on`. Retention is not implemented in this PR (plan: prune `dealer_price_changes` past 400 days).

**Excluded from every table:** only dealer id 0 (no store matched). `DEALER_ANALYTICS_EXCLUDE` (comma list, default empty) can add ids.

**Group buckets are kept and flagged.** Some directory rows are really dealer-group websites attributed to one rooftop: 16951 (ED MORSE NISSAN, `edmorse.com`) lists 61 makes and 10,934 units, Harley-Davidson included. `dealer_daily_summary` carries `make_count` and `is_group_bucket` (1 when the dealer has **40 or more distinct makes in stock, or 1,500 or more units in stock**). The page hides flagged dealers by default with a toggle to show them. Measured on box2 2026-10-30: **117 of 9,488 dealers flagged** (116 by units, 13 by makes, 12 by both, 1 by makes only), holding 299,509 of 2,897,842 active units (10.3%). `dealer-analytics-probe.mjs --suspects` lists them. The make rule is narrow on purpose: 2,528 small dealers list 20 to 39 makes (trade-ins), which a lower threshold would have swept in. Their changes and units are still counted in `dealer_price_changes` and `market_price_daily`.

## Guards (all enforced in code, covered by tests)

- Starts only between 06:00 and 18:00 ET, after box2's nightly sync wrote its run-summary line (and no `inventory-sync.mjs` is running), with no crawl lock/process (box2's own `check-crawl-gate.mjs`).
- Takes the shared sync lock (`/api/ops/sync-lock/*`, heartbeat renewed) for the whole write phase, waits at most 90 minutes for it, and always releases it.
- Hard stop at 21:30 ET, checked between every batch, so it is gone before the 22:00 crawl. Also stops if the lock is lost or a crawl starts (gate re-checked every 20 batches).
- Any error stops the run: later steps are skipped, the run row is marked `failed`, the lock is released, exit code 1. No retries.
- Never touches the sync path: it reads `dealer_inventory` and `dealer_inventory_days` and writes only the four new tables (a test greps the sources for writes to the existing tables).
- Already-finished days are skipped, so cron can fire hourly.

Exit codes: 0 ok / already done, 2 not ready (nothing written), 4 stopped at the deadline or because a crawl started, 1 error.

## Cost (dry run on box2, 2026-10-30 18:13 to 18:49 ET, reader account, read-only)

The first full dry run (`--steps=changes,market` plus the real summary SQL over every dealer range) took **36 minutes 28 seconds**, peak memory 825 MB, load average about 1 on an otherwise idle box2:

| Step | Result | Time |
|---|---|---|
| price changes, window 10-29..10-30 | 1,995,195 VINs checked (carry-forward bumps `last_seen_at`, so this is nearly all stock); **108,512 changes** (90,700 drops, 17,812 increases): 81,124 dated 10-29, 27,388 dated 10-30 (a partial day when it ran) | 14 min 44 s |
| market averages | 289 makes, **22,019** make/model/year/condition rows | 9 min 22 s |
| daily summary | **9,630 dealers**, 2,897,842 active units, **117 flagged `is_group_bucket`** (299,509 units) | 12 min 21 s |

The earlier read-only estimate (10 to 15 minutes, about 240k changes a day) was too low on both counts: it ignored the 200 ms throttle between batches and it used the persisted `price_diff` count (which includes carry-over). Real change volume is about 80k a day. 36 minutes finishes comfortably before the 21:30 ET stop for any start time up to 18:00 ET, but it is long enough that the job should start right after the sync (cron hourly from 10:00 ET).

Statements are capped at 120 s (`max_statement_time`). The price-drop columns of the summary were not part of this run (the table does not exist yet): that query is a small range scan on the new table's primary key.

## Files (PR 1)

`scripts/box/` (flat, like the other box scripts; the shared `syncHttp.js`, `syncLockHeartbeat.js`, `syncLockWait.js` ship alongside):

- `dealerAnalyticsCore.js` (tables, SQL, derivation, windows), `dealerAnalyticsRun.js` (guards and steps), `dealerAnalyticsBox.mjs` (box wiring)
- `dealer-analytics-nightly.mjs` (`--dry-run`, `--create-tables`, `--day=`, `--steps=`), `dealer-analytics-backfill.mjs` (dry run unless `--apply`), `dealer-analytics-probe.mjs` (read-only: `--price-diff`, `--tables`, `--suspects`)
- `run_dealer_analytics.sh` (cron entry: env, flock, daily log), `dealerAnalytics.test.mjs`

## Install (each step needs its own GO)

1. Copy the files above plus `scripts/box/package.json` (`{"type":"module"}`, without it node treats the `.js` files as CommonJS) into `~/dealer-analytics/` on box2 and create `~/dealer-analytics/.env` with the deals-api's `DB_*` values (`DB_WRITER_*` and `DB_READER_*`). `TRIMSCOUT_API_KEY` comes from `~/inventory-sync/.env`. Record md5s.
2. `node dealer-analytics-probe.mjs --price-diff --sample=20` and `--suspects` (read-only).
3. `node dealer-analytics-nightly.mjs --dry-run` once: row counts and a timing, no writes (works before the tables exist; the price-drop columns then read 0). Only starts between 06:00 and 18:00 ET, after the sync and with no crawl running.
4. GO: `--create-tables`.
5. GO: `dealer-analytics-backfill.mjs` dry run, then `--apply` in an idle window (resumable; pauses itself at 21:30 ET), then `dealer-analytics-probe.mjs --tables` (must be 98% or better).
6. GO: cron, for example `15 10-17 * * * /home/ubuntu/dealer-analytics/run_dealer_analytics.sh` (hourly; finished days are skipped).

Rollback: remove the cron line; `DROP TABLE dealer_price_changes, dealer_daily_summary, market_price_daily, dealer_analytics_runs`. Nothing else depends on them until PR 2.

## Known limits

- Box1/3/4 syncs land on their own schedule. The job re-derives the last 2 days of changes each run, so a late box is caught the next day. The summary and market tables are snapshots as of the run.
- After the crawl ends there can be up to 5 minutes before box2's sync takes its lock (`run_sync_when_safe.sh` polls every 300 s); the job requires the sync's run-summary line to be recent, which covers it except in that gap.
- If box2 is switched to crawl-queue host mode (`docs/CRAWL_QUEUE.md`), its sync exits at once and writes no run summary, so the job would report "not ready" until that is revisited.
- `removed_at` can be wrong after wrongly-retired runs (see the stale-shard incident), which skews removed counts and "added" counts for the affected days.
- History is only about 5 weeks deep (days table starts 2026-09-28), so the 90-day trend fills in over time.
