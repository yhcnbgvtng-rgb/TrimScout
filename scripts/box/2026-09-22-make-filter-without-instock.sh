#!/usr/bin/env bash
# Deals API: fix make= inventory queries that DON'T also filter inStock=1.
#
# #271 forced idx_inv_stock_make for every make= query. That index is (removed_at, make, model), so it
# only seeks on make once removed_at IS NULL (inStock=1) pins its first column; without that it's a
# full scan + filesort. Confirmed live 2026-09-22: GET /api/inventory?make=Porsche&limit=5 took ~18s
# (EXPLAIN: type ALL, 591k rows) while the same query with inStock=1 took ~25ms. Toyota (145k rows, the
# largest make) measured 20.1s for a 200-row page.
#
# Fix: without inStock=1, force a new idx_inv_make_dealer (make, dealer_name, vin) instead — make
# leads, so it seeks, and the default dealer:asc sort then reads in index order and stops at LIMIT.
# Measured with the existing idx_inv_make_model (make, model) as a stand-in: Porsche 42–67ms for a page
# at offset 2,000 across dealer/price/seen sorts, 10ms COUNT; but Toyota still 8.5s, a filesort of 145k
# wide rows — hence the dealer_name-ordered index. inStock=1 keeps idx_inv_stock_make (unchanged).
#
# The index is built here, online (ALGORITHM=INPLACE, LOCK=NONE — crawler writes continue), BEFORE the
# restart, so ensureInventoryTable's ADD INDEX IF NOT EXISTS is a no-op at startup rather than a
# multi-second ALTER stalling the first request. The ensure list gets it too, for a fresh table.
#
# Run on the box (ubuntu@3.208.49.1):
#   cd ~ && curl -fsSL -o 2026-09-22-make-filter-without-instock.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-make-filter-without-instock.sh && sudo cp 2026-09-22-make-filter-without-instock.sh /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo bash 2026-09-22-make-filter-without-instock.sh
# Idempotent. Backup, exact-replace with asserts, node --check, index build, pm2 restart, health check.
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
if "idx_inv_make_dealer" in s:
    print("already patched"); sys.exit(0)
def rep(old,new,label):
    global s
    n=s.count(old); assert n==1, f"{label}: {n}\n{old[:160]}"
    s=s.replace(old,new); changed.append(label)

rep('''    "ADD INDEX IF NOT EXISTS idx_inv_stock_make (removed_at, make, model)",
''',
'''    "ADD INDEX IF NOT EXISTS idx_inv_stock_make (removed_at, make, model)",
    // make= WITHOUT inStock=1 (the sheet's "all, incl. removed" view): idx_inv_stock_make can't seek
    // on make until removed_at is pinned, so that was a full scan — see inventoryListQuery.
    "ADD INDEX IF NOT EXISTS idx_inv_make_dealer (make, dealer_name, vin)",
''', "ensure idx_inv_make_dealer")

rep('''  const indexHint = p("make") ? "FORCE INDEX (idx_inv_stock_make)" : "";
''',
'''  // idx_inv_stock_make leads with removed_at, so it only seeks on make when inStock=1 pins that
  // column; without it the same hint was a forced full scan + filesort — confirmed live 2026-09-22:
  // make=Porsche 18s, make=Toyota 20.1s. idx_inv_make_dealer (make, dealer_name, vin) leads with make
  // and reads the default dealer:asc sort in index order.
  const indexHint = !p("make") ? ""
    : p("inStock") === "1" ? "FORCE INDEX (idx_inv_stock_make)" : "FORCE INDEX (idx_inv_make_dealer)";
''', "make= hint by inStock")

open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
if [ "$ON_BOX" = 1 ]; then
  (
    set -a; . /opt/trimscout-deals/.env.trimscout-db; set +a
    export MYSQL_PWD="$DB_WRITER_PASSWORD"
    echo "building idx_inv_make_dealer (online)…"
    time mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_WRITER_USER" "$DB_NAME" \
      -e "ALTER TABLE dealer_inventory ADD INDEX IF NOT EXISTS idx_inv_make_dealer (make, dealer_name, vin), ALGORITHM=INPLACE, LOCK=NONE"
  )
  sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory?make=Porsche&limit=1")
  echo "inventory-route-check (401 = up, auth-gated): $code"
fi
