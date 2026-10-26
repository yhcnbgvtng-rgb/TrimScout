# Box patch: catalog facet extras (condition + colour counts, price histogram, server-side "Leave out")

Code only on the PR branch `feat/search-facet-data`. **Nothing here has been run on a box, no box was read or touched while writing it, and the PR does not install anything.** box2 only. One restart, in an idle window, on Paul's own typed GO. Read `docs/BOXES.md` first (box2 is the deals box; SSH alias `box2`).

## Why
PR "Search: live count, chip facets with counts…" (#581) shows no number on condition or colour chips, has no price sparkline and hides "Leave out" words only among cars already loaded, because the box serves none of that. This adds it on the box, additively; the web app works with or without it (an older box just leaves those pieces blank).

## What the box now serves
| Data | Where it comes from | Extra cost |
|---|---|---|
| `exteriorColorCounts`, `interiorColorCounts` in `GET /api/inventory/catalog` | `inv_color_facets.vehicle_count`, which the rebuild already stores per (make, model, trim, exterior, interior) and the read used to throw away (`SELECT DISTINCT`). Now `SUM(vehicle_count) … GROUP BY colour` over the same rows. | **none** (same rows read, same cache entry). Not behind the flag. |
| `conditionCounts` `{new, used, cpo}` and `priceHistogram` `{width:5000, top:150000, all, new, used, cpo}` (31 buckets, the last open-ended) | New table `inv_price_facets (make, model, trim, cond, bucket, vehicle_count)` plus an all-makes `inv_price_summary`, filled by **one extra aggregate per make** in `rebuildCatalogFacets`. | One more index-range aggregate per make (see "Cost control"). **Behind `FACET_COND_PRICE`, default off.** |
| `exclude=` on `GET /api/inventory` (and the contact-search POST): repeated params, at most 5 words of 2-24 characters, `[a-z0-9 -]` only. Response echoes `excludeApplied: [...]` | A residual `NOT (CONCAT_WS(' ', year, make, model, trim, exterior_color, interior_color) LIKE '%word%' OR …)` on the rows the make's index range already selected. Only honoured with a `make=` (without one it would be a whole-table string scan). The existing `countCap` and `max_statement_time` still bound it. | No new scan; a string test per visited row. Not behind the flag (inert unless the web app sends `exclude`). |

Option counts are unchanged. Condition counts and the histogram follow make/model/trim only (the precomputed grain), not the other selections.

## Cost control: the rebuild must not grow by more than 10%
- The extra aggregate walks the same table with the same `FORCE INDEX (idx_inv_stock_make_model_trim)` and the same WHERE as the colour aggregate the rebuild already runs, once per make. The per-make option join over the ~9.5M-row options table (the bulk of the ~16 minute build) is untouched.
- **Self-limiting.** Before each make the rebuild asks `budgetAllows()` whether the extra time so far plus one more average make stays within `FACET_EXTRA_BUDGET_PCT` (default 10, hard maximum 10) of the rest of the build. The extra time counted is the aggregate's SELECT **and** its DELETE/INSERT into `inv_price_facets`. A make that would break it is **skipped** (its previous price rows stay), the all-makes summary is then **not** rewritten, and the skip is reported. The first make always runs, so the worst overshoot is one make's extra query. `facet_extras.test.js` simulates this for extra queries 0.15x to 5x a make's normal cost.
- **Measured, not assumed.** `GET /api/inventory/catalog-facets/status` gains `extras: { extraMs, skippedMakes, pctOfRestOfBuild, budgetPct }` after a flagged rebuild; the rebuild log line prints the same. `inv_facet_meta` stores `extra_ms` / `extra_skipped` so the numbers survive a restart.
- **Probe first.** `scripts/box/2026-10-26-facet-extras-probe.mjs` (read-only, reader account) times the colour aggregate and the new aggregate on a sample of makes and projects the extra time against the last full build (reads only: the write into `inv_price_facets` is not in the probe, but it is in the rebuild's own measurement in step 7, which is the one that counts). Do not turn the flag on if it says NO-GO (over 8%).
- I could not measure this on the real database from here; the 10% claim rests on the guard above, and the probe (step 5, reads only) and the measured rebuild (step 7, reads and writes) are how it gets proven.

## Files
| Box file (`/opt/trimscout-deals/src/`) | Change |
|---|---|
| `deals_api_server.js` | anchored edits only (20 of them, `scripts/box/facet-extras-edits.json`): flag const, DDL under the flag, the extra rebuild aggregate, price summary, status fields, colour read, payload fields, `excludeApplied` echo |
| `inventoryListQuery.js` | anchored edits: `excludeTermsOf`, the exclude predicate, `excludeTerms` in the result |
| `facetExtras.js` | new module (embedded in the patcher) |

The box's `deals_api_server.js` is not a git checkout and drifts from the repo, so the patcher does not copy the repo's file: every edit has a `find` that must occur **exactly once** (or its marker must already be there), else it aborts and writes nothing. Prerequisite: the options-paid-only patch (`2026-10-19-options-paid-only.mjs`) is installed (the patcher refuses otherwise). The patcher's md5 is printed in the PR; the box files' md5s will differ from the repo's by design.

## Steps (box2; BOX = `box2`)
0. **Preconditions** (stop if any prints, or if it is 21:50-23:59 ET): idle means no crawl, no sync, sync lock free, nothing long-running on the table. The restart in step 6 wipes the in-memory sync lock and re-runs `ensureInventoryTable`'s ALTERs, which queue behind long SELECTs.
```bash
ssh box2 'TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone|backfill|remap" | grep -v pgrep; grep "\[sync-lock\]" ~/.pm2/logs/deals-api-out.log | tail -2'   # last sync-lock event must be a release
ssh box2 'curl -s -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" localhost:3004/api/inventory/catalog-facets/status'   # NOTE lastDurationMs (the baseline) and lastBuiltAt
ssh box2 'pm2 jlist | node -e '"'"'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api").pm2_env;console.log(JSON.stringify({DISABLE_FACET_REBUILD:p.DISABLE_FACET_REBUILD,OPTIONS_PAID_ONLY:p.OPTIONS_PAID_ONLY,OPTION_MODEL_POLICY_PATH:p.OPTION_MODEL_POLICY_PATH,OPTION_JUNK_RULES:p.OPTION_JUNK_RULES,FACET_COND_PRICE:p.FACET_COND_PRICE}))})'"'"''   # write these down: step 7 must keep them
```
1. **Copy** the patcher and the probe from the Mac, in the repo checkout of the PR branch:
```bash
P=scripts/box; ssh box2 'mkdir -p /tmp/fx'; scp $P/2026-10-26-facet-extras.mjs $P/2026-10-26-facet-extras-probe.mjs box2:/tmp/fx/
ssh box2 'cd /tmp/fx && md5sum *'      # compare with the md5s in the PR description
```
2. **Dry run** (writes nothing). Every edit must say `will apply` (or `already applied`) and it must end `DRY RUN ok`. Any `ANCHOR PROBLEM` means the box's text differs: stop and send me the lines it names.
```bash
ssh box2 'node /tmp/fx/2026-10-26-facet-extras.mjs --dir=/opt/trimscout-deals/src'
```
3. **Backup** (the patcher also writes `<file>.bak.<stamp>` next to each file; this is the second copy, off the source tree):
```bash
ssh box2 'B=~/backups/facet-extras-20261026; mkdir -p $B; cd /opt/trimscout-deals/src && cp -p deals_api_server.js inventoryListQuery.js $B/ && cd $B && md5sum *.js | tee md5s.txt'
```
4. **Apply** (no restart, flag stays off). Note the `STAMP` it prints.
```bash
ssh box2 'node /tmp/fx/2026-10-26-facet-extras.mjs --dir=/opt/trimscout-deals/src --apply'
ssh box2 'cd /opt/trimscout-deals/src && ls -l *.bak.* facetExtras.js && for f in deals_api_server inventoryListQuery facetExtras; do node --check $f.js && echo "$f ok"; done'
```
5. **Probe the cost** (read-only; still in the idle window):
```bash
ssh box2 'cd /opt/trimscout-deals && node /tmp/fx/2026-10-26-facet-extras-probe.mjs --explain'
```
   Must end `GO`. On `NO-GO`, go to step 9 (restore) or continue only with `FACET_COND_PRICE` unset (steps 6-7 without it still give colour counts and server-side exclude).
6. **Restart once**, keeping every variable from step 0 and adding the flag. `DISABLE_FACET_REBUILD=1` stays (no rebuild runs by itself; step 7 is manual):
```bash
ssh box2 'cd /opt/trimscout-deals && DISABLE_FACET_REBUILD=1 FACET_COND_PRICE=1 FACET_EXTRA_BUDGET_PCT=10 pm2 restart deals-api --update-env && pm2 save'
ssh box2 'pm2 jlist | node -e '"'"'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api").pm2_env;console.log(p.status,p.FACET_COND_PRICE,p.DISABLE_FACET_REBUILD,p.OPTIONS_PAID_ONLY,p.OPTION_MODEL_POLICY_PATH)})'"'"''
ssh box2 'pm2 logs deals-api --lines 40 --nostream | grep -i -E "error|not loaded|facet" | tail'   # no errors; the new tables are created at first use
```
   The values printed must match step 0 (plus `FACET_COND_PRICE=1`). Re-take the sync lock state check from step 0.
7. **Facet rebuild** (manual; the last full build took about 16 minutes), then watch it:
```bash
ssh box2 'curl -s -X POST -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" localhost:3004/api/inventory/catalog-facets/rebuild'
ssh box2 'curl -s -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" localhost:3004/api/inventory/catalog-facets/status'   # repeat until building:false
```
   **Pass criteria:** `lastError` null; `lastDurationMs` is **at most 1.10 x the baseline from step 0**; `extras.pctOfRestOfBuild` is **at most 10**; `extras.skippedMakes` is **0** (a skip is allowed by design but means the histogram for those makes is the previous one and the all-makes summary was not rewritten: report it, do not widen the budget).
8. **Verify the payloads** (`countsAsOf` must equal `lastBuiltAt`):
```bash
ssh box2 'K="X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY"; curl -s -H "$K" "localhost:3004/api/inventory/catalog?make=Toyota&model=RAV4" | node -e '"'"'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.countsAsOf,j.conditionCounts,(j.exteriorColorCounts||[]).slice(0,3),j.priceHistogram&&j.priceHistogram.all.length)})'"'"''
ssh box2 'K="X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY"; for q in "" "&exclude=black"; do curl -s -H "$K" "localhost:3004/api/inventory?make=Toyota&inStock=1&retailOnly=1&limit=1&countCap=1000$q" | node -e '"'"'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.total,j.totalCapped,j.excludeApplied)})'"'"'; done'
```
   Expect the condition counts to add up to about the make/model count, the histogram `all` to have 31 entries, and the second search to print a smaller (or equal) total and `excludeApplied: [ 'black' ]`.
9. **Restore** (any step, any time):
   - *Flag off, code stays* (the histogram and condition counts disappear from the payload; colour counts and exclude stay): `ssh box2 'cd /opt/trimscout-deals && unset FACET_COND_PRICE && DISABLE_FACET_REBUILD=1 pm2 restart deals-api --update-env && pm2 save'`, then re-check with the `pm2 jlist` line from step 0 that `FACET_COND_PRICE` is gone. Note `--update-env` only adds/overrides, so confirm it; if it still shows `1`, `pm2 delete deals-api` is NOT the answer: use the next bullet.
   - *Files back*: `ssh box2 'cd /opt/trimscout-deals/src && for f in deals_api_server inventoryListQuery; do cp -p $f.js.bak.<STAMP> $f.js; done; rm -f facetExtras.js'` (or the copies in `~/backups/facet-extras-20261026/`; `md5sum` them against `md5s.txt`), then restart as in step 6 **without** `FACET_COND_PRICE`, and `pm2 save`. The web app keeps working: it treats the missing fields as "no data".
   - *Tables*: `inv_price_facets`, `inv_price_summary` and the two `inv_facet_meta` columns are additive and harmless. Drop them only if asked: `DROP TABLE inv_price_facets, inv_price_summary; ALTER TABLE inv_facet_meta DROP COLUMN extra_ms, DROP COLUMN extra_skipped;` (writer account).

## Website side (this PR)
`/api/catalog/options` already passes the catalog JSON through. The page now shows a number on condition and exterior-colour chips, draws the price sparkline under the slider (following the picked condition), and sends the "Leave out" words to the box as repeated `exclude=` params, so the headline count is exact. If a response carries no `excludeApplied` (an older box) the page falls back to hiding matching cars among those already loaded and says the words are not counted yet. Nothing breaks if the site is deployed before the box patch, or after.

## After install
- `catalog-facets/status` after each nightly rebuild: `extras.pctOfRestOfBuild` stays at or under 10, `skippedMakes` 0. A rising `skippedMakes` means the extra query got slower than the budget allows: lower `FACET_EXTRA_BUDGET_PCT` or turn the flag off.
- Watch box2 swap and the sync lock during the first flagged rebuild, as for any rebuild.
