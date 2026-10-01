#!/usr/bin/env bash
# Stable (write-proof, restart-proof) cache for the buyer /search dropdown payloads.
#
# Why (confirmed live 2026-10-01 after PR #365's two deals-api restarts): /api/inventory/makes, /facets and
# /catalog timed out at the 20s cap, so the Make dropdown never loaded. invCached is cleared by
# invInvalidate() on EVERY bulk upsert / removing sweep (and a concurrent invalidation discards a result that
# was mid-compute), so while crawl boxes push continuously these whole-table GROUP BYs can never be cached —
# and on a box that is I/O-bound from those same writes they cannot finish inside the cap anyway. This moves
# those four payloads to stableCache.js: fresh entry served; expired entry served IMMEDIATELY while one
# background refresh runs; every success persisted to /opt/trimscout-deals/facet-cache.json so a restart keeps it.
# Timeouts and the buffer pool are NOT touched. The vehicle list stays live; only hit counts get stale.
#
# NEEDS A QUIET WINDOW TO WARM: a cold cache has nothing to serve, so after the restart the four endpoints must
# be hit once while the box can finish them (warm-facets step below). Run it only when no bulk/sweep is active.
#
# Run on the deals box (ubuntu@52.202.234.65):
#   scp stableCache.js 2026-10-01-stable-facet-cache.sh ubuntu@52.202.234.65:~ ; ssh ... 'sudo cp ~/stableCache.js ~/2026-10-01-stable-facet-cache.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-10-01-stable-facet-cache.sh'
set -euo pipefail
DIR=/opt/trimscout-deals/src
FILE="$DIR/deals_api_server.js"
[ -f "$DIR/stableCache.js" ] || { echo "ERROR: $DIR/stableCache.js missing" >&2; exit 1; }
node --check "$DIR/stableCache.js" && echo "syntax ok: stableCache.js"
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"; echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if "stableCached" in s:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); print("patched:", label)

rep(r'''import { createGate, SearchBusyError } from "./searchGate.js";
import { optionRowsFromOptions, payloadHasOptions, buyerOptionCatalog, CATALOG_MIN_VEHICLES } from "./inventoryOptionRows.js";
''', r'''import { createGate, SearchBusyError } from "./searchGate.js";
import { createStableCache } from "./stableCache.js";
import { optionRowsFromOptions, payloadHasOptions, buyerOptionCatalog, CATALOG_MIN_VEHICLES } from "./inventoryOptionRows.js";
''', 'hunk 1')
rep(r'''};
const invInvalidate = () => {
''', r'''};
// The buyer /search dropdown payloads (makes, state/make/model/trim counts, option catalog) live in
// their own stale-while-revalidate cache that writes do NOT invalidate and a restart does not lose —
// see stableCache.js for why invCached cannot serve them while the crawl is writing.
const stableCached = createStableCache({
  ttlMs: INV_CACHE_MS,
  filePath: process.env.INV_FACET_CACHE_FILE || "/opt/trimscout-deals/facet-cache.json",
}).get;
const invInvalidate = () => {
''', 'hunk 2')
rep(r'''  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("makes", async () => {
    // Wrapped the same way handleListInventory/handleInventoryCatalogOptions are (SET STATEMENT
''', r'''  await ensureInventoryTable(pool);
  sendJson(res, 200, await stableCached("makes", async () => {
    // Wrapped the same way handleListInventory/handleInventoryCatalogOptions are (SET STATEMENT
''', 'hunk 3')
rep(r'''  const cacheKey = `facets:${state}|${make}|${model}`;
  sendJson(res, 200, await invCached(cacheKey, async () => {
    const q = (sql, args) =>
''', r'''  const cacheKey = `facets:${state}|${make}|${model}`;
  sendJson(res, 200, await stableCached(cacheKey, async () => {
    const q = (sql, args) =>
''', 'hunk 4')
rep(r'''    const fWhereSql = fWhere.length ? "WHERE " + fWhere.join(" AND ") : "";
    sendJson(res, 200, await invCached(`catalog-facets:${make}|${model}|${trim}`, async () => {
      const [optionRows] = await withPoolTimeout(
''', r'''    const fWhereSql = fWhere.length ? "WHERE " + fWhere.join(" AND ") : "";
    sendJson(res, 200, await stableCached(`catalog-facets:${make}|${model}|${trim}`, async () => {
      const [optionRows] = await withPoolTimeout(
''', 'hunk 5')
rep(r'''  const cacheKey = `catalog-options:${make}|${model}|${trim}`;
  sendJson(res, 200, await invCached(cacheKey, async () => {
    // STRAIGHT_JOIN drives from dealer_inventory (filtered by make=/removed_at first, typically
''', r'''  const cacheKey = `catalog-options:${make}|${model}|${trim}`;
  sendJson(res, 200, await stableCached(cacheKey, async () => {
    // STRAIGHT_JOIN drives from dealer_inventory (filtered by make=/removed_at first, typically
''', 'hunk 6')
open(p, "w").write(s)
PY
node --check "$FILE" && echo "syntax ok: deals_api_server.js"
echo "Restarting deals-api (this drops the in-memory cache; the facet cache file starts EMPTY — warm it next)."
sudo -u ubuntu pm2 restart deals-api >/dev/null && sleep 3
echo "Rollback: sudo cp $FILE.bak.$STAMP $FILE && sudo -u ubuntu pm2 restart deals-api"
