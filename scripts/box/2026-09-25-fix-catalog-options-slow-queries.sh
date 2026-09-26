#!/usr/bin/env bash
# Fixes two separate slow queries inside GET /api/inventory/catalog (handleInventoryCatalogOptions):
#
# 1. The option-codes query drove from dealer_inventory_options (scanning every option row across
#    every make) and only filtered dealer_inventory's make= afterward — confirmed live 2026-09-25:
#    30s+ once dealer_inventory_options had real volume. STRAIGHT_JOIN now drives from
#    dealer_inventory (filtered by make=/removed_at first) into dealer_inventory_options by its
#    primary key instead.
# 2. The colors query's GROUP BY exterior_color, interior_color had no covering index at all —
#    "Using temporary; Using filesort" over 280k+ rows for a single make.
#
# Both fixes need a matching index: idx_inv_stock_make_dealer (already added by
# 2026-09-25-fix-make-filter-filesort.sh, run this first if you haven't) and the new
# idx_inv_stock_make_colors below. Indexes apply immediately — no backfill needed.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-fix-catalog-options-slow-queries.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-fix-catalog-options-slow-queries.sh?cb=$(date +%s)" && grep -c idx_inv_stock_make_colors 2026-09-25-fix-catalog-options-slow-queries.sh && sudo cp 2026-09-25-fix-catalog-options-slow-queries.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-25-fix-catalog-options-slow-queries.sh
set -euo pipefail
FILE=${FILE:-/opt/trimscout-deals/src/deals_api_server.js}
ON_BOX=$([ "$FILE" = /opt/trimscout-deals/src/deals_api_server.js ] && echo 1 || echo 0)
if [ "$ON_BOX" = 1 ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
fi

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

if "makeIndexHint" not in s:
    rep('''  const where = ["i.removed_at IS NULL"], args = [];
  if (make) { where.push("i.make = ?"); args.push(make); }
  if (model) { where.push("i.model = ?"); args.push(model); }
  if (trim) { where.push("i.trim = ?"); args.push(trim); }
  const whereSql = "WHERE " + where.join(" AND ");
  const cacheKey = `catalog-options:${make}|${model}|${trim}`;
  sendJson(res, 200, await invCached(cacheKey, async () => {
    const [optionRows] = await pool.query(
      `SELECT o.code, COUNT(*) AS vehicleCount FROM dealer_inventory_options o JOIN dealer_inventory i ON i.vin = o.vin AND i.dealer_id = o.dealer_id ${whereSql} GROUP BY o.code ORDER BY o.code`,
      args
    );
    const [colorRows] = await pool.query(
      `SELECT exterior_color, interior_color FROM dealer_inventory i ${whereSql} AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL) GROUP BY exterior_color, interior_color`,
      args
    );''', '''  const where = ["i.removed_at IS NULL"], args = [];
  if (make) { where.push("i.make = ?"); args.push(make); }
  if (model) { where.push("i.model = ?"); args.push(model); }
  if (trim) { where.push("i.trim = ?"); args.push(trim); }
  const whereSql = "WHERE " + where.join(" AND ");
  // Both queries below only get a FORCE INDEX when make= is set — mirrors inventoryListQuery.js's
  // own rule (a hint is only safe/helpful when the leading equality column it expects is actually
  // pinned). Confirmed live 2026-09-25: without these, both queries scanned/filesorted the whole
  // matching set — the options query drove from dealer_inventory_options (the larger table) and
  // filtered dealer_inventory afterward instead of the other way around (30s+, mostly wasted once
  // dealer_inventory_options has real volume); the colors query had no index covering its
  // GROUP BY exterior_color, interior_color at all ("Using temporary; Using filesort" over 280k+
  // rows for a single make).
  const makeIndexHint = make ? "FORCE INDEX (idx_inv_stock_make_dealer)" : "";
  const makeColorsIndexHint = make ? "FORCE INDEX (idx_inv_stock_make_colors)" : "";
  const cacheKey = `catalog-options:${make}|${model}|${trim}`;
  sendJson(res, 200, await invCached(cacheKey, async () => {
    // STRAIGHT_JOIN drives from dealer_inventory (filtered by make=/removed_at first, typically
    // the far smaller side) into dealer_inventory_options by its (vin, dealer_id, code) primary
    // key, instead of the optimizer's previous choice of scanning every row in
    // dealer_inventory_options and only filtering by make afterward.
    const [optionRows] = await pool.query(
      `SELECT STRAIGHT_JOIN o.code, COUNT(*) AS vehicleCount FROM dealer_inventory i ${makeIndexHint} JOIN dealer_inventory_options o ON o.vin = i.vin AND o.dealer_id = i.dealer_id ${whereSql} GROUP BY o.code ORDER BY o.code`,
      args
    );
    const [colorRows] = await pool.query(
      `SELECT exterior_color, interior_color FROM dealer_inventory i ${makeColorsIndexHint} ${whereSql} AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL) GROUP BY exterior_color, interior_color`,
      args
    );''', "STRAIGHT_JOIN + index hints for catalog options/colors")
else:
    print("already patched")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"

echo "Applying idx_inv_stock_make_colors directly if not already present (idempotent; can take ~1-2 min on a large table)..."
sudo mysql trimscout -e "ALTER TABLE dealer_inventory ADD INDEX IF NOT EXISTS idx_inv_stock_make_colors (removed_at, make, exterior_color, interior_color);"
echo "Also confirming idx_inv_stock_make_dealer exists (from 2026-09-25-fix-make-filter-filesort.sh)..."
sudo mysql trimscout -e "ALTER TABLE dealer_inventory ADD INDEX IF NOT EXISTS idx_inv_stock_make_dealer (removed_at, make, dealer_name, vin);"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/catalog)
echo "GET /api/inventory/catalog without key -> $code (401 = server up and guarding)"
echo "Done. Verify live, e.g.:"
echo '  curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory/catalog?make=Subaru" -w "\n%{time_total}s\n"'
