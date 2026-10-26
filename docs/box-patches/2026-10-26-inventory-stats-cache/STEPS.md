# Box patch: `/api/inventory/stats` served from `statsCached`, queries guarded (box2)

Code and docs only. **Nothing installed, no box touched.** Install only on Paul's separate typed GO, in an idle window (no sync, no crawl push). One file changes: `/opt/trimscout-deals/src/deals_api_server.js` on box2 (`52.202.234.65`, pm2 `trimscout-deals-api`; not a git checkout). Needs a pm2 restart; the cache file `stats-cache.json` is created on first request.

## Why
`invCached` is cleared by every bulk upsert/sweep, so after the nightly sync the first `/stats` requests rescan the whole table and time out. `statsCached` is write-proof stale-while-revalidate (30 min). The five queries also get `SET STATEMENT max_statement_time` + `withPoolTimeout`, as `/makes` has. Nothing else reads the `"stats"` key of `invCache` (only the handler did). Known tradeoff: `statsCached` keeps 40 entries and drops the oldest-inserted, so many filtered analytics keys can evict `"stats"` once; it then recomputes.

## box2 has drifted: check first (read-only)
`patch.py` anchors on exact text and writes nothing unless every anchor matches once (handler line, function signature, `statsCached`, `withPoolTimeout`, `statementSeconds`/`waitMs` definitions, five bare `pool.query("` calls). If box2 lacks `statsCached` (older than #443), the patch refuses: stop and report.

## Steps
0. **Read-only drift check** (the one to run now if wanted; changes nothing):
```bash
KEY=~/.ssh/trimscout_box_2026; H=ubuntu@52.202.234.65; P=docs/box-patches/2026-10-26-inventory-stats-cache
ssh -i $KEY $H 'cat > /tmp/stats-drift.sh' < $P/drift-check.sh && ssh -i $KEY $H 'bash /tmp/stats-drift.sh /opt/trimscout-deals/src/deals_api_server.js'
```
   Must end `DRIFT CHECK PASS`, including `ok   handler line (1)` = the live file still has the `invCached("stats"` line. Record the md5 it prints as BEFORE. Idle check: `pgrep -fa "inventory-sync|run_nightly_chain|standalone" | grep -v pgrep` empty.
1. **Stage + md5 the patcher** (writes only /tmp): `scp -i $KEY $P/patch.py $H:/tmp/` ; expect `md5sum /tmp/patch.py` = `976f22c2f70baf47ad1c48870cde9452`.
2. **Dry run**: `ssh -i $KEY $H 'python3 /tmp/patch.py /opt/trimscout-deals/src/deals_api_server.js --dry-run'` → `dry run OK`.
3. **Backup**:
```bash
ssh -i $KEY $H 'B=~/backups/stats-cache-20261026; mkdir -p $B; cp -p /opt/trimscout-deals/src/deals_api_server.js $B/; md5sum $B/deals_api_server.js | tee $B/md5s.txt'
```
4. **Apply + verify**:
```bash
ssh -i $KEY $H 'cd /opt/trimscout-deals/src && python3 /tmp/patch.py deals_api_server.js && md5sum deals_api_server.js && cp deals_api_server.js /tmp/chk.mjs && node --check /tmp/chk.mjs && echo SYNTAX_OK; rm -f /tmp/chk.mjs; grep -c "statsCached(\"stats\"" deals_api_server.js; grep -c "invCached(\"stats\"" deals_api_server.js'
```
   Expect SYNTAX_OK, then `1` and `0`.
5. **Restart** (idle only): `ssh -i $KEY $H 'pm2 restart trimscout-deals-api'`, then `curl -s -m 60 localhost:<port>/api/inventory/stats | head -c 200` twice (second must be instant) and `pm2 logs trimscout-deals-api --lines 30 --nostream`.
6. **Rollback** (one line, then pm2 restart):
```bash
ssh -i $KEY $H 'cp -p ~/backups/stats-cache-20261026/deals_api_server.js /opt/trimscout-deals/src/ && md5sum /opt/trimscout-deals/src/deals_api_server.js && pm2 restart trimscout-deals-api'   # md5 must equal BEFORE from step 0
```
