# Box patch: "Reachable by quote request" admin tile (box2 deals API) — code only, NOTHING IS INSTALLED

Install only on Paul's typed GO, in an idle window (not 22:00-23:30 ET; box2's nightly sync finished and the sync lock released). Box2 only, one patched file plus one new file in `/opt/trimscout-deals/src`, one `sudo -u ubuntu pm2 restart deals-api`. No schema or env change. Addresses and paths: `docs/BOXES.md`.

## Why
The admin tile "Sales email on file for X of Y rooftops" counted any non-empty `contact_email` (audit 2026-10-30): `accessibility@hmausa.com` on 111 rooftops, lead-vendor domains, scraped `.png` names and department inboxes all counted. The patch makes the box compute the tile with the SAME function the wizard badge and quote routing run (`quoteReachable.js`, shared with the web app), and returns the new fields the admin page already reads:

| Field | Meaning |
|---|---|
| `coverage.dealersReachable` | rooftops with cars on the lot whose address passes the shared check and who have not unsubscribed |
| `coverage.dealersUnverified` | rooftops with an address we cannot tie to the store (public mail, unrelated domain) |
| `coverage.dealersWithEmail` | kept for older readers; now equals `dealersReachable` |
| `dom.byDealer[].emailStatus` / `.hasEmail` | per rooftop: `reachable` / `unverified` / `none`; `hasEmail` is true only for `reachable` |

Until this is installed the admin page shows the old count under an honest label ("Box has not been updated: this is the old any-text-in-the-field count"), so nothing misleads in the meantime.

## What it adds to the request
One cached query of the directory's addresses (to find group domains: a mail domain two or more rooftops share), and the existing coverage count becomes a per-dealer pass over the in-scope rooftops (about 9.5k) in JS. The directory query is cached with the other inventory caches (`invCached`) and re-run after a bulk upsert. **Not measured on box2** (code only); step 6 times the first call.

