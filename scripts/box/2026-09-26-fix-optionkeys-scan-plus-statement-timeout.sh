#!/usr/bin/env bash
# Two fixes, deployed together since both were surfaced by the same live incident:
#
# 1. inventoryListQuery.js's optionKeys= filter was a CORRELATED SUBQUERY — one
#    dealer_inventory_options lookup per outer candidate row. An earlier fix (#318) indexed that
#    per-row lookup so each individual call was fast, but a correlated subquery still runs once
#    PER OUTER ROW regardless. Confirmed live 2026-09-26: a real buyer search with optionKeys= and
#    no make=/state= (674,248 outer candidate rows — every in-stock vehicle nationally) ran for
#    2+ hours before being killed manually. Rewritten as a JOIN into a derived table: the matching
#    (vin, dealer_id) pairs are computed exactly once, then joined like any other table. Verified
#    via EXPLAIN: the derived table scans idx_opt_canonical index-only (no new index needed —
#    InnoDB appends the primary key to every secondary index), the outer join becomes a plain
#    eq_ref lookup instead of a per-row subquery execution.
#
# 2. GET /api/inventory's two queries (list + count) now run under MariaDB's
#    SET STATEMENT max_statement_time=20 FOR ... — confirmed live, MariaDB 10.11 aborts a query
#    that exceeds this with error 1969, in exactly the given number of seconds. A backstop
#    independent of query-plan correctness: even the fixed, index-only optionKeys= plan still took
#    58s live against dealer_inventory_options under heavy concurrent write load from a one-time
#    backfill — a hard ceiling means a pathological case fails fast (freeing the MySQL thread/
#    connection) instead of running indefinitely long after the calling client's own 60s timeout
#    has already given up, which is what let the original incident occupy a connection for 2+
#    hours. Not applied to handleExportInventory's streaming query (a 50k-row CSV export is
#    expected to run longer than 20s by design).
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-26-fix-optionkeys-scan-plus-statement-timeout.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-26-fix-optionkeys-scan-plus-statement-timeout.sh?cb=$(date +%s)" && curl -fsSL -o inventoryListQuery.js "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src/inventoryListQuery.js?cb=$(date +%s)" && grep -c opt_match inventoryListQuery.js && sudo cp 2026-09-26-fix-optionkeys-scan-plus-statement-timeout.sh inventoryListQuery.js /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-26-fix-optionkeys-scan-plus-statement-timeout.sh
set -euo pipefail
FILE=${FILE:-/opt/trimscout-deals/src/deals_api_server.js}
DIR=$(dirname "$FILE")
ON_BOX=$([ "$FILE" = /opt/trimscout-deals/src/deals_api_server.js ] && echo 1 || echo 0)
if [ "$ON_BOX" = 1 ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
  if [ ! -f "$DIR/inventoryListQuery.js" ]; then
    echo "ERROR: $DIR/inventoryListQuery.js not found — fetch it alongside this script first (see the usage line above). Always re-fetched whole, never patched in place." >&2
    exit 1
  fi
  if ! grep -q "opt_match" "$DIR/inventoryListQuery.js"; then
    echo "ERROR: the fetched inventoryListQuery.js doesn't contain opt_match — likely a stale cached copy from raw.githubusercontent.com. Re-fetch with a fresh cache-busting query param and try again." >&2
    exit 1
  fi
fi

sudo python3 - "$FILE" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
changed = []

def rep(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, "%s: expected exactly 1 match, found %d:\n%s" % (label, n, old[:200])
    s = s.replace(old, new)
    changed.append(label)

if "max_statement_time" not in s:
    rep(
        '''async function handleListInventory(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const { sql, args, orderBy } = inventoryListQuery(params);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
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
}''',
        '''// Hard ceiling on how long any single GET /api/inventory (list or count) query is allowed to run
// server-side, via MariaDB's own SET STATEMENT ... FOR (confirmed live 2026-09-26, MariaDB
// 10.11: aborts with error 1969 "max_statement_time exceeded" at exactly the given second).
// This is a backstop independent of query-plan correctness — even a well-planned query can run
// long under enough concurrent write contention (confirmed live the same day: a correctly
// index-only-planned optionKeys= query still took 58s against a table under heavy concurrent
// write load from a one-time backfill). Without this, a slow query keeps consuming a MySQL
// thread/connection long after the calling client's own 60s timeout (lib/inventoryApi.ts) has
// already given up — confirmed live: a real buyer search sat in the MariaDB processlist for
// 2+ hours after its caller was long gone, silently starving the box of resources until manually
// killed. 20s is comfortably above every legitimately-fast query measured on this table (all
// well under 1s once properly indexed) while still failing fast on anything pathological.
// Not applied to handleExportInventory's streaming query — a 50k-row CSV export is expected to
// run longer than this by design.
const INV_LIST_STATEMENT_TIMEOUT_SECONDS = 20;

async function handleListInventory(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const { sql, args, orderBy } = inventoryListQuery(params);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
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
  const [rows] = await pool.query(
    `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT COUNT(*) AS total ${sql}`, args);
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}''',
        "statement timeout on handleListInventory",
    )
else:
    print("already patched")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PYEOF

node --check "$FILE" && echo "syntax ok"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Done. Verify live, e.g.:"
echo '  curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory?optionKeys=heated+front+seats,sunroof&limit=5" -w "\n%{time_total}s\n"'
