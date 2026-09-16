#!/usr/bin/env bash
# Deals API: dealer_inventory carries the nightly crawl's rich fields — window sticker, engine/transmission,
# days on lot, day-over-day price movement, price history, factory options, crawl first-seen date — with
# list filters (changeType, priceChange=drop|increase, hasSticker, minDays), extra sort keys, movement counts
# in /stats, and GET /api/inventory/by-dealer (in-stock counts per store for the dealer sheet).
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-16-inventory-rich-fields.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-16-inventory-rich-fields.sh && bash 2026-09-16-inventory-rich-fields.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check. Columns are added
# on the next request (ALTER TABLE … IF NOT EXISTS).
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

if "window_sticker_url" not in s:
    rep('''    await pool.query("ALTER TABLE dealer_inventory DROP PRIMARY KEY, ADD PRIMARY KEY (vin, dealer_id)");
  }
  inventoryReady = true;''', '''    await pool.query("ALTER TABLE dealer_inventory DROP PRIMARY KEY, ADD PRIMARY KEY (vin, dealer_id)");
  }
  // The nightly crawl carries more than the core columns: window sticker, engine/transmission, days on lot,
  // day-over-day price movement, price history, factory options. Additive, so a fresh or old table both work.
  for (const ddl of [
    "MODIFY cond VARCHAR(12) NULL",
    "ADD COLUMN IF NOT EXISTS window_sticker_url VARCHAR(700) NULL",
    "ADD COLUMN IF NOT EXISTS engine VARCHAR(160) NULL",
    "ADD COLUMN IF NOT EXISTS transmission VARCHAR(160) NULL",
    "ADD COLUMN IF NOT EXISTS days_on_lot INT NULL",
    "ADD COLUMN IF NOT EXISTS old_price INT NULL",
    "ADD COLUMN IF NOT EXISTS price_diff INT NULL",
    "ADD COLUMN IF NOT EXISTS price_change_type VARCHAR(16) NULL",
    "ADD COLUMN IF NOT EXISTS change_type VARCHAR(16) NULL",
    "ADD COLUMN IF NOT EXISTS price_history_json TEXT NULL",
    "ADD COLUMN IF NOT EXISTS options_json MEDIUMTEXT NULL",
    "ADD COLUMN IF NOT EXISTS options_total INT NULL",
    "ADD COLUMN IF NOT EXISTS base_msrp INT NULL",
    "ADD COLUMN IF NOT EXISTS crawl_first_seen DATE NULL",
    "ADD INDEX IF NOT EXISTS idx_inv_change (change_type)",
    "ADD INDEX IF NOT EXISTS idx_inv_price_change (price_change_type)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  inventoryReady = true;''', "columns")
    rep('''    vdpUrl: r.vdp_url, imageUrl: r.image_url, source: r.source, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, removedAt: r.removed_at,
    dealerCity: r.dealer_city ?? null, dealerState: r.dealer_state ?? null,
  };
}''', '''    vdpUrl: r.vdp_url, imageUrl: r.image_url, source: r.source, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, removedAt: r.removed_at,
    dealerCity: r.dealer_city ?? null, dealerState: r.dealer_state ?? null,
    windowStickerUrl: r.window_sticker_url ?? null, engine: r.engine ?? null, transmission: r.transmission ?? null, daysOnLot: r.days_on_lot ?? null,
    oldPrice: r.old_price ?? null, priceDiff: r.price_diff ?? null, priceChangeType: r.price_change_type ?? null, changeType: r.change_type ?? null,
    priceHistory: INV_JSON(r.price_history_json), options: INV_JSON(r.options_json), optionsTotal: r.options_total ?? null, baseMsrp: r.base_msrp ?? null,
    crawlFirstSeen: r.crawl_first_seen ?? null,
  };
}
const INV_JSON = (t) => { if (!t) return null; try { return JSON.parse(t); } catch { return null; } };
const INV_JSON_STR = (v, n) => { if (v == null) return null; try { const t = JSON.stringify(v); return t.length > n ? null : t; } catch { return null; } };
const INV_DATE = (v) => (typeof v === "string" && /^\\d{4}-\\d{2}-\\d{2}/.test(v) ? v.slice(0, 10) : null);''', "row mapper")
    rep('''    const values = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId), INV_STR(v.dealerName, 255), INV_STR(v.condition, 8), INV_INT(v.year), INV_STR(v.make, 64), INV_STR(v.model, 96), INV_STR(v.trim, 160), INV_STR(v.bodyStyle, 64), INV_STR(v.exteriorColor, 96), INV_STR(v.interiorColor, 96), INV_INT(v.mileage), INV_INT(v.price), INV_INT(v.msrp), INV_STR(v.stockNumber, 64), INV_STR(v.vdpUrl, 700), INV_STR(v.imageUrl, 700), INV_STR(v.source, 16)]);
    await pool.query(
      `INSERT INTO dealer_inventory (vin, dealer_id, dealer_name, cond, year, make, model, trim, body_style, exterior_color, interior_color, mileage, price, msrp, stock_number, vdp_url, image_url, source)
       VALUES ? ON DUPLICATE KEY UPDATE dealer_id = VALUES(dealer_id), dealer_name = VALUES(dealer_name), cond = COALESCE(VALUES(cond), cond), year = COALESCE(VALUES(year), year), make = COALESCE(VALUES(make), make), model = COALESCE(VALUES(model), model), trim = COALESCE(VALUES(trim), trim), body_style = COALESCE(VALUES(body_style), body_style), exterior_color = COALESCE(VALUES(exterior_color), exterior_color), interior_color = COALESCE(VALUES(interior_color), interior_color), mileage = COALESCE(VALUES(mileage), mileage), price = COALESCE(VALUES(price), price), msrp = COALESCE(VALUES(msrp), msrp), stock_number = COALESCE(VALUES(stock_number), stock_number), vdp_url = VALUES(vdp_url), image_url = COALESCE(VALUES(image_url), image_url), source = VALUES(source), last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL`,
      [values]
    );''', '''    const values = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId), INV_STR(v.dealerName, 255), INV_STR(v.condition, 12), INV_INT(v.year), INV_STR(v.make, 64), INV_STR(v.model, 96), INV_STR(v.trim, 160), INV_STR(v.bodyStyle, 64), INV_STR(v.exteriorColor, 96), INV_STR(v.interiorColor, 96), INV_INT(v.mileage), INV_INT(v.price), INV_INT(v.msrp), INV_STR(v.stockNumber, 64), INV_STR(v.vdpUrl, 700), INV_STR(v.imageUrl, 700), INV_STR(v.source, 16),
      INV_STR(v.windowStickerUrl, 700), INV_STR(v.engine, 160), INV_STR(v.transmission, 160), INV_INT(v.daysOnLot), INV_INT(v.oldPrice), INV_INT(v.priceDiff), INV_STR(v.priceChangeType, 16), INV_STR(v.changeType, 16), INV_JSON_STR(v.priceHistory, 60000), INV_JSON_STR(v.options, 200000), INV_INT(v.optionsTotal), INV_INT(v.baseMsrp), INV_DATE(v.crawlFirstSeen)]);
    await pool.query(
      `INSERT INTO dealer_inventory (vin, dealer_id, dealer_name, cond, year, make, model, trim, body_style, exterior_color, interior_color, mileage, price, msrp, stock_number, vdp_url, image_url, source,
        window_sticker_url, engine, transmission, days_on_lot, old_price, price_diff, price_change_type, change_type, price_history_json, options_json, options_total, base_msrp, crawl_first_seen)
       VALUES ? ON DUPLICATE KEY UPDATE dealer_id = VALUES(dealer_id), dealer_name = VALUES(dealer_name), cond = COALESCE(VALUES(cond), cond), year = COALESCE(VALUES(year), year), make = COALESCE(VALUES(make), make), model = COALESCE(VALUES(model), model), trim = COALESCE(VALUES(trim), trim), body_style = COALESCE(VALUES(body_style), body_style), exterior_color = COALESCE(VALUES(exterior_color), exterior_color), interior_color = COALESCE(VALUES(interior_color), interior_color), mileage = COALESCE(VALUES(mileage), mileage), price = COALESCE(VALUES(price), price), msrp = COALESCE(VALUES(msrp), msrp), stock_number = COALESCE(VALUES(stock_number), stock_number), vdp_url = VALUES(vdp_url), image_url = COALESCE(VALUES(image_url), image_url), source = VALUES(source), last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL,
        window_sticker_url = COALESCE(VALUES(window_sticker_url), window_sticker_url), engine = COALESCE(VALUES(engine), engine), transmission = COALESCE(VALUES(transmission), transmission), days_on_lot = COALESCE(VALUES(days_on_lot), days_on_lot), old_price = VALUES(old_price), price_diff = VALUES(price_diff), price_change_type = VALUES(price_change_type), change_type = VALUES(change_type), price_history_json = COALESCE(VALUES(price_history_json), price_history_json), options_json = COALESCE(VALUES(options_json), options_json), options_total = COALESCE(VALUES(options_total), options_total), base_msrp = COALESCE(VALUES(base_msrp), base_msrp), crawl_first_seen = COALESCE(VALUES(crawl_first_seen), crawl_first_seen)`,
      [values]
    );''', "bulk fields")
    rep('''  if (p("inStock") === "1") where.push("i.removed_at IS NULL");''', '''  if (p("inStock") === "1") where.push("i.removed_at IS NULL");
  if (p("changeType")) { where.push("i.change_type = ?"); args.push(p("changeType").toUpperCase()); }
  if (p("priceChange") === "drop") where.push("i.price_diff < 0");
  if (p("priceChange") === "increase") where.push("i.price_diff > 0");
  if (p("hasSticker") === "1") where.push("i.window_sticker_url IS NOT NULL");
  if (p("minDays")) { where.push("i.days_on_lot >= ?"); args.push(Number(p("minDays"))); }''', "list filters")
    rep('''  const sortable = { dealer: "i.dealer_name", year: "i.year", make: "i.make", model: "i.model", price: "i.price", mileage: "i.mileage", seen: "i.last_seen_at" };''',
        '''  const sortable = { dealer: "i.dealer_name", year: "i.year", make: "i.make", model: "i.model", price: "i.price", mileage: "i.mileage", seen: "i.last_seen_at", days: "i.days_on_lot", pricediff: "i.price_diff", msrp: "i.msrp" };''', "sort keys")
    rep('''  const [byCond] = await pool.query("SELECT cond, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL GROUP BY cond");
  sendJson(res, 200, { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), vins: Number(tot.vins), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond });
}''', '''  const [byCond] = await pool.query("SELECT cond, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL GROUP BY cond");
  const [[mv]] = await pool.query("SELECT SUM(change_type = 'NEW_ARRIVAL') AS arrivals, SUM(price_diff < 0) AS priceDrops, SUM(price_diff > 0) AS priceIncreases, SUM(window_sticker_url IS NOT NULL) AS withSticker, SUM(removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) AS removedToday FROM dealer_inventory WHERE removed_at IS NULL OR removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
  sendJson(res, 200, { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), vins: Number(tot.vins), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond,
    movement: { arrivals: Number(mv.arrivals || 0), priceDrops: Number(mv.priceDrops || 0), priceIncreases: Number(mv.priceIncreases || 0), withSticker: Number(mv.withSticker || 0), removedToday: Number(mv.removedToday || 0) } });
}

// GET /api/inventory/by-dealer — in-stock counts per store, for the dealer sheet.
async function handleInventoryByDealer(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const [rows] = await pool.query("SELECT dealer_id, COUNT(*) AS inStock, SUM(cond = 'new') AS newCount, SUM(price_diff < 0) AS priceDrops, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id");
  sendJson(res, 200, { dealers: rows.map((r) => ({ dealerId: String(r.dealer_id), inStock: Number(r.inStock), newCount: Number(r.newCount || 0), priceDrops: Number(r.priceDrops || 0), lastSeenAt: r.lastSeenAt })) });
}''', "stats + by-dealer")
    rep('''  if (req.method === "GET" && pathname === "/api/inventory/stats") return run(handleInventoryStats);''', '''  if (req.method === "GET" && pathname === "/api/inventory/stats") return run(handleInventoryStats);
  if (req.method === "GET" && pathname === "/api/inventory/by-dealer") return run(handleInventoryByDealer);''', "route")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats)
echo "GET /api/inventory/stats without key -> $code (401 = server up and guarding)"
