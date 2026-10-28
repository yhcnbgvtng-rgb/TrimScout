# One-per-VIN facets from incremental loser bucket counts (box2) — code only, NOTHING IS INSTALLED

Install in a **daytime** window on Paul's typed GO, one numbered step at a time. Box2 only (`ssh box2`; `docs/BOXES.md`). Written without box access: nothing below was measured on the box. Every statement the new code issues is capped at 10 s, and every runnable step has a stop rule.

## Why
The facets subtract the duplicate-VIN losers with one `GROUP BY make, state, model, trim` over the losers table (605,072 rows) joined to `dealer_inventory`. On box2 that statement does not finish inside the 120 s background budget (measured 2026-10-27 20:45 ET: interrupted at 120.0 s), so after any cache clear, rebuild or restart the facets fall back to undeduped counts (Ford 359,645 instead of ~286k). #613 only fixed the *cold wait*; the statement itself is the problem.

## What changes
New small table `dealer_inventory_vin_loser_buckets` (`shard`, `make`, `state`, `model`, `trim`, `seen_on`, `n`), kept exact **per shard** (a shard = the first 8 characters of the VIN):

* The sync upsert hook and the post-sweep reconcile (`refreshVinLosers`, `reconcileLosers`) already re-decide VINs. With `ONE_PER_VIN_BUCKETS=1` they now also recompute the shards of those VINs: for up to 25 shards a statement, read the aggregate of the visible losers (losers table ⨝ `dealer_inventory` by primary key, `LIKE 'XXXXXXXX%'` prefix ranges, **no locks**), then in one small transaction `DELETE` the group's rows and `INSERT` the new ones. Exact, never arithmetic deltas: a failed recompute leaves a shard stale until one of its VINs is touched again (the next nightly sync, or the next reconcile). A bucket failure never undoes or hides the losers write; it is logged.
* The facet read (`facetsOnePerVin`, all stores) reads `SELECT … SUM(n) … GROUP BY make, state, model, trim` from the buckets table (no join, no losers table) **only when** `ONE_PER_VIN_BUCKETS=1` **and** the `buckets_ready` marker is in `dealer_inventory_vin_loser_meta`. Otherwise it runs the old losers-table GROUP BY unchanged. A contact-set read (`dealerIds`) is unchanged.
* The seen-window is a DATE dimension (`seen_on >= CURDATE() - days`). The base facet lists use the exact time (`last_seen_at >= NOW() - days`), so the one boundary day can differ by that day's losers (a few). Accepted.
* One-time backfill / verify / ready script: `scripts/box/2026-10-31-loser-buckets.mjs` (phases below). It writes only the two new small tables, never `dealer_inventory`, never the losers table, never takes the sync lock.
* **Not changed:** `deals_api_server.js` (the flag is read inside the module), the schema of `dealer_inventory` and of the losers table, the list/count predicate. No ALTER anywhere.

