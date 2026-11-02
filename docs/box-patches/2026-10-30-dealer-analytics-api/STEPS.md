# Dealer Analytics read endpoints on the deals API (box2) — code only, NOTHING IS INSTALLED

Install only on Paul's typed GO, in an idle window (not 22:00-23:30 ET; box2's nightly sync finished and the sync lock free). Box2 only. One new file and one patched file in `/opt/trimscout-deals/src` (`dealerAnalyticsApi.js`, `deals_api_server.js`), one `sudo -u ubuntu pm2 restart deals-api`. No schema change and no env change. Do it **after** the nightly job's tables exist and a run has finished (docs/DEALER_ANALYTICS_NIGHTLY.md); before that the endpoints answer 503 "not built yet", which is safe but useless.

## What it adds
`GET /api/inventory/dealer-analytics/dealers`, `/dealers/:id`, `/dealers/:id/market` (read-only, behind the same API key as every /api/inventory/* route; scoped audit keys are default-denied). A **dedicated** stable cache instance (`dealerAnalyticsCached`, 400 entries, 30 min, persisted to `/opt/trimscout-deals/dealer-analytics-cache.json`, created on first use) so per-dealer keys cannot evict the buyer dropdown entries in `facet-cache.json`; keys carry the finished run's identity, so a new nightly run is served at once. Statements run under `SET STATEMENT max_statement_time=8`.

## The patch is cut against box2's live text (2026-10-30), not repo main
Box2's live `deals_api_server.js` differs from main (it has imports main does not), so the patch is cut from a read-only copy of the live file (`docs/box-snapshots/2026-10-30-box2-deals-api/`) and applies with no fuzz and no hand edit on the box. It has 3 hunks: the import, the cache + handler block just above `// GET /api/inventory/by-dealer`, and the route line just above the `/api/inventory/by-dealer` route. It relies on identifiers the live file already defines: `createStableCache`, `runBackground`, `waitMs`, `withPoolTimeout`, `getPool`, `sendJson`.

| File | Applies to (box2 `src/`) | BASE md5 | Result md5 | File md5 |
|---|---|---|---|---|
| `deals_api_server.js.patch` | `deals_api_server.js` | `bd11ff778117cd932c2608e1585634d4` | `4b695d7d4297e728033b37ffdc59a09f` | `c59a0e988cf51fae85c3eb8a9c162894` |
| `dealerAnalyticsApi.js` (new, copied from `scrapers/lightsail-crawler/src/`) | — | — | — | `2fd7eb4f33118c116cbdb86fba94cc5f` |

If the live `deals_api_server.js` is not `bd11ff77...` (another package was installed since), **stop**: do not hand-edit on the box. Pull the live file, cut a new patch from it in a PR, re-verify the result md5.

## Steps (Paul's GO)
0. Preconditions: no `run-daily-crawl|run_nightly_chain|standalone|inventory-sync.mjs` process on box1-4, sync lock free (last `[sync-lock]` line in `/home/ubuntu/.pm2/logs/deals-api-out.log` is a `release`), and `SELECT COUNT(*) FROM dealer_analytics_runs WHERE status='ok'` is at least 1.
1. Backup and drift check, read-only on the live file:
```bash
ssh box2 'cd /opt/trimscout-deals/src && md5sum deals_api_server.js && S=$(date +%Y%m%d%H%M%S) && sudo cp -p deals_api_server.js deals_api_server.js.bak.dealeranalytics.$S && echo "backup stamp: $S"'
```
   The md5 must equal the BASE above. Write down the stamp.
2. Patch a COPY, never the live file (`-F0` = no fuzz, so drift fails instead of patching wrongly):
```bash
scp docs/box-patches/2026-10-30-dealer-analytics-api/deals_api_server.js.patch scrapers/lightsail-crawler/src/dealerAnalyticsApi.js box2:/tmp/
ssh box2 'mkdir -p /tmp/dealeranalytics && cd /tmp/dealeranalytics && cp /opt/trimscout-deals/src/deals_api_server.js . && cp /tmp/dealerAnalyticsApi.js . && patch -F0 --dry-run deals_api_server.js < /tmp/deals_api_server.js.patch && patch -F0 -s --no-backup-if-mismatch deals_api_server.js < /tmp/deals_api_server.js.patch && md5sum deals_api_server.js dealerAnalyticsApi.js && ls *.rej 2>&1 | head -1'
```
   Expect no `.rej`, `deals_api_server.js` = `4b695d7d...` and `dealerAnalyticsApi.js` = `2fd7eb4f33118c116cbdb86fba94cc5f`.
3. **Check the import after patching** (`node --check` does NOT catch a missing import):
```bash
ssh box2 'cd /tmp/dealeranalytics && grep -c "dealerAnalyticsApi.js" deals_api_server.js && grep -c "matchDealerAnalyticsRoute" deals_api_server.js && grep -c "dealerAnalyticsCached" deals_api_server.js && node --check deals_api_server.js && node --check dealerAnalyticsApi.js && echo syntax ok'
```
   Counts must be 1, 2 and 2.
4. Install the checked copies and restart (only the `ubuntu` PM2 runs deals-api; never `sudo pm2` bare):
```bash
ssh box2 'cd /tmp/dealeranalytics && sudo install -m 0644 dealerAnalyticsApi.js /opt/trimscout-deals/src/dealerAnalyticsApi.js && sudo install -m 0644 deals_api_server.js /opt/trimscout-deals/src/deals_api_server.js && md5sum /opt/trimscout-deals/src/dealerAnalyticsApi.js /opt/trimscout-deals/src/deals_api_server.js && sudo -u ubuntu pm2 restart deals-api'
```
5. Verify (about 10 s after the restart): `deals-api` online with an unchanged restart count, `/health` 200, and with the API key from `~/inventory-sync/.env`: `curl -s -H "X-Trimscout-Api-Key: ..." http://127.0.0.1:3004/api/inventory/dealer-analytics/dealers | head -c 600` returns `"dealers":[...]` (or the 503 "not built yet" message if no run has finished); `/dealers/2187` and `/dealers/2187/market` answer in under 10 s cold. Time each with `curl -w '%{time_total}'`. Clean up `/tmp/dealeranalytics` and the two files in `/tmp`.

## Rollback
```bash
ssh box2 'cd /opt/trimscout-deals/src && sudo cp -p deals_api_server.js.bak.dealeranalytics.<STAMP> deals_api_server.js && md5sum deals_api_server.js && sudo -u ubuntu pm2 restart deals-api'
```
The md5 must equal the BASE. `dealerAnalyticsApi.js` can stay (nothing imports it) and `dealer-analytics-cache.json` can be deleted.
