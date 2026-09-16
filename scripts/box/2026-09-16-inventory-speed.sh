#!/usr/bin/env bash
# Deals API: inventory sheet speed — composite indexes for every in-stock sort/filter the sheet uses, and a
# 10-minute in-memory cache for the aggregate endpoints (/stats, /by-dealer) that every bulk upsert / sweep
# clears. Before: stats 22 s, by-dealer 17 s, a listing page ~5 s.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-16-inventory-speed.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-16-inventory-speed.sh && bash 2026-09-16-inventory-speed.sh
# Idempotent. The indexes build on the first request after restart (a minute or so on ~250k rows).
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

if "idx_inv_stock_dealer" not in s:
    rep('''    "ADD INDEX IF NOT EXISTS idx_inv_price_change (price_change_type)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);''', '''    "ADD INDEX IF NOT EXISTS idx_inv_price_change (price_change_type)",
    // Every sheet query filters removed_at IS NULL then sorts — composite indexes let those read in order.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer (removed_at, dealer_name, vin)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_make (removed_at, make, model)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_price (removed_at, price)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_msrp (removed_at, msrp)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_mileage (removed_at, mileage)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_year (removed_at, year)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_seen (removed_at, last_seen_at)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_days (removed_at, days_on_lot)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_diff (removed_at, price_diff)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer_id (removed_at, dealer_id)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);''', "indexes")
    rep('''const INV_STR = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);''', '''const INV_STR = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
// The aggregate endpoints (stats, by-dealer) scan the whole table and only change when a sync writes, so they
// are served from memory for 10 minutes and dropped by every bulk upsert / sweep.
const INV_CACHE_MS = 10 * 60_000;
const invCache = new Map();
const invCached = async (key, fn) => { const hit = invCache.get(key); if (hit && Date.now() - hit.at < INV_CACHE_MS) return hit.value; const value = await fn(); invCache.set(key, { at: Date.now(), value }); return value; };
const invInvalidate = () => invCache.clear();''', "cache helpers")
    rep('''  sendJson(res, 200, { upserted, skipped });
}

// GET /api/inventory/vin/:vin''', '''  invInvalidate();
  sendJson(res, 200, { upserted, skipped });
}

// GET /api/inventory/vin/:vin''', "bulk invalidates")
    rep('''  const [result] = await pool.query(sql, args);
  sendJson(res, 200, { removed: result.affectedRows });
}''', '''  const [result] = await pool.query(sql, args);
  if (result.affectedRows) invInvalidate();
  sendJson(res, 200, { removed: result.affectedRows });
}''', "sweep invalidates")
    rep('''async function handleInventoryStats(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const [[tot]]''', '''async function handleInventoryStats(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("stats", () => computeInventoryStats(pool)));
}
async function computeInventoryStats(pool) {
  const [[tot]]''', "stats cached")
    rep('''  sendJson(res, 200, { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), vins: Number(tot.vins), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond,
    movement: { arrivals: Number(mv.arrivals || 0), priceDrops: Number(mv.priceDrops || 0), priceIncreases: Number(mv.priceIncreases || 0), withSticker: Number(mv.withSticker || 0), removedToday: Number(mv.removedToday || 0) } });
}''', '''  return { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), vins: Number(tot.vins), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond,
    movement: { arrivals: Number(mv.arrivals || 0), priceDrops: Number(mv.priceDrops || 0), priceIncreases: Number(mv.priceIncreases || 0), withSticker: Number(mv.withSticker || 0), removedToday: Number(mv.removedToday || 0) } };
}''', "stats return")
    rep('''  const [rows] = await pool.query("SELECT dealer_id, COUNT(*) AS inStock, SUM(cond = 'new') AS newCount, SUM(price_diff < 0) AS priceDrops, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id");
  sendJson(res, 200, { dealers: rows.map((r) => ({ dealerId: String(r.dealer_id), inStock: Number(r.inStock), newCount: Number(r.newCount || 0), priceDrops: Number(r.priceDrops || 0), lastSeenAt: r.lastSeenAt })) });''', '''  sendJson(res, 200, await invCached("by-dealer", async () => {
    const [rows] = await pool.query("SELECT dealer_id, COUNT(*) AS inStock, SUM(cond = 'new') AS newCount, SUM(price_diff < 0) AS priceDrops, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id");
    return { dealers: rows.map((r) => ({ dealerId: String(r.dealer_id), inStock: Number(r.inStock), newCount: Number(r.newCount || 0), priceDrops: Number(r.priceDrops || 0), lastSeenAt: r.lastSeenAt })) };
  }));''', "by-dealer cached")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats)
echo "GET /api/inventory/stats without key -> $code (401 = server up and guarding)"
