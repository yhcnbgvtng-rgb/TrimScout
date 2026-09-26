#!/usr/bin/env bash
# Adds yearMin=/yearMax= to inventoryListQuery.js — the buyer /search page's AI parse (Gemini)
# now extracts a stated year ("2024 bmw ix") into these params, but the box-side query builder
# had no year filter at all until now. No schema/index change: idx_inv_stock_year
# (removed_at, year) already existed (added for the year:asc/desc sort option) — this is just
# the first filter to actually use it.
#
# inventoryListQuery.js is always re-fetched whole and replaced, never patched in place (same
# rule as every other box script that touches it) — it's small, pure, and fully covered by
# test/inventory_list_query.test.js.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-add-year-filter.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-add-year-filter.sh?cb=$(date +%s)" && sudo bash 2026-09-25-add-year-filter.sh
set -euo pipefail
cd /tmp
curl -fsSL -o inventoryListQuery.js "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src/inventoryListQuery.js?cb=$(date +%s)"
if ! grep -q "yearMin" inventoryListQuery.js; then
  echo "ERROR: the fetched inventoryListQuery.js doesn't contain yearMin — likely a stale cached copy from raw.githubusercontent.com. Re-run with a fresh cache-busting query param." >&2
  exit 1
fi
node --check inventoryListQuery.js && echo "syntax ok"
sudo cp inventoryListQuery.js /opt/trimscout-deals/src/inventoryListQuery.js
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Done."
