#!/usr/bin/env bash
# Deals box: teach POST /api/inventory/sweep to protect rows another box wrote recently (server half of the sync fix).
#
# Replaces inventorySweep.js (a pure module) with the repo copy. A sweep that carries `sourceBox` + `foreignBefore`
# retires a stale row only if source_box = sourceBox OR source_box IS NULL OR last_seen_at < foreignBefore. A sweep
# WITHOUT those fields (every box's current sync client) is byte-for-byte unchanged, so this is safe to deploy first and
# does nothing until a box runs the new client. No schema change, no data change.
#
# DO NOT RUN until Paul says go. It restarts deals-api: only when the sync lock is free, no crawl/bulk/sweep is mid-flight
# and no long query holds a table metadata lock (the restart re-runs ensureInventoryTable's ALTERs, which queue behind it):
#   sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"
#   grep '\[sync-lock\]' ~/.pm2/logs/deals-api-out.log | tail -2        # last event must be a release
#
# Run on the deals box (ubuntu@52.202.234.65), after merge:
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o inventorySweep.js "$B/scrapers/lightsail-crawler/src/inventorySweep.js?cb=$(date +%s)" && curl -fsSL -o 2026-10-07-safe-sweep-server.sh "$B/scripts/box/2026-10-07-safe-sweep-server.sh?cb=$(date +%s)" && sudo cp /opt/trimscout-deals/src/inventorySweep.js /opt/trimscout-deals/src/inventorySweep.js.bak.$(date +%Y%m%d-%H%M%S) && sudo cp inventorySweep.js 2026-10-07-safe-sweep-server.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-10-07-safe-sweep-server.sh
set -euo pipefail
DIR=/opt/trimscout-deals/src
F="$DIR/inventorySweep.js"
node --check "$F" && echo "syntax ok: inventorySweep.js"
grep -q "foreignBefore" "$F" || { echo "ERROR: stale inventorySweep.js (no foreignBefore) - re-fetch with cache-busting." >&2; exit 1; }
grep -q "export function buildSweepStatement" "$F" || { echo "ERROR: unexpected inventorySweep.js" >&2; exit 1; }
echo "Restarting deals-api (reloads the module)."
sudo -u ubuntu pm2 restart deals-api >/dev/null && sleep 3
echo "Rollback: sudo cp \$(ls -t $DIR/inventorySweep.js.bak.* | head -1) $F && sudo -u ubuntu pm2 restart deals-api"