## Files (`/opt/trimscout-deals/src`)
Copied from the repo checkout at the install commit: `scrapers/lightsail-crawler/src/quoteReachable.js` (new file, copied whole, md5 in `manifest.txt`). Patched: `deals_api_server.js`, which has two accepted starting files (before and after the sweep-crawl-stamps install, PR #628); pick the patch by the live md5, never by guess.

<!-- MD5S:START -->
```
# md5  role  file   (BASE = box2 live text read-only 2026-10-29, the two accepted starting files of deals_api_server.js; RESULT = after the patch; PATCH = the patch file; FILE = copied whole to the box)
31d527ba8e277ff58e39f73ad1d00295  BASE    deals_api_server.js@before-crawl-stamps
3609a39f07e8caa2d2a9c551c89a19ec  RESULT  deals_api_server.js@before-crawl-stamps
b40e93c8c13de575cae0055be64a04d0  PATCH   deals_api_server.js.patch
400e943b58e972a00fcce92738ead685  BASE    deals_api_server.js@after-crawl-stamps
4f4d81a822d0106e6a4198a8bf7d7100  RESULT  deals_api_server.js@after-crawl-stamps
805378b67044e9727b24d37b1b726840  PATCH   deals_api_server.after-crawl-stamps.js.patch
cff4d09baa921dac3d2cdb23c81d6dea  FILE    quoteReachable.js
```
<!-- MD5S:END -->

The patches stack with `2026-10-29-stats-cache-warm` (same file, different hunks); the install test applies this one to the stats-warm result too. If a live md5 matches none of the BASE values, **stop**: do not hand-edit on the box. Pull the live file, cut a new patch from it in a PR, and re-verify the result md5.

## Steps (Paul's GO)
0. Preconditions: no `run-daily-crawl|run_nightly_chain|standalone|inventory-sync.mjs` process on box1-4, sync lock free (last `[sync-lock]` line in `/home/ubuntu/.pm2/logs/deals-api-out.log` is a `release`).
1. Backup and drift check, read-only on the live file:
```bash
ssh box2 'cd /opt/trimscout-deals/src && md5sum deals_api_server.js && S=$(date +%Y%m%d%H%M%S) && sudo cp -p deals_api_server.js deals_api_server.js.bak.reachtile.$S && echo "backup stamp: $S"'
```
   `deals_api_server.js` must equal one of the two BASE values: `31d527ba…` (use `deals_api_server.js.patch`) or `400e943b…` (use `deals_api_server.after-crawl-stamps.js.patch`). Any other md5: stop. Write down the stamp and which one it was.
2. Patch a COPY, never the live file (`-F0` = no fuzz, so drift fails instead of patching wrongly):
```bash
scp scrapers/lightsail-crawler/src/quoteReachable.js docs/box-patches/2026-10-30-reachable-tile/*.patch box2:/tmp/
# DP: deals_api_server.js.patch when the live md5 is 31d527ba…, deals_api_server.after-crawl-stamps.js.patch when it is 400e943b…
ssh box2 'DP=deals_api_server.js.patch; mkdir -p /tmp/reachtile && cd /tmp/reachtile && cp /opt/trimscout-deals/src/deals_api_server.js . && cp /tmp/quoteReachable.js . && patch -F0 --dry-run deals_api_server.js < /tmp/$DP && patch -F0 -s --no-backup-if-mismatch deals_api_server.js < /tmp/$DP && md5sum deals_api_server.js quoteReachable.js && ls *.rej 2>&1 | head -1'
```
   Expect no `.rej` and the RESULT md5 for your starting file, and the FILE md5 for `quoteReachable.js`.
3. Check the import and the module: `ssh box2 'cd /tmp/reachtile && grep -c "quoteReachable.js" deals_api_server.js && node --check quoteReachable.js && node --input-type=module -e "import(\"/tmp/reachtile/quoteReachable.js\").then(m=>console.log(m.reachabilityBucket({contactEmail:\"accessibility@hmausa.com\"}), m.reachabilityBucket({contactEmail:\"jdoe@gmail.com\"})))"'`. Expect `1`, then `none unverified`. (`node --check` does NOT catch a missing import.)
4. Syntax check the patched server: `ssh box2 'cd /tmp/reachtile && cp deals_api_server.js check.mjs && node --check check.mjs && echo syntax ok'`.
5. Install and restart (only the `ubuntu` PM2 runs deals-api; never a bare `sudo pm2`):
```bash
ssh box2 'cd /tmp/reachtile && sudo install -m 0644 quoteReachable.js /opt/trimscout-deals/src/quoteReachable.js && sudo install -m 0644 deals_api_server.js /opt/trimscout-deals/src/deals_api_server.js && md5sum /opt/trimscout-deals/src/quoteReachable.js /opt/trimscout-deals/src/deals_api_server.js && sudo -u ubuntu pm2 restart deals-api'
```
6. Verify (about 10 s after the restart): `deals-api` online and its restart count unchanged 10 s later; `/health` 401; then one analytics call, timed, e.g. `time curl -s -H "X-Trimscout-Api-Key: $KEY" "http://127.0.0.1:3004/api/inventory/analytics" | python3 -c "import sys,json; c=json.load(sys.stdin)['coverage']; print({k:c[k] for k in ('dealers','dealersReachable','dealersUnverified','dealersWithEmail')})"`. `dealersReachable` should be near the audit's 5,468 of 9,486 (the audit's group-domain threshold was 3, this uses 2, so a little higher). If the call takes more than a few seconds cold, roll back.

## Rollback
```bash
ssh box2 'cd /opt/trimscout-deals/src && sudo cp -p deals_api_server.js.bak.reachtile.<STAMP> deals_api_server.js && sudo rm -f quoteReachable.js && md5sum deals_api_server.js && sudo -u ubuntu pm2 restart deals-api'
```
The md5 must equal the starting md5 written down in step 1. The admin page falls back to its "Box has not been updated" label.

## Not in this package
The contact-write guard in `auth_api_server.js` (refuses department mailboxes, vendor domains and junk on create, update and bulk import) is in the repo mirror and covered by the web app's own guard, but the live auth server's text is not in `docs/box-snapshots/`, so no patch is cut for it here. Install it with its own package cut from the live text, on its own GO.