<!-- MD5S:START -->
```
5c98573aa3d08773c3bac8e0bd38d350  FINAL  onePerVinLosers.js
fe523fedd25f112ee0e39cb7b2edcbda  FINAL  2026-10-31-loser-buckets.mjs
```
<!-- MD5S:END -->
`onePerVinLosers.js` BASE on the box is either `65db034542a7b50e36714ab88db42123` (main after #607) or `78bc22a08603aa1ae3afdb2b83bb1415` (#613, if it was installed since). Anything else: STOP and send the file back.

## Gate (before every write and the restart)
1. Sync lock free (read the log, never acquire it): `grep '\[sync-lock\]' ~/.pm2/logs/*deals*out*.log | tail -2` ends with a release.
2. No `inventory-sync|run_nightly_chain|run_sync|standalone|backfill|unretire|apply|oem-trim` process on box1-box4 (`pgrep -fa`; boxes 1/3/4 via `ssh -J box2 -i ~/.ssh/LightsailDefaultKey-us-east-1.pem ubuntu@<private ip>`).
3. Daytime: not inside the nightly crawl+sync window (22:00-06:30 ET). `pm2 describe deals-api` online. Stop and report if any of this is false.

## Steps

**0. Read-only precondition check (no writes).**
```bash
ssh box2 'cd /opt/trimscout-deals/src && md5sum onePerVinLosers.js && grep -c "facetsOnePerVin\|createLoserMaintenance" deals_api_server.js'
ssh box2 'pm2 env 0 2>/dev/null | grep -E "ONE_PER_VIN|STALE_HIDE" ; true'
```
* The `grep -c` must be ≥ 2. If it is 0, the one-per-VIN facet hooks are **not installed on the box**: do `docs/box-patches/2026-10-29-one-per-vin-losers/STEPS.md` first (it has its own gate and restart), then come back. Report which case it is before going on.
* Note which `ONE_PER_VIN_*` flags are set now (they must be kept: the restart below is a plain `pm2 restart`, not a re-created process).
* The losers table held 605,072 rows on 2026-10-27. The buckets are only as right as the losers table; step 6 compares the two, and the hooks keep the losers table current once `ONE_PER_VIN_LOSERS=maintain` is set (it must be, per the flag list above; if it is not, set it in step 4 and run `docs/box-patches/2026-10-29-one-per-vin-losers` `--phase=dry` / `run` first).

**1. Backup and stage (no live file replaced yet; a self-contained copy of the code is staged beside the app).**
```bash
ssh box2 'D=~/backups/loser-buckets-$(date +%Y%m%d); mkdir -p $D && cp -p /opt/trimscout-deals/src/onePerVinLosers.js $D/ && echo backed-up-to $D'
ssh box2 'S=/opt/trimscout-deals/loser-buckets-stage; mkdir -p $S/scripts/box $S/scrapers/lightsail-crawler/src && cd /opt/trimscout-deals/src && cp retailFacets.js onePerVin.js refreshTimeouts.js $S/scrapers/lightsail-crawler/src/'
scp scrapers/lightsail-crawler/src/onePerVinLosers.js box2:/opt/trimscout-deals/loser-buckets-stage/scrapers/lightsail-crawler/src/
scp scripts/box/2026-10-31-loser-buckets.mjs box2:/opt/trimscout-deals/loser-buckets-stage/scripts/box/
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && md5sum scrapers/lightsail-crawler/src/onePerVinLosers.js scripts/box/2026-10-31-loser-buckets.mjs'   # must equal the FINAL md5s above, else STOP
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && node --check scrapers/lightsail-crawler/src/onePerVinLosers.js && node --check scripts/box/2026-10-31-loser-buckets.mjs && echo SYNTAX_OK'
```
The script resolves `mysql2` from `/opt/trimscout-deals/node_modules` (the stage dir sits inside it) and the DB credentials from `/opt/trimscout-deals/.env.trimscout-db` (its default `--env`). **Run every script command below from `/opt/trimscout-deals/loser-buckets-stage`** (`cd` there first). Its module copy is the new one, so the script works before the live module is replaced in step 4. If `retailFacets.js` / `onePerVin.js` / `refreshTimeouts.js` are missing in `src/` or fail `node --check`, STOP.

**2. Create the two tables (writer; empty tables, nothing reads them yet).**
```bash
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && node scripts/box/2026-10-31-loser-buckets.mjs --phase=create'
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && node scripts/box/2026-10-31-loser-buckets.mjs --phase=explain'
```
Read the EXPLAIN: the shard aggregate must show the losers table `range` on `PRIMARY` and `dealer_inventory` `eq_ref` on `PRIMARY`; the facet read must be a scan of the small buckets table only. Anything else: STOP.

**3. Dry run (read-only, every statement stopped at 10 s).**
```bash
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && node scripts/box/2026-10-31-loser-buckets.mjs --phase=dry --page-shards=100 2>&1 | tail -5'
```
Reports shards visited and aggregate rows it would write, and how long it took (the whole backfill is about this long plus the write time). If any statement hits the 10 s stop, or the run would clearly not fit the window: STOP, leave it.

**4. Install the module and switch the flag on (needs Paul's GO; ONE plain restart).** Gate re-checked. Add `ONE_PER_VIN_BUCKETS=1` to the box's existing process environment *the same way the other `ONE_PER_VIN_*` flags are set* (do not recreate the process), keep all the flags noted in step 0, then:
```bash
ssh box2 'cd /opt/trimscout-deals && cp loser-buckets-stage/scrapers/lightsail-crawler/src/onePerVinLosers.js src/onePerVinLosers.js && md5sum src/onePerVinLosers.js && pm2 restart deals-api --update-env && pm2 save'
ssh box2 'sleep 5; curl -s -m 10 http://127.0.0.1:3004/health'
```
From this restart on, the sync hook and the reconcile maintain the buckets for every VIN they touch; the facets still read the old way, because the `buckets_ready` marker is not set.

**5. Backfill (writer; resumable; hard stop; first error stops it).**
```bash
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && nohup node scripts/box/2026-10-31-loser-buckets.mjs --phase=run --state=/opt/trimscout-deals/loser-buckets.state --deadline-et=17:30 > ~/backups/loser-buckets-run.log 2>&1 &'
ssh box2 'tail -3 ~/backups/loser-buckets-run.log'      # watch; do not poll tighter than every few minutes
```
Re-run the same command after any stop (it resumes from `--state`). A run that stopped on an error leaves the shards done so far exact; read the error line, do not retry blindly.

**6. Verify, then mark ready (writer, one row).**
```bash
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && node scripts/box/2026-10-31-loser-buckets.mjs --phase=verify --sample=300'
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && node scripts/box/2026-10-31-loser-buckets.mjs --phase=status'
ssh box2 'cd /opt/trimscout-deals/loser-buckets-stage && node scripts/box/2026-10-31-loser-buckets.mjs --phase=ready --sample=300'
```
`ready` refuses unless 300 random shards match exactly and the bucket total is within 0.5% of the stored loser rows.

**7. Check the facets (no restart needed; the marker is read on the next facet refresh).** Clear nothing by hand. Force a fresh read the way a restart would: wait for the facet cache TTL, or `pm2 restart deals-api` once more *only on Paul's GO*.
```bash
K=$(grep -h "^TRIMSCOUT_API_KEY=" ~/inventory-sync/.env | head -1 | cut -d= -f2- | tr -d "\"'")
time curl -s -m 60 -H "X-Trimscout-Api-Key: $K" 'http://127.0.0.1:3004/api/inventory/facets?onePerVin=1' | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('onePerVin'),[m for m in d['makes'] if m['make']=='Ford'])"
```
Expect `onePerVin: true` and Ford ≈ 286k, returned in seconds. `pm2 logs deals-api --lines 80 --nostream | grep -i 'duplicate-VIN buckets\|bucket recompute'` should show nothing after the first minute.

## Rollback
* **Facets back to the old read, no restart:** `node scripts/box/2026-10-31-loser-buckets.mjs --phase=ready --unready` (deletes the marker; the next facet refresh reads the losers-table GROUP BY again). Takes effect on the next cache refresh.
* **Module and flag:** restore `~/backups/loser-buckets-<date>/onePerVinLosers.js` to `src/`, remove `ONE_PER_VIN_BUCKETS` from the process environment, `pm2 restart deals-api --update-env`, `pm2 save`.
* The two new tables can stay (nothing reads them without the flag): `DROP TABLE dealer_inventory_vin_loser_buckets, dealer_inventory_vin_loser_meta;` only if Paul asks.

## Not in this change
* The seen-window boundary day (above) and the staleness between a sweep and the next reconcile (≤ the 15 min reconcile debounce) are accepted approximations; the reconcile/verify keep the table exact.
* The losers table's own maintenance (hooks and `refreshVinLosers`) is unchanged; only its shards are recomputed after it.
