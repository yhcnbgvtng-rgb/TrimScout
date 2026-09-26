#!/usr/bin/env bash
# Gives make= filters a real covering index, mirroring the exact fix state= already got.
#
# idx_inv_stock_make (removed_at, make, model) seeks the WHERE fine but doesn't cover the
# default dealer_name/vin sort, so MariaDB still had to materialize and filesort every matching
# row before returning a page. Confirmed live 2026-09-25: make=Toyota, inStock=1, no explicit
# sort= — exactly the buyer /search page's own default view once it started sending real
# traffic — 10.8s for ~340k matching rows, EXPLAIN showing "Using filesort". state= had this
# identical bug and got the covering-index fix (idx_inv_stock_state) the same day; make= never
# did — this closes that gap with idx_inv_stock_make_dealer (removed_at, make, dealer_name, vin).
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-fix-make-filter-filesort.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-fix-make-filter-filesort.sh?cb=$(date +%s)" && curl -fsSL -o inventoryListQuery.js "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src/inventoryListQuery.js?cb=$(date +%s)" && grep -c idx_inv_stock_make_dealer inventoryListQuery.js && sudo cp 2026-09-25-fix-make-filter-filesort.sh inventoryListQuery.js /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-25-fix-make-filter-filesort.sh
# Idempotent. Backup, exact-replace with asserts, direct DDL (index applies immediately —
# no backfill needed, unlike a new column), node --check, pm2 restart, health check.
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
  if ! grep -q "idx_inv_stock_make_dealer" "$DIR/inventoryListQuery.js"; then
    echo "ERROR: the fetched inventoryListQuery.js doesn't contain idx_inv_stock_make_dealer — likely a stale cached copy from raw.githubusercontent.com. Re-fetch with a cache-busting query param and try again." >&2
    exit 1
  fi
fi

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

if "idx_inv_stock_make_dealer" not in s:
    rep('''    "ADD INDEX IF NOT EXISTS idx_inv_stock_make (removed_at, make, model)",
    // make= WITHOUT inStock=1 (the sheet's "all, incl. removed" view): idx_inv_stock_make can't seek
    // on make until removed_at is pinned, so that was a full scan — see inventoryListQuery.js.
    "ADD INDEX IF NOT EXISTS idx_inv_make_dealer (make, dealer_name, vin)",''', '''    "ADD INDEX IF NOT EXISTS idx_inv_stock_make (removed_at, make, model)",
    // idx_inv_stock_make (above) seeks on (removed_at, make) fine, but doesn't cover the default
    // dealer_name/vin sort, so MariaDB still had to materialize and filesort every matching row
    // before returning the first page — confirmed live 2026-09-25: make=Toyota, inStock=1, no
    // sort= (the buyer /search page's own default view once it went public), 10.8s for 340k
    // matching rows, EXPLAIN showing "Using filesort". state= got this exact covering treatment
    // (idx_inv_stock_state below) when its own version of this bug was fixed 2026-09-25 — make=
    // never did. This is that same fix, for make=.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_make_dealer (removed_at, make, dealer_name, vin)",
    // make= WITHOUT inStock=1 (the sheet's "all, incl. removed" view): idx_inv_stock_make can't seek
    // on make until removed_at is pinned, so that was a full scan — see inventoryListQuery.js.
    "ADD INDEX IF NOT EXISTS idx_inv_make_dealer (make, dealer_name, vin)",''', "idx_inv_stock_make_dealer DDL")
else:
    print("already patched")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"

echo "Applying the index directly (idempotent — same DDL ensureInventoryTable() runs lazily, but only on the next AUTHENTICATED request, which this restart's own health check deliberately doesn't send)..."
sudo mysql trimscout -e "ALTER TABLE dealer_inventory ADD INDEX IF NOT EXISTS idx_inv_stock_make_dealer (removed_at, make, dealer_name, vin);"
echo "Index applied."

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"

sudo mysql trimscout -e "SHOW INDEX FROM dealer_inventory WHERE Key_name = 'idx_inv_stock_make_dealer';"
echo "Done. Verify live with EXPLAIN, e.g.:"
echo "  sudo mysql trimscout -e \"EXPLAIN SELECT i.* FROM dealer_inventory i FORCE INDEX (idx_inv_stock_make_dealer) WHERE i.make = 'Toyota' AND i.removed_at IS NULL ORDER BY i.dealer_name ASC, i.vin ASC LIMIT 24;\""
