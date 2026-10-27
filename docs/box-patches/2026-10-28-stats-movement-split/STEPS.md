# `/api/inventory/stats`: movement query split, last-good parts (box2) — code only, NOTHING IS INSTALLED

Install only on Paul's typed GO, in an idle window (gate below). Box2 only (`ssh box2`; `docs/BOXES.md`). One new file and one patched file in `/opt/trimscout-deals/src`, one plain `pm2 restart deals-api`. No schema change, no env change.

## Why
Live 2026-10-27 `/api/inventory/stats` answered 503 on every call, cold or warm (`statsCached` keeps nothing when the compute throws, so "warm" never happened). Not a restart, not a different path: the sync's live-totals check calls the same handler.

One of the five queries is over its cap. Read-only timing on box2 (reader account):

| Query | Plan | Time |
|---|---|---|
| totals (COUNT, COUNT DISTINCT) | unchanged | 8.5 s |
| byMake / byState / byCond | unchanged | 1.5 s / 2 s / 0.9 s |
| **movement** (`WHERE removed_at IS NULL OR removed_at >= now-1d`, five SUMs) | `type ALL`, ~4.4M rows | **> 150 s** (killed by a 150 s cap; 20 s cap in production) |

The OR defeats every index. Splitting it by `removed_at` alone is not enough: the old SUMs read `change_type`, `price_diff` and `window_sticker_url`, and a row lookup per row is what makes it slow. The same sums over only the 325k rows removed in the last day, with row lookups, also ran past 20 s (measured, `SET STATEMENT max_statement_time=20`).

## What changes (`inventoryStats.js`, new; `deals_api_server.js.patch`, 2 hunks)
Measured on box2 with the reader account and a 20 s cap; EXPLAIN and time are for the exact statements in `STATS_SQL`:

| Figure | Statement (all `FROM dealer_inventory`) | EXPLAIN | Time (cold / warm) |
|---|---|---|---|
| priceDrops | `COUNT(*) WHERE removed_at IS NULL AND price_diff < 0` | range `idx_inv_stock_diff`, **Using index** | 0.48 s / 0.06 s |
| priceIncreases | same, `> 0` | range `idx_inv_stock_diff`, Using index | 0.07 s / 0.02 s |
| arrivals | `COUNT(*) WHERE change_type='NEW_ARRIVAL' AND removed_at IS NULL` | index_merge **intersect** `idx_inv_removed` + `idx_inv_change`, Using index | 4.3 s / 1.8 s |
| removedToday | `COUNT(*) WHERE removed_at >= now-1d` | range, **Using index** | 0.44 s |
| withSticker | `COUNT(*) WHERE removed_at IS NULL AND window_sticker_url IS NOT NULL` | `type ALL` (no index can cover a VARCHAR(700)) | **not run** (a table scan; see below) |

* The first four run in the request path (together about 1-5 s). **withSticker is the one table scan**, so it is not in the request path: it runs through `runBackground` (the 120 s statement budget), single flight, at most once per 6 h, and after a failure not again for 1 h. The payload carries its last good value, `null` until the first scan succeeds. The admin sheet does not render it, and the sync ignores it. Whether the scan finishes inside 120 s on the live table is **unmeasured**; if it never does, the field simply stays `null` and the log says so once an hour.
* **Meaning of the movement figures changes**: arrivals / price drops / price increases now describe the cars **in stock** (they sit beside "In stock" and "Removed (24h)" on the sheet). The old query also counted them over the 325k cars removed in the last day; that part cannot be read inside the cap and is dropped.
* **One failed query never wipes the stats.** Every part (totals, the three lists, the four movement counts) keeps its own last good value; a part that fails serves it and the payload says so: `"stale": ["arrivals"]`. A part that has never succeeded since the process started (cold database, broken query) still fails the request, as today. Because the handler no longer throws after one good run, `statsCached` also never replaces a good payload with nothing.
* Known limit, unchanged: `statsCached` holds 40 entries and evicts the oldest inserted, so many filtered analytics keys can push `"stats"` out once; it then recomputes (about 10-15 s now, inside the cap).

