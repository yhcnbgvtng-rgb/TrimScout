#!/usr/bin/env bash
# Deals API: give dealer_inventory its own `state` column instead of joining
# dealership_contacts for every state= filter.
#
# state= never had a column of its own — every filter had to JOIN
# dealership_contacts (itself unindexed on state), and even the 2026-09-22
# STRAIGHT_JOIN rework that fixed the worst case still couldn't return
# sorted results without materializing and filesorting the whole state's
# matches first. Confirmed live 2026-09-25 on box2 (post deals-box
# migration): state=NJ + inStock=1, the admin sheet's default view, 27.4s
# for 56,956 matching rows.
#
# This denormalizes state onto dealer_inventory the same way dealer_name
# already is: a new column kept in sync by the existing rev/normalize
# triggers, two new indexes mirroring make='s idx_inv_stock_make/
# idx_inv_make_dealer exactly, and inventoryListQuery() pulled out into its
# own module (inventoryListQuery.js) and rewritten to drop the whole
# STRAIGHT_JOIN special case — state= is now filtered and sorted exactly
# like make= is, and the query-plan logic finally has real unit tests
# (deals_api_server.js has no "am I the main module" guard, so it can't be
# imported for testing without starting a real server — the pure query
# builder needed its own file to be testable at all).
#
# Existing rows are backfilled by this same script, in ONE UPDATE ... JOIN
# (indexed on dealer_id) run once at the end — not gated behind a live
# request, since ~500k+ rows would make that request itself time out.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2, post-migration):
#   cd ~ && curl -fsSL -o 2026-09-25-dealer-inventory-state-column.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-dealer-inventory-state-column.sh && curl -fsSL -o inventoryListQuery.js https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src/inventoryListQuery.js && sudo cp 2026-09-25-dealer-inventory-state-column.sh inventoryListQuery.js /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo bash 2026-09-25-dealer-inventory-state-column.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart,
# health check, then the one-time backfill UPDATE.
set -euo pipefail
FILE=${FILE:-/opt/trimscout-deals/src/deals_api_server.js}
DIR=$(dirname "$FILE")
ON_BOX=$([ "$FILE" = /opt/trimscout-deals/src/deals_api_server.js ] && echo 1 || echo 0)
if [ "$ON_BOX" = 1 ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
  if [ ! -f "$DIR/inventoryListQuery.js" ]; then
    echo "ERROR: $DIR/inventoryListQuery.js not found — fetch it alongside this script first (see the usage line above)." >&2
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

if "idx_inv_stock_state" not in s:
    rep('''import mysql from "mysql2/promise";''', '''import mysql from "mysql2/promise";
import { inventoryListQuery } from "./inventoryListQuery.js";''', "import")

    rep('''    "ADD COLUMN IF NOT EXISTS source_box VARCHAR(16) NULL",
    "ADD COLUMN IF NOT EXISTS vdp_url_norm VARCHAR(700) NULL",
    "ADD INDEX IF NOT EXISTS idx_inv_change (change_type)",
    "ADD INDEX IF NOT EXISTS idx_inv_price_change (price_change_type)",
    // Every sheet query filters removed_at IS NULL then sorts — composite indexes let those read in order.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer (removed_at, dealer_name, vin)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_make (removed_at, make, model)",
    // make= WITHOUT inStock=1 (the sheet's "all, incl. removed" view): idx_inv_stock_make can't seek
    // on make until removed_at is pinned, so that was a full scan — see inventoryListQuery.
    "ADD INDEX IF NOT EXISTS idx_inv_make_dealer (make, dealer_name, vin)",''', '''    "ADD COLUMN IF NOT EXISTS source_box VARCHAR(16) NULL",
    "ADD COLUMN IF NOT EXISTS vdp_url_norm VARCHAR(700) NULL",
    // state was never its own column — every state= filter had to JOIN dealership_contacts,
    // which has no index on state either, forcing a full scan of it plus a temp table +
    // filesort to satisfy the default dealer_name sort (confirmed live 2026-09-25 on box2:
    // state=NJ + inStock=1, the admin sheet's default view, 27.4s — 56,956 matching rows
    // materialized and sorted before the first page could be returned). Denormalized here the
    // same way dealer_name already is, kept in sync by trg_inv_state_insert/update below, so
    // state= can finally use a real composite index instead of a JOIN — see inventoryListQuery.js.
    // Existing rows are backfilled once by this same deploy script, not here (500k+ rows —
    // too slow to gate a live request behind).
    "ADD COLUMN IF NOT EXISTS state VARCHAR(2) NULL",
    "ADD INDEX IF NOT EXISTS idx_inv_change (change_type)",
    "ADD INDEX IF NOT EXISTS idx_inv_price_change (price_change_type)",
    // Every sheet query filters removed_at IS NULL then sorts — composite indexes let those read in order.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer (removed_at, dealer_name, vin)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_make (removed_at, make, model)",
    // make= WITHOUT inStock=1 (the sheet's "all, incl. removed" view): idx_inv_stock_make can't seek
    // on make until removed_at is pinned, so that was a full scan — see inventoryListQuery.js.
    "ADD INDEX IF NOT EXISTS idx_inv_make_dealer (make, dealer_name, vin)",
    // Mirrors idx_inv_stock_make/idx_inv_make_dealer exactly, for state= instead of make=.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_state (removed_at, state, dealer_name, vin)",
    "ADD INDEX IF NOT EXISTS idx_inv_state_dealer (state, dealer_name, vin)",''', "state column + indexes")

    rep('''        SET @vun = SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(NEW.vdp_url), '?', 1), '#', 1);
        SET @vun = REPLACE(REPLACE(@vun, 'https://', ''), 'http://', '');
        SET @vun = IF(LEFT(@vun, 4) = 'www.', SUBSTRING(@vun, 5), @vun);
        SET NEW.vdp_url_norm = NULLIF(TRIM(TRAILING '/' FROM @vun), '');
      END
    `);''', '''        SET @vun = SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(NEW.vdp_url), '?', 1), '#', 1);
        SET @vun = REPLACE(REPLACE(@vun, 'https://', ''), 'http://', '');
        SET @vun = IF(LEFT(@vun, 4) = 'www.', SUBSTRING(@vun, 5), @vun);
        SET NEW.vdp_url_norm = NULLIF(TRIM(TRAILING '/' FROM @vun), '');
        -- Keeps the denormalized state column (see the ADD COLUMN comment above) in sync from
        -- dealership_contacts by dealer_id — a primary-key lookup per row, not the full-table
        -- JOIN this replaces at query time. NULL when dealer_id has no matching rooftop (the
        -- "no store matched" bucket, dealer_id 0) — matches the LEFT JOIN's own behavior today.
        SET NEW.state = (SELECT state FROM dealership_contacts WHERE id = NEW.dealer_id LIMIT 1);
      END
    `);''', "trigger state sync")

    rep('''  if (f.state) { where.push("d.state = ?"); args.push(f.state); }''', '''  if (f.state) { where.push("i.state = ?"); args.push(f.state); }''', "analytics state column")

    # inventoryListQuery() moves to its own file (inventoryListQuery.js, fetched alongside this
    # script) — find it by its start/end markers rather than matching the whole ~90-line body
    # verbatim, since that's the one place box-file drift is most likely to bite.
    start_marker = '''// The filter/sort shared by GET /api/inventory (one page) and GET /api/inventory/export (the whole
// filter, streamed): returns the FROM/WHERE clause, its args and the ORDER BY.
function inventoryListQuery(params) {'''
    end_marker = '''  return { sql, args, orderBy };
}'''
    start_idx = s.find(start_marker)
    assert start_idx != -1, "inventoryListQuery start marker not found — box file has drifted, stopping rather than guessing"
    end_idx = s.find(end_marker, start_idx)
    assert end_idx != -1, "inventoryListQuery end marker not found — box file has drifted, stopping rather than guessing"
    end_idx += len(end_marker)
    old_fn = s[start_idx:end_idx]
    assert "STRAIGHT_JOIN" in old_fn, "expected the pre-fix STRAIGHT_JOIN body — box file has drifted, stopping rather than guessing"
    replacement = '''// inventoryListQuery lives in its own module (inventoryListQuery.js) purely so it can be
// unit-tested without starting this file's real server — see that module's header comment.'''
    s = s[:start_idx] + replacement + s[end_idx:]
    changed.append("inventoryListQuery extracted to its own module")
else:
    print("already patched")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"

echo "Backfilling existing rows' state column from dealership_contacts (one-time, indexed on dealer_id)..."
time sudo mysql trimscout -e "UPDATE dealer_inventory i JOIN dealership_contacts d ON d.id = i.dealer_id SET i.state = d.state WHERE i.state IS NULL AND d.state IS NOT NULL;"
sudo mysql trimscout -e "SELECT COUNT(*) AS still_null_with_known_dealer FROM dealer_inventory i JOIN dealership_contacts d ON d.id = i.dealer_id WHERE i.state IS NULL AND d.state IS NOT NULL;"
echo "Backfill complete."
