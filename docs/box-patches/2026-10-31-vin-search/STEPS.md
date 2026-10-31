# VIN search for /search (box2) — code only, NOTHING IS INSTALLED

Adds `GET /api/inventory/vin-search?suffix=XXXXXX` to box2's `deals_api_server.js` so the `/search` VIN box can find a car by the **last 6-8 characters**. A full 17-character VIN already works against the existing `/api/inventory/vin/:vin`; the web change needs no patch for that. Until this is installed, a suffix search shows "Searching by the last characters isn't available yet — enter the full 17-character VIN."

Cut against box2's live `deals_api_server.js` **md5 `bd11ff778117cd932c2608e1585634d4`** (rebuilt from the 2026-10-29 snapshot + the stats-warm and buyer-contact-reveal patches and checked by md5 in `scripts/box/vin-search-patch.test.mjs`). Written without box access; nothing here was run on the box.

## What it does
* One new handler, one new route line. Nothing else changes; no schema change, no ALTER, no new index.
* Query: `WHERE i.vin_rev LIKE '<reversed suffix>%' AND i.removed_at IS NULL LIMIT 26`, a range scan on the existing `idx_inv_vin_rev` (added by `scripts/box/2026-09-22-inventory-search-prefix-suffix.sh`), so it reads only the rows it returns. Run as `SET STATEMENT max_statement_time=10 FOR …`: a 10 s cap, then an error to the caller.
* The input is validated on the box too (6-8 characters, no I/O/Q), so the route cannot be used for a wider scan.
* Read-only. Removed listings are excluded ("current inventory").

## Gate (before the restart)
Sync lock free, no sync/crawl/backfill process on any box, daytime (not 22:00-06:30 ET), `pm2 describe deals-api` online. Same as `docs/box-patches/2026-10-30-buyer-contact-reveal/STEPS.md`.

## Steps (on Paul's typed GO)
0. Read-only: `ssh box2 'md5sum /opt/trimscout-deals/src/deals_api_server.js'` must print `bd11ff77…`; otherwise STOP. Also `ssh box2 "mysql … -e 'SHOW INDEX FROM dealer_inventory WHERE Key_name=\"idx_inv_vin_rev\"'"` must list the index; otherwise STOP (the suffix query would scan).
1. Backup and dry run on a copy:
   ```bash
   ssh box2 'cp -p /opt/trimscout-deals/src/deals_api_server.js ~/backups/deals_api_server.js.bak.vinsearch && cp /opt/trimscout-deals/src/deals_api_server.js /tmp/dasv.js'
   scp docs/box-patches/2026-10-31-vin-search/deals_api_server.js.patch box2:/tmp/
   ssh box2 'cd /tmp && patch -F0 dasv.js < deals_api_server.js.patch && cp dasv.js dasv.mjs && node --check dasv.mjs && md5sum dasv.js'
   ```
   The result md5 must be `79bc7ca587662d4f5120cd9c4330f209`.
2. Apply: `ssh box2 'cp /tmp/dasv.js /opt/trimscout-deals/src/deals_api_server.js && sudo -u ubuntu pm2 restart deals-api'`.
3. Check: `curl -s -H "X-Trimscout-Api-Key: …" "http://127.0.0.1:3004/api/inventory/vin-search?suffix=<last 6 of a known VIN>"` returns that car and finishes in well under 10 s; `…?suffix=ABC` returns 400.
4. Rollback: `cp ~/backups/deals_api_server.js.bak.vinsearch /opt/trimscout-deals/src/deals_api_server.js && sudo -u ubuntu pm2 restart deals-api`.

## md5s
```
bd11ff778117cd932c2608e1585634d4  BASE    deals_api_server.js (live box2)
79bc7ca587662d4f5120cd9c4330f209  RESULT  deals_api_server.js
```
