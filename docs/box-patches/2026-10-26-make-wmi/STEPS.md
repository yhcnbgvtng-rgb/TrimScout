# Box patch: take the make from the VIN (PR #580, merged as `368b794`) + dealer/shard-brand fallback (PR #597)

Code only. **Nothing here has been installed by this PR.** The first revision of this directory (PR #582) was tested on copies of the real box files; **this revision (regenerated from #597) was tested only on repo blobs and a simulated box directory** (`check`, `apply` and `restore` against fake `src/` dirs, both from the pre-patch and from the first-patch state), because the box `standalone.js` files are not in the repo. The first real test is `crawler.sh check` on box4, which is read-only and patches a copy. One box at a time, no-crawl window, only on Paul's own typed GO. Do NOT `git pull` / `merge` / `commit` on a box.

## What this changes
Before: a car whose page has no make was stored with the roster brand (`dealer.make || brand.name`), so a Dodge Challenger, Subaru Impreza, Lincoln Corsair, Honda Fit and Buick Encore were all stored as **GMC** at a GMC-roster dealer. After: the make comes from the VIN's first 3 characters (Stellantis: 5-character line code), a stored make that the VIN contradicts is replaced, and a VIN no table knows keeps whatever the page said. **New in this revision (#597):** a car with no page make whose VIN no table knows is no longer skipped: it is kept under the dealer's roster brand, else the shard's brand (never the Stellantis umbrella; a shared WMI only accepts a brand from its own family), and logged as `make_source=fallback` with the VIN. It is skipped (and logged `make unresolvable`) only when no real brand is available. Rule and numbers: PR #580. #597 also adds 26 WMI prefixes taken from box4's 2026-10-27 skipped VINs.

Two places, two installs:
1. **Crawler boxes** (box1, box2, box3, box4: `~/nj-scraper/scrapers/lightsail-crawler/src`): stops the roster fallback at ingest. `crawler.sh`.
2. **box2 deals-api** (`/opt/trimscout-deals/src`, pm2 `deals-api`): corrects the make at the write choke point (`normalizeMakeForWrite`) for every upload from every box. `deals-api.sh`. `deals_api_server.js` itself is **not** edited: it already imports `normalizeMakeForWrite` from `./stellantisMake.js`.

Order (Paul's plan): **box4 crawler files first** (one nightly crawl, then check), then **box1, box2 (crawler dir), box3**, then **box2 deals-api**. The deals-api change corrects makes on write whatever the crawler sends, so it does not depend on the crawler step.

## Files and md5s
Crawler boxes (`src/`; the box copies of `brand_match.js` are identical everywhere):

| File | before | after (`files/`) |
|---|---|---|
| `vinWmi.js` | absent (or `365a9b0dd148dcd115b442601f7c47af`, the first revision, or `422bd7190ee821d33449d28489e22d17`, the #597 revision) | `7371d7d9bd40bd9586b4ef8a848a4969` (new / replaced) |
| `stellantisMake.js` | absent | `4017f1f9e24dc14d1b2cc530737e1e00` (new) |
| `stellantisVinTable.js` | absent | `2bb0902516fe1279adec20291096ac7b` (new) |
| `ingestGuards.js` | absent | `88ec75c5d81a19dd484de0dea62add28` (new; nothing on the crawler imports it except the new files) |
| `brand_match.js` | `8b4d8c1fe29731cccae7c0d96c36aaad` (all four boxes; `91d723fe2cf8440c1da6e719e3c5b871` if the first revision was installed) | `2b421d128ce20aab0644820bb0702271` (replaced) |
| `standalone.js` box1 | `02f73e161e29dde0fe0633759328c9a8` (first revision installed: `82fa1a602d6229fc5eb17114fb347e6a`) | **not pinned yet** (see below) |
| `standalone.js` box2, box3, box4 | `2e69d8748b9addbff93dac618bb71f1e` (first revision installed: `6465d05d2377da81293897292e895776`) | **not pinned yet** (see below) |

`standalone.js` is patched, not replaced: the boxes' copy is far behind `main`. Two patches, same end result: `02-standalone.patch` (md5 `47d66cd27da48dd87d583f3e37a71dfa`) for a box still on the pre-patch file, and `03-standalone-upgrade.patch` (md5 `7a27bdc2472527f41952adb47f874af9`) for a box that already has the first revision. Hunks 1-2 are unchanged from the first revision (they remove the two `dealer.make` / `brand.name` fallbacks); the change is hunk 3, one line: the call becomes `resolveKeptMake(brand, vehicle, dealer)` and the "make unresolvable" log is reworded. The import line is not touched (`resolveKeptMake` logs `make_source=fallback` itself). On repo blobs both patches give the same file (md5 `5ad71401850fb90d4407c96045a2d489` on the repo's old base); the box files differ from the repo, so **the md5 of the patched box file is unknown until `check` runs on a box**. `crawler.sh` therefore verifies the patched file by content (new call present, both old fallbacks gone, log line present, `node --check`) and **prints its md5**; `SA_NEW_BOX1` / `SA_NEW_OTHER` at the top of `crawler.sh` are empty on purpose. After box4's `check`, box2/box3 (same variant) must print the same md5; pin it in `crawler.sh` before box1-3 if you want the md5 enforced. The other files are the exact files from #597.

box2 deals-api (`/opt/trimscout-deals/src`):

| File | before | after |
|---|---|---|
| `vinWmi.js` | absent | `7371d7d9bd40bd9586b4ef8a848a4969` (new; the STEPS table used to show the first revision's md5 here, `deals-api.sh` already checked the #597 one) |
| `stellantisMake.js` | `4f384997f7107b66b9521bb561b7a10e` (= the repo's pre-#580 file) | `4017f1f9e24dc14d1b2cc530737e1e00` |
| `stellantisVinTable.js` | `2bb0902516fe1279adec20291096ac7b` | unchanged |
| `ingestGuards.js` | `0ba41bc0c45b07ad75a2fd32571937da` (the Oct 7 version: older than `main`'s price-guard update, which is not needed here) | unchanged: vinWmi only uses its `canonicalMake` |
| `deals_api_server.js` | not touched | not touched |

`manifest.txt` has the md5 of every file in this directory; check it after `scp`.

Two things to know before the crawler step:
- `brand_match.js` on the boxes is two commits behind the repo's pre-#580 file, so replacing it also brings the earlier **Stellantis umbrella resolution** (a Stellantis-roster car with no make resolves to its real nameplate instead of the umbrella "Stellantis") onto the crawler boxes. Same function exports, so `nj_policy.js` and `standalone.js` keep working. The deals-api already had that behaviour.
- A crawl loads these files when each crawl process starts. Installing during a running crawl would put half the shards on the old code and half on the new, so install in the no-crawl window (below).

## Timing
Cron starts every crawl at 22:00 ET. Last night's crawl+sync ended 05:22-06:48 ET on box2/3/4 and 08:44 on box1 (a long box1 crawl ran 10.4 h). The window is **after the sync finishes and before 21:50 ET**. `crawler.sh apply` refuses after 21:50 ET and while any crawl/sync process runs (`ALLOW_CRAWL_WINDOW=1` overrides the clock only on Paul's say-so).

## Steps: crawler boxes (repeat per box; BOX = `ubuntu@IP`; box1/box3/box4 need `-J ubuntu@52.202.234.65`, box2 is direct)
0. From the Mac, in the repo checkout (after the PR merges):
```bash
P=docs/box-patches/2026-10-26-make-wmi; J="-J ubuntu@52.202.234.65"; BOX=ubuntu@172.26.11.241   # box4; box1 .1.32, box3 .15.105; for box2 use BOX=ubuntu@52.202.234.65 and J=""
ssh $J $BOX 'mkdir -p /tmp/mw'
scp $J -r $P/. $BOX:/tmp/mw/                              # the whole directory: manifest.txt lists every file
```
1. On the box: integrity, then preconditions (all must be quiet):
```bash
cd /tmp/mw && md5sum -c manifest.txt                       # every line OK (manifest.txt itself is not listed)
TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone.js" | grep -v pgrep    # no output, and before 21:50
```
2. Drift check (read-only; patches a copy in a temp dir). Must end `DRIFT CHECK PASS` (or `ALREADY PATCHED`):
```bash
bash /tmp/mw/crawler.sh check
```
It prints which `standalone.js` state the box has (not patched / first revision installed, will be upgraded / already new) and refuses on any md5 that is not in the table above, then prints the md5 the patched file would have. **box4's logs of 2026-10-27 already contain `make unresolvable` lines, so box4 may already carry the first revision (or another build of it): `check` tells; an unknown md5 means stop and report.**
3. Apply (does the backup itself: `~/backups/make-wmi-20261026/` holds `brand_match.js`, `standalone.js`, `md5s.txt`, `absent.txt`; then copies the 4 new files, patches `standalone.js`, replaces `brand_match.js` last; verifies every md5 and syntax and runs the five-VIN test on the live files; on any failure it restores by itself):
```bash
bash /tmp/mw/crawler.sh apply      # ends: APPLIED. No restart needed
```
No restart: every crawl is a fresh Node process.
4. Restore (any time; also what `apply` does on failure). Puts the two files back and removes the four new files, then verifies the original md5s:
```bash
bash /tmp/mw/crawler.sh restore    # ends: RESTORED: md5s match the backup
```
5. Quick test by hand (read-only, any time after step 3):
```bash
node /tmp/mw/test-five-vins.mjs crawler ~/nj-scraper/scrapers/lightsail-crawler/src    # FIVE-VIN TEST PASS
```
The five VINs (`2B3LJ54T19H594202` Challenger, `4S3GTAV69P3713237` Impreza, `5LMCJ1DH0NUL16894` Corsair, `JHMGK5H76HS000056` Fit, `KL4CJCSB4JB582999` Encore), each stored as "GMC" on a GMC-roster crawl, must come out Dodge / Subaru / Lincoln / Honda / Buick, with a page make of "GMC" and with none; two real GMC VINs must stay GMC; an unknown-WMI VIN keeps its stored make.

**Box order: box4 first.** Apply on box4, leave it through one nightly crawl and run the checks below, then box1, box2 (crawler dir), box3, one at a time, each only after its own `check` passes and on Paul's typed GO. `restore` also puts back an older `vinWmi.js` if the first revision had installed one.

## Steps: box2 deals-api (last)
0. From the Mac: `scp -r $P/. ubuntu@52.202.234.65:/tmp/mw/` (the whole directory, so `manifest.txt` checks out).
1. On box2: `cd /tmp/mw && md5sum -c manifest.txt`; sync lock clear (`grep -h "\[sync-lock\]" /home/ubuntu/.pm2/logs/deals-api-out.log | tail -1` must end `release`, not `acquire`) and no `inventory-sync` process.
2. `bash /tmp/mw/deals-api.sh check` then `bash /tmp/mw/deals-api.sh apply`. `check` tests the two files against the box's own `ingestGuards.js` in a temp dir. `apply` backs up `stellantisMake.js` to `~/backups/make-wmi-deals-20261026/`, copies `vinWmi.js` then `stellantisMake.js`, verifies md5s and runs the five-VIN test on the live files. **It does not restart anything.**
3. **Restart: yes, required.** The module is loaded when the process starts, so the running `deals-api` keeps the old `stellantisMake.js` in memory until `pm2 restart deals-api` (plain, as `ubuntu`; no `--update-env` needed, nothing in the environment changes). Do it only with the sync lock clear and no sync client running, in an idle window. The server's startup ALTERs have hung behind long SELECTs before, so right after the restart:
```bash
pm2 status deals-api; pm2 logs deals-api --lines 30 --nostream | tail -30      # online, no stack trace, "listening"
node /tmp/mw/test-five-vins.mjs deals /opt/trimscout-deals/src                  # FIVE-VIN TEST PASS
```
4. Restore: `bash /tmp/mw/deals-api.sh restore` (puts `stellantisMake.js` back, removes `vinWmi.js`), then `pm2 restart deals-api`.

## After install: what to check
- Crawler, after the first crawl on a patched box: `grep -c "make unresolvable" ~/nj-scraper/scrapers/lightsail-crawler/logs/*-$(date +%F).log` (cars skipped because no page make, no WMI and no brand to fall back on; expect ~0) and `grep -h "make_source=fallback" ~/nj-scraper/scrapers/lightsail-crawler/logs/*-$(date +%F).log | awk '{print substr($NF,1,3)}' | sort | uniq -c | sort -rn` (the VIN prefixes that still miss the WMI table: add the clear ones in a follow-up PR) and no `SyntaxError` / `Cannot find module` in the run log.
- Rows: from box2's reader account, index-bounded, the read-only dry run `scripts/box/2026-10-24-make-wmi-reclean.mjs --vpic` (see PR #580) shows how many rows the VIN still contradicts. Only rows a patched crawl or a patched write path has touched change; the other ~19k rows stay as they are until their store is re-crawled. **There is no apply phase**: rewriting the existing rows is a separate step and is not part of this patch.
- Not part of this patch: the dry-run script, the vPIC step and the tests (repo-side tools, run from the Mac with `--emit`).


## Revision 2026-10-28: `vinWmi.js` shared-plant fix
`vinWmi.js` changed (md5 `7371d7d9bd40bd9586b4ef8a848a4969`, was `422bd7190ee821d33449d28489e22d17`; it also exports `WMI_LIST` for the stored-make scripts): `7YA` (Georgia metaplant) is now Hyundai/Kia/Genesis instead of Hyundai only, so a 2027 Kia Sportage Hybrid is no longer rewritten to Hyundai (1,413 live rows would have been); `3MY` also Scion, `3N6` also Chevrolet (City Express), `JN1` also Mitsubishi; a model rule decides a foreign or blank make on those shared WMIs. `crawler.sh` and `deals-api.sh` now expect the new md5 and accept the old #597 file as an upgradeable state (`crawler.sh`), `manifest.txt` is regenerated with `md5`. **`standalone.js` is unaffected**: it only imports `resolveKeptMake` from `brand_match.js`, so `02-standalone.patch`, `03-standalone-upgrade.patch` and the #614 politeness md5s (`a1f4e0bf…`, `d05cd479…`, `3523e736…`, `627a49f3…`) do not change. Nothing was installed.


## Revision 2026-10-28 (later): box1 already has the #614 politeness refit
Box1's `standalone.js` is `627a49f3fe9c470469dd203d95de1bf6` (politeness refit installed 2026-10-28 18:40 ET, before make-wmi), a state `crawler.sh` did not know: `crawler.sh check` stopped with "not a known version" and nothing was changed. `crawler.sh` now accepts that md5 (`SA_POL_BOX1`) and applies the new `04-standalone-box1-politeness.patch` (md5 `6e0710a5cdd18e381f9f1b10caec9cc8`), which is `02-standalone.patch`'s three hunks cut against the politeness-refitted file (they applied with no offset or fuzz; the new patch is the diff of the real result). Expected result `8c39cf86d3017210d586ff3afeb33969`, pinned as `SA_NEW_POL_BOX1`, so the md5 is enforced on box1. `manifest.txt` and `crawler.sh` are regenerated; no other file changed (`vinWmi.js` is still `7371d7d9…`).

Tested off the box only, on the copies in `docs/box-patches/2026-10-28-politeness-refit/box-src/box1` with the politeness patch applied (`scrapers/lightsail-crawler/test/politeness_box_refit.test.js`), and with `crawler.sh check` against a fake crawler dir holding that file (pin matched, five-VIN test passed). **Not installed anywhere.** The first real run is `bash /tmp/mw/crawler.sh check` on box1, which is read-only; `apply` only on Paul's typed GO, idle window, before 21:50 ET. Box1's rollback is unchanged: `BACKUP=<dir> bash /tmp/mw/crawler.sh restore` puts back the politeness-patched `standalone.js` it backed up.
