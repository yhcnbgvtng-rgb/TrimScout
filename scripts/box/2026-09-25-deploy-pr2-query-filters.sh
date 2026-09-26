#!/usr/bin/env bash
# Deploys PR 2's inventoryListQuery.js filters (priceMin, priceMax, maxDays,
# exteriorColor, interiorColor) to the box. These were added in PR 2
# (#301, merged 2026-09-25) and are already live-tested (26/26 passing
# locally), but the PR 2 box deploy script
# (2026-09-25-inventory-catalog-endpoint.sh) only patched deals_api_server.js
# for the new /api/inventory/catalog endpoint — it never redeployed
# inventoryListQuery.js itself, so these filters were silently no-ops in
# production: GET /api/vehicles/search?priceMax=40000 (and maxDays=/colors=)
# returned unfiltered results with no error, confirmed live via a browser
# smoke test of PR 4's /search page (a $46,795 vehicle came back for a
# priceMax=40000 query).
#
# inventoryListQuery.js is always re-fetched whole and replaced, never
# patched in place (same rule as every other box script that touches it) —
# it's small, pure, and fully covered by test/inventory_list_query.test.js.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-deploy-pr2-query-filters.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-deploy-pr2-query-filters.sh?cb=$(date +%s)" && curl -fsSL -o inventoryListQuery.js "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src/inventoryListQuery.js?cb=$(date +%s)" && grep -c priceMax inventoryListQuery.js && sudo cp 2026-09-25-deploy-pr2-query-filters.sh inventoryListQuery.js /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-25-deploy-pr2-query-filters.sh
set -euo pipefail
DIR=/opt/trimscout-deals/src
if [ ! -f "$DIR/inventoryListQuery.js" ]; then
  echo "ERROR: $DIR/inventoryListQuery.js not found — fetch the latest copy alongside this script first (see the usage line above)." >&2
  exit 1
fi
if ! grep -q "priceMax" "$DIR/inventoryListQuery.js"; then
  echo "ERROR: the fetched inventoryListQuery.js doesn't contain priceMax — you likely got a stale cached copy from raw.githubusercontent.com. Re-fetch with a cache-busting query param (see the usage line above) and try again." >&2
  exit 1
fi

node --check "$DIR/inventoryListQuery.js" && echo "syntax ok"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Verify live, e.g.:"
echo '  curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory?make=Toyota&model=4Runner&priceMax=40000&limit=5" | python3 -m json.tool | grep -A1 '"'"'"price"'"'"
