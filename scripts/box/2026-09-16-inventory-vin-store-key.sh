#!/usr/bin/env bash
# Deals API: dealer_inventory keyed by (vin, dealer_id) — a dealer group lists the same car on several
# rooftops, and the first cut (PK vin) kept only one of them. Migrates the existing table in place on the
# next request (ALTER PRIMARY KEY), and stats gains a distinct-VIN count. Re-push the crawl afterwards.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-16-inventory-vin-store-key.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-16-inventory-vin-store-key.sh && bash 2026-09-16-inventory-vin-store-key.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
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
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    s = s.replace(old, new); changed.append(label)

if "PRIMARY KEY (vin, dealer_id)" not in s:
    rep("    vin CHAR(17) NOT NULL PRIMARY KEY,\n    dealer_id INT NULL,", "    vin CHAR(17) NOT NULL,\n    dealer_id INT NOT NULL DEFAULT 0,", "create table key")
    rep("    INDEX idx_inv_removed (removed_at)\n  )`);\n  inventoryReady = true;", "    INDEX idx_inv_removed (removed_at),\n    PRIMARY KEY (vin, dealer_id)\n  )`);\n  // First cut keyed by VIN alone; a dealer group lists the same car on several rooftops, so the key is (vin, store).\n  const [[pk]] = await pool.query(\"SELECT COUNT(*) AS n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dealer_inventory' AND CONSTRAINT_NAME = 'PRIMARY'\");\n  if (Number(pk.n) === 1) {\n    await pool.query(\"ALTER TABLE dealer_inventory MODIFY dealer_id INT NOT NULL DEFAULT 0\");\n    await pool.query(\"ALTER TABLE dealer_inventory DROP PRIMARY KEY, ADD PRIMARY KEY (vin, dealer_id)\");\n  }\n  inventoryReady = true;", "migrate existing table")
    rep("const INV_INT = (v) => (Number.isFinite(Number(v)) && v !== null && v !== \"\" ? Math.round(Number(v)) : null);", "const INV_INT = (v) => (Number.isFinite(Number(v)) && v !== null && v !== \"\" ? Math.round(Number(v)) : null);\nconst INV_DEALER = (v) => INV_INT(v) || 0;", "dealer default")
    rep("    const values = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_INT(v.dealerId),", "    const values = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId),", "bulk values")
    rep("    vin: r.vin, dealerId: r.dealer_id == null ? null : String(r.dealer_id),", "    vin: r.vin, dealerId: r.dealer_id ? String(r.dealer_id) : null,", "row mapper")
    rep("  const [[tot]] = await pool.query(\"SELECT COUNT(*) AS total, SUM(removed_at IS NULL) AS inStock, COUNT(DISTINCT dealer_id) AS dealers, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory\");", "  const [[tot]] = await pool.query(\"SELECT COUNT(*) AS total, SUM(removed_at IS NULL) AS inStock, COUNT(DISTINCT dealer_id) AS dealers, COUNT(DISTINCT vin) AS vins, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory\");", "stats query")
    rep("  sendJson(res, 200, { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond });", "  sendJson(res, 200, { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), vins: Number(tot.vins), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond });", "stats response")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats)
echo "GET /api/inventory/stats without key -> $code (401 = server up and guarding)"
