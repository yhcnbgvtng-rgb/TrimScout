#!/usr/bin/env bash
# Deals API: PR 1 of the buyer /search feature — dealer_inventory_options
# (indexed option-code side table) + dealer_inventory.price_change_count,
# plus the matching inventoryListQuery.js filters (odometerMax=,
# minPriceChanges=, optionCodes=) that read them.
#
# Neither column/table is backfilled for existing rows — there's no
# historical per-change or per-option record to backfill from before this
# deploy, so both start empty/0 and are "tracked going forward" only (see
# the code comments in ensureInventoryTable/handleInventoryBulk). This is a
# deliberate, confirmed scope decision — do not add a backfill step later
# without re-confirming it's wanted.
#
# Learned the hard way on 2026-09-25's state-column deploy: the app's own
# ensureInventoryTable() only runs its ALTER/CREATE DDL lazily, on the
# first successful AUTHENTICATED request to an inventory endpoint after a
# restart — and this script's own health check below deliberately omits
# the API key (same as every other box script's health check), so it never
# triggers that migration. This script runs the DDL directly instead, so
# the box is fully consistent immediately, not dependent on a live request
# happening afterward.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-buyer-search-schema.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-buyer-search-schema.sh && curl -fsSL -o inventoryListQuery.js https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src/inventoryListQuery.js && sudo cp 2026-09-25-buyer-search-schema.sh inventoryListQuery.js /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-25-buyer-search-schema.sh
# Idempotent. Backup, exact-replace with asserts, direct DDL, node --check,
# pm2 restart, health check.
set -euo pipefail
FILE=${FILE:-/opt/trimscout-deals/src/deals_api_server.js}
DIR=$(dirname "$FILE")
ON_BOX=$([ "$FILE" = /opt/trimscout-deals/src/deals_api_server.js ] && echo 1 || echo 0)
if [ "$ON_BOX" = 1 ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
  if [ ! -f "$DIR/inventoryListQuery.js" ]; then
    echo "ERROR: $DIR/inventoryListQuery.js not found — fetch the latest copy alongside this script first (see the usage line above). It's always re-fetched whole, never patched in place." >&2
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

if "price_change_count" not in s:
    rep('''    "ADD COLUMN IF NOT EXISTS state VARCHAR(2) NULL",
    "ADD INDEX IF NOT EXISTS idx_inv_change (change_type)",''', '''    "ADD COLUMN IF NOT EXISTS state VARCHAR(2) NULL",
    // How many times this vehicle's price has genuinely changed since it was first seen —
    // for the buyer search's minPriceChanges= filter. Incremented in handleInventoryBulk's
    // upsert only when the incoming price differs from what was already stored (see that
    // function), never recomputed from history here. Existing rows stay at the DEFAULT 0 —
    // there's no historical per-change record to backfill from, so this is "tracked going
    // forward" only, not a true lifetime count for inventory that predates this column.
    "ADD COLUMN IF NOT EXISTS price_change_count INT NOT NULL DEFAULT 0",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_price_changes (removed_at, price_change_count)",
    "ADD INDEX IF NOT EXISTS idx_inv_change (change_type)",''', "price_change_count column + index")

    rep('''  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_days (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    seen_on DATE NOT NULL,
    price INT NULL,
    mileage INT NULL,
    PRIMARY KEY (vin, dealer_id, seen_on),
    INDEX idx_days_vin (vin)
  )`);
  inventoryReady = true;
}''', '''  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_days (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    seen_on DATE NOT NULL,
    price INT NULL,
    mileage INT NULL,
    PRIMARY KEY (vin, dealer_id, seen_on),
    INDEX idx_days_vin (vin)
  )`);
  // One row per (vehicle, factory option code) — a normalized side table for the buyer
  // search's "must-have ALL of these options" filter. dealer_inventory.options_json is a
  // free-text blob (see inventoryRowFromDb) with no index, so "has every one of these codes"
  // can't be answered efficiently there at 1.5M+ rows. Populated in handleInventoryBulk by
  // deleting and reinserting each chunk's vehicles' rows on every upsert — always a full
  // replace of the set, never a partial add, so a vehicle that loses an option on a later
  // crawl doesn't keep matching it forever.
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_options (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    code VARCHAR(32) NOT NULL,
    PRIMARY KEY (vin, dealer_id, code),
    INDEX idx_opt_code (code)
  )`);
  inventoryReady = true;
}''', "dealer_inventory_options table")

    rep('''       VALUES ? ON DUPLICATE KEY UPDATE dealer_id = VALUES(dealer_id), dealer_name = VALUES(dealer_name), cond = COALESCE(VALUES(cond), cond), year = COALESCE(VALUES(year), year), make = COALESCE(VALUES(make), make), model = COALESCE(VALUES(model), model), trim = COALESCE(VALUES(trim), trim), body_style = COALESCE(VALUES(body_style), body_style), exterior_color = COALESCE(VALUES(exterior_color), exterior_color), interior_color = COALESCE(VALUES(interior_color), interior_color), mileage = COALESCE(VALUES(mileage), mileage), price = COALESCE(VALUES(price), price), msrp = COALESCE(VALUES(msrp), msrp), stock_number = COALESCE(VALUES(stock_number), stock_number), vdp_url = VALUES(vdp_url), image_url = COALESCE(VALUES(image_url), image_url), source = VALUES(source), last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL,''', '''       VALUES ? ON DUPLICATE KEY UPDATE dealer_id = VALUES(dealer_id), dealer_name = VALUES(dealer_name), cond = COALESCE(VALUES(cond), cond), year = COALESCE(VALUES(year), year), make = COALESCE(VALUES(make), make), model = COALESCE(VALUES(model), model), trim = COALESCE(VALUES(trim), trim), body_style = COALESCE(VALUES(body_style), body_style), exterior_color = COALESCE(VALUES(exterior_color), exterior_color), interior_color = COALESCE(VALUES(interior_color), interior_color), mileage = COALESCE(VALUES(mileage), mileage),
        price_change_count = price_change_count + IF(VALUES(price) IS NOT NULL AND price IS NOT NULL AND VALUES(price) <> price, 1, 0),
        price = COALESCE(VALUES(price), price), msrp = COALESCE(VALUES(msrp), msrp), stock_number = COALESCE(VALUES(stock_number), stock_number), vdp_url = VALUES(vdp_url), image_url = COALESCE(VALUES(image_url), image_url), source = VALUES(source), last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL,''', "price_change_count increment")

    rep('''    upserted += chunk.length;
    // Today's observation for every vehicle in the chunk, plus the crawl's dated price points (backfill).''', '''    upserted += chunk.length;
    // Replace each vehicle's option-code set (dealer_inventory_options) in the same chunk as
    // its main upsert — tied together so a chunk that fails partway through never leaves a
    // live VIN's row updated but its option set stale/empty. A full delete-then-reinsert per
    // chunk, not a per-vehicle diff: cheap at 500 rows, and correct when a later crawl drops
    // an option the vehicle no longer has (an additive-only write would keep matching it).
    const optionPairs = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId)]);
    await pool.query("DELETE FROM dealer_inventory_options WHERE (vin, dealer_id) IN (?)", [optionPairs]);
    const optionRows = [];
    for (const v of chunk) {
      if (!Array.isArray(v.options)) continue;
      const vin = v.vin.trim().toUpperCase(), dealerId = INV_DEALER(v.dealerId);
      const codes = new Set(v.options.map((o) => INV_STR(o && o.code, 32)).filter(Boolean));
      for (const code of codes) optionRows.push([vin, dealerId, code]);
    }
    if (optionRows.length) await pool.query("INSERT INTO dealer_inventory_options (vin, dealer_id, code) VALUES ? ON DUPLICATE KEY UPDATE vin = VALUES(vin)", [optionRows]);
    // Today's observation for every vehicle in the chunk, plus the crawl's dated price points (backfill).''', "option-code table population")
else:
    print("already patched")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"

echo "Applying the schema change directly (idempotent — same DDL ensureInventoryTable() runs lazily)..."
sudo mysql trimscout -e "ALTER TABLE dealer_inventory ADD COLUMN IF NOT EXISTS price_change_count INT NOT NULL DEFAULT 0;"
sudo mysql trimscout -e "ALTER TABLE dealer_inventory ADD INDEX IF NOT EXISTS idx_inv_stock_price_changes (removed_at, price_change_count);"
sudo mysql trimscout -e "CREATE TABLE IF NOT EXISTS dealer_inventory_options (vin CHAR(17) NOT NULL, dealer_id INT NOT NULL DEFAULT 0, code VARCHAR(32) NOT NULL, PRIMARY KEY (vin, dealer_id, code), INDEX idx_opt_code (code));"
echo "Schema change applied."

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"

sudo mysql trimscout -e "SHOW COLUMNS FROM dealer_inventory LIKE 'price_change_count';"
sudo mysql trimscout -e "SHOW TABLES LIKE 'dealer_inventory_options';"
echo "Done. Both start empty/0 for existing rows by design — they populate on the next crawl sync, not retroactively."
