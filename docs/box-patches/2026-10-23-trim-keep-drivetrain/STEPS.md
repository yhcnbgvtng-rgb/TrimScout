# Box patch: keep drivetrain words in the trim (replaces what #570 / #572 patch 02 installed)

Code only on the PR branch `fix/trim-keep-drivetrain`. Nothing here has been run on a box, and no box was read or touched while writing it. One box at a time, no-crawl window, on Paul's own typed GO. No restart: every crawl is a fresh Node process.

## Why
Patch 02 of `docs/box-patches/2026-10-21-trim-cleanup/` made the crawl strip a trailing `4WD/AWD/4x4/RWD/FWD/2WD` from every trim. Nothing else stores the drivetrain: `dealer_inventory` has no drivetrain column, the shard record has no drivetrain field, and no VIN decode result is saved. The read-only dry run showed 256,093 rows (83% of the changes) would lose it. This patch keeps the drivetrain word and still decodes entities, drops ® ™ and collapses whitespace.

## What it touches (one file per box)
| File | md5 before (the #572 patch-02 file, same on every box) | md5 after |
|---|---|---|
| `src/trimClean.js` | `c7288942656fb4df16b2c8552e558eb4` | `0b396545f0fdf1449c90ea1256c23f73` |

`src/standalone.js` is NOT touched (it still calls `cleanTrim(vehicle.trim, { make })`; the function now ignores `make`). `01-trim-keep-drivetrain.patch` md5 `1936fc2591bd3585169f8a7c0afdf656`; `drift-check.sh` md5 is printed by `md5sum` in step 1 (check it against the PR). Applies with `patch -p1` from `scrapers/lightsail-crawler`. Do NOT `git pull`/`merge`/`commit` on a box.

## Timing (important)
The crawl cron starts at 22:00 ET. Boxes 1-4 carry the stripping version since 2026-10-22/23, so **tonight's crawl strips**. Nothing is lost for good: a row's trim is rewritten by the sync upsert on every crawl (`trim = COALESCE(VALUES(trim), trim)`), so the first crawl on the fixed file puts `XLT 4WD` back. Rows not re-crawled keep what they have (the one-time re-clean has NOT been run). Install this before the next 22:00 start, or accept one more night of stripping.

## Steps (repeat per box; BOX = the IP)
0. From the Mac, in the repo checkout:
```bash
P=docs/box-patches/2026-10-23-trim-keep-drivetrain; ssh -i ~/.ssh/trimscout_box_2026 ubuntu@BOX 'mkdir -p /tmp/tk'
scp -i ~/.ssh/trimscout_box_2026 $P/{01-trim-keep-drivetrain.patch,drift-check.sh} ubuntu@BOX:/tmp/tk/
```
1. On the box, preconditions (stop if a process prints, or inside 21:50-23:59 ET while a crawl may be starting/running unless Paul says go anyway) and integrity:
```bash
TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone" | grep -v pgrep
cd /tmp/tk && md5sum *   # 01 1936fc2591bd3585169f8a7c0afdf656, drift-check.sh as in the PR
```
2. Drift check (read-only, works on a copy). Must end `DRIFT CHECK PASS` (patched copy md5 `0b396545…`) or `ALREADY PATCHED`:
```bash
bash /tmp/tk/drift-check.sh
```
3. Backup:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/trim-keep-drivetrain-20261024; mkdir -p $B; cp -p src/trimClean.js $B/; (cd $B && md5sum *.js | tee md5s.txt)   # must show c7288942...
```
4. Apply and verify:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler
patch -p1 < /tmp/tk/01-trim-keep-drivetrain.patch
md5sum src/trimClean.js    # 0b396545f0fdf1449c90ea1256c23f73
cp src/trimClean.js /tmp/chk.mjs && node --check /tmp/chk.mjs && echo SYNTAX_OK; rm -f /tmp/chk.mjs
grep -c "DRIVETRAIN_WORD_RE" src/trimClean.js    # 0
```
5. Restore (back to the stripping version; also resumes the stripping):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/trim-keep-drivetrain-20261024; cp -p $B/trimClean.js src/ && cat $B/md5s.txt && md5sum src/trimClean.js
```
Full rollback of the cleanup itself (no trim cleaning at all) is the restore in `docs/box-patches/2026-10-21-trim-cleanup/STEPS.md` step 5 and is NOT what this PR wants: it would bring ® and `&reg;` junk back.

## After install: what to check
After the first crawl on a patched box, from box2's reader account, index-bounded counts only:
```sql
SELECT trim, COUNT(*) FROM dealer_inventory FORCE INDEX (idx_inv_make_model_trim) WHERE make='Ford' AND model='Bronco' GROUP BY BINARY trim;
```
Re-crawled rows show `Big Bend 4WD`-style trims again, and no `®` / `&reg;`.

## The one-time re-clean (`scripts/box/2026-10-21-trim-reclean.mjs`, #572)
It calls the same `cleanTrim`, so once this PR is merged (and #572 rebased on it) its `drivetrain` reason drops to zero and the dry run shrinks to the entity / mark / whitespace rows (about 80k of the 310k). Re-run its dry run before any plan/apply; its numbers from before this fix no longer apply.
