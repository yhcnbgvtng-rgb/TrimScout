#!/usr/bin/env bash
# Buyer search column sort: ascending sorts on price / mileage / days-on-lot put vehicles with NO value last (box side).
#
# MariaDB treats NULL as the smallest value, so "low to high" started with every row that has no price. This replaces
# inventoryListQuery.js (a pure module) with the repo copy: for sort=price:asc|mileage:asc|days:asc the ORDER BY becomes
# `(col IS NULL), col ASC, vin`. Descending, year, dealer, make, model and trim sorts are byte-for-byte unchanged, as are
# all filters and index hints. Until this runs, those three ascending sorts still start with the blanks (the page works).
#
# DO NOT RUN while the recovery crawl / a bulk sync / a sweep is mid-flight, or while a long query holds a table metadata
# lock: the pm2 restart re-runs ensureInventoryTable's ALTERs, which queue behind that query and hang every inventory
# endpoint. Check first:
#   sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"
#   grep '\[sync-lock\]' ~/.pm2/logs/deals-api-out.log | tail -3     # last event should be a release
#
# Run on the deals box (ubuntu@52.202.234.65), after merge:
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o inventoryListQuery.js "$B/scrapers/lightsail-crawler/src/inventoryListQuery.js?cb=$(date +%s)" && curl -fsSL -o 2026-10-06-sort-nulls-last.sh "$B/scripts/box/2026-10-06-sort-nulls-last.sh?cb=$(date +%s)" && sudo cp /opt/trimscout-deals/src/inventoryListQuery.js /opt/trimscout-deals/src/inventoryListQuery.js.bak.$(date +%Y%m%d-%H%M%S) && sudo cp inventoryListQuery.js 2026-10-06-sort-nulls-last.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-10-06-sort-nulls-last.sh
set -euo pipefail
DIR=/opt/trimscout-deals/src
F="$DIR/inventoryListQuery.js"
[ -f "$F" ] || { echo "ERROR: $F missing - fetch it first (see usage line)." >&2; exit 1; }
node --check "$F" && echo "syntax ok: inventoryListQuery.js"
grep -q "NULLS_LAST_ASC" "$F" || { echo "ERROR: stale inventoryListQuery.js (no NULLS_LAST_ASC) - re-fetch with cache-busting." >&2; exit 1; }
grep -q "multiParam" "$F" || { echo "ERROR: inventoryListQuery.js lacks multiParam - it is not the current repo copy." >&2; exit 1; }
echo "Restarting deals-api (reloads the module)."
sudo -u ubuntu pm2 restart deals-api >/dev/null && sleep 3
echo "Rollback: sudo cp \$(ls -t $DIR/inventoryListQuery.js.bak.* | head -1) $F && sudo -u ubuntu pm2 restart deals-api"
