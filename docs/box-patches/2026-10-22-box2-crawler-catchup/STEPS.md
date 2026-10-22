# Plan: bring box2's crawler up to date with box4's (exact-file copy), install tomorrow (2026-10-22) in idle time on Paul's GO

Docs only. Everything below was learned **read-only** (box2 and box4 reads between 21:25 and 21:31 ET on 2026-10-21; box tree pulled to the Mac as a tarball of `src/ scripts/ package*.json`; no secrets read: env files were listed by name, mtime, md5 prefix and variable NAMES only, the crontab was printed with secret-looking values masked). Nothing was written on any box. Nothing here has been run on a box except those reads.

## 1. What box2 has locally (git `b8ea6e3`, 2026-09-22, branch `cursor/nj-crawler-ops-36e4`; box4 is on the SAME base commit, branch `expansion-brands`)
Both trees are dirty hand-patched checkouts; neither matches any commit.
| Kind | box2 local edits | Also on box4? |
|---|---|---|
| tracked `src/` modified | `box_report.js` (+24), `brand_match.js` (+22), `capacity.js` (+27), `enricher.js` (+19/-), `inventory_shards.js` (+7/-), `standalone.js` (373 lines changed) | `box_report.js`, `brand_match.js`, `capacity.js`: **byte-identical** (same md5). `enricher.js`, `inventory_shards.js`, `standalone.js`: box4 has a **superset** (see 2) |
| tracked `scripts/` modified | `run-daily-crawl.mjs` (438 lines changed), `recommend-shard-split.mjs` (+62) | `recommend-shard-split.mjs` identical. `run-daily-crawl.mjs` differs (box4 has the run-label fix, see 2) |
| untracked `src/` (12 modules) | `bigJson.js`, `crawl_claims.js`, `descriptionFeatures.js`, `facebookPixelFields.js`, `knownModels.js`, `listingModel.js`, `optionSentenceFilter.js`, `probeRetry.js`, `syncCrawlGate.js`, `vdpResponseGate.js`, `vdpUrlFilter.js`, `vdpUrlTrim.js` | all present on box4; all identical except `facebookPixelFields.js` (box4 has #569 on top) |
| untracked `scripts/` | `analyze_hyundai_genesis.mjs`, `check-crawl-gate.mjs`, `materialize-core-locator-gap-dealer-files.mjs` | `check-crawl-gate.mjs`, `materialize-...` identical; **`analyze_hyundai_genesis.mjs` is box2-only** (left alone) |
| top level, data | `probe_bmw.mjs` .. `probe_bmw6.mjs` (box2-only scratch), ~110 modified/untracked `dealers/**` data files, `data/**` run output, `docs/capacity_history.csv` | data only; not touched by this plan |
| backups | `src/.pre-395-*`, `src/.pre-399-*`, `*.bak.*` | box4 has its own equivalents; box2's are left in place |

**Box2-only code that box4 lacks: none that matters.** A line-level three-way comparison (git base vs box2 vs box4) of the 11 differing files shows every line box2 added is also in box4, except 5 lines in `standalone.js`/`inventory_shards.js`: they are the OLD call sites `readJsonLarge(LATEST_SNAPSHOT_PATH)` / `readJsonLarge(inventoryShardPath(...))` / one `isLikelyVdpUrl` filter and `probeDealerBotProtectionWithRetry(dealer)` form that box4 later replaced (state-shard wall fix: `legacyShardSplit`, retry-aware bot probe). So copying box4's file loses nothing box2 uniquely has.

## 2. Every `src/` file, box2 vs box4 (md5; 109 vs 118 files, backups excluded from "real")
- **94 identical** (includes `bigJson.js`, `crawl_claims.js`, `box_report.js`, `capacity.js`, `brand_match.js`, ... the whole shared core).
- **11 differ**: 9 crawl files to copy (`brands`, `enricher`, `facebookPixelFields`, `http_probe`, `inventory_shards`, `nj_policy`, `porscheSchemaOrgFields`, `standalone`, `window_sticker`) and 2 mirrors that are NOT run from this directory and are **skipped** (`deals_api_server.js`, `auth_api_server.js`: the live deals-api/auth-api run from `/opt/trimscout-deals/src`).
- **box4-only real files (9)**: 5 are imported by box4's `standalone.js` and **are copied** (`jsonLdColors`, `jsonLdStock`, `legacyShardSplit`, `listingColors`, `sitemapDiscovery`); 3 (`dealerDriftDetect`, `dealerPageIdentityPlain`, `expansionDealerFiles`) are imported only by box4's newer `scripts/dealer-bot-report.mjs`, and 1 (`inventoryListQuery`) only by the `deals_api_server.js` mirror: **not copied**. The 4 other "box4-only"/"box2-only" paths are `.pre-*` backup copies.
- **scripts/**: 59 identical; `dealer-bot-report.mjs` and `run-daily-crawl.mjs` differ (box4 includes the 2026-09-27 run-label fix so a same-day core + expansion run cannot overwrite each other's bot report; box2 runs core only, **leave both unchanged** so the cron entrypoint and its report-file pairing stay as they are); box4-only: `dealer-drift-report.mjs`, `run_core_crawl_when_safe.sh`, `run_nightly_chain.sh`, `split-state-shards-by-brand.mjs` (box4's chain; box2 keeps its direct cron).
- **package**: `package-lock.json` identical; `package.json` differs by one script entry (`dealer-drift-report`) - not copied. Installed versions identical on both: apify 3.7.2, crawlee 3.18.1, got-scraping 4.2.1, mysql2 3.24.2, patchright 1.63.0; 272 top-level `node_modules` entries each; node v22.23.2 / npm 10.9.8 on both. **No `npm install` is needed or wanted.**

### The 14 files to copy (`manifest.txt` holds the md5s the scripts check)
| File | box2 now | box4 (target) | kind |
|---|---|---|---|
| `src/brands.js` | `7df982dbb1edbcbbd5accba8b080bf44` | `fd92799b12bf4d903d9cf0aaafc9fc34` | changed |
| `src/enricher.js` | `f0439a14ec18ff1fb4eb7e5e90d457cb` | `16aff0e3c2e0c5116942e40a12cd2c11` | changed |
| `src/facebookPixelFields.js` | `38ca8bfb10d2a91d1ea7722c16d6dd0b` | `3a08479b1342588d1fa30d43e0901d17` | changed (= #569) |
| `src/http_probe.js` | `f4ee7e9eb577fa83e06ffafc2ebf3289` | `5930f6d2e458c12797151b59b4a6ced4` | changed |
| `src/inventory_shards.js` | `70fd9a7ffdd5ea1d69647455c329bbcc` | `46b5b4a5c7d1b1b90abf032bdca6a1bb` | changed |
| `src/nj_policy.js` | `526af3d3d686054b3c827740f0a61f32` | `a136a25a59f415a1c17b86a23f5b93af` | changed |
| `src/porscheSchemaOrgFields.js` | `91c97852ce6e62845aae7889e34afcda` | `2a5b0e03e834bdf99f7ab7b9182d8f9d` | changed (= #565 `findVehicleLd`) |
| `src/standalone.js` | `a9cc633204d7b69eb6491507c0f59a6b` | `718da826025e51dab544fed5ab8c5901` | changed |
| `src/window_sticker.js` | `4a30d410ed458abe722e3f29841a0b04` | `2e6872f03b6ff80fb74dc8eb900b0cbe` | changed |
| `src/jsonLdColors.js` | (absent) | `9b9471479aa3dacd2604540c2a123724` | new (#564) |
| `src/jsonLdStock.js` | (absent) | `284350b41333e926c101c01f1d8302e8` | new (#565) |
| `src/legacyShardSplit.js` | (absent) | `09e4f0abf29b286f0bd4d2135bd22acb` | new |
| `src/listingColors.js` | (absent) | `c63822c08180890a66403d516fc0c561` | new (#416) |
| `src/sitemapDiscovery.js` | (absent) | `8d10f68fb5cda9134a7b81315677f696` | new |

## 3. Method: copy box4's exact files (recommended)
| Option | Result | Surprises |
|---|---|---|
| **A. Copy box4's 14 exact files** (this plan) | box2's runtime `src/` is md5-identical to the tree box3/box4 have run nightly; each file is checked against a recorded md5 | fewest: nothing is re-derived, box2 has no unique code to lose, and a wrong file is caught by md5 before anything is written |
| B. Apply #564 patch 02, #564 patch 01, #565, #569 one by one | I applied the four repo patch files plus #569 in order to a copy of box2's real `standalone.js`: **they all apply cleanly**, but the result is `0b67cbd5...`, not box4's `718da826...`, because box4 also carries its earlier hand patches (legacy shard split, robots/sitemap discovery, retry-aware probe) that exist as no patch file here. And `enricher`, `inventory_shards`, `http_probe`, `nj_policy`, `brands`, `window_sticker` would still differ | a hybrid no box has ever run |
| C. git update (`pull`/`merge`/`checkout`) | would conflict on ~8 modified tracked files and the untracked modules; main is hundreds of commits past `b8ea6e3` with different dependencies | most: also forbidden by the standing "never git pull on a box" rule |

Install order with #572: **this catch-up first, then #572's box2 patch.** After the catch-up box2's `standalone.js` is `718da826...`, and `02-box2-trim-clean.patch` then gives `2e69d8748b9addbff93dac618bb71f1e` (checked on a copy of box4's real file) plus `src/trimClean.js` `c7288942656fb4df16b2c8552e558eb4`. #564/#565/#569 are already inside the copied files: **do not** apply those patches to box2 separately.

## 4. What must survive (none of it is touched; each is checked)
- **Crontab**: `0 22 * * *` `cd .../lightsail-crawler && ... CRAWL_STATES=AL,CA,CO,GA,IN,MD,ME,MT,NC,ND,NV,OK,OR,PA,TN,TX,VT,WV,WY CRAWLER_MAX_CONCURRENT_STATES=6 CRAWLER_P90_SEC_PER_ROOFTOP=30 CRAWLER_DRIVER_BUDGET_HOURS=23 node scripts/run-daily-crawl.mjs`, the `CRON_TZ`/`TZ`/`CRAWL_STATES` header lines, and `10 22 * * *` `run_sync_when_safe.sh`. This plan never edits cron; step 2 and step 6 compare `crontab -l | md5sum`.
- **Env files**: `.env` (`CRAWLER_PROGRESS_HOST`, `CRAWLER_PROGRESS_PORT`; box4 has no such file) and `.env.trimscout-db` (`DB_HOST DB_NAME DB_PORT DB_WRITER_USER DB_WRITER_PASSWORD`; same md5 as box4's). Not read for values, not touched; their md5 is recorded before and after.
- **node_modules / package files**: unchanged (identical versions to box4's); no npm run.
- `data/` (19 state-wide shards, `snapshots/`, `runs/`), `dealers/`, `logs/`, the `.pre-*`/`.bak.*` backups, `probe_bmw*.mjs`, `scripts/` entirely, `/opt/trimscout-deals` (deals-api, auth-api, MariaDB), `/home/ubuntu/inventory-sync`: untouched. **No restart of anything** (each crawl is a fresh Node process).

## 5. Behaviour that WILL change on box2's first crawl (so nothing surprises you)
1. **First run migrates the shard layout.** Box2 has 19 state-wide shards in `data/inventory/` (CA 218 MB, TX 174 MB, PA 141 MB, NC 108 MB, MD 70 MB, ...) and zero per-brand shards. Box4's `standalone.js` reads/strips the in-scope records of a legacy `<ST>.json` into per-brand `<ST>__<brand>.json` files (`legacyShardSplit.js`; this is the state-shard-wall fix). Expect new `__` files and shrinking state files after the first run. The nightly sync reads every `*.json` there, as on box4. Disk is fine (227 GB free). Memory: box2 is 15.8 GB, no swap, with a MariaDB OOM history; per-brand shards are what keep files under V8's string limit, but watch the first run.
2. **Robots/sitemap discovery** adds requests for dealers whose normal URL list came back empty (kill switches `CRAWLER_ROBOTS_SITEMAP=false`, `CRAWLER_SITEMAP_RETRY_PASS=false`).
3. **#564/#565/#569 fills** (colours, stock numbers from JSON-LD, Team Velocity price from the pixel; switches `CRAWLER_JSONLD_COLORS=false`, `CRAWLER_JSONLD_STOCK=false`, `CRAWLER_SCHEMA_GRAPH=false`, `CRAWLER_PIXEL_PRICE=false`). Box2's 19 states will start filling those fields.
Put any kill switch on the cron command line (env assignments before `node`), never in a file.

## 6. Steps (install tomorrow in an idle window, one typed GO)
0. **Re-verify box4 still has the manifest files** (read-only; box4 may change before tomorrow). On the Mac:
```bash
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@100.50.85.234 'cd ~/nj-scraper/scrapers/lightsail-crawler && md5sum src/{brands,enricher,facebookPixelFields,http_probe,inventory_shards,nj_policy,porscheSchemaOrgFields,standalone,window_sticker,jsonLdColors,jsonLdStock,legacyShardSplit,listingColors,sitemapDiscovery}.js'
```
   Compare with column 3 of the table above (or `manifest.txt`). If any differ, stop: the manifest is stale (box4 moved on).
1. **Stage** (writes only under `/tmp` on box2). Mac -> scratch -> box2, in this repo checkout:
```bash
K="-i ~/.ssh/trimscout_box_2026"; Z=docs/box-patches/2026-10-22-box2-crawler-catchup; W=$(mktemp -d); mkdir -p $W/src
for f in brands enricher facebookPixelFields http_probe inventory_shards nj_policy porscheSchemaOrgFields standalone window_sticker jsonLdColors jsonLdStock legacyShardSplit listingColors sitemapDiscovery; do scp -q $K ubuntu@100.50.85.234:nj-scraper/scrapers/lightsail-crawler/src/$f.js $W/src/; done
ssh $K ubuntu@52.202.234.65 'mkdir -p /tmp/b2sync/src'
scp -q $K $W/src/*.js ubuntu@52.202.234.65:/tmp/b2sync/src/; scp -q $K $Z/manifest.txt $Z/drift-check.sh ubuntu@52.202.234.65:/tmp/b2sync/
```
2. **Preconditions on box2** (stop if anything prints a process, if it is past 21:30 ET, or if the last `[sync-lock]` event is an `acquire`):
```bash
TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone" | grep -v pgrep
grep "sync-lock" ~/.pm2/logs/deals-api-out.log | tail -1
cd ~/nj-scraper/scrapers/lightsail-crawler; crontab -l | md5sum; md5sum .env .env.trimscout-db package.json package-lock.json   # record all five
```
3. **Drift check** (read-only). It must end `DRIFT CHECK PASS`; it re-checks box2's 9 current md5s against the plan (a changed file means box2 moved after 2026-10-21 21:28 ET: stop and re-plan), checks the 14 staged md5s, syntax-checks every file on an overlay copy, and statically verifies that every relative import in `src/` and `scripts/` (566 statements in the local rehearsal) still resolves to a file exporting the names imported, using box2's own `node_modules`:
```bash
bash /tmp/b2sync/drift-check.sh        # defaults: ~/nj-scraper/scrapers/lightsail-crawler and /tmp/b2sync
```
4. **Backup** (src + package files, as one tar, with its md5 and file count):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/b2-crawler-catchup-20261022; mkdir -p $B
tar czf $B/crawler-src-pkg.tgz src package.json package-lock.json && md5sum $B/crawler-src-pkg.tgz | tee $B/md5s.txt && tar tzf $B/crawler-src-pkg.tgz | wc -l
md5sum src/*.js | tee $B/src-md5-before.txt | wc -l
```
5. **Apply** (copies only the 14 manifest files, preserving nothing else):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler
awk '!/^#/ && NF {print $3}' /tmp/b2sync/manifest.txt | while read -r p; do cp /tmp/b2sync/$p $p; done
```
6. **Verify** (md5s equal box4's, syntax, nothing else moved):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler
awk '!/^#/ && NF {print $2 "  " $3}' /tmp/b2sync/manifest.txt | md5sum -c -        # 14 lines, all OK
for f in $(awk '!/^#/ && NF {print $3}' /tmp/b2sync/manifest.txt); do cp $f /tmp/chk.mjs && node --check /tmp/chk.mjs || echo "SYNTAX FAIL $f"; done; rm -f /tmp/chk.mjs; echo SYNTAX_DONE
crontab -l | md5sum; md5sum .env .env.trimscout-db package.json package-lock.json    # must equal the five from step 2
```
7. **Restore** (one line; removes the 5 new files, then unpacks the original `src/` and package files over everything):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && rm -f src/jsonLdColors.js src/jsonLdStock.js src/legacyShardSplit.js src/listingColors.js src/sitemapDiscovery.js && tar xzf ~/backups/b2-crawler-catchup-20261022/crawler-src-pkg.tgz && md5sum src/standalone.js   # expect a9cc633204d7b69eb6491507c0f59a6b
```
   If a crawl has already run on the new files, `data/inventory` now has per-brand `__` shards; the OLD code ignores them while the old state-wide files may be shorter, so restore BEFORE the 22:00 run or ask first (do not delete shards by hand).
8. **Watch the first run** (22:00): `logs/` for `legacy`/shard lines, count of `data/inventory/*__*.json`, `data/runs/<date>/core/box-report.json` duration vs the last 3 nights (box2 core: 9.9-14.7 h), box2 `free -m` / `dmesg` OOM lines for mariadbd (11 kills Oct 10-16), the 22:10 sync log (`removed` count; the fleet's removals are already high and unexplained), and the first `Sync lock` events. After it, install #572's box2 patch.
