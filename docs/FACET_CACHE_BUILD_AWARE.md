# Build-aware facet cache

## Problem (seen 2026-10-10)
The buyer `/search` dropdowns (`/api/inventory/catalog`) are served from `stableCached`, a stale-while-revalidate cache persisted in `facet-cache.json` with a 10-minute TTL. A facet rebuild rewrites `inv_option_facets`, but cached payloads were only replaced when they expired and someone asked, so after the 20:53 ET rebuild 140 of 147 `catalog-facets:*` entries still held the pre-cleanup lists (for example `Toyota|RAV4|XLE Premium`: "battery charge meter", "Daytime Running Lights (DRL)", "hybrid energy monitor", all 2,302). The first visitor to each key also got the old copy.

## Fix
`createStableCache` takes an optional `isOutdated(value)`. The deals server passes `builtForOtherBuild(value, catalogFacets.builtAt)`: a payload whose `countsAsOf` is not the current build stamp counts as expired immediately, even inside the TTL. The caller gets up to `outdatedWaitMs` (3 s) to receive the refreshed value; if the refresh is slower or fails, the old copy is served exactly as for an expired entry. Payloads without `countsAsOf` (the other users of the cache) are unaffected, and so is an unknown current build.

## Deploy (idle window; Paul's GO first)
Idle: no crawl, no sync, sync lock free, nothing long-running on the database. The restart wipes the in-memory sync lock and re-runs `ensureInventoryTable`'s ALTERs, which queue behind long SELECTs.

1. Check idle on all four boxes twice, two minutes apart, and: `sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"`.
2. Copy the cache file: `cp -p /opt/trimscout-deals/facet-cache.json ~/facet-cache.json.pre-buildaware` (never delete the live one).
3. Install (no restart):
   ```bash
   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o 2026-10-11-facet-cache-build-aware.sh "$B/scripts/box/2026-10-11-facet-cache-build-aware.sh?cb=$(date +%s)" && bash 2026-10-11-facet-cache-build-aware.sh
   ```
   `stableCache.js` is replaced whole (the box copy was identical to the repo's before this change) and `deals_api_server.js` gets two anchored edits; each anchor must match once or nothing is installed. Backups are `.bak.<timestamp>`.
4. Restart once, keeping the environment: `pm2 restart deals-api --update-env` with `DISABLE_FACET_REBUILD=1` and the same `OPTION_MODEL_POLICY_PATH` as today (the three files under `/opt/trimscout-deals/src/optionPolicies/`), then `pm2 save`. Confirm both with `pm2 jlist`. Re-take the sync lock afterwards if you are still working under it.
5. Verify: the boot log has no errors; `curl -s -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" "localhost:3004/api/inventory/catalog?make=Toyota&model=RAV4&trim=XLE%20Premium"` returns `countsAsOf` equal to `catalog-facets/status` `lastBuiltAt`; `https://www.trimscout.com/search` returns 200.
6. From now on a facet rebuild needs no per-key warming: the first request for each key after a rebuild fetches the new build.

## Rollback
Copy the two `.bak.<timestamp>` files back and restart (or leave it: the old behavior is just the 10-minute lag).
