#!/usr/bin/env bash
# Applies the same statement/pool timeout protection (#320/#322) to
# handleInventoryCatalogOptions (/api/inventory/catalog) — PR #324.
#
# Confirmed live 2026-09-27, after #320, #321, and #322 (JOIN rewrite, Vercel maxDuration,
# pool-wait timeout) were all deployed: the exact buyer-search flow still timed out at 60s.
# Isolated it to a different handler entirely:
#   GET /api/inventory/catalog?make=Ford                -> 503 in 60.3s (Vercel-side abort)
#   GET /api/inventory/catalog?make=BMW&model=iX          -> 200 in 33.9s (was 1.55s via the
#                                                            equivalent /api/vehicles/search
#                                                            proof earlier the same day)
#   GET /api/inventory/catalog (no make/model)            -> 200 in 0.5s
# /api/search/parse calls catalogOptions() (this endpoint) unconditionally via
# Promise.all([inventoryMakes(), catalogOptions()]) on every AI search request.
# handleInventoryCatalogOptions has its own separate pool.query() calls and had neither
# SET STATEMENT max_statement_time nor withPoolTimeout — the exact "query never even started
# executing, so no statement-level cap ever applied" failure #322 already fixed for
# handleListInventory, just in a sibling handler that never inherited the fix.
#
# Fix: wraps both of this handler's queries (the options STRAIGHT_JOIN and the colors query) in
# the same SET STATEMENT + withPoolTimeout pattern #320/#322 already established — reuses the
# existing INV_LIST_STATEMENT_TIMEOUT_SECONDS/POOL_WAIT_TIMEOUT_MS/withPoolTimeout, no new
# mechanism, just applying the existing one to a handler that was missed.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-27-catalog-options-pool-timeout.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-27-catalog-options-pool-timeout.sh?cb=$(date +%s)" && sudo cp 2026-09-27-catalog-options-pool-timeout.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-27-catalog-options-pool-timeout.sh
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    if new in s:
        return
    n = s.count(old)
    assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

rep('''    const [optionRows] = await pool.query(
      `SELECT STRAIGHT_JOIN o.canonical_key, MIN(o.label) AS label, COUNT(*) AS vehicleCount FROM dealer_inventory i ${makeIndexHint} JOIN dealer_inventory_options o ON o.vin = i.vin AND o.dealer_id = i.dealer_id ${whereSql} GROUP BY o.canonical_key ORDER BY o.canonical_key`,
      args
    );
    const [colorRows] = await pool.query(
      `SELECT exterior_color, interior_color FROM dealer_inventory i ${makeColorsIndexHint} ${whereSql} AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL) GROUP BY exterior_color, interior_color`,
      args
    );''', '''    //
    // Wrapped the same way handleListInventory's queries are (SET STATEMENT + withPoolTimeout,
    // see their comments) — confirmed live 2026-09-27 this handler had neither: /api/search/parse
    // calls this unconditionally (via catalogOptions()) on every AI search, and with the box
    // under real load it hung the full 60s caller-side abort with no error on either side, the
    // exact same "never even started executing, so the statement-level cap had nothing to catch"
    // failure handleListInventory already had fixed. This is a separate handler with its own
    // pool.query() calls, so it needed the same fix applied to it directly, not inherited.
    const [optionRows] = await withPoolTimeout(
      pool.query(
        `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT STRAIGHT_JOIN o.canonical_key, MIN(o.label) AS label, COUNT(*) AS vehicleCount FROM dealer_inventory i ${makeIndexHint} JOIN dealer_inventory_options o ON o.vin = i.vin AND o.dealer_id = i.dealer_id ${whereSql} GROUP BY o.canonical_key ORDER BY o.canonical_key`,
        args
      ),
      POOL_WAIT_TIMEOUT_MS,
      "Timed out waiting for an available database connection or a slow query"
    );
    const [colorRows] = await withPoolTimeout(
      pool.query(
        `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT exterior_color, interior_color FROM dealer_inventory i ${makeColorsIndexHint} ${whereSql} AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL) GROUP BY exterior_color, interior_color`,
        args
      ),
      POOL_WAIT_TIMEOUT_MS,
      "Timed out waiting for an available database connection or a slow query"
    );''', "handleInventoryCatalogOptions query wrapping")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok: deals_api_server.js"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Verify live, e.g.:"
echo '  time curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory/catalog?make=Ford" -o /dev/null -w "%{http_code}\n"'
