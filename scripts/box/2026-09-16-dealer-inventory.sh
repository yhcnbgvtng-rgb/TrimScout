#!/usr/bin/env bash
# Deals API: dealer_inventory — vehicles crawled from dealer websites.
#   POST /api/inventory/bulk   { vehicles: [...] }        upsert by VIN
#   POST /api/inventory/sweep  { dealerId, seenAfter }    mark a store's stale VINs removed
#   GET  /api/inventory?dealerId=&state=&make=&model=&cond=&q=&inStock=1&limit=&offset=&sort=
#   GET  /api/inventory/stats
# The table is created on first use (CREATE TABLE IF NOT EXISTS).
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-16-dealer-inventory.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-16-dealer-inventory.sh && bash 2026-09-16-dealer-inventory.sh
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

if "dealer_inventory" not in s:
    rep('''const server = http.createServer((req, res) => {
  if (!requireAuth(req, res)) return;
''', r'''// ---------------------------------------------------------------------------
// Dealer inventory — vehicles crawled from dealer websites (scrapers/inventory/crawl_inventory.py).
// One row per VIN; a VIN that moves stores is re-pointed on the next upsert. `removed_at` is set by the
// sweep once a store's crawl no longer lists the VIN, so "in stock" = removed_at IS NULL.
// ---------------------------------------------------------------------------
let inventoryReady = false;
async function ensureInventoryTable(pool) {
  if (inventoryReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory (
    vin CHAR(17) NOT NULL PRIMARY KEY,
    dealer_id INT NULL,
    dealer_name VARCHAR(255) NOT NULL,
    cond VARCHAR(8) NULL,
    year SMALLINT NULL,
    make VARCHAR(64) NULL,
    model VARCHAR(96) NULL,
    trim VARCHAR(160) NULL,
    body_style VARCHAR(64) NULL,
    exterior_color VARCHAR(96) NULL,
    interior_color VARCHAR(96) NULL,
    mileage INT NULL,
    price INT NULL,
    msrp INT NULL,
    stock_number VARCHAR(64) NULL,
    vdp_url VARCHAR(700) NULL,
    image_url VARCHAR(700) NULL,
    source VARCHAR(16) NULL,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_at DATETIME NULL,
    INDEX idx_inv_dealer (dealer_id),
    INDEX idx_inv_make_model (make, model),
    INDEX idx_inv_last_seen (last_seen_at),
    INDEX idx_inv_removed (removed_at)
  )`);
  inventoryReady = true;
}

const INV_STR = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const INV_INT = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);

function inventoryRowFromDb(r) {
  return {
    vin: r.vin, dealerId: r.dealer_id == null ? null : String(r.dealer_id), dealerName: r.dealer_name, condition: r.cond || null, year: r.year, make: r.make, model: r.model, trim: r.trim,
    bodyStyle: r.body_style, exteriorColor: r.exterior_color, interiorColor: r.interior_color, mileage: r.mileage, price: r.price, msrp: r.msrp, stockNumber: r.stock_number,
    vdpUrl: r.vdp_url, imageUrl: r.image_url, source: r.source, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, removedAt: r.removed_at,
    dealerCity: r.dealer_city ?? null, dealerState: r.dealer_state ?? null,
  };
}

// POST /api/inventory/bulk { vehicles: [{vin, dealerId, dealerName, condition, year, make, model, trim, ...}] }
async function handleInventoryBulk(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const body = await readBody(req, 30_000_000);
  const vehicles = Array.isArray(body.vehicles) ? body.vehicles : null;
  if (!vehicles) return badRequest(res, "vehicles[] is required");
  let upserted = 0, skipped = 0;
  for (let i = 0; i < vehicles.length; i += 500) {
    const chunk = vehicles.slice(i, i + 500).filter((v) => typeof v.vin === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(v.vin.trim().toUpperCase()) && INV_STR(v.dealerName, 255));
    skipped += Math.min(500, vehicles.length - i) - chunk.length;
    if (!chunk.length) continue;
    const values = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_INT(v.dealerId), INV_STR(v.dealerName, 255), INV_STR(v.condition, 8), INV_INT(v.year), INV_STR(v.make, 64), INV_STR(v.model, 96), INV_STR(v.trim, 160), INV_STR(v.bodyStyle, 64), INV_STR(v.exteriorColor, 96), INV_STR(v.interiorColor, 96), INV_INT(v.mileage), INV_INT(v.price), INV_INT(v.msrp), INV_STR(v.stockNumber, 64), INV_STR(v.vdpUrl, 700), INV_STR(v.imageUrl, 700), INV_STR(v.source, 16)]);
    await pool.query(
      `INSERT INTO dealer_inventory (vin, dealer_id, dealer_name, cond, year, make, model, trim, body_style, exterior_color, interior_color, mileage, price, msrp, stock_number, vdp_url, image_url, source)
       VALUES ? ON DUPLICATE KEY UPDATE dealer_id = VALUES(dealer_id), dealer_name = VALUES(dealer_name), cond = COALESCE(VALUES(cond), cond), year = COALESCE(VALUES(year), year), make = COALESCE(VALUES(make), make), model = COALESCE(VALUES(model), model), trim = COALESCE(VALUES(trim), trim), body_style = COALESCE(VALUES(body_style), body_style), exterior_color = COALESCE(VALUES(exterior_color), exterior_color), interior_color = COALESCE(VALUES(interior_color), interior_color), mileage = COALESCE(VALUES(mileage), mileage), price = COALESCE(VALUES(price), price), msrp = COALESCE(VALUES(msrp), msrp), stock_number = COALESCE(VALUES(stock_number), stock_number), vdp_url = VALUES(vdp_url), image_url = COALESCE(VALUES(image_url), image_url), source = VALUES(source), last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL`,
      [values]
    );
    upserted += chunk.length;
  }
  sendJson(res, 200, { upserted, skipped });
}

// POST /api/inventory/sweep { dealerId, seenAfter } — a store's VINs not seen since `seenAfter` are marked removed.
async function handleInventorySweep(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const body = await readBody(req);
  const dealerId = INV_INT(body.dealerId);
  const seenAfter = typeof body.seenAfter === "string" ? new Date(body.seenAfter) : null;
  if (!dealerId || !seenAfter || Number.isNaN(seenAfter.getTime())) return badRequest(res, "dealerId and seenAfter (ISO) are required");
  const [result] = await pool.query("UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id = ? AND removed_at IS NULL AND last_seen_at < ?", [dealerId, seenAfter]);
  sendJson(res, 200, { removed: result.affectedRows });
}

// GET /api/inventory?dealerId=&state=&make=&model=&cond=&q=&inStock=1&limit=&offset=&sort=
async function handleListInventory(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const where = [], args = [];
  const p = (k) => (params.get(k) || "").trim();
  if (p("dealerId")) { where.push("i.dealer_id = ?"); args.push(Number(p("dealerId"))); }
  if (p("state")) { where.push("d.state = ?"); args.push(p("state").toUpperCase()); }
  if (p("make")) { where.push("i.make = ?"); args.push(p("make")); }
  if (p("model")) { where.push("i.model = ?"); args.push(p("model")); }
  if (p("cond")) { where.push("i.cond = ?"); args.push(p("cond")); }
  if (p("inStock") === "1") where.push("i.removed_at IS NULL");
  if (p("q")) { where.push("(i.vin LIKE ? OR i.dealer_name LIKE ? OR i.model LIKE ? OR i.trim LIKE ? OR i.stock_number LIKE ?)"); const like = `%${p("q")}%`; args.push(like, like, like, like, like); }
  const sortable = { dealer: "i.dealer_name", year: "i.year", make: "i.make", model: "i.model", price: "i.price", mileage: "i.mileage", seen: "i.last_seen_at" };
  const [sk, sd] = (p("sort") || "dealer:asc").split(":");
  const orderBy = `${sortable[sk] || "i.dealer_name"} ${sd === "desc" ? "DESC" : "ASC"}, i.vin ASC`;
  const limit = Math.min(Math.max(Number(p("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(p("offset")) || 0, 0);
  const sql = `FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${sql}`, args);
  const [rows] = await pool.query(`SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}

// GET /api/inventory/stats — counts for the admin sheet's filter menus.
async function handleInventoryStats(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const [[tot]] = await pool.query("SELECT COUNT(*) AS total, SUM(removed_at IS NULL) AS inStock, COUNT(DISTINCT dealer_id) AS dealers, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory");
  const [byMake] = await pool.query("SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100");
  const [byState] = await pool.query("SELECT d.state AS state, COUNT(*) AS n FROM dealer_inventory i JOIN dealership_contacts d ON d.id = i.dealer_id WHERE i.removed_at IS NULL GROUP BY d.state ORDER BY n DESC");
  const [byCond] = await pool.query("SELECT cond, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL GROUP BY cond");
  sendJson(res, 200, { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond });
}

const server = http.createServer((req, res) => {
  if (!requireAuth(req, res)) return;
''', "inventory handlers")
    rep('''  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }
''', '''  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  // dealer inventory (crawled vehicles)
  if (req.method === "POST" && pathname === "/api/inventory/bulk") return run(handleInventoryBulk);
  if (req.method === "POST" && pathname === "/api/inventory/sweep") return run(handleInventorySweep);
  if (req.method === "GET" && pathname === "/api/inventory/stats") return run(handleInventoryStats);
  if (req.method === "GET" && pathname === "/api/inventory") return run(handleListInventory, url.searchParams);
''', "routes")
    rep('''  console.log(`  GET  /health`);''', '''  console.log(`  POST /api/inventory/bulk`);
  console.log(`  POST /api/inventory/sweep`);
  console.log(`  GET  /api/inventory?dealerId=&state=&make=&model=&cond=&q=&inStock=1&limit=&offset=&sort=`);
  console.log(`  GET  /api/inventory/stats`);
  console.log(`  GET  /health`);''', "banner")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats)
echo "GET /api/inventory/stats without key -> $code (401 = server up and guarding)"
sudo pm2 logs trimscout-deals-api --lines 6 --nostream | tail -6
