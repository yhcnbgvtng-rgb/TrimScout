# Model option policies in the nightly sync and the options list

Code-only change. Nothing is deployed, restarted or rebuilt by merging it. The policy stays **off** until `OPTION_MODEL_POLICY_PATH` is set in deals-api's environment at a restart.

## What it does

With the policy loaded (bundled files: `toyota-rav4-2026`, `toyota-2026-2027`, `ford-2026`, `chevrolet-2026-2027`, `gmc-2026-2027`, `buick-2026-2027`):

1. **Nightly sync write path** (`handleInventoryBulk`): for a vehicle covered by a policy (make + model + year), only the policy's options are written to `dealer_inventory_options`. Re-synced cars can no longer bring the generic rows back. Every other vehicle takes the generic path, unchanged.
   - A payload with a **blank trim** is treated as "no information" (the upsert COALESCEs `trim`), so the stored rows are left alone rather than wiped by "no trusted trim -> no options".
   - A non-blank trim the policy does not trust still yields zero options (policy rule 6).
2. **`/api/inventory` per-vehicle `options`** (`inventoryRowFromDb`, which also serves by-listing-url, VIN history and the export): for a covered vehicle the list is the policy result for that car's `options_json`, as `{ code, name, price, kind }` (price and kind from the policy). It is the same engine and the same input as the facet rows, so list, filters and facets agree. A car with no policy gets the very same array back.
3. `options_json` itself is **not** rewritten. The list is filtered on the way out.

Example (tests): 2026 RAV4 XSE `JTM6CRAV3TD314853` has 11 dealer lines; only the Weather Package remains, in the facet table and in the API list.

## Why a patch script, not a file copy

The box's `deals_api_server.js` is a different version from the repo's (about 350 lines differ), and its `factoryOptionAllowlist.js` is the old file with no model policies at all. `inventoryOptionRows.js` is identical. So `scripts/box/2026-10-11-option-policy-write-path.sh` installs the new allowlist module and the three policy JSONs and applies three anchored edits to the box's `deals_api_server.js`. Each anchor must match exactly once or nothing is installed; the new module is load-tested against the box's own `inventoryOptionRows.js` first; the script never restarts anything. Tested against a copy of the box's files on 2026-10-10.

## Deploy steps (idle window; Paul's GO first)

Idle means: no crawl, no sync, sync lock free, and nothing long-running on the table (the restart re-runs `ensureInventoryTable`'s ALTERs, which queue behind long SELECTs). Do not do this between 22:00 and the end of the nightly syncs (boxes sync 22:05 to 22:10).

1. **Check idle** (box2):
   ```bash
   sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"
   grep '\[sync-lock\]' ~/.pm2/logs/deals-api-out.log | tail -2        # last event must be a release
   ```
   Check all four boxes have no crawl/sync running (`ps`, load) twice, two minutes apart.
2. **Record "before" for a non-policy make** (to prove it is unchanged): pick a Honda VIN, save `curl -s -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" "localhost:3004/api/inventory?q=<VIN>&dealerId=<id>&limit=1"` to a file.
3. **Safety copies**: `cp -p /opt/trimscout-deals/facet-cache.json ~/facet-cache.json.pre-optpolicy` (never delete the live one).
4. **Install** (no restart):
   ```bash
   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o 2026-10-11-option-policy-write-path.sh "$B/scripts/box/2026-10-11-option-policy-write-path.sh?cb=$(date +%s)" && bash 2026-10-11-option-policy-write-path.sh
   ```
   It prints its rollback line. Behaviour is unchanged until step 5.
5. **One restart with the policy on** (pm2 process `deals-api`; it currently runs with `DISABLE_FACET_REBUILD=1`, keep it):
   ```bash
   P=/opt/trimscout-deals/src/optionPolicies
   DISABLE_FACET_REBUILD=1 OPTION_MODEL_POLICY_PATH=$P/toyota-rav4-2026.json,$P/toyota-2026-2027.json,$P/ford-2026.json,$P/chevrolet-2026-2027.json,$P/gmc-2026-2027.json,$P/buick-2026-2027.json pm2 restart deals-api --update-env && pm2 save
   pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api").pm2_env;console.log(p.DISABLE_FACET_REBUILD,p.OPTION_MODEL_POLICY_PATH)})'
   ```
   Wait for boot; `pm2 logs deals-api --lines 30 --nostream` must NOT contain `[options] allowlist not loaded`.
6. **Verify**:
   - `JTM6CRAV3TD314853` (dealer 1614): `curl ... "localhost:3004/api/inventory?q=JTM6CRAV3TD314853&dealerId=1614&limit=1"` -> `options` is only the Weather Package.
   - `optionKeys=weather%20package` returns it; `optionKeys=illuminated%20door%20sills` returns total 0.
   - The Honda response from step 2 is byte-identical (except fields that change nightly, e.g. `lastSeenAt`).
7. **Re-converge Toyota and Ford rows.** The 2026-10-10 Toyota apply wrote policy rows once; any Toyota that re-synced at 22:05 or later before this deploy had its generic rows written back. Ford rows have never been applied. Cars converge by themselves the next time they are re-synced (the diff-write only touches changed sets). To converge everything now, run `scripts/box/2026-10-10-toyota-option-policy-apply.mjs` (`--phase=plan`, check the summary, `--phase=apply`; 83 s for Toyota on 2026-10-10; it takes the sync lock) and the per-make scripts `scripts/box/2026-10-11-{ford,chevrolet,gmc,buick}-option-policy-apply.mjs` (same phases; each is limited to its own make). Ford is a decision for Paul: its dry run (docs/ford-2026) was 150,584 cars.
8. **One facet rebuild**, after step 7, when the lock is free: `POST /api/inventory/catalog-facets/rebuild`, then watch `GET /api/inventory/catalog-facets/status` (last full build took about 16 minutes). Warm the catalog cache per make afterwards as on 2026-10-09 (`~/oct9/warm.sh`).

## Rollback

- **Policy off, code stays**: restart without the variable: `DISABLE_FACET_REBUILD=1 pm2 restart deals-api --update-env` after `unset OPTION_MODEL_POLICY_PATH` (confirm with the `pm2 jlist` line above), `pm2 save`. The list and the write path go back to generic behaviour; the table keeps whatever rows it has until cars re-sync.
- **Files back**: copy the two `.bak.<timestamp>` files over `factoryOptionAllowlist.js` and `deals_api_server.js`, then restart.
- **Rows back**: `--phase=restore` of the apply script puts the backed-up rows back for exactly the cars it applied (dry unless `--go`). The 2026-10-10 Toyota backup is `/home/ubuntu/toyota-option-apply-EsvcAP/state/backup.jsonl` (md5 2bb0af068fcc446966f686a7fcf9f8a8).

## Known limits

- Policy matching uses the stored make / model / year / trim. A model spelling the policy does not list (for example a trim-suffixed model name) is simply not covered and stays on the generic rules.
- Dealer add-ons (`dealerAddons` in the policy result) are not stored anywhere yet; there is no `dealer_addons` column.