<!-- MD5S:START -->
```
863e53d8c72659c11ee870e9b6a67dd3  FINAL  inventoryStats.js
6e35309faa02b5d8c24f6f66101055f3  BASE   deals_api_server.js (box2 live after #607, read-only 2026-10-27 19:05 ET)
31d527ba8e277ff58e39f73ad1d00295  FINAL  deals_api_server.js (after the patch)
```
<!-- MD5S:END -->
A test (`inventory_stats.test.js`) applies this patch with `-F0` to the box2 snapshot plus the #607 patch and checks the FINAL md5; it fails CI if either side drifts.

## Gate (before every write and the restart)
1. Sync lock free (read the log, never acquire it): `grep '\[sync-lock\]' ~/.pm2/logs/*deals*out*.log | tail -2` ends with a release.
2. No `inventory-sync|run_nightly_chain|standalone|backfill|unretire|apply` process on box1-box4 (`pgrep -fa`; boxes 1/3/4 are reached through `ssh -J box2 -i ~/.ssh/LightsailDefaultKey-us-east-1.pem ubuntu@<private ip>`).
3. Not inside the nightly crawl+sync window (22:00-06:30 ET). `pm2 describe deals-api` online.

## Install
```bash
# 0. stage (from the repo root of the merge commit; writes only to the stage dir)
ssh box2 'mkdir -p /opt/trimscout-deals/stats-split-stage'
scp scrapers/lightsail-crawler/src/inventoryStats.js docs/box-patches/2026-10-28-stats-movement-split/deals_api_server.js.patch box2:/opt/trimscout-deals/stats-split-stage/
# 1. md5s + backup + zero-fuzz patch on a COPY + syntax check
ssh box2 'cd /opt/trimscout-deals/stats-split-stage && md5sum inventoryStats.js        # = 863e53d8… (FINAL)
cd /opt/trimscout-deals/src && md5sum deals_api_server.js                              # must be 6e35309f… (BASE); if not, STOP: the box has drifted, re-diff
S=$(date +%Y%m%d%H%M%S); cp -p deals_api_server.js deals_api_server.js.bak.statssplit.$S && echo "backup suffix statssplit.$S"
cp deals_api_server.js ../stats-split-stage/stage.js && patch -F0 --no-backup-if-mismatch ../stats-split-stage/stage.js < ../stats-split-stage/deals_api_server.js.patch && cp ../stats-split-stage/stage.js /tmp/chk.mjs && node --check /tmp/chk.mjs && echo SYNTAX_OK && md5sum ../stats-split-stage/stage.js   # = 31d527ba… (FINAL)
rm -f /tmp/chk.mjs'
# 2. install (gate re-checked), then ONE plain restart
ssh box2 'cd /opt/trimscout-deals/src && cp ../stats-split-stage/inventoryStats.js . && cp ../stats-split-stage/stage.js deals_api_server.js && md5sum inventoryStats.js deals_api_server.js && pm2 restart deals-api'
```
If the restart happens with `ONE_PER_VIN_*` flags set, nothing else changes: pm2 keeps the env.

## Verify (key read inside the ssh command, never printed)
```bash
ssh box2 'set -a; . /opt/trimscout-deals/.env.trimscout-db; set +a
g(){ curl -s -m 60 -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" -w "\n[%{http_code} %{time_total}s]\n" "localhost:3004$1" | cut -c1-400; }
g /api/inventory/stats; g /api/inventory/stats'
```
Expect `200` in well under 20 s cold (about 10-15 s: the 8.5 s totals dominate) and instant warm, `"movement"` with four numbers and `"withSticker":null`, no `"stale"`. `pm2 logs deals-api --lines 40 --nostream | grep -i "inventory stats"` shows nothing, or `withSticker scan failed` (expected if the scan exceeds 120 s). After the next sync, its log line `live totals` must stop saying `unavailable`.

## Rollback
```bash
ssh box2 'cd /opt/trimscout-deals/src && cp -p deals_api_server.js.bak.statssplit.<S> deals_api_server.js && md5sum deals_api_server.js && rm -f inventoryStats.js && pm2 restart deals-api'    # md5 must be 6e35309f…
```
`stats-cache.json` needs no cleanup: a cached payload from the new code has the same fields as the old one (plus `stale` and a possibly-null `withSticker`, which the old consumers ignore).

## What this does not do
* It does not make `withSticker` available if its scan cannot finish in 120 s (a denormalised counter or a covering index on a sticker flag would; not done here).
* It does not speed up the totals query (`COUNT(DISTINCT vin)` over 4.9M rows, 8.5 s, inside the cap; if it ever exceeds 20 s the stats serve the last good totals and say `stale`).
