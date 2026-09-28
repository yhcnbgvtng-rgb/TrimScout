#!/usr/bin/env bash
# Fixes the buyer /search "inventory timeout" on any optionKeys= (must-have options) query.
#
# Root cause, confirmed live 2026-09-26 by direct reproduction against production:
#   - GET /api/vehicles/search?optionKeys=heated_seats,sunroof (no make/model — exactly what
#     the AI search box sends for a query like "cars near 07030 with heated seats and sunroof",
#     since zip/radius alone don't set make) hung past the 60s client-side abort every time:
#     503 "Inventory request timed out".
#   - Even narrowed to make=BMW (26,945 candidate rows, 0.6s on its own), adding a single
#     optionKeys= took 15.9s.
# inventoryListQuery.js's optionKeys= filter is a correlated subquery — one
# dealer_inventory_options lookup per outer candidate row: WHERE dealer_id = i.dealer_id AND
# canonical_key IN (...). The only index on that table, idx_opt_canonical (canonical_key),
# leads with canonical_key, not dealer_id — so MariaDB had to scan every row nationwide with a
# matching key (real volume — see the CREATE TABLE comment) before it could check dealer_id,
# once per outer row. With no make/model to narrow the outer set first, that's the full
# unbounded scan hanging the request.
#
# Fix (query shape + index, not a raised timeout): idx_opt_dealer_canonical (dealer_id,
# canonical_key, vin) leads with the per-outer-row equality this subquery actually runs on and
# covers vin, turning each call into an index-only lookup scoped to one dealer's own rows.
# inventoryListQuery.js now also FORCE INDEXes it, same discipline as every other filter in
# this file after past live incidents where the optimizer picked the wrong index on its own.
#
# inventoryListQuery.js is always re-fetched whole and replaced, never patched in place (same
# rule as every other box script that touches it) — it's small, pure, and fully covered by
# test/inventory_list_query.test.js (28/28 passing locally, including the updated optionKeys
# assertions for the new FORCE INDEX).
#
# Run on the deals box (ubuntu@52.202.234.65 — box2):
#   cd ~ && curl -fsSL -o 2026-09-26-fix-option-search-timeout.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-26-fix-option-search-timeout.sh?cb=$(date +%s)" && curl -fsSL -o inventoryListQuery.js "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src/inventoryListQuery.js?cb=$(date +%s)" && grep -c idx_opt_dealer_canonical inventoryListQuery.js && sudo cp 2026-09-26-fix-option-search-timeout.sh inventoryListQuery.js /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-26-fix-option-search-timeout.sh
set -euo pipefail
DIR=/opt/trimscout-deals/src
FILE="$DIR/deals_api_server.js"

if [ ! -f "$DIR/inventoryListQuery.js" ]; then
  echo "ERROR: $DIR/inventoryListQuery.js not found — fetch the latest copy alongside this script first (see the usage line above)." >&2
  exit 1
fi
if ! grep -q "idx_opt_dealer_canonical" "$DIR/inventoryListQuery.js"; then
  echo "ERROR: the fetched inventoryListQuery.js doesn't contain idx_opt_dealer_canonical — you likely got a stale cached copy from raw.githubusercontent.com. Re-fetch with a cache-busting query param (see the usage line above) and try again." >&2
  exit 1
fi
node --check "$DIR/inventoryListQuery.js" && echo "syntax ok: inventoryListQuery.js"

STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '''  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_options (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    canonical_key VARCHAR(80) NOT NULL,
    label VARCHAR(160) NOT NULL,
    code VARCHAR(32) NULL,
    PRIMARY KEY (vin, dealer_id, canonical_key),
    INDEX idx_opt_canonical (canonical_key)
  )`);
  inventoryReady = true;'''
new = '''  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_options (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    canonical_key VARCHAR(80) NOT NULL,
    label VARCHAR(160) NOT NULL,
    code VARCHAR(32) NULL,
    PRIMARY KEY (vin, dealer_id, canonical_key),
    INDEX idx_opt_canonical (canonical_key)
  )`);
  await pool.query("ALTER TABLE dealer_inventory_options ADD INDEX IF NOT EXISTS idx_opt_dealer_canonical (dealer_id, canonical_key, vin)");
  inventoryReady = true;'''
if "idx_opt_dealer_canonical" in s:
    print("already patched")
else:
    n = s.count(old)
    assert n == 1, f"expected exactly 1 match, found {n}"
    s = s.replace(old, new)
    open(p, "w").write(s)
    print("patched: ensureInventoryTable index creation")
PY

node --check "$FILE" && echo "syntax ok: deals_api_server.js"

echo "Applying idx_opt_dealer_canonical directly (idempotent) so it's live immediately, not just on next fresh boot..."
sudo mysql trimscout -e "ALTER TABLE dealer_inventory_options ADD INDEX IF NOT EXISTS idx_opt_dealer_canonical (dealer_id, canonical_key, vin);"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Verify live, e.g. (should return well under a second, not 60s+):"
echo '  time curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory?optionKeys=heated_seats" -o /dev/null -w "%{http_code}\n"'
