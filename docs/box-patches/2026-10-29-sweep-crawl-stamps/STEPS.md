# Box patch: sweep crawl stamps + the real retired list (box2)

Code and docs only. **Nothing is installed and no box was touched.** Install only on Paul's typed **GO**, in an idle window, one numbered step at a time. Box2 is both the deals box (`/opt/trimscout-deals`, MariaDB, pm2 `trimscout-deals-api`) and a crawl box (`~/inventory-sync`). Builds on `docs/box-patches/2026-10-27-sweep-guards/` (already live on box2): it needs the guard fields, `sweep_miss_count` / `sweep_miss_at`, and the probe.

## Why (audit 2026-10-29, read-only)
Box2's 10-28 sync retired 10,544 cars, all of them "second misses". 6,189 came from brands the 10-28 crawl never visited (they are crawled every few nights). Their last crawl output (`updatedAt` 10-28 ~09:00 UTC) was still inside the sync's 30 h freshness window on 10-29 08:27 UTC, so two syncs in a row swept the **same** observation: the 10-27 sync counted miss 1, the 10-28 sync counted "miss 2" and retired. `minMisses 2` counted runs, not crawls. Separately, `~/sweep-retired/retired-*.csv.gz` was a prediction written before the sweep (17,155 rows against 10,544 retirements), so it could not be used to roll anything back.

