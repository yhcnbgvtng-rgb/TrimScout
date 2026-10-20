# Box patch: parse `@graph` Vehicle nodes (Team Velocity) + stock number from JSON-LD sku

Code only on the PR branch `feat/jsonld-stock-and-graph-patch`. Nothing here has been run, and no box was read or touched while writing it. Boxes 1, 3, 4 only (not box2). Do it in a no-crawl window, one box at a time, on Paul's own typed GO.
No restart is needed: every crawl is a fresh Node process, so the next 22:00 start loads the patched files.

## What it fixes
1. **`@graph` (patch `01-schema-graph`)**: the 2026-10-19 Toyota audit found 20,745 new Toyota cars on Team Velocity `/viewdetails/` pages with price/MSRP blank 97.5%. Box4's logs show their detail pages are fetched (HTTP 200); the box's schema.org strategy (`standalone.js` ~line 288) checks only the JSON-LD block's top-level object, and Team Velocity wraps the Vehicle in `@graph`, so the strategy returns null and the crawl falls to the VIN-only Strategy 3 (model recovered from the title, trim from the URL slug, no price/MSRP). Main has had `findVehicleLd` since #353; box4's `porscheSchemaOrgFields.js` is the 2026-09-22 version (md5 `91c97852…`, git `fb63fd2`) and lacks it. This patch adds ONLY `findVehicleLd` to that file (not main's other later changes) and switches the strategy to call it.
2. **Stock number (patch `02-jsonld-stock`)**: stock number is blank on 56,110 of 56,256 DealerOn-style, 20,722 of 20,745 Team Velocity and 26,109 of 46,641 Dealer.com new Toyotas. New `src/jsonLdStock.js` reads `sku` / `stockNumber` / `vehicleStockNumber` from the JSON-LD nodes about the same car (DealerOn: the Product block's sku; Team Velocity: the `@graph` Vehicle's sku; Dealer.com: a flat Car's sku), blank only. Needs `jsonLdColors.js` from #564 (patch 02 also edits it to export the shared node matcher).

## Patches (paths relative to `scrapers/lightsail-crawler`; apply with `patch -p1`; ORDER MATTERS)
| # | Patch | Directory | What | md5 |
|---|---|---|---|---|
| 1 | `02-label-colors-pr416.patch` | `2026-10-19-dealeron-jsonld-colors/` | **box4 needs it** (no `listingColors.js`); box1/box3 only if the check below says so | `816982532d897efda718f09017dae7ed` |
| 2 | `01-jsonld-colors.patch` | `2026-10-19-dealeron-jsonld-colors/` | #564 colours | `7300894c1e7e7ae032949942879399ad` |
| 3 | `01-schema-graph.patch` | this directory | `findVehicleLd` + `@graph` strategy + `CRAWLER_SCHEMA_GRAPH` switch | `d20e9f2226e7c4e7bcc7fcf7a35354eb` |
| 4 | `02-jsonld-stock.patch` | this directory | `jsonLdStock.js` + call + shared matcher | `fc8fe22ee2cea8e4105692c627c424b6` |

`drift-check.sh` (md5 `e6787422c978e7be723ddf6d35519f60`, this directory) works out which of the four a box still needs and applies them, in order, to a COPY of the box's files in a temp dir - nothing in the checkout changes. Repo-side proof: starting from a reconstruction of box4 (standalone.js with none of #416/#564/#353 pieces, `porscheSchemaOrgFields.js` = git `fb63fd2`, md5-identical to box4's), all four apply in order and give files identical to the PR branch; `standalone.js` there is a reconstruction from main, not box4's real file, so **the real gate is step 3 on each box**.

The boxes' checkouts are hand-patched and dirty: do NOT `git pull`, `git merge` or `git commit` there. Use the patches only. Box IPs: box1 34.203.148.79, box3 184.73.158.210, box4 100.50.85.234.

## Off switches (add to that box's crawl cron line; each makes the new behaviour a no-op)
- `CRAWLER_SCHEMA_GRAPH=false` - ignore `@graph` again (top-level object only, as before).
- `CRAWLER_JSONLD_STOCK=false` - no stock-number fill.
- `CRAWLER_JSONLD_COLORS=false` - no JSON-LD colour fill (#564).
Last resort is the restore in step 6.

## Steps (repeat per box; set `BOX` to the box's IP)
0. From the Mac, in the repo checkout, stage the four patches and the checker on the box:
```bash
P=docs/box-patches; ssh -i ~/.ssh/lightsail_key.pem ubuntu@BOX 'mkdir -p /tmp/gs'
scp -i ~/.ssh/lightsail_key.pem $P/2026-10-19-dealeron-jsonld-colors/02-label-colors-pr416.patch ubuntu@BOX:/tmp/gs/564-02-label-colors-pr416.patch
scp -i ~/.ssh/lightsail_key.pem $P/2026-10-19-dealeron-jsonld-colors/01-jsonld-colors.patch ubuntu@BOX:/tmp/gs/564-01-jsonld-colors.patch
scp -i ~/.ssh/lightsail_key.pem $P/2026-10-19-schema-graph-stock/{01-schema-graph.patch,02-jsonld-stock.patch,drift-check.sh} ubuntu@BOX:/tmp/gs/
```
1. On the box, preconditions (stop if anything prints a process, or if it is past 21:30 ET), and confirm the files arrived intact:
```bash
TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone" | grep -v pgrep
cd /tmp/gs && md5sum *   # 564-02: 816982532d89..., 564-01: 7300894c1e7e..., 01-schema-graph: d20e9f2226e7..., 02-jsonld-stock: fc8fe22ee2cea..., drift-check.sh: e6787422c978e7be723ddf6d35519f60
```
2. Record the "before" state (also printed by step 3; keep it):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && md5sum src/standalone.js src/porscheSchemaOrgFields.js; ls -l src/listingColors.js src/jsonLdColors.js src/jsonLdStock.js 2>&1
```
3. **Drift check + dry run** (read-only; applies to copies):
```bash
bash /tmp/gs/drift-check.sh        # default dir: ~/nj-scraper/scrapers/lightsail-crawler
```
It must end with `DRIFT CHECK PASS`. Save its "md5 of the patched COPIES" block: after step 5 the real files must have exactly those md5s. Expected on every box: `porscheSchemaOrgFields.js` `2a5b0e03e834bdf99f7ab7b9182d8f9d`, `jsonLdColors.js` `9b9471479aa3dacd2604540c2a123724`, `jsonLdStock.js` `284350b41333e926c101c01f1d8302e8`, `listingColors.js` `c63822c08180890a66403d516fc0c561` (a different `porscheSchemaOrgFields.js` "before" md5 than `91c97852…` means that box has its own edits - the checker will say whether the patch still applies). `FAIL`/`DRIFT CHECK FAIL` (a `.rej`, a changed context line) = **stop**: send the md5s and the output back; do not force.
4. Backup (record the md5s):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/schema-graph-stock-20261019; mkdir -p $B
for f in standalone.js porscheSchemaOrgFields.js listingColors.js jsonLdColors.js jsonLdStock.js; do [ -f src/$f ] && cp -p src/$f $B/ || echo "absent before: $f" >> $B/absent.txt; done
(cd $B && md5sum *.js | tee md5s.txt; cat absent.txt 2>/dev/null)
```
5. Apply, then verify (apply only the patches step 3 listed under "patches needed", in that order; for box4 that is all four):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler
patch -p1 < /tmp/gs/564-02-label-colors-pr416.patch   # only if listed
patch -p1 < /tmp/gs/564-01-jsonld-colors.patch        # only if listed
patch -p1 < /tmp/gs/01-schema-graph.patch             # only if listed
patch -p1 < /tmp/gs/02-jsonld-stock.patch             # only if listed
md5sum src/*.js | grep -E "standalone|porscheSchemaOrgFields|listingColors|jsonLd"   # must equal the step 3 copies block
for f in standalone porscheSchemaOrgFields listingColors jsonLdColors jsonLdStock; do cp src/$f.js /tmp/chk.mjs && node --check /tmp/chk.mjs || echo "SYNTAX FAIL $f"; done; rm -f /tmp/chk.mjs; echo SYNTAX_DONE
grep -c findVehicleLd src/standalone.js; grep -c fillStockFromJsonLd src/standalone.js   # expect 3 and 2
```
6. Restore (puts the backed-up files back, deletes the files these patches created, re-checks against `md5s.txt`):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/schema-graph-stock-20261019
cp -p $B/standalone.js $B/porscheSchemaOrgFields.js src/
for f in listingColors.js jsonLdColors.js jsonLdStock.js; do if [ -f $B/$f ]; then cp -p $B/$f src/; else rm -f src/$f; fi; done
cat $B/md5s.txt; md5sum src/standalone.js src/porscheSchemaOrgFields.js; ls src/listingColors.js src/jsonLdColors.js src/jsonLdStock.js 2>&1
```
(`rm` only runs for a file the box did not have before, per the backup step.)

## What to watch
- Team Velocity dealers' log sections should lose the title-recovery lines: before, Vancouver Toyota logged 604 `blank model recovered from title`; check with `grep -c "blank model recovered from title" ~/nj-scraper/scrapers/lightsail-crawler/logs/wa-toyota-$(date +%F).log` (expect a large drop on the first crawl after applying).
- Values only change when a car's page is fetched again. From box2's reader account, counts only, for Team Velocity URLs (baseline 2026-10-19, new Toyota MY2025-27: price blank 97.5%, stock blank ~100%):
```sql
SELECT source_box, COUNT(*) cars, ROUND(100*AVG(price IS NULL OR price=0),1) price_blank_pct, ROUND(100*AVG(stock_number IS NULL OR stock_number=''),1) stock_blank_pct
FROM dealer_inventory WHERE removed_at IS NULL AND cond='new' AND year BETWEEN 2025 AND 2027 AND make='Toyota'
  AND REGEXP_REPLACE(vdp_url,'^https?://[^/]+','') LIKE '/viewdetails/%' GROUP BY source_box;
```
A drop on the patched boxes only is the signal. If price stays blank while model/stock fill, those pages' JSON-LD offer has no price (the dealer hides it) - not a patch problem.
- Not covered: box1/box2/box3 behaviour for Team Velocity was inferred from box2's source-box splits (all four boxes show 97-99% price blank), not read from their files. Box2's own crawl checkout is out of scope here.
