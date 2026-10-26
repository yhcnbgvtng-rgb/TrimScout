# Box patch: data for the /search "More filters" panel (facet counts, fuel / drivetrain / transmission, body style, dealer, VIN pattern)

Code only on the PR branch `feat/search-filter-box`, stacked on `feat/search-filter-panel` (the website side) and, through it, on #583. **Nothing here has been run on a box, no box was read or touched while writing it, and the PR does not install anything.** box2 only (the deals box; read `docs/BOXES.md` first). One restart, in an idle window, on Paul's own typed GO. If `2026-10-26-facet-extras.mjs` (#583) is not installed yet, install it first and take **one** restart for both.

## Why
The website panel (PR "Search: full filter panel …") shows live counts on year, mileage, days on market, body style, fuel, drivetrain, transmission and dealer chips, and lets a shopper filter by them and by VIN pattern. The box does not serve any of that yet. Until it does the page keeps those groups hidden (the counts call answers 404) and says so when a shared link carries filters the box cannot apply.

## What the box serves after this patch
| Piece | Detail |
|---|---|
| `GET /api/inventory/facet-counts?<the /search filters>` | `make` required (400 otherwise). Returns `{ supported: true, rows, dims: { year, mileage, bodyStyle, fuel, drivetrain, transmission, days, dealer } }`, or `{ supported: true, tooBroad: true, cap }` when the make's set is bigger than `FACET_COUNTS_ROW_CAP` rows (default 40,000). Each list counts the cars that pass **every other** filter but not its own. |
| New list filters on `GET /api/inventory` (and the contact-search POST) | `odometerMin`; `bodyStyle` (repeated, OR); `dealerId` (repeated, OR; one value is the same `i.dealer_id = ?` as before); `fuel`, `drivetrain`, `transmission` (repeated, OR, **only with a make**); `vinPattern` (`?` one character, `*` a run; needs three real characters, and without a make a literal start or end of three). |
| `filtersApplied` on every list response | The new filters this call applied (possibly `[]`). A box without the patch says nothing, which is how the page knows a filter was not applied. |

**Inferred filters.** There is no fuel or drivetrain column. `inventoryDerived.js` classifies from the trim / engine / model / body-style / transmission text with one set of patterns used for both the SQL (`CASE … REGEXP`) and the JS that counts, so a chip's number and the list it opens agree. A car whose text says nothing is in **no** class; "gas" means an engine is stated and nothing says hybrid / plug-in / electric / diesel. The patterns avoid backslashes (token edges are `[^A-Za-z0-9]`) so the SQL string literal cannot misread them. **Not tested against a real MariaDB** (none is available where this was written): the probe in step 5 compares the SQL result with the JS rules on a sample of real cars and fails the GO if more than 1% disagree.

## Cost and load: what is bounded, what is not measured
- `facet-counts` is **one** SELECT over the make's existing index range (the list query's own FROM/WHERE with the faceted filters removed), reading ten small columns and computing three CASE expressions per row, capped at `FACET_COUNTS_ROW_CAP + 1` rows and `max_statement_time`. Everything else is done in memory. A set over the cap is answered "too broad" and never scanned further. Nothing is added to the nightly rebuild.
- At most `FACET_COUNTS_MAX_CONCURRENT` (default 2) run at once; others wait `FACET_COUNTS_QUEUE_WAIT_MS` (default 1.5 s) and get the usual 503 "busy". Answers are cached 60 s per query string (300 entries). The page asks at most once per 250 ms burst and aborts the previous request.
- The new list filters are residual predicates on rows the make's index range already selects; `fuel` / `drivetrain` / `transmission` are ignored without a make, and a VIN pattern without a make needs a literal start or end (primary key / `idx_inv_vin_rev`).
- **Not measured:** the real row-fetch time on the biggest sets (a whole make like Ford is over the cap and answers "too broad" at once; a make + model set up to 40,000 rows is the heaviest case). The probe times it on real sets before anything points at it, and `FACET_COUNTS_ROW_CAP` can be lowered with no code change.

## Files
| Box file (`/opt/trimscout-deals/src/`) | Change |
|---|---|
| `inventoryListQuery.js` | anchored edits (6, `scripts/box/filter-panel-edits.json`): the import, `filtersApplied`, several dealers, `odometerMin`, `bodyStyle`, the derived filters, the VIN pattern |
| `deals_api_server.js` | anchored edits (5): the import, the route, the handler with its gate and cache, `filtersApplied` echoed on list calls |
| `inventoryDerived.js`, `facetCounts.js` | new modules (embedded in the patcher) |

The patcher aborts and writes nothing unless every `find` occurs exactly once (or its marker is already there), and unless `facetExtras.js` and `optionsPaidOnlyServer.js` are present. The box's `deals_api_server.js` drifts from the repo, so **the dry run on box2 is what proves the anchors** (not run). There is no flag and nothing to set: the filters are inert until the web app sends them.

