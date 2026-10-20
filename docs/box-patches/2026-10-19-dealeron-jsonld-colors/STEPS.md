# Box patch: exterior/interior colour from any JSON-LD block (DealerOn-style pages)

Code only on the PR branch `fix/dealeron-color-jsonld`. Nothing here has been run, and no box was read or touched while writing it. Boxes 1, 3, 4 only (not box2). Do it in a no-crawl window, one box at a time, on Paul's own typed GO.
No restart is needed: every crawl is a fresh Node process, so the next 22:00 start loads the patched files. Kill switch if it misbehaves: add `CRAWLER_JSONLD_COLORS=false` to that box's crawl cron line (the fill is then skipped; nothing else changes).

## What it fixes
DealerOn pages (`/new-City-Year-…` URLs) carry two JSON-LD blocks: a `Vehicle` block with no colour and a `Product` block with `color`. The extractor read only the Vehicle block. The 2026-10-19 box2 audit found 82,205 of 92,044 active new MY2025-27 cars on these URLs with a blank exterior colour (and 91,714 with a blank interior). New file `src/jsonLdColors.js` reads colour from any JSON-LD block that is about the same car (same VIN, same stock number, or - for a Product with no VIN - the same `name` as the Vehicle block), and `src/standalone.js` calls it just before the existing labelled-colour fill. Blanks only; a non-blank value is never replaced. The interior colour from the page HTML ("Interior Color" spec list) is PR #416's `fillColorsFromLabels`; patch 02 below installs it if a box does not already have it.

## Patches (paths relative to `scrapers/lightsail-crawler`; apply with `patch -p1`)
| Patch | What | md5 | Lines |
|---|---|---|---|
| `01-jsonld-colors.patch` | new `src/jsonLdColors.js` + 3 lines in `src/standalone.js` (needs the #416 lines in `standalone.js` as context) | `7300894c1e7e7ae032949942879399ad` | 139 |
| `02-label-colors-pr416.patch` | ONLY if the box lacks #416: new `src/listingColors.js` + import and call in `src/standalone.js` | `816982532d897efda718f09017dae7ed` | 56 |

Dry-run on the repo side: 02 then 01 applied to `origin/main` minus #416 gives byte-identical `standalone.js` (`68e5d49d50d93c6219cea6360d1e5672`), `jsonLdColors.js` (`069bb6fe9390b4ba04a621b3d367da4e`) and `listingColors.js` (`c63822c08180890a66403d516fc0c561`) to the PR branch; 01 alone applies to `origin/main`. **Not yet dry-run against any box's real `standalone.js`** - the boxes' checkouts are hand-patched, so step 3's dry-run is the real test, and the "before" md5 of each box must be recorded in step 2 (it is not known here).

The boxes' checkouts are hand-patched and dirty: do NOT `git pull`, `git merge` or `git commit` there. Use the patches only. Box IPs: box1 34.203.148.79, box3 184.73.158.210, box4 100.50.85.234.

## Steps (repeat per box; set `BOX` to the box's IP)

0. From the Mac, in the repo checkout, copy the patches up:
```bash
scp -i ~/.ssh/lightsail_key.pem docs/box-patches/2026-10-19-dealeron-jsonld-colors/0*.patch ubuntu@BOX:/tmp/
```
1. On the box, preconditions (stop if anything prints a process, or if it is past 21:30 ET):
```bash
TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone" | grep -v pgrep
md5sum /tmp/01-jsonld-colors.patch /tmp/02-label-colors-pr416.patch   # 7300894c1e7e7ae032949942879399ad / 816982532d897efda718f09017dae7ed
```
2. Record the "before" state, and decide whether 02 is needed:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler
md5sum src/standalone.js; ls -l src/listingColors.js src/jsonLdColors.js 2>&1
grep -c fillColorsFromLabels src/standalone.js    # 2 = #416 present (skip patch 02); 0 = absent (apply 02 first)
```
3. Dry-run before touching anything (each must print only "patching file" lines and exit 0; if 02 is needed, dry-run 02 first, apply it in step 5, then dry-run 01):
```bash
patch -p1 --dry-run < /tmp/02-label-colors-pr416.patch; echo rc=$?   # only when grep above printed 0
patch -p1 --dry-run < /tmp/01-jsonld-colors.patch; echo rc=$?        # when 02 is not needed
```
If a dry-run rejects, stop: that box's `standalone.js` has drifted; send the md5 and the reject output back instead of forcing anything.
4. Backup (record the md5s):
```bash
B=~/backups/dealeron-jsonld-colors-20261019; mkdir -p $B
cp -p src/standalone.js $B/ && [ -f src/listingColors.js ] && cp -p src/listingColors.js $B/
(cd $B && md5sum * | tee md5s.txt); ls src/jsonLdColors.js 2>/dev/null || echo "jsonLdColors.js absent before (restore = delete it)"
```
5. Apply, then verify:
```bash
patch -p1 < /tmp/02-label-colors-pr416.patch      # only when needed
patch -p1 < /tmp/01-jsonld-colors.patch
md5sum src/standalone.js src/jsonLdColors.js src/listingColors.js
node --check src/standalone.js && node --check src/jsonLdColors.js && node --check src/listingColors.js && echo SYNTAX_OK
grep -c "fillColorsFromJsonLd" src/standalone.js    # expect 2 (import + call)
```
Expected `jsonLdColors.js` md5 `069bb6fe9390b4ba04a621b3d367da4e` and `listingColors.js` md5 `c63822c08180890a66403d516fc0c561` (a box whose `listingColors.js` differs from this was hand-edited - report it). `standalone.js` is `68e5d49d50d93c6219cea6360d1e5672` only on a box that was otherwise identical to `main`; on a drifted box compare with the "before" md5 from step 2 instead (patch 01 adds 3 lines to it, patch 02 adds 3).
6. Restore (puts the backed-up files back, removes the new module, re-checks against the step 2 / `md5s.txt` hashes):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && B=~/backups/dealeron-jsonld-colors-20261019
cp -p $B/standalone.js src/ && { [ -f $B/listingColors.js ] && cp -p $B/listingColors.js src/ || rm -f src/listingColors.js; }
rm -f src/jsonLdColors.js; (cd $B && cat md5s.txt) && md5sum src/standalone.js src/listingColors.js 2>&1
```
(`rm src/listingColors.js` only runs when the box had none before, i.e. when patch 02 added it.)

## What to watch
Colour only changes when a car's page is fetched again, so expect it to move over the following crawls, not on the first night's old cars. From the reader account on box2, counts only (before the patch, and again after two nights), for DealerOn-style URLs:
```sql
SELECT source_box, COUNT(*) cars, ROUND(100*AVG(exterior_color IS NULL OR exterior_color=''),1) ext_blank_pct, ROUND(100*AVG(interior_color IS NULL OR interior_color=''),1) int_blank_pct
FROM dealer_inventory WHERE removed_at IS NULL AND cond='new' AND year BETWEEN 2025 AND 2027
  AND REGEXP_REPLACE(vdp_url,'^https?://[^/]+','') REGEXP '^/(new|used)-[^/]+-20' GROUP BY source_box;
```
Baseline 2026-10-19 (all 10 audited models together): exterior blank 89%, interior blank 99.6%. A drop on the patched boxes only (not on box2's own-crawled rows) is the signal. If nothing moves, the cause is that the cars are not being re-fetched (the stub-row pattern seen on Team Velocity dealers), not this patch.
