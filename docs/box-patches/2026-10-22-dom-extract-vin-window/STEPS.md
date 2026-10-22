# Box patch: `dom_store.js` caches the vehicle area of a page (#574); dry-run plan for box4 first

Code and docs only. **Nothing installed, and no box was changed**: everything below came from read-only reads of box1/box3/box4 on 2026-10-22 (10:50-11:00 ET) and tests on local copies of the boxes' own `dom_store.js`. Install only on Paul's typed GO. One file changes: `src/dom_store.js`. No restart: each crawl is a fresh Node process, so the next 22:00 start loads it. **There is no env-var off switch**; the way back is the file restore in step 6.

## Files and md5s
| File | before | after |
|---|---|---|
| `src/dom_store.js` on box1, box3 and box4 (all three read byte-identical, 215 lines, same as git main before #574) | `3265fc4a6b070519884254a38bf61360` | `bba6552b946cc4a44b3e0fef1308940e` |
| `01-dom-extract.patch` (path relative to `scrapers/lightsail-crawler`, `patch -p1`) | | `e8dd5fb91605ac5ffc17bb88c7c4b773` |
| `drift-check.sh` | | `402e7cc541b058e836bd4f6de4305baf` |
The patch applied to a copy of box4's real file gives exactly the after md5; `drift-check.sh` passed on that copy (patched md5 `bba6552b…`, smoke 4/4) and reports ALREADY PATCHED on the new file. The boxes' checkouts are hand-patched and dirty: do NOT `git pull`/`merge`/`commit` there. Box IPs: box4 100.50.85.234, box3 184.73.158.210, box1 34.203.148.79.

## Cache size and disk estimate (per box, from measured values; estimates, not a run)
What changes: for a page where no JSON-LD block carries the car's VIN and there is no DDC dataLayer (Team Velocity, and any other such platform), the cached extract goes from the dealer's JSON-LD block (about 22,000 chars) to the page window around the VIN (4,000 chars before to 8,000 after = at most 12,000 chars). DDC (Dealer.com) and VIN-bearing JSON-LD pages (DealerOn) are unchanged.
- **Bytes per page, before vs after.** Before (measured on real Team Velocity blobs on box1): 22,007 chars of JSON-LD -> **2.8-3.0 KB gzipped** (2,914 measured; blobs of 2,810-3,052 B). After: a real cached HTML page extract of 8,698 chars gzips to 2,850 B, so a full 12,000-char window is about **3.9 KB** (a repeated-text proxy of the first 12,000 chars of the dealer block gives 2.1 KB; HTML with inline scripts compresses less). Both fit one 4 KB filesystem block in most cases, so **on-disk bytes per file are the same (4 KB), and about 8 KB only for a page that compresses badly.**
- **What really moves the disk is how many files are kept.** A blob is rewritten only when the day's extract hash differs from yesterday's, and files are kept 7 days. Today a Team Velocity car has 1-8 blob files (sample of 9 cars: 4, 2, 1, 1, 1, 1, 8, 8, 2; mean ~3): its dealer block is mostly stable. The window includes the car's own price/days-on-lot text, so some cars will change daily.
- **Pages that can be affected per night** (upper bound = Team Velocity + "other" platform records in the shards; Dealer.com and DealerOn excluded): box1 56,790 + 18,311 = **75,101**, box3 80,048 + 38,288 = **118,336**, box4 91,049 + 45,920 = **136,969**.
| Per box | Free now (`df -h /`) | Free inodes | Likely: same files, same 4 KB blocks | If every window file becomes 8 KB (3 files/car) | Worst case: new file every night, 8 files/car (7-day retention) at 8 KB, minus today's ~3 x 4 KB |
|---|---|---|---|---|---|
| box1 | 133 GB of 154 GB (14% used) | 18.7 M | about +0 | +0.9 GB | **+3.7 GB (2.8% of free)** |
| box3 | 277 GB of 309 GB (11% used) | 37.8 M | about +0 | +1.4 GB | **+5.9 GB (2.1% of free)** |
| box4 | 274 GB of 309 GB (12% used) | 37.3 M | about +0 | +1.6 GB | **+6.8 GB (2.5% of free)** |
Worst-case files: 0.60 M (box1), 0.95 M (box3), 1.10 M (box4) against the free inodes above (about 3% of them). Current `dom_blobs`: box1 7.6 GB / 847,802 VIN dirs, box3 16 GB / 1,095,539, box4 1,150,713 dirs (size not measured: `du` over a million directories is too heavy to run on a live box). All three are comfortably inside their disks; the 7-day prune (`DOM_RETAIN_DAYS`) bounds the growth. Caveats: the "after" size is an extrapolation (no full Team Velocity page is cached to measure); "other platform" cars are counted although some will keep their JSON-LD block; shard totals are the whole current inventory, not just last night's pages.

## Dry-run plan: box4 first (about 10 minutes; start before 21:00 ET, hard stop 21:30 ET; the 22:00 crawl and the later sync are never touched)
0. **Preconditions** (stop if anything prints a process or if it is past 21:30 ET):
```bash
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@100.50.85.234 'TZ=America/New_York date +%H:%M; pgrep -fa "run_nightly_chain|run-daily-crawl|standalone|inventory-sync" | grep -v pgrep; df -h / | tail -1; md5sum ~/nj-scraper/scrapers/lightsail-crawler/src/dom_store.js'
```
   The md5 must be `3265fc4a6b070519884254a38bf61360`.
1. **Stage** (writes only under `/tmp`), from the Mac in the repo checkout at the merged commit:
```bash
P=docs/box-patches/2026-10-22-dom-extract-vin-window; ssh -i ~/.ssh/trimscout_box_2026 ubuntu@100.50.85.234 'mkdir -p /tmp/dx'
scp -i ~/.ssh/trimscout_box_2026 $P/{01-dom-extract.patch,drift-check.sh} ubuntu@100.50.85.234:/tmp/dx/
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@100.50.85.234 'cd /tmp/dx && md5sum *'   # e8dd5fb91605ac5ffc17bb88c7c4b773  01-dom-extract.patch / 402e7cc541b058e836bd4f6de4305baf  drift-check.sh
```
2. **Drift check + dry run** on the box (read-only, works on a copy): must end `DRIFT CHECK PASS` and print `bba6552b946cc4a44b3e0fef1308940e`:
```bash
bash /tmp/dx/drift-check.sh
```
3. **Backup**:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/dom-extract-20261022; mkdir -p $B; cp -p src/dom_store.js $B/; md5sum $B/dom_store.js | tee $B/md5s.txt
```
4. **Apply and verify**:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && patch -p1 < /tmp/dx/01-dom-extract.patch
md5sum src/dom_store.js    # must be bba6552b946cc4a44b3e0fef1308940e
cp src/dom_store.js /tmp/chk.mjs && node --check /tmp/chk.mjs && echo SYNTAX_OK; rm -f /tmp/chk.mjs
grep -c "Keep the page around the VIN instead" src/dom_store.js   # expect 1
```
5. **Nothing else**: no restart, no cron edit, no crawl start.
6. **Restore** (one line):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && cp -p ~/backups/dom-extract-20261022/dom_store.js src/ && md5sum src/dom_store.js   # expect 3265fc4a6b070519884254a38bf61360
```
7. **After the first crawl on box4 (next morning)**, read-only: take 5 Team Velocity VINs, `zcat dom_blobs/<VIN>/<newest>.html.gz | head -c 600` must show page markup around the VIN and no `"@graph"`; blob size mean (expect ~3-4 KB); new files per car vs the table above; `df -h /` and `df -i /` against today's 274 GB / 37.3 M free. If the blobs show where stock and price live, that is the input for a real extraction fix. Roll out to box3 and box1 only after that look, with the same steps (their file is byte-identical, so the same patch and md5s apply).
