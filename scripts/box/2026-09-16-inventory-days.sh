#!/usr/bin/env bash
# Deals API: dealer_inventory_days — one row per (VIN, store, day) the crawl saw the car, with that day's price —
# written on every sync and backfilled from the crawl's dated price points; GET /api/inventory/vin/:vin returns
# every listing of a VIN with its day-by-day observations (the VIN history view on the admin sheet).
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-16-inventory-days.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-16-inventory-days.sh && bash 2026-09-16-inventory-days.sh
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

if "dealer_inventory_days" not in s:
    rep('''    "ADD INDEX IF NOT EXISTS idx_inv_price_change (price_change_type)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  inventoryReady = true;''', '''    "ADD INDEX IF NOT EXISTS idx_inv_price_change (price_change_type)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  // One row per (VIN, store, day) the crawl saw the car, with that day's price — the day-by-day history behind
  // the VIN view. Written on every sync; the crawl's price-history points backfill days before the table existed.
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_days (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    seen_on DATE NOT NULL,
    price INT NULL,
    mileage INT NULL,
    PRIMARY KEY (vin, dealer_id, seen_on),
    INDEX idx_days_vin (vin)
  )`);
  inventoryReady = true;''', "days table")
    rep('''    upserted += chunk.length;
  }
  sendJson(res, 200, { upserted, skipped });
}''', '''    upserted += chunk.length;
    // Today's observation for every vehicle in the chunk, plus the crawl's dated price points (backfill).
    const today = new Date().toISOString().slice(0, 10);
    const days = [];
    for (const v of chunk) {
      const vin = v.vin.trim().toUpperCase(), dealerId = INV_DEALER(v.dealerId);
      days.push([vin, dealerId, today, INV_INT(v.price), INV_INT(v.mileage)]);
      if (Array.isArray(v.priceHistory)) for (const h of v.priceHistory.slice(-60)) { const d = INV_DATE(h && h.date); if (d && d !== today) days.push([vin, dealerId, d, INV_INT(h.price), null]); }
    }
    if (days.length) await pool.query("INSERT INTO dealer_inventory_days (vin, dealer_id, seen_on, price, mileage) VALUES ? ON DUPLICATE KEY UPDATE price = COALESCE(VALUES(price), price), mileage = COALESCE(VALUES(mileage), mileage)", [days]);
  }
  sendJson(res, 200, { upserted, skipped });
}

// GET /api/inventory/vin/:vin — every store that has listed the VIN, with its day-by-day observations.
async function handleInventoryVin(req, res, vin) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const [rows] = await pool.query("SELECT i.*, d.city AS dealer_city, d.state AS dealer_state FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id WHERE i.vin = ? ORDER BY i.removed_at IS NULL DESC, i.last_seen_at DESC", [vin]);
  const [days] = await pool.query("SELECT dealer_id, seen_on, price, mileage FROM dealer_inventory_days WHERE vin = ? ORDER BY seen_on ASC", [vin]);
  const fmt = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  sendJson(res, 200, { vin, listings: rows.map(inventoryRowFromDb), days: days.map((r) => ({ dealerId: r.dealer_id ? String(r.dealer_id) : null, seenOn: fmt(r.seen_on), price: r.price, mileage: r.mileage })) });
}''', "days write + vin endpoint")
    rep('''  if (req.method === "GET" && pathname === "/api/inventory/by-dealer") return run(handleInventoryByDealer);''', '''  if (req.method === "GET" && pathname === "/api/inventory/by-dealer") return run(handleInventoryByDealer);
  const inventoryVinMatch = pathname.match(/^\\/api\\/inventory\\/vin\\/([A-HJ-NPR-Z0-9]{17})$/i);
  if (req.method === "GET" && inventoryVinMatch) return run(handleInventoryVin, inventoryVinMatch[1].toUpperCase());''', "vin route")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats)
echo "GET /api/inventory/stats without key -> $code (401 = server up and guarding)"
