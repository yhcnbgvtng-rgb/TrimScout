#!/usr/bin/env bash
# Deals API: PR 2 of the buyer /search feature — adds GET /api/inventory/catalog
# (handleInventoryCatalogOptions), the box-side handler behind the new buyer-facing
# GET /api/catalog/options route. Code-only: no schema change here. It reads
# dealer_inventory_options and dealer_inventory.exterior_color/interior_color, all of
# which already exist (dealer_inventory_options landed in PR 1's
# 2026-09-25-buyer-search-schema.sh; the color columns predate this series entirely).
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-inventory-catalog-endpoint.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-inventory-catalog-endpoint.sh && sudo cp 2026-09-25-inventory-catalog-endpoint.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-25-inventory-catalog-endpoint.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
#
# Requires PR 1 (2026-09-25-buyer-search-schema.sh) already deployed — this script's
# anchor text assumes dealer_inventory_options exists; if that migration hasn't run yet
# on this box, deploy it first.
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

if "handleInventoryCatalogOptions" not in s:
    rep('''async function handleInventoryByDealer(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("by-dealer", async () => {
    const [rows] = await pool.query("SELECT dealer_id, COUNT(*) AS inStock, SUM(cond = 'new') AS newCount, SUM(price_diff < 0) AS priceDrops, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id");
    return { dealers: rows.map((r) => ({ dealerId: String(r.dealer_id), inStock: Number(r.inStock), newCount: Number(r.newCount || 0), priceDrops: Number(r.priceDrops || 0), lastSeenAt: r.lastSeenAt })) };
  }));
}

// ---------------------------------------------------------------------------''', '''async function handleInventoryByDealer(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("by-dealer", async () => {
    const [rows] = await pool.query("SELECT dealer_id, COUNT(*) AS inStock, SUM(cond = 'new') AS newCount, SUM(price_diff < 0) AS priceDrops, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id");
    return { dealers: rows.map((r) => ({ dealerId: String(r.dealer_id), inStock: Number(r.inStock), newCount: Number(r.newCount || 0), priceDrops: Number(r.priceDrops || 0), lastSeenAt: r.lastSeenAt })) };
  }));
}

// GET /api/inventory/catalog?make=&model=&trim= — the buyer /search page's filter-panel
// options: which factory option codes and exterior/interior colors actually exist among
// in-stock vehicles matching the given make/model/trim. Scoped (not a global distinct list)
// so the panel never offers a combination that returns zero results — e.g. offering "PANO"
// for a Model 3 when only the Model Y has it. Cached per make/model/trim key the same 10
// minutes as stats/by-dealer/analytics, invalidated the same way (every bulk upsert/sweep).
async function handleInventoryCatalogOptions(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const make = (params.get("make") || "").trim();
  const model = (params.get("model") || "").trim();
  const trim = (params.get("trim") || "").trim();
  const where = ["i.removed_at IS NULL"], args = [];
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
    );
    const exteriorColors = [...new Set(colorRows.map((r) => r.exterior_color).filter(Boolean))].sort();
    const interiorColors = [...new Set(colorRows.map((r) => r.interior_color).filter(Boolean))].sort();
    return {
      options: optionRows.map((r) => ({ code: r.code, vehicleCount: Number(r.vehicleCount) })),
      exteriorColors,
      interiorColors,
    };
  }));
}

// ---------------------------------------------------------------------------''', "handleInventoryCatalogOptions handler")

    rep('''  if (req.method === "GET" && pathname === "/api/inventory/by-dealer") return run(handleInventoryByDealer);
if (req.method === "GET" && pathname === "/api/inventory/by-listing-url") return run(handleInventoryByListingUrl, url.searchParams);''', '''  if (req.method === "GET" && pathname === "/api/inventory/by-dealer") return run(handleInventoryByDealer);
  if (req.method === "GET" && pathname === "/api/inventory/catalog") return run(handleInventoryCatalogOptions, url.searchParams);
if (req.method === "GET" && pathname === "/api/inventory/by-listing-url") return run(handleInventoryByListingUrl, url.searchParams);''', "catalog route registration")
else:
    print("already patched")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/catalog)
echo "GET /api/inventory/catalog without key -> $code (401 = server up and guarding)"
echo "Done. Verify live with an authenticated request, e.g.:"
echo '  curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory/catalog?make=Toyota"'
