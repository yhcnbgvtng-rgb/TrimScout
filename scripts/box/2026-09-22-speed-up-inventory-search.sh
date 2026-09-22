#!/usr/bin/env bash
# Deals API: /api/inventory ran the same WHERE clause twice per request — once for
# SELECT COUNT(*), once for the LIMITed page. The free-text q= search (a 5-column
# OR'd LIKE '%...%', which no index can help since it has a leading wildcard) is the
# worst case: every search scanned dealer_inventory twice instead of once. Switches
# to SQL_CALC_FOUND_ROWS / FOUND_ROWS() — MariaDB has never deprecated it (unlike
# MySQL 8+) — so the row count comes as a side effect of the one LIMITed query
# instead of a second full scan. Same `total` value in the response either way.
#
# Run on the box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-22-speed-up-inventory-search.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-speed-up-inventory-search.sh && bash 2026-09-22-speed-up-inventory-search.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read(); changed=[]
def rep(old,new,label):
    global s
    n=s.count(old); assert n==1, f"{label}: {n}\n{old[:160]}"
    if new in s: return
    s=s.replace(old,new); changed.append(label)
rep('''  const sql = `FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${sql}`, args);
  const [rows] = await pool.query(`SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });''',
'''  const sql = `FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  // One scan instead of two. A free-text q= search is a 5-column OR'd LIKE
  // '%...%' — no index can help a leading wildcard, so it walks every
  // candidate row; running that same WHERE clause a second time just for
  // COUNT(*) doubled the cost of every search for nothing. SQL_CALC_FOUND_ROWS
  // computes the full match count as a side effect of the LIMITed query
  // itself (MariaDB has never deprecated it, unlike MySQL 8+), so FOUND_ROWS()
  // is a cheap follow-up, not a second scan — but it's per-connection state,
  // so both queries MUST run on the same pooled connection, never pool.query()
  // twice (the second call can land on a different connection and read back
  // an unrelated request's count). Same `total` value in the response either way.
  const conn = await pool.getConnection();
  let rows, total;
  try {
    [rows] = await conn.query(`SELECT SQL_CALC_FOUND_ROWS i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...args, limit, offset]);
    [[{ total }]] = await conn.query("SELECT FOUND_ROWS() AS total");
  } finally {
    conn.release();
  }
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });''', "one-scan inventory list (SQL_CALC_FOUND_ROWS, connection-pinned)")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory?inStock=1&limit=1")
echo "inventory-check: $code"