## Steps (box2)
0. **Preconditions** (stop if any prints, or if it is 21:50-23:59 ET): same as the facet-extras patch: no crawl, no sync, sync lock free.
```bash
ssh box2 'TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone|backfill|remap" | grep -v pgrep; grep "\[sync-lock\]" ~/.pm2/logs/deals-api-out.log | tail -2'   # last sync-lock event must be a release
ssh box2 'pm2 ls'   # the process name: earlier steps say `deals-api`, docs/BOXES.md says `trimscout-deals-api`; use whichever pm2 shows (P below)
ssh box2 'ls /opt/trimscout-deals/src/facetExtras.js /opt/trimscout-deals/src/optionsPaidOnlyServer.js'   # both must exist (the facet-extras patch is the prerequisite)
ssh box2 'P=deals-api; pm2 jlist | node -e '"'"'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api").pm2_env;console.log(JSON.stringify({DISABLE_FACET_REBUILD:p.DISABLE_FACET_REBUILD,OPTIONS_PAID_ONLY:p.OPTIONS_PAID_ONLY,OPTION_MODEL_POLICY_PATH:p.OPTION_MODEL_POLICY_PATH,OPTION_JUNK_RULES:p.OPTION_JUNK_RULES,FACET_COND_PRICE:p.FACET_COND_PRICE}))})'"'"''   # write these down: the restart must keep them
```
1. **Copy** the patcher and the probe from the Mac, in the repo checkout of the PR branch:
```bash
P=scripts/box; ssh box2 'mkdir -p /tmp/fp'; scp $P/2026-10-27-filter-panel.mjs $P/2026-10-27-filter-coverage-probe.mjs box2:/tmp/fp/
ssh box2 'cd /tmp/fp && md5sum *'      # compare with the md5s in the PR description
```
2. **Dry run** (writes nothing). Every edit must say `will apply` (or `already applied`) and it must end `DRY RUN ok`. Any `ANCHOR PROBLEM` means the box's text differs: stop and send me the lines it names.
```bash
ssh box2 'node /tmp/fp/2026-10-27-filter-panel.mjs --dir=/opt/trimscout-deals/src'
```
3. **Backup** (the patcher also writes `<file>.bak.<stamp>` next to each file; this is the second copy, off the source tree):
```bash
ssh box2 'B=~/backups/filter-panel-20261027; mkdir -p $B; cd /opt/trimscout-deals/src && cp -p deals_api_server.js inventoryListQuery.js $B/ && cd $B && md5sum *.js | tee md5s.txt'
```
4. **Apply** (no restart). Note the `STAMP` it prints.
```bash
ssh box2 'node /tmp/fp/2026-10-27-filter-panel.mjs --dir=/opt/trimscout-deals/src --apply'
ssh box2 'cd /opt/trimscout-deals/src && ls -l *.bak.* inventoryDerived.js facetCounts.js && for f in deals_api_server inventoryListQuery inventoryDerived facetCounts; do node --check $f.js && echo "$f ok"; done'
```
5. **Probe** (read-only, about a minute, still in the idle window). It reports how complete each column is, how the three inferred filters split the cars, compares the SQL rules with the JS rules on a sample of real cars, and times the facet row query on real sets. Must end `GO`.
```bash
ssh box2 'cd /opt/trimscout-deals && node /tmp/fp/2026-10-27-filter-coverage-probe.mjs --explain'
```
   On `NO-GO`: a SQL/JS disagreement means a pattern needs a fix (send me the printed rows); a `SLOW` row means lower `FACET_COUNTS_ROW_CAP` (step 6) or leave the route unused. Either way step 9 restores.
6. **Restart once**, keeping every variable from step 0 (add `FACET_COUNTS_ROW_CAP=…` only if the probe asked for a lower cap):
```bash
ssh box2 'cd /opt/trimscout-deals && DISABLE_FACET_REBUILD=1 pm2 restart deals-api --update-env && pm2 save'
ssh box2 'pm2 logs deals-api --lines 40 --nostream | grep -i -E "error|not loaded" | tail'   # none
```
   Re-run the `pm2 jlist` line from step 0: the values must match.
7. **Verify** (`K` is the box's API key; every call reads only):
```bash
ssh box2 'K="X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY"; curl -s -o /dev/null -w "%{http_code}\n" -H "$K" "localhost:3004/api/inventory/facet-counts"'   # 400 (make is required)
ssh box2 'K="X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY"; curl -s -H "$K" "localhost:3004/api/inventory/facet-counts?make=Toyota&model=RAV4&inStock=1&retailOnly=1" | node -e '"'"'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.tooBroad?"tooBroad":j.rows,j.dims&&{fuel:j.dims.fuel,drivetrain:j.dims.drivetrain,transmission:j.dims.transmission,dealers:j.dims.dealer.length})})'"'"''
ssh box2 'K="X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY"; for q in "" "&fuel=hybrid&drivetrain=awd"; do curl -s -H "$K" "localhost:3004/api/inventory?make=Toyota&model=RAV4&inStock=1&retailOnly=1&limit=1&countCap=1000$q" | node -e '"'"'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.total,j.filtersApplied)})'"'"'; done'
```
   Expect the second total to be at most the first and `filtersApplied` `[ 'drivetrain', 'fuel' ]`. The first call of the second command's `fuel` counts should add up to about the first `rows`.
8. **Then the website**: nothing to do box-side. The website PR works with or without this patch; once the box answers, the "More filters" groups appear on their own.
9. **Restore** (any step, any time):
   - *Files back*: `ssh box2 'cd /opt/trimscout-deals/src && for f in deals_api_server inventoryListQuery; do cp -p $f.js.bak.<STAMP> $f.js; done; rm -f inventoryDerived.js facetCounts.js'` (or the copies in `~/backups/filter-panel-20261027/`, checked with `md5sum` against `md5s.txt`), then restart as in step 6 and `pm2 save`. The page goes back to hiding those groups by itself (404).
   - *Lighter*: set `FACET_COUNTS_ROW_CAP=1000` and restart: every set over a thousand cars answers "too broad", which costs one cheap query.
   - No tables, columns or flags were added, so there is nothing to drop.

## After install
- Watch box2 swap and the pool for the first day; `facet-counts` is the only new query shape. A rising 503 rate on it means lower `FACET_COUNTS_MAX_CONCURRENT` or the row cap.
- Follow-up data work that would make these filters complete is listed in `docs/search-filter-panel/AUDIT.md` (stored drivetrain / fuel columns from the VIN decode, dealer coordinates).
