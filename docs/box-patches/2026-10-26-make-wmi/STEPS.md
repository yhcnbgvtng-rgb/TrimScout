# Box patch: take the make from the VIN (PR #580, merged as `368b794`)

Code only. **Nothing here has been installed or run on a box.** Every script below was tested on copies of the real box files (box1's and box2's `standalone.js`, box2's deals-api `stellantisMake.js` / `ingestGuards.js` / `stellantisVinTable.js`, copied read-only), never on a live checkout. One box at a time, no-crawl window, only on Paul's own typed GO. Do NOT `git pull` / `merge` / `commit` on a box.

## What this changes
Before: a car whose page has no make was stored with the roster brand (`dealer.make || brand.name`), so a Dodge Challenger, Subaru Impreza, Lincoln Corsair, Honda Fit and Buick Encore were all stored as **GMC** at a GMC-roster dealer. After: the make comes from the VIN's first 3 characters (Stellantis: 5-character line code), a stored make that the VIN contradicts is replaced, and a VIN no table knows keeps whatever the page said (blank stays blank; such a car with no page make is skipped and logged). Rule and numbers: PR #580.

Two places, two installs:
1. **Crawler boxes** (box1, box2, box3, box4: `~/nj-scraper/scrapers/lightsail-crawler/src`): stops the roster fallback at ingest. `crawler.sh`.
2. **box2 deals-api** (`/opt/trimscout-deals/src`, pm2 `deals-api`): corrects the make at the write choke point (`normalizeMakeForWrite`) for every upload from every box. `deals-api.sh`. `deals_api_server.js` itself is **not** edited: it already imports `normalizeMakeForWrite` from `./stellantisMake.js`.

Order (Paul's plan): **box4 crawler files first**, then **box1, box2 (crawler dir), box3**, then **box2 deals-api**. The deals-api change corrects makes on write whatever the crawler sends, so it does not depend on the crawler step.

## Files and md5s
Crawler boxes (`src/`; the box copies of `brand_match.js` are identical everywhere):

| File | before | after (`files/`) |
|---|---|---|
| `vinWmi.js` | absent | `365a9b0dd148dcd115b442601f7c47af` (new) |
| `stellantisMake.js` | absent | `4017f1f9e24dc14d1b2cc530737e1e00` (new) |
| `stellantisVinTable.js` | absent | `2bb0902516fe1279adec20291096ac7b` (new) |
| `ingestGuards.js` | absent | `88ec75c5d81a19dd484de0dea62add28` (new; nothing on the crawler imports it except the new files) |
| `brand_match.js` | `8b4d8c1fe29731cccae7c0d96c36aaad` (all four boxes) | `91d723fe2cf8440c1da6e719e3c5b871` (replaced) |
| `standalone.js` box1 | `02f73e161e29dde0fe0633759328c9a8` | `82fa1a602d6229fc5eb17114fb347e6a` (patched) |
| `standalone.js` box2, box3, box4 | `2e69d8748b9addbff93dac618bb71f1e` | `6465d05d2377da81293897292e895776` (patched) |

`standalone.js` is patched, not replaced: the boxes' copy is far behind `main`, so `02-standalone.patch` (md5 `a722dbe8b6428d3c0d16d3240f6aaef4`, the PR's three hunks cut against the box file; it applies exactly, no offset or fuzz, to both variants) only removes the two `dealer.make` / `brand.name` fallbacks and adds the "make unresolvable" log line. The other files are the exact files from `368b794`.

box2 deals-api (`/opt/trimscout-deals/src`):

| File | before | after |
|---|---|---|
| `vinWmi.js` | absent | `365a9b0dd148dcd115b442601f7c47af` (new) |
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
It prints which `standalone.js` variant the box has and refuses on any md5 that is not in the table above.
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

After box4: leave it through one nightly crawl and check (below) before box1-3.

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
- Crawler, after the first crawl on a patched box: `grep -c "make unresolvable" ~/nj-scraper/scrapers/lightsail-crawler/logs/*-$(date +%F).log` (cars skipped because neither the page nor the VIN gave a make; expect a small number) and no `SyntaxError` / `Cannot find module` in the run log.
- Rows: from box2's reader account, index-bounded, the read-only dry run `scripts/box/2026-10-24-make-wmi-reclean.mjs --vpic` (see PR #580) shows how many rows the VIN still contradicts. Only rows a patched crawl or a patched write path has touched change; the other ~19k rows stay as they are until their store is re-crawled. **There is no apply phase**: rewriting the existing rows is a separate step and is not part of this patch.
- Not part of this patch: the dry-run script, the vPIC step and the tests (repo-side tools, run from the Mac with `--emit`).
