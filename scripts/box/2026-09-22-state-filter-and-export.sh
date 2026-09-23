#!/usr/bin/env bash
# Deals API: (1) fix the state= inventory filter's query plan, (2) add a single-query streaming
# GET /api/inventory/export for the admin crawl sheet's CSV.
#
# (1) state= with the default dealer_name sort walked idx_inv_stock_dealer — every in-stock car in
# the country (~296k-row estimate) in dealer order — discarding non-matching states row by row. Confirmed
# live 2026-09-22 for TX (38,847 in stock): 21.3s for the first 2,000-row page, >90s (killed) at offset
# 20,000. Driving the join from dealership_contacts (the state's rooftops) into idx_inv_stock_dealer_id
# measured 9–11s regardless of offset — bounded, and the rest of that is disk I/O on a 128MB buffer pool.
# (2) The admin CSV used to page /api/inventory 2,000 rows at a time from Vercel — ~20 sequential
# re-sorts for TX, each a fresh filesort. The export endpoint runs the filter ONCE and streams NDJSON.
#
# Run on the box (ubuntu@3.208.49.1):
#   cd ~ && curl -fsSL -o 2026-09-22-state-filter-and-export.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-state-filter-and-export.sh && sudo cp 2026-09-22-state-filter-and-export.sh /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo bash 2026-09-22-state-filter-and-export.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
# FILE=... overrides the target (used to apply the identical change to the repo mirror).
set -euo pipefail
FILE=${FILE:-/opt/trimscout-deals/src/deals_api_server.js}
ON_BOX=$([ "$FILE" = /opt/trimscout-deals/src/deals_api_server.js ] && echo 1 || echo 0)
if [ "$ON_BOX" = 1 ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
fi

python3 - "$FILE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read(); changed=[]
if "function inventoryListQuery(params)" in s:
    print("already patched"); sys.exit(0)
def rep(old,new,label):
    global s
    n=s.count(old); assert n==1, f"{label}: {n}\n{old[:160]}"
    s=s.replace(old,new); changed.append(label)

rep('''// GET /api/inventory?dealerId=&state=&make=&model=&cond=&q=&inStock=1&limit=&offset=&sort=
async function handleListInventory(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const where = [], args = [];''',
'''// The filter/sort shared by GET /api/inventory (one page) and GET /api/inventory/export (the whole
// filter, streamed): returns the FROM/WHERE clause, its args and the ORDER BY.
function inventoryListQuery(params) {
  const where = [], args = [];''', "extract inventoryListQuery")

rep('''  const orderBy = `${sortable[sk] || "i.dealer_name"} ${sd === "desc" ? "DESC" : "ASC"}, i.vin ASC`;
  const limit = Math.min(Math.max(Number(p("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(p("offset")) || 0, 0);
''',
'''  const orderBy = `${sortable[sk] || "i.dealer_name"} ${sd === "desc" ? "DESC" : "ASC"}, i.vin ASC`;
''', "move limit/offset to handler")

rep('''  const indexHint = p("make") ? "FORCE INDEX (idx_inv_stock_make)" : "";
  const sql = `FROM dealer_inventory i ${indexHint} LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
''',
'''  const indexHint = p("make") ? "FORCE INDEX (idx_inv_stock_make)" : "";
  // state= has the same trap, found after the make= fix: with the default dealer_name sort the
  // optimizer walks idx_inv_stock_dealer — every in-stock car in the country, in dealer order —
  // and throws away the other states row by row. Confirmed live 2026-09-22 for TX (38,847 in
  // stock): 21.3s for the first 2,000 rows, >90s (killed) at offset 20,000; IGNORE INDEX just
  // moved it onto idx_inv_dealer_name_fwd with the same result. Starting from the state's
  // rooftops (dealership_contacts) and reading each one's cars via its dealer_id index measured
  // 9–11s at any offset — a filesort over only that state's rows. The state filter makes the
  // LEFT JOIN an inner join anyway, so STRAIGHT_JOIN changes the plan, not the result. Scoped
  // to state= without make= (already hinted), q= (its prefix/suffix index merge is better) or
  // dealerId= (already one store).
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const byState = p("state") && !p("make") && !p("q") && !p("dealerId");
  const sql = byState
    ? `FROM dealership_contacts d STRAIGHT_JOIN dealer_inventory i FORCE INDEX (${p("inStock") === "1" ? "idx_inv_stock_dealer_id" : "idx_inv_dealer"}) ON d.id = i.dealer_id ${whereSql}`
    : `FROM dealer_inventory i ${indexHint} LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${whereSql}`;
  return { sql, args, orderBy };
}

// GET /api/inventory?dealerId=&state=&make=&model=&cond=&q=&inStock=1&limit=&offset=&sort=
async function handleListInventory(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const { sql, args, orderBy } = inventoryListQuery(params);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
''', "state= join order + handler split")

rep('''  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${sql}`, args);
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}
''',
'''  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${sql}`, args);
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}

// GET /api/inventory/export?<same filters as /api/inventory>&max= — the admin sheet's CSV source.
// The CSV used to page /api/inventory 2,000 rows at a time, so a 38k-row state paid ~20 separate
// sorts; this runs the filter once and streams one vehicle per line (NDJSON) as MariaDB returns
// rows, so neither this 1GB box nor the caller holds the whole export in memory. The last line is
// {"done":true,"rows":n,"capped":bool} — a stream without it was cut off. A client that
// disconnects destroys the connection (not released mid-query back into the pool).
async function handleExportInventory(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const { sql, args, orderBy } = inventoryListQuery(params);
  const max = Math.min(Math.max(Number(params.get("max")) || 50000, 1), 50000);
  const conn = await pool.getConnection();
  let aborted = false;
  res.on("close", () => { if (!res.writableFinished) { aborted = true; conn.destroy(); } });
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
  let n = 0, capped = false;
  try {
    const rows = conn.connection.query(`SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ?`, [...args, max + 1]).stream({ highWaterMark: 500 });
    for await (const row of rows) {
      if (aborted) break;
      if (n === max) { capped = true; continue; }
      n++;
      if (!res.write(JSON.stringify(inventoryRowFromDb(row)) + "\\n")) await new Promise((r) => { res.once("drain", r); res.once("close", r); });
    }
    if (!aborted) res.end(JSON.stringify({ done: true, rows: n, capped }) + "\\n");
  } catch (err) {
    if (!aborted) {
      console.error(`${new Date().toISOString()} /api/inventory/export failed after ${n} rows:`, err.message);
      res.end(JSON.stringify({ error: "Export failed partway through" }) + "\\n");
    }
  } finally {
    if (!aborted) conn.release();
  }
}
''', "add handleExportInventory")

rep('''  if (req.method === "GET" && pathname === "/api/inventory") return run(handleListInventory, url.searchParams);
''',
'''  if (req.method === "GET" && pathname === "/api/inventory") return run(handleListInventory, url.searchParams);
  if (req.method === "GET" && pathname === "/api/inventory/export") return run(handleExportInventory, url.searchParams);
''', "route /api/inventory/export")

open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
if [ "$ON_BOX" = 1 ]; then
  sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory/export?inStock=1&state=TX&max=1")
  echo "export-route-check (401 = up, auth-gated): $code"
fi