## What changes
| | Where | Behaviour |
|---|---|---|
| Crawl stamps | sync client + deals API (`inventorySweep.js`) | The sync sends `crawlStamps` (store id -> newest crawl record time among the store's uploaded rows). The API keeps one stamp per store in a new table `sweep_crawl_stamps` and sweeps a store only when its stamp is **newer** than the stored one. Newer: normal sweep (count a miss, retire a row whose previous miss was counted). No stored stamp (first sight): counts a new streak, **retires nothing, advances nothing**. Not newer, or no stamp sent: the store is untouched (no miss counted, nothing retired). A store skipped by the partial-crawl guard or left out by the client records nothing. |
| Real retired list | same | The sweep request carries `returnRetired`; the API stamps `removed_at` with a request-wide whole-second time and reads those rows back (vin, dealerId, dealer, state, last_seen_at, sweep_miss_count; max 20,000 per call). The sync writes them as `retired-*.csv.gz` (the four old columns first, then `dealerId,lastSeenAt,missCount`) and the old prediction as `candidates-*.csv.gz`. Against an API that does not report rows, no retired file is written. |

Both are opt-in per request. A client without the new fields gets byte-for-byte the old statements and responses. The new client's probe stops the sweep before anything is swept if the API does not acknowledge stamps (`SWEEP_CRAWL_STAMPS=0` turns stamps off on purpose).

### Known consequences (decide before GO)
- **The first sync after step 5 retires nothing on box2**: every store is "first sight" (counted only). From the second sync on, a store is swept only if a brand job re-crawled it since. Sold cars of a rotation brand stay listed until that brand's next crawl: up to a few days longer than today. This is the point of the change.
- A store whose brand is not re-crawled shows in the log as `no new crawl` (first 20 named) and keeps its rows.
- Boxes 1, 3 and 4 do not run the sweep guards at all (checked read-only 2026-10-29: no `syncSweepGuard.js`, no `sweep guards acknowledged`); they still retire on the first miss. This package does not change that.
- `~/sweep-retired/retired-*` from before the install are predictions (no `dealerId` column); the new ones are real. The "came back" count reads `retired-*` only, so it will read low for a week while old files age out.

## Files
The md5s are in `manifest.txt` (`scripts/box/sweep-guards-install.test.mjs` fails CI if a FINAL line is stale).
`BASE` = the file on box2 now (read-only 2026-10-29), which equals `origin/main` before this PR; `FINAL` = the repo file at this PR's head. `deals_api_server.js` and `inventory-sync.mjs` are patched in place with patches cut from **box2's own text** (`BOXBASE` -> `BOXFINAL`); the other five files are replaced whole.

Stage from a clean checkout of `main` at the merge commit (copies to `/tmp` on box2, changes nothing else; run from the repo root):
```bash
ssh box2 'rm -rf /tmp/sweep-crawl-stamps-stage && mkdir -p /tmp/sweep-crawl-stamps-stage'
scp docs/box-patches/2026-10-29-sweep-crawl-stamps/* scrapers/lightsail-crawler/src/inventorySweep.js scripts/box/syncRun.js scripts/box/syncSweep.js scripts/box/syncSweepGuard.js scripts/box/syncRetired.js box2:/tmp/sweep-crawl-stamps-stage/
ssh box2 'cd /tmp/sweep-crawl-stamps-stage && md5sum inventorySweep.js syncRun.js syncSweep.js syncSweepGuard.js syncRetired.js && grep FINAL manifest.txt'   # the five md5s must equal the FINAL lines
```

## Steps

### 0. Read-only drift check (changes nothing)
```bash
ssh box2 'bash /tmp/sweep-crawl-stamps-stage/drift-check.sh /tmp/sweep-crawl-stamps-stage'
```
Must end `DRIFT CHECK PASS`. Any `FAIL`: stop and send Paul the output. Idle window: box2's crawl starts 22:00 ET and the sync wrapper (`run_sync_when_safe.sh`, cron 22:10 box time) waits for it; install between the end of a sync (~09:00 ET) and ~21:30 ET. Also confirm no other box's sync holds the lock: `grep '\[sync-lock\]' ~/.pm2/logs/*deals*out*.log | tail -2` must end with a release.

### 1. Backups (before anything is written)
```bash
ssh box2 'B=~/backups/sweep-crawl-stamps-$(date +%Y%m%d); mkdir -p $B/server $B/client && cp -p /opt/trimscout-deals/src/inventorySweep.js /opt/trimscout-deals/src/deals_api_server.js $B/server/ && cp -p ~/inventory-sync/inventory-sync.mjs ~/inventory-sync/syncRun.js ~/inventory-sync/syncSweep.js ~/inventory-sync/syncSweepGuard.js ~/inventory-sync/syncRetired.js $B/client/ && cp -p ~/inventory-sync/.env $B/client/.env && (cd $B && md5sum server/* client/* | tee md5s-before.txt)'
```
Keep `md5s-before.txt`: a rollback must reproduce these exact values.

### 2. Deals API files (not live until step 3)
```bash
ssh box2 'cd /opt/trimscout-deals/src && cp /tmp/sweep-crawl-stamps-stage/inventorySweep.js inventorySweep.js && patch -F0 deals_api_server.js < /tmp/sweep-crawl-stamps-stage/deals_api_server.js.patch && md5sum inventorySweep.js deals_api_server.js && node --check deals_api_server.js && node --check inventorySweep.js && echo SYNTAX-OK'
```
`inventorySweep.js` must equal its FINAL line and `deals_api_server.js` its `BOXFINAL` line; any `FAILED`/`Hunk` message or a syntax error: restore both from the backup and stop.

### 3. Restart the deals API (idle only)
Before: `sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"` shows nothing long (a restart ALTER hangs behind long SELECTs), and no sync holds the lock.
```bash
ssh box2 'pm2 restart trimscout-deals-api && sleep 5 && pm2 logs trimscout-deals-api --lines 15 --nostream | tail -15'
```
Then probe with a store id that exists nowhere (these sweep nothing; the key is read from the env file inside the one ssh command and never printed):
```bash
ssh box2 'set -a; . /opt/trimscout-deals/.env.trimscout-db; set +a
post() { curl -s -m 30 -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" -H "Content-Type: application/json" -X POST http://localhost:3004/api/inventory/sweep -d "$1"; echo; }
post "{\"dealerId\":-1,\"seenAfter\":\"1970-01-01T00:00:00Z\"}"
post "{\"dealerId\":-1,\"seenAfter\":\"1970-01-01T00:00:00Z\",\"minMisses\":2,\"protectElsewhere\":true}"
post "{\"dealerId\":-1,\"seenAfter\":\"1970-01-01T00:00:00Z\",\"minMisses\":2,\"protectElsewhere\":true,\"crawlStamps\":{},\"returnRetired\":true}"'
```
Expect `{"removed":0}`, then `{"removed":0,"counted":0,"skipped":[]}`, then `{"removed":0,"counted":0,"skipped":[],"retired":[],"stamps":{"swept":[],"countOnly":[],"unchanged":[],"noStamp":[]}}`. The third creates the table: `sudo mysql trimscout -e "SHOW CREATE TABLE sweep_crawl_stamps\G"` must show `dealer_id`, `crawl_stamp`, `swept_at` with `dealer_id` as the primary key. If the `CREATE TABLE` is refused (privileges) the third answer is a 500: stop, nothing else changed; the old client keeps working.

### 4. Query plans (read-only EXPLAIN; changes nothing)
```bash
ssh box2 'sudo mysql trimscout -e "EXPLAIN SELECT vin, dealer_id, dealer_name, state, last_seen_at, sweep_miss_count FROM dealer_inventory WHERE dealer_id IN (13516, 13515, 12122) AND removed_at = \"2026-10-29 05:44:44\" AND last_seen_at < \"2026-10-29 04:00:00\" LIMIT 20001\G"'
```
Pass = `range`/`ref` on `idx_inv_stock_dealer_id` (removed_at, dealer_id), not `ALL`. If it scans the table, stop and tell Paul: the read-back would be slow and step 5 must not run.

### 5. Sync client on box2 (not yet run)
```bash
ssh box2 'cd ~/inventory-sync && cp /tmp/sweep-crawl-stamps-stage/syncRun.js /tmp/sweep-crawl-stamps-stage/syncSweep.js /tmp/sweep-crawl-stamps-stage/syncSweepGuard.js /tmp/sweep-crawl-stamps-stage/syncRetired.js . && patch -F0 inventory-sync.mjs < /tmp/sweep-crawl-stamps-stage/inventory-sync.mjs.patch && md5sum inventory-sync.mjs syncRun.js syncSweep.js syncSweepGuard.js syncRetired.js && for f in inventory-sync.mjs syncRun.js syncSweep.js syncSweepGuard.js syncRetired.js; do node --check $f || echo "SYNTAX FAILED $f"; done'
```
Each md5 must equal its FINAL / BOXFINAL line. Any `FAILED` or syntax error: restore the five files from `$B/client` and stop. If a temporary `SWEEP_MIN_MISSES=3` line is in `~/inventory-sync/.env` (an interim switch), remove it now: crawl stamps replace it.

### 6. What to check after the first real sync (next morning, `~/inventory-sync/logs/sync-<date>.log`)
- `[sync] sweep guards acknowledged by the deals API: {...} (+ crawl stamps)` at the start of the sweep. If the sync stops with `does not acknowledge crawl stamps`, steps 2/3 did not take effect; nothing was swept.
- `[sync] crawl stamps: N store(s) had a newer crawl ..., M seen for the first time (counted, nothing retired), K had no new crawl ...`. **Night 1: almost every store is "seen for the first time" and `removed` is about 0.** From night 2, `no new crawl` names the stores that were not re-crawled.
- `[sync] retired list: X VIN(s) retired by the sweep (X reported removed)`: the two numbers must match (INCOMPLETE/TRUNCATED notes say why not). `zcat ~/sweep-retired/retired-*-box2.csv.gz | head -2` has the 7-column header.
- `SELECT COUNT(*) FROM sweep_crawl_stamps` is about the number of swept stores (a few thousand) after night 1.

### 7. Rollback (client and server independently; restore, check md5, restart)
Client (takes effect at the next sync):
```bash
ssh box2 'B=$(ls -dt ~/backups/sweep-crawl-stamps-* | head -1); cp -p $B/client/inventory-sync.mjs $B/client/syncRun.js $B/client/syncSweep.js $B/client/syncSweepGuard.js $B/client/syncRetired.js ~/inventory-sync/ && cd ~/inventory-sync && md5sum inventory-sync.mjs syncRun.js syncSweep.js syncSweepGuard.js syncRetired.js && grep -E "client/" $B/md5s-before.txt'
```
Server (the old client form is unchanged either way; a new client against the old server stops at its probe without sweeping):
```bash
ssh box2 'B=$(ls -dt ~/backups/sweep-crawl-stamps-* | head -1); cp -p $B/server/inventorySweep.js $B/server/deals_api_server.js /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && md5sum inventorySweep.js deals_api_server.js && grep -E "server/" $B/md5s-before.txt && pm2 restart trimscout-deals-api'
```
The table can stay (nothing reads it without stamps); to drop it: `DROP TABLE IF EXISTS sweep_crawl_stamps` (the next install starts from "first sight" again). Switch without touching code: `SWEEP_CRAWL_STAMPS=0` in `~/inventory-sync/.env` (the wrapper `run_sync_when_safe.sh` sources it with `set -a` just before starting the sync), which sweeps with the counted-misses rule only.

## Interim switch for a night when this is not installed: `SWEEP_MIN_MISSES=3`
`~/inventory-sync/.env` is sourced with `set -a` immediately before `node inventory-sync.mjs` starts, so a line added any time before the sync starts takes effect for that sync. With 3 misses a car is retired on its **third** sweep, and one crawl output can be swept at most twice (the 30 h freshness window is shorter than two sync intervals plus the crawl-to-sync gap), so no retirement can rest on a single crawl. Cost: every car that really sold stays listed one sweep longer; for a rotation brand that is until its next crawl. Cars already at miss 1 move to miss 2 on the first sync and are retired on the next sweep of a store that was re-crawled. It does not touch boxes 1/3/4, which have no guards. Remove the line when this package is installed.

## What was not verified
The SQL runs through a model of the table in `scrapers/lightsail-crawler/test/sweepGuards.test.js` (including a mutation check that the regression test fails without the stamp rule), not against MariaDB. Steps 3 and 4 are the real-database check: the `INSERT ... VALUES ? ON DUPLICATE KEY UPDATE ... GREATEST`, the `CREATE TABLE IF NOT EXISTS` privilege, and `removed_at = ?` with a `Date` under the pool's timezone setting have not run against box2's MariaDB.
