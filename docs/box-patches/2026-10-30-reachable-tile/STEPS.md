# Box patch: "Reachable by quote request" admin tile (box2 deals API) — code only, NOTHING IS INSTALLED

Re-cut 2026-10-30 against box2's live `deals_api_server.js`, md5 `bd11ff77…` (the file after the buyer-contact-reveal install, PR #643). Install only on Paul's typed GO, on **box2** (`ssh box2`; `docs/BOXES.md`), in an idle window (not 22:00-23:30 ET): sync lock free and no sync/crawl process running. One patched file plus one new file in `/opt/trimscout-deals/src`, one `sudo -u ubuntu pm2 restart deals-api`. No schema or env change.

## Why
The admin tile "Sales email on file for X of Y rooftops" counted any non-empty `contact_email` (audit 2026-10-30): `accessibility@hmausa.com` on 111 rooftops, lead-vendor domains, scraped `.png` names and department inboxes all counted. The patch makes the box compute the tile with the SAME function the wizard badge, /search Contact column and quote routing run (`quoteReachable.js`, shared with the web app: `isQuoteReachable` / `reachabilityBucket`):

| Field | Meaning |
|---|---|
| `coverage.dealersReachable` | rooftops with cars on the lot whose address passes the shared check and who have not unsubscribed |
| `coverage.dealersUnverified` | rooftops with an address we cannot tie to the store (public mail, unrelated domain), shown as "Unverified email", never as on file |
| `coverage.dealersWithEmail` | kept for older readers; now equals `dealersReachable` |
| `dom.byDealer[].emailStatus` / `.hasEmail` | per rooftop: `reachable` / `unverified` / `none`; `hasEmail` is true only for `reachable` |

Until this is installed the admin page shows the old count under an honest label, so nothing misleads in the meantime.

## Files (`/opt/trimscout-deals/src`)
| File | Before (must be exactly) | After |
|---|---|---|
| `quoteReachable.js` | absent | `cff4d09baa921dac3d2cdb23c81d6dea` (new: `files/`, the repo's `scrapers/lightsail-crawler/src/quoteReachable.js`) |
| `deals_api_server.js` | `bd11ff778117cd932c2608e1585634d4` | `5ce745d698cc19bcdf9809e8982304f3` (patched by `deals_api_server.js.patch`, `805378b67044e9727b24d37b1b726840`) |

There is exactly one accepted starting file. Any other md5 (another package was installed since): **stop**. Do not hand-edit on the box; pull the live file, cut a new patch in a PR, re-pin. The patch applies with **zero fuzz** (`patch -F0`); the test `scripts/box/reachable-tile-install.test.mjs` runs it against the local, gitignored live snapshot `docs/box-snapshots/2026-10-30-box2-deals-api/` (the test skips when it is absent; `install.sh check` does the same md5 pin and zero-fuzz dry run on the box).

<!-- MD5S:START -->
```
# md5  role  file   (BASE = box2 live deals_api_server.js read-only 2026-10-30, after the buyer-contact-reveal install #643; RESULT = after the patch; PATCH/FILE = shipped in this directory)
bd11ff778117cd932c2608e1585634d4  BASE     deals_api_server.js@live-2026-10-30
5ce745d698cc19bcdf9809e8982304f3  RESULT   deals_api_server.js@live-2026-10-30
805378b67044e9727b24d37b1b726840  PACKAGE  deals_api_server.js.patch
cff4d09baa921dac3d2cdb23c81d6dea  PACKAGE  files/quoteReachable.js
-                                 BEFORE   quoteReachable.js   (absent)
```
<!-- MD5S:END -->

## What it adds to the request
One cached query of the directory's addresses (to find group domains: a mail domain two or more rooftops share), and the existing coverage count becomes a per-dealer pass over the in-scope rooftops (about 9.5k) in JS. The analytics result is already cached by the stats-warm install. **Not measured on box2** (code only); step 5 times the first call. The new query reads `dealership_contacts.email_opt_out`, `domains_json`, `website`, `is_test`: created by the auth server's migrations (`auth_api_server.js`), not read from the live DB here.

## Steps (on box2, as `ubuntu`)
0. Mac, from the merged checkout: `scp -r docs/box-patches/2026-10-30-reachable-tile ubuntu@52.202.234.65:/tmp/rt`. Compare to `manifest.txt` (`PACKAGE` rows): `cd /tmp/rt && md5sum deals_api_server.js.patch files/quoteReachable.js`.
1. Read-only drift check (changes nothing in the live dir; dry-runs the patch on a copy, runs the smoke test on a temp copy). Must end `DRIFT CHECK PASS`:
```bash
bash /tmp/rt/install.sh check
```
2. Gate by hand as well: the last `[sync-lock]` line in `~/.pm2/logs/deals-api-out.log` is a `release`; no `inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|standalone` process on box2 (it also crawls), boxes 1/3/4 sync clients not mid-upload. `apply` and `restart` check the lock and box2's own processes again and refuse.
3. Apply: gates, **backup first** to `~/backups/box2-reachable-tile-20261030/` (`deals_api_server.js`, `md5s.txt`), copies `quoteReachable.js` then the patched server (cut and verified on a temp copy first), checks every md5, `node --check`, the smoke test on the live files, and restores itself on any failure. **Does not restart.**
```bash
bash /tmp/rt/install.sh apply
```
   If `/opt/trimscout-deals/src` is root-owned: `SUDO=sudo bash /tmp/rt/install.sh apply`.
4. Restart (gates again, then `sudo -u ubuntu pm2 restart deals-api`, then checks the process is online with a fresh uptime stamp and `/health` answers 401). Never `sudo pm2 ...` and never `trimscout-deals-api`: the root PM2 has no `deals-api`.
```bash
bash /tmp/rt/install.sh restart
```
5. Verify (about 10 s after the restart): `sudo -u ubuntu pm2 logs deals-api --lines 30 --nostream` has no errors, `deals-api` stays online (restart count unchanged a minute later), then one timed analytics call: `time curl -s -H "X-Trimscout-Api-Key: $KEY" "http://127.0.0.1:3004/api/inventory/analytics" | python3 -c "import sys,json; c=json.load(sys.stdin)['coverage']; print({k:c[k] for k in ('dealers','dealersReachable','dealersUnverified','dealersWithEmail')})"`. `dealersReachable` should be near the audit's 5,468 of 9,486 (the audit's group-domain threshold was 3, this uses 2, so a little higher). If the cold call takes more than a few seconds, roll back.
6. Clean up `/tmp/rt`. Keep the backup until the admin page is seen working.

## Rollback
```bash
bash /tmp/rt/install.sh restore && sudo -u ubuntu pm2 restart deals-api
```
`restore` copies the backed-up server back, removes `quoteReachable.js` and checks the md5 against `md5s.txt`. The admin page falls back to its "Box has not been updated" label.

## Not in this package
The contact-write guard in `auth_api_server.js` (refuses department mailboxes, vendor domains and junk on create, update and bulk import) is in the repo mirror, but the live auth server's text is not in `docs/box-snapshots/`, so no patch is cut for it here. The web side (the /search Contact column showing "Unverified email") ships with the Next app, not this package.
