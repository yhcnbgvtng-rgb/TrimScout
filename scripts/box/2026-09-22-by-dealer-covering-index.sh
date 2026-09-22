#!/usr/bin/env bash
# Deals API: adds a covering index for GET /api/inventory/by-dealer (the admin "Dealers" tab).
# That endpoint's GROUP BY dealer_id aggregates COUNT/SUM/MAX over cond, price_diff, and
# last_seen_at — none covered by any existing index — so MariaDB needed a full row lookup per
# in-stock vehicle. Confirmed live via EXPLAIN + timing: 32.1s cold. This query is normally
# cached for 10 minutes (invCache), which had hidden the cost until today's deploy restarts
# (for the search-index and SQL_CALC_FOUND_ROWS fixes) cleared it, exposing a "Dealers" tab
# that took 30+ seconds to load.
#
# Fix: one composite index with every column the query touches, so MariaDB answers it entirely
# from the index (EXPLAIN: "Using index", no row access). Confirmed live: 223ms — ~148x
# faster. This is a pure index addition — safe, reversible (DROP INDEX undoes it), no query
# logic changes, no schema semantics changes.
#
# Run on the box (ubuntu@3.208.49.1):
#   cd ~ && curl -fsSL -o 2026-09-22-by-dealer-covering-index.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-by-dealer-covering-index.sh && sudo cp 2026-09-22-by-dealer-covering-index.sh /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo bash 2026-09-22-by-dealer-covering-index.sh
# Idempotent (IF NOT EXISTS). Backup, exact-replace with asserts, node --check, pm2 restart,
# health check. NOTE: the index itself may already exist on the box from live testing earlier
# today (test-by-dealer-index.mjs) — ADD INDEX IF NOT EXISTS makes this a safe no-op either way.
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
rep('''    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer_id (removed_at, dealer_id)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);''',
'''    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer_id (removed_at, dealer_id)",
    // Covering index for /api/inventory/by-dealer's GROUP BY dealer_id (the admin "Dealers"
    // tab): COUNT/SUM/MAX over cond, price_diff, last_seen_at previously needed a full row
    // lookup per in-stock vehicle — 32.1s cold, confirmed live via EXPLAIN + timing (the
    // 10-minute cache normally hid this, until a deploy restart cleared it). With every
    // referenced column in one index, MariaDB answers the whole query from the index alone
    // ("Using index" in EXPLAIN, no row access): 223ms, ~148x faster.
    "ADD INDEX IF NOT EXISTS idx_inv_by_dealer_covering (removed_at, dealer_id, cond, price_diff, last_seen_at)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);''', "by-dealer covering index registration")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory/by-dealer")
echo "by-dealer-check: $code"
