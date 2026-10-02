#!/usr/bin/env bash
# Admin Vehicles sheet: multi-select filters + dynamic facet counts (box side).
#
# What this deploys:
#   - inventoryListQuery.js (replaced whole): state/make/model/trim/cond accept REPEATED params
#     (state=FL&state=GA) -> `col IN (...)`. ONE value is byte-for-byte the old `col = ?` SQL and index
#     hints, so the buyer /search path is unchanged.
#   - inventoryAdminFacets.js (new, replaced whole): pure multi-value facet SQL builder.
#   - deals_api_server.js (anchored patch): import + handleInventoryAdminFacets + route
#     GET /api/inventory/admin-facets. The buyer GET /api/inventory/facets handler is NOT touched.
#
# Deploy order: run this BEFORE merging the Next.js PR. Until it runs, an old box would treat
# state=FL&state=GA as just "FL" (params.get) — the Next route guards against that by requiring the
# admin-facets endpoint (404 on an un-patched box) before it offers multi-select counts.
#
# deals_api_server.js is patched by EXACT anchored replacement (each anchor must match once) because the
# box's copy drifts from the repo mirror. Idempotent. Backup, anchored replace with asserts, node --check,
# pm2 restart. No schema or index change; admin-facets cache entries fill on first use. The restart drops
# in-flight requests — run it when no bulk/sweep is mid-flight.
#
# Run on the deals box (ubuntu@52.202.234.65):
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && for f in inventoryListQuery.js inventoryAdminFacets.js; do curl -fsSL -o $f "$B/scrapers/lightsail-crawler/src/$f?cb=$(date +%s)"; done && curl -fsSL -o 2026-10-02-admin-vehicles-multiselect.sh "$B/scripts/box/2026-10-02-admin-vehicles-multiselect.sh?cb=$(date +%s)" && grep -c multiParam inventoryListQuery.js && sudo cp inventoryListQuery.js inventoryAdminFacets.js 2026-10-02-admin-vehicles-multiselect.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-10-02-admin-vehicles-multiselect.sh
set -euo pipefail
DIR=/opt/trimscout-deals/src
FILE="$DIR/deals_api_server.js"

for f in inventoryListQuery.js inventoryAdminFacets.js; do
  [ -f "$DIR/$f" ] || { echo "ERROR: $DIR/$f missing — fetch it first (see usage line)." >&2; exit 1; }
  node --check "$DIR/$f" && echo "syntax ok: $f"
done
grep -q "multiParam" "$DIR/inventoryListQuery.js" || { echo "ERROR: stale inventoryListQuery.js (no multiParam) — re-fetch with cache-busting." >&2; exit 1; }
grep -q "countCap" "$DIR/inventoryListQuery.js" || { echo "ERROR: inventoryListQuery.js has no countCap — it is not the current repo copy." >&2; exit 1; }
grep -q "stableCached" "$FILE" || { echo "ERROR: stableCached missing from deals_api_server.js — run 2026-10-01-stable-facet-cache.sh first." >&2; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"; echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

if "handleInventoryAdminFacets" in s:
    print("already patched"); sys.exit(0)

rep(r'''import { inventoryListQuery, totalFromPage, applyCountCap, deferredPageSql } from "./inventoryListQuery.js";''',
    r'''import { inventoryListQuery, totalFromPage, applyCountCap, deferredPageSql } from "./inventoryListQuery.js";
import { adminFacetQueries, adminFacetResponse } from "./inventoryAdminFacets.js";''', "import")

HANDLER = r'''// GET /api/inventory/admin-facets?state=&state=&make=&make=&model=&... (repeated params = multi-select) —
// State/Make/Model/Trim hit counts for the admin Vehicles sheet. Its own endpoint so the buyer
// /api/inventory/facets (single-value, its own stable cache) is untouched. Scoping rules, and why they
// stop short of the sheet's other filters: see inventoryAdminFacets.js. Same stale-while-revalidate cache
// as the buyer facets, keyed by the (order-independent) selection; same 20s statement cap.
async function handleInventoryAdminFacets(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const f = adminFacetQueries(params);
  sendJson(res, 200, await stableCached(f.cacheKey, async () => {
    const q = (query) =>
      query
        ? withPoolTimeout(
            pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR ${query.sql}`, query.args),
            POOL_WAIT_TIMEOUT_MS,
            "Timed out waiting for an available database connection or a slow query"
          ).then(([rows]) => rows)
        : Promise.resolve([]);
    const [states, makes, models, trims] = await Promise.all([q(f.queries.states), q(f.queries.makes), q(f.queries.models), q(f.queries.trims)]);
    return adminFacetResponse({ states, makes, models, trims });
  }));
}

'''
rep("// GET /api/inventory/by-dealer", HANDLER + "// GET /api/inventory/by-dealer", "handler")

rep(r'''  if (req.method === "GET" && pathname === "/api/inventory/facets") return run(handleInventoryFacets, url.searchParams);''',
    r'''  if (req.method === "GET" && pathname === "/api/inventory/facets") return run(handleInventoryFacets, url.searchParams);
  if (req.method === "GET" && pathname === "/api/inventory/admin-facets") return run(handleInventoryAdminFacets, url.searchParams);''', "route")

open(p, "w").write(s)
print("patched:", ", ".join(changed))
PY

node --check "$FILE" && echo "syntax ok: deals_api_server.js"
echo "Restarting deals-api."
sudo -u ubuntu pm2 restart deals-api >/dev/null && sleep 3
echo "Rollback: sudo cp $FILE.bak.$STAMP $FILE && sudo -u ubuntu pm2 restart deals-api"
