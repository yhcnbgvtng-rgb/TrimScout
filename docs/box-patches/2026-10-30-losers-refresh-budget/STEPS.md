# One-per-VIN facet buckets: 120 s background budget for the losers GROUP BY (box2) — code only, NOTHING IS INSTALLED

Install only on Paul's typed GO, in an idle window (gate below). Box2 only (`ssh box2`; `docs/BOXES.md`). **One file replaced**: `onePerVinLosers.js` in `/opt/trimscout-deals/src`; `deals_api_server.js` is NOT touched (the budget is read from `refreshTimeouts.js`, which is already on the box). One plain `pm2 restart deals-api`. No schema, no env change. Written without box access: nothing below was re-measured on the box.

## Why
The facet read subtracts the losers via `vin-losers-table:<days>` in the stable cache. That cache only gives a refresh the 120 s background budget when it is recomputing an **existing** (expired) entry. A **cold** key (first run, or after a restart before the persisted cache file has the key) went through the 20 s buyer budget, hit `max_statement_time`, fell back to undeduped counts for the 60 s failure cooldown, and then tried again cold on the same 20 s budget, so it could never land.

## What changes (`onePerVinLosers.js` only)
* The all-stores buckets read **always** runs with `max_statement_time=120` and a 150 s connection wait (the constants in `refreshTimeouts.js`), warm or cold. A contact-set read (`dealerIds`) keeps the interactive 20 s.
* A caller that hits a cold key waits at most 15 s (`COLD_WAIT_MS`). Past that it gets the unadjusted lists immediately, **no cooldown**, while the single in-flight read keeps running and fills the cache. The next call is adjusted. A read that fails after that wait starts the usual 60 s cooldown; one that succeeds clears it.
* After a restart, the persisted entry (`facet-cache.json`, loaded at start) is served at once as an expired entry with the background refresh behind it, so a restart does not drop to undeduped counts as long as that file has the key. This is existing behaviour, now covered by a test.
* **Not done: incremental.** The GROUP BY is still one statement over the ~600k-row losers table joined to `dealer_inventory` by primary key. Whether it finishes in 120 s on the live table is **unmeasured**; the STEPS below measure it before the flag is relied on. If it does not, the next step is incremental maintenance of per-bucket counts in the reconcile, not a bigger budget.

<!-- MD5S:START -->
```
78bc22a08603aa1ae3afdb2b83bb1415  FINAL  onePerVinLosers.js
65db034542a7b50e36714ab88db42123  BASE  onePerVinLosers.js (main after #607)
```
<!-- MD5S:END -->
A test (`one_per_vin_losers.test.js`) fails CI if the FINAL md5 goes stale.

**If #607 is not installed yet** (`docs/box-patches/2026-10-29-one-per-vin-losers/STEPS.md` not run): do that install, but copy this FINAL `onePerVinLosers.js` in place of the one its table lists (its pinned md5 is superseded by this one). **If #607 is installed**, the box file should be the BASE md5 above.

## Gate (before every write and the restart)
1. Sync lock free (read the log, never acquire it): `grep '\[sync-lock\]' ~/.pm2/logs/*deals*out*.log | tail -2` ends with a release.
2. No `inventory-sync|run_nightly_chain|standalone|backfill|unretire|apply` process on box1-box4 (`pgrep -fa`; boxes 1/3/4 via `ssh -J box2 -i ~/.ssh/LightsailDefaultKey-us-east-1.pem ubuntu@<private ip>`).
3. Not inside the nightly crawl+sync window (22:00-06:30 ET). `pm2 describe deals-api` online.

## Install
```bash
# 0. stage
ssh box2 'mkdir -p /opt/trimscout-deals/opvl-budget-stage'
scp scrapers/lightsail-crawler/src/onePerVinLosers.js box2:/opt/trimscout-deals/opvl-budget-stage/
# 1. preconditions + md5s + backup + syntax check
ssh box2 'cd /opt/trimscout-deals/src && ls refreshTimeouts.js && grep -c BACKGROUND_WAIT_MS refreshTimeouts.js     # both must exist; else STOP
md5sum onePerVinLosers.js ../opvl-budget-stage/onePerVinLosers.js     # box = 65db0345… (BASE), stage = 78bc22a08603aa1ae3afdb2b83bb1415 (FINAL); else STOP
S=$(date +%Y%m%d%H%M%S); cp -p onePerVinLosers.js onePerVinLosers.js.bak.opvlbudget.$S && echo "backup suffix opvlbudget.$S"
cp ../opvl-budget-stage/onePerVinLosers.js /tmp/chk.mjs && node --check /tmp/chk.mjs && echo SYNTAX_OK; rm -f /tmp/chk.mjs'
# 2. measure the real statement on the live table first (read-only, reader account, 120 s cap), before installing
ssh box2 'mysql <db>' <<'SQL'      # note the time; > ~100 s means go incremental instead
SET STATEMENT max_statement_time=120 FOR SELECT COUNT(*) FROM (SELECT i.make, i.state, i.model, i.trim FROM dealer_inventory_vin_losers l JOIN dealer_inventory i ON i.vin=l.vin AND i.dealer_id=l.dealer_id WHERE i.removed_at IS NULL AND i.stale_at IS NULL AND (i.cond IS NULL OR i.cond <> 'wholesale') GROUP BY i.make, i.state, i.model, i.trim) x;
SQL
# 3. install (gate re-checked), then ONE plain restart
ssh box2 'cd /opt/trimscout-deals/src && cp ../opvl-budget-stage/onePerVinLosers.js . && md5sum onePerVinLosers.js && pm2 restart deals-api'
```

## Verify (right after the restart; only meaningful with `ONE_PER_VIN_FACETS=1`)
```bash
time curl -s 'http://127.0.0.1:3004/api/inventory/facets?onePerVin=1' | head -c 300     # a cold call returns within ~15 s, either adjusted or (first time only) "onePerVin":false
sleep 120; curl -s 'http://127.0.0.1:3004/api/inventory/facets?onePerVin=1' | head -c 300   # now "onePerVin":true, and cached
pm2 logs deals-api --lines 80 --nostream | grep -i 'duplicate-VIN buckets'                  # none after the first minute
# restart once more: the very first call must already be adjusted (served from facet-cache.json while the refresh runs behind it)
```

## Rollback
`ssh box2 'cd /opt/trimscout-deals/src && cp -p onePerVinLosers.js.bak.opvlbudget.<suffix> onePerVinLosers.js && pm2 restart deals-api'`
