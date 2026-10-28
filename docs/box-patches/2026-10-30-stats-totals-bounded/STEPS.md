# `/api/inventory/stats`: totals query made index-bounded (box2) — code only, NOTHING IS INSTALLED

Install only on Paul's typed GO, in an idle window (gate below). Box2 only (`ssh box2`; `docs/BOXES.md`). **One file replaced** (`inventoryStats.js`) in `/opt/trimscout-deals/src`, one plain `pm2 restart deals-api`. `deals_api_server.js` is untouched. No schema change, no env change. Written without box access: every box-side number below is from the incident report (21.6 s against the 20 s cap), nothing was re-measured.

## Why
The `totals` statement (`COUNT(*), SUM(removed_at IS NULL), COUNT(DISTINCT dealer_id), COUNT(DISTINCT vin), MAX(last_seen_at)` over the whole table) took 21.6 s on box2 against the 20 s `max_statement_time`. It is the only request-path statement near the cap, and the DISTINCT counts are what make it slow. On a cold process a failure there fails the whole request (no last good value yet).

## What changes
| Figure | Where it runs now | Statement |
|---|---|---|
| total, inStock | request path | `SELECT COUNT(*), SUM(removed_at IS NULL) FROM dealer_inventory` — touches only `removed_at`, so `idx_inv_removed` should cover it (index-only scan; **EXPLAIN not run**, check it in step 3) |
| lastSeenAt | request path | `SELECT MAX(last_seen_at)` — one read of `idx_inv_last_seen` |
| dealers, vins | **background** (the 120 s budget, `runBackground`) | the two `COUNT(DISTINCT)`; single flight, refreshed at most every 30 min, a failure is not retried for 15 min, last good value kept |

* `dealers` and `vins` are `null` in the payload until the first background scan succeeds after a restart (the first minutes), then carry the last good value. If the scan never fits in 120 s they stay `null` and the log says so every 15 min (`dealers/vins distinct scan failed`).
* Consumers made null-safe in this PR: the admin Vehicles header (`VehiclesSheet.tsx`, shows "N in stock" without "across N stores" until the figure lands; **web deploy, not a box step**) and the sync summary (`live` is only JSON-logged; `null` is fine).
* Everything else (byMake / byState / byCond, movement counts, sticker scan, per-part last-good, `stale`) is unchanged.

<!-- MD5S:START -->
```
7a27ab119e133ea781aad43d22e1e15a  FINAL  inventoryStats.js
```
<!-- MD5S:END -->
BASE (what is on the box now) should be `863e53d8c72659c11ee870e9b6a67dd3` (the 2026-10-28 stats-movement-split install). If it is not, STOP: either that install never happened or the box drifted; re-diff before copying. A test (`inventory_stats.test.js`) fails CI if the md5 above goes stale.

## Gate (before every write and the restart)
1. Sync lock free (read the log, never acquire it): `grep '\[sync-lock\]' ~/.pm2/logs/*deals*out*.log | tail -2` ends with a release.
2. No `inventory-sync|run_nightly_chain|standalone|backfill|unretire|apply` process on box1-box4 (`pgrep -fa`; boxes 1/3/4 via `ssh -J box2 -i ~/.ssh/LightsailDefaultKey-us-east-1.pem ubuntu@<private ip>`).
3. Not inside the nightly crawl+sync window (22:00-06:30 ET). `pm2 describe deals-api` online.

## Install
```bash
# 0. stage
ssh box2 'mkdir -p /opt/trimscout-deals/stats-totals-stage'
scp scrapers/lightsail-crawler/src/inventoryStats.js box2:/opt/trimscout-deals/stats-totals-stage/
# 1. md5s + backup + syntax check
ssh box2 'cd /opt/trimscout-deals/stats-totals-stage && md5sum inventoryStats.js      # = 7a27ab119e133ea781aad43d22e1e15a (FINAL)
cd /opt/trimscout-deals/src && md5sum inventoryStats.js                               # must be 863e53d8… (BASE); else STOP
S=$(date +%Y%m%d%H%M%S); cp -p inventoryStats.js inventoryStats.js.bak.totals.$S && echo "backup suffix totals.$S"
cp ../stats-totals-stage/inventoryStats.js /tmp/chk.mjs && node --check /tmp/chk.mjs && echo SYNTAX_OK; rm -f /tmp/chk.mjs'
# 2. read-only EXPLAINs (reader account), before installing
ssh box2 'mysql -e "EXPLAIN SELECT COUNT(*), SUM(removed_at IS NULL) FROM dealer_inventory; EXPLAIN SELECT MAX(last_seen_at) FROM dealer_inventory" <db>'   # expect key idx_inv_removed / "Select tables optimized away", Extra "Using index"
# 3. install (gate re-checked), then ONE plain restart
ssh box2 'cd /opt/trimscout-deals/src && cp ../stats-totals-stage/inventoryStats.js . && md5sum inventoryStats.js && pm2 restart deals-api'
```

## Verify (right after the restart)
```bash
for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' http://127.0.0.1:3004/api/inventory/stats; done   # 200 each; first well under the 20 s cap
curl -s http://127.0.0.1:3004/api/inventory/stats | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["total"], d["inStock"], d["dealers"], d["vins"], d.get("stale"))'
# repeat after ~3 min: dealers/vins are now numbers (they are null until the background scan lands)
pm2 logs deals-api --lines 50 --nostream | grep 'inventory stats'     # any "distinct scan failed" = the 120 s budget is too small
```

## Rollback
`ssh box2 'cd /opt/trimscout-deals/src && cp -p inventoryStats.js.bak.totals.<suffix> inventoryStats.js && pm2 restart deals-api'`
