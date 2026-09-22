#!/usr/bin/env bash
# Deals API: reverts SQL_CALC_FOUND_ROWS in handleListInventory back to two independent
# queries. This is an OUTAGE FIX, not a style change — SQL_CALC_FOUND_ROWS (added earlier
# today by scripts/box/2026-09-22-speed-up-inventory-search.sh) caused a live "Inventory
# request timed out" failure on the admin crawl sheet's default view (no q=, inStock=1,
# sort=dealer:asc): 591k candidate rows, 427k matching. SQL_CALC_FOUND_ROWS can't return
# early once LIMIT rows are found — it must fully evaluate every matching row so a later
# FOUND_ROWS() is exact — so MariaDB gave up an index-ordered scan that finds the first
# `limit` rows and stops, for a filesort over all 427k matches. Confirmed live via EXPLAIN +
# timing: 17.5s combined vs 19ms (SELECT) + 839ms (COUNT(*)) split — ~20x faster. This keeps
# the prefix/suffix search indexes from the same day's other fix; only the count strategy
# changes.
#
# Run on the box (ubuntu@3.208.49.1):
#   cd ~ && curl -fsSL -o 2026-09-22-revert-sql-calc-found-rows.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-revert-sql-calc-found-rows.sh && sudo cp 2026-09-22-revert-sql-calc-found-rows.sh /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo bash 2026-09-22-revert-sql-calc-found-rows.sh
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
  // One scan instead of two: running the WHERE clause a second time just for
  // COUNT(*) doubled the cost of every request for nothing (worst case a
  // free-text q= search — see the idx_inv_*_fwd/_rev indexes above for why
  // that's no longer a full scan on its own). SQL_CALC_FOUND_ROWS computes the full match
  // count as a side effect of the LIMITed query itself (MariaDB has never
  // deprecated it, unlike MySQL 8+), so FOUND_ROWS() is a cheap follow-up,
  // not a second scan — but it's per-connection state, so both queries MUST
  // run on the same pooled connection, never pool.query() twice (the second
  // call can land on a different connection and read back an unrelated
  // request's count). Same `total` value in the response either way.
  const conn = await pool.getConnection();
  let rows, total;
  try {
    [rows] = await conn.query(`SELECT SQL_CALC_FOUND_ROWS i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...args, limit, offset]);
    [[{ total }]] = await conn.query("SELECT FOUND_ROWS() AS total");
  } finally {
    conn.release();
  }
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}''',
'''  const sql = `FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  // Two independent queries, NOT SQL_CALC_FOUND_ROWS — reverted 2026-09-22 after it caused a
  // live outage on the default (no q=, inStock=1, sort=dealer:asc) view: 591k candidate rows,
  // 427k matching. SQL_CALC_FOUND_ROWS can't return early once LIMIT rows are found — it must
  // fully evaluate every matching row so FOUND_ROWS() is exact — so MariaDB gave up the
  // idx_inv_stock_dealer index-ordered scan (which finds the first `limit` rows and stops) for
  // a filesort over all 427k matches: 17.5s, confirmed live via EXPLAIN + timing. Splitting
  // back into two queries measured 19ms (SELECT, index range scan) + 839ms (COUNT(*)) on the
  // same data — ~20x faster combined, because the SELECT regains the index+LIMIT early-stop
  // and the COUNT is a separate, simple aggregate. This trades away the one real case
  // SQL_CALC_FOUND_ROWS helped (the original un-indexed q= full scan, where neither query
  // could stop early anyway) for correctness on every other case, which is the common one.
  const [rows] = await pool.query(`SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${sql}`, args);
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}''', "revert SQL_CALC_FOUND_ROWS to split queries")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory?inStock=1&limit=1&sort=dealer:asc")
echo "inventory-default-check: $code"
