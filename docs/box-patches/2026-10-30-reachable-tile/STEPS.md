# Box patch: "Reachable by quote request" admin tile (box2 deals API) — code only, NOTHING IS INSTALLED

**v2, 2026-10-30.** v1 was applied on box2 that evening and rolled back after a cold analytics call ran past 120 s (limit 5 s). v2 moves the counts out of the MEDIAN analytics path. Cut against box2's live `deals_api_server.js`, md5 `bd11ff77…` (after the buyer-contact-reveal install, PR #643). Install only on Paul's typed GO (not before box2's sync has finished), on **box2** (`ssh box2`; `docs/BOXES.md`): sync lock free, no sync/crawl process on any box. One patched file plus two new files in `/opt/trimscout-deals/src`, one `sudo -u ubuntu pm2 restart deals-api`. No schema or env change.

## Why v1 was slow (from the code; EXPLAIN was not run, there is no local DB and box2's production DB is off limits)
v1 added, inside `computeInventoryAnalytics` (the `statsCached` MEDIAN path), `SELECT i.dealer_id, MAX(i.dealer_name), MAX(d.contact_email), MAX(d.website), MAX(d.domains_json), MAX(d.email_opt_out) … GROUP BY i.dealer_id` over every in-stock car, plus four more `MAX(d.*)` columns in the existing `byDealer` query.
- `i.dealer_name` is in neither `idx_inv_stock_dealer_id (removed_at, dealer_id)` nor `idx_inv_by_dealer_covering (removed_at, dealer_id, cond, price_diff, last_seen_at)`, so the grouped read stops being index-only: one row lookup per in-stock vehicle. The comment above that index in the live file measured exactly this shape at 32.1 s cold against 223 ms covered.
- Every in-stock row also joined `dealership_contacts` and aggregated its text columns (`domains_json` is TEXT), millions of times, to learn about roughly 9.5k rooftops.
- It sat in the same compute as the MEDIAN full scans, so a cold key paid for both, and a persisted pre-patch cache entry kept serving the old fields until it expired (the 14 ms "first call" never ran the new code).

## What v2 does
`reachableCoverage.js` overlays the reachable counts on the cached stats payload; `computeInventoryAnalytics` is **byte-for-byte unchanged** (the test pins it).
1. Directory read: `SELECT id, dealer_name, contact_email, website, domains_json, email_opt_out FROM dealership_contacts WHERE is_test = 0` — one small table (about 10k rows, primary key), classified once in JS with the shared rule (`quoteReachable.js`), group domains included.
2. Dealer ids in scope: `SELECT i.dealer_id FROM dealer_inventory i WHERE [filters] AND i.removed_at IS NULL AND i.dealer_id > 0 GROUP BY i.dealer_id` — no join, only `removed_at` and `dealer_id`, so the unfiltered call is answered from `idx_inv_stock_dealer_id` alone (the by-dealer query is the same class).
3. Both are cached in their own in-memory stale-while-revalidate cache (`reachableCached`, 30 min, not the stats cache, not cleared by writes), each read capped by the server's statement timeout. A failure leaves the stats payload untouched and is not cached (the page falls back to its "not updated" label).

Fields: `coverage.dealersReachable`, `coverage.dealersUnverified` (shown as "Unverified email", never as on file), `coverage.dealersWithEmail` (= reachable, for older readers), and `dom.byDealer[].emailStatus` / `.hasEmail` (true only for `reachable`).

**Estimated cold time (not measured on box2):** directory read 0.1-0.5 s + JS classification under 0.1 s + unfiltered dealer-id read 0.2-1 s ≈ **0.5-2 s**, hard-capped at the statement timeout per read; warm calls are milliseconds. Filtered calls (state, make, model, dates) read `dealer_id` from the row for each matching car and cost about what the existing `byDealer` query already costs.

## Files (`/opt/trimscout-deals/src`)
| File | Before (must be exactly) | After |
|---|---|---|
| `quoteReachable.js` | absent | `cff4d09baa921dac3d2cdb23c81d6dea` (new: `files/`) |
| `reachableCoverage.js` | absent | `43276833cab9f27e615bd0068bb663de` (new: `files/`) |
| `deals_api_server.js` | `bd11ff778117cd932c2608e1585634d4` | `b2a0964b0e25eb4f47f54b563d8eb523` (patched by `deals_api_server.js.patch`, `23f3aea19de2d0ba822748e3118153c4`: one import, one cache, three lines in `handleInventoryAnalytics`) |

There is exactly one accepted starting file. Any other md5 (another package was installed since): **stop**. Do not hand-edit on the box; pull the live file, cut a new patch in a PR, re-pin. The patch applies with **zero fuzz** (`patch -F0`); `scripts/box/reachable-tile-install.test.mjs` runs it against the local (gitignored) live snapshot `docs/box-snapshots/2026-10-30-box2-deals-api/` and skips with a message when it is absent; `install.sh check` does the same md5 pin and zero-fuzz dry run on the box. The module behaviour is covered by `scrapers/lightsail-crawler/test/reachable_coverage.test.js`.

<!-- MD5S:START -->
```
# md5  role  file   (BASE = box2 live deals_api_server.js read-only 2026-10-30, after the buyer-contact-reveal install #643; RESULT = after the patch; PATCH/FILE = shipped in this directory)
bd11ff778117cd932c2608e1585634d4  BASE     deals_api_server.js@live-2026-10-30
b2a0964b0e25eb4f47f54b563d8eb523  RESULT   deals_api_server.js@live-2026-10-30
23f3aea19de2d0ba822748e3118153c4  PACKAGE  deals_api_server.js.patch
cff4d09baa921dac3d2cdb23c81d6dea  PACKAGE  files/quoteReachable.js
43276833cab9f27e615bd0068bb663de  PACKAGE  files/reachableCoverage.js
-                                 BEFORE   quoteReachable.js   (absent)
-                                 BEFORE   reachableCoverage.js   (absent)
```
<!-- MD5S:END -->

## Steps (on box2, as `ubuntu`)
0. Mac, from the merged checkout: `scp -r docs/box-patches/2026-10-30-reachable-tile ubuntu@52.202.234.65:/tmp/rt`. Compare to `manifest.txt` (`PACKAGE` rows): `cd /tmp/rt && md5sum deals_api_server.js.patch files/*`.
1. Read-only drift check (changes nothing in the live dir). Must end `DRIFT CHECK PASS`:
```bash
bash /tmp/rt/install.sh check
```
2. Gate by hand as well: the last `[sync-lock]` line in `~/.pm2/logs/deals-api-out.log` is a `release`; no `inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|standalone` process on any box; `catalog-facets/status` shows `building: false`. `apply` and `restart` check the lock and box2's own processes again and refuse.
3. **Time the unpatched baseline first**, before applying anything, with the default key (no `?from=`, no filters), twice (the first may be a cache hit; note which): `time curl -s -H "X-Trimscout-Api-Key: $KEY" "http://127.0.0.1:3004/api/inventory/analytics" -o /dev/null`. Write both numbers down. Do not use a `?from=` key: it forces a different, filter-scoped MEDIAN compute and says nothing about the tile.
4. Apply (gates, **backup first** to `~/backups/box2-reachable-tile-20261030/`, copies the two modules then the patched server, checks every md5, `node --check`, the smoke test on the live files, restores itself on any failure; **does not restart**), then restart (gates again, `sudo -u ubuntu pm2 restart deals-api`, online with a fresh uptime stamp, `/health` 401). Never `sudo pm2 ...` and never `trimscout-deals-api`.
```bash
bash /tmp/rt/install.sh apply
bash /tmp/rt/install.sh restart
```
   If `/opt/trimscout-deals/src` is root-owned: `SUDO=sudo bash /tmp/rt/install.sh apply`.
5. Verify, timed, with the **default key** (same command as step 3, plus the fields): `time curl -s -H "X-Trimscout-Api-Key: $KEY" "http://127.0.0.1:3004/api/inventory/analytics" | python3 -c "import sys,json; c=json.load(sys.stdin)['coverage']; print({k:c.get(k) for k in ('dealers','dealersReachable','dealersUnverified','dealersWithEmail')})"`. The first call after the restart must come back in **under 5 s** with `dealersReachable` and `dealersUnverified` present (v2 computes them on every first call, so a persisted pre-patch stats entry cannot hide them) and `dealersReachable` near the audit's 5,468 of 9,486 (a little higher: the audit's group-domain threshold was 3, this uses 2). Then a second call (milliseconds), `sudo -u ubuntu pm2 logs deals-api --lines 30 --nostream` with no errors, and the restart count unchanged a minute later. If the first call takes 5 s or more, or the fields are missing: roll back.
6. Clean up `/tmp/rt`. Keep the backup until the admin page is seen working.

## Rollback
```bash
bash /tmp/rt/install.sh restore && sudo -u ubuntu pm2 restart deals-api
```
`restore` copies the backed-up server back, removes the two modules and checks the md5 against `md5s.txt`. The admin page falls back to its "Box has not been updated" label.

## Not in this package
The contact-write guard in `auth_api_server.js` (refuses department mailboxes, vendor domains and junk on create, update and bulk import) is in the repo mirror, but the live auth server's text is not in `docs/box-snapshots/`, so no patch is cut for it here. The /search "Unverified email" column ships with the Next app (PR #655), not this package.
