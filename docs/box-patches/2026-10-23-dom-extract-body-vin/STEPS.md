# Box patch: `dom_store.js` builds the cached window around the BODY occurrence of the VIN (follow-up to #574); dry-run plan for box4

Code and docs only. **Nothing installed, and no box was changed.** Install only on Paul's typed GO. One file changes: `src/dom_store.js`. No restart: each crawl is a fresh Node process, so the next 22:00 start loads it. **There is no env-var off switch**; the way back is the file restore in step 6.

## Why
Read-only look at box4 on 2026-10-23: five Team Velocity blobs dated 2026-10-23 (five different dealers, VINs masked) were 8,327-8,742 chars of page **head** each, with the VIN first at offset 327-742 and 4 times in all. They held no stock number and no price, only dealer script settings (`var hideVINandStock`, `var priceColor`) and the dealership's `priceRange` JSON-LD. #574 builds the window around `text.indexOf(vin)`, and on these pages the first VIN is in the `<head>` (canonical / og:url / twitter:url meta and link tags carry the page URL), so the window is the head. This change picks the occurrence that is the car: skip `<head>`, tag attributes and URLs; of the body occurrences take the one closest to stock / price / MSRP text; none near text: the last body occurrence; none in the body: the last occurrence anywhere. Window size is unchanged (4,000 before, 8,000 after).

## Files and md5s
| File | before | after |
|---|---|---|
| `src/dom_store.js` on box4 (must already hold #574) | `bba6552b946cc4a44b3e0fef1308940e` | `1a2e29b0166878a3561c21ca8c427bf1` |
| `01-dom-extract.patch` (path relative to `scrapers/lightsail-crawler`, `patch -p1`) | | `b08445d984134ddf8d736dd62e6adfa0` |
| `drift-check.sh` | | `1b48d62625efcb8774d33f3785095c12` |
The patch applied to a copy of the #574 file gives exactly the after md5, passes `node --check`, and `drift-check.sh` ends `DRIFT CHECK PASS` (smoke 5/5) and `ALREADY PATCHED` on the new file (both run locally on a copy). Not run on a box. box4's own file was not md5'd in this PR's reads: step 0 does it. **box1 and box3 were not read today**; on 2026-10-22 they read `3265fc4a6b070519884254a38bf61360` (#574 not installed), so this patch does not apply there until #574 does (the drift check says so and stops). The boxes' checkouts are hand-patched and dirty: do NOT `git pull`/`merge`/`commit` there. box4 public IP 100.50.85.234 (docs/BOXES.md).

## Cache size and disk
Window size is unchanged, so bytes per page do not change (8,327-8,742 chars before; a real body window is up to 12,000 chars, about 3-4 KB gzipped, one 4 KB block). What changes is **the first night**: every Team Velocity car's extract differs from yesterday's head, so every such car gets a new blob file once (a blob is rewritten only when the day's hash differs). Upper bound = box4's Team Velocity + "other platform" records, 136,969 pages (from the #574 sizing) x about 4 KB = **about 0.55 GB and 137 k files, once**, against 274 GB and 37.3 M inodes free (box4, 2026-10-23: dom_blobs 18 GB, 1,162,705 VIN dirs, 12% used). The 7-day prune bounds it. Estimate, not a run.

## Dry-run plan: box4 only (about 10 minutes; start before 21:00 ET, hard stop 21:30 ET; the 22:00 crawl and the later sync are never touched)
0. **Preconditions** (stop if anything prints a process or it is past 21:30 ET):
```bash
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@100.50.85.234 'TZ=America/New_York date +%H:%M; pgrep -fa "run_nightly_chain|run-daily-crawl|[s]tandalone|inventory-sync" | grep -v pgrep; df -h / | tail -1; md5sum ~/nj-scraper/scrapers/lightsail-crawler/src/dom_store.js'
```
   The md5 must be `bba6552b946cc4a44b3e0fef1308940e` (#574 installed). If it is `3265fc4a…`, #574 is not on box4: stop.
1. **Stage** (writes only under `/tmp`), from the Mac in the repo checkout at the merged commit:
```bash
P=docs/box-patches/2026-10-23-dom-extract-body-vin; ssh -i ~/.ssh/trimscout_box_2026 ubuntu@100.50.85.234 'mkdir -p /tmp/dx'
scp -i ~/.ssh/trimscout_box_2026 $P/{01-dom-extract.patch,drift-check.sh} ubuntu@100.50.85.234:/tmp/dx/
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@100.50.85.234 'cd /tmp/dx && md5sum *'   # b08445d984134ddf8d736dd62e6adfa0  01-dom-extract.patch / 1b48d62625efcb8774d33f3785095c12  drift-check.sh
```
2. **Drift check + dry run** on the box (read-only, works on a copy): must end `DRIFT CHECK PASS` and print `1a2e29b0166878a3561c21ca8c427bf1`:
```bash
bash /tmp/dx/drift-check.sh
```
3. **Backup**:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/dom-extract-body-vin-20261023; mkdir -p $B; cp -p src/dom_store.js $B/; md5sum $B/dom_store.js | tee $B/md5s.txt
```
4. **Apply and verify**:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && patch -p1 < /tmp/dx/01-dom-extract.patch
md5sum src/dom_store.js    # must be 1a2e29b0166878a3561c21ca8c427bf1
cp src/dom_store.js /tmp/chk.mjs && node --check /tmp/chk.mjs && echo SYNTAX_OK; rm -f /tmp/chk.mjs
grep -c "pickVinOccurrence" src/dom_store.js   # expect 2
```
5. **Nothing else**: no restart, no cron edit, no crawl start.
6. **Restore** (one line):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && cp -p ~/backups/dom-extract-body-vin-20261023/dom_store.js src/ && md5sum src/dom_store.js   # expect bba6552b946cc4a44b3e0fef1308940e
```
7. **After the first crawl on box4 (next morning)**, read-only: take 5 Team Velocity VINs (match by `/viewdetails/` in the shard `url`), `zcat dom_blobs/<VIN>/<newest>.html.gz`: the text must hold the car's own block (a `Stock` / price / MSRP label and value next to the VIN) and must not start with the page head (`<link rel="canonical"`); mean blob size, new files per car (about 1 once, per the estimate above), `df -h /` and `df -i /` against 274 GB / 37.3 M free. The text around the VIN is the input for a real stock / price extractor (the blobs held only the head until now, so where those fields sit on a Team Velocity page is still unseen). Roll out to box3 and box1 only after that look and after #574 is on them.
