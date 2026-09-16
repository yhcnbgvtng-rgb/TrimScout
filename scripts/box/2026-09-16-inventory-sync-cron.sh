#!/usr/bin/env bash
# Crawl box (ubuntu@98.92.140.11): install the nightly inventory → deals-box sync.
# Pulls scripts/box/inventory-sync.mjs, does one sync now against the latest crawl output, and adds a
# crontab line that re-syncs every night at 06:15 UTC (the run-daily-crawl cron finishes well before that).
#
#   curl -fsSL -o 2026-09-16-inventory-sync-cron.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-16-inventory-sync-cron.sh && TRIMSCOUT_API_KEY=<the deals API key> bash 2026-09-16-inventory-sync-cron.sh
#
# The key is the same X-Trimscout-Api-Key the deals box already checks (LIGHTSAIL_API_KEY on Vercel /
# TRIMSCOUT_API_KEY in /opt/trimscout-deals/.env on the deals box). Idempotent.
set -euo pipefail
: "${TRIMSCOUT_API_KEY:?set TRIMSCOUT_API_KEY=… (the deals API key)}"
DATA=/home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/national_inventory_latest.json
DIR=/home/ubuntu/inventory-sync
mkdir -p "$DIR/logs"
curl -fsSL -o "$DIR/inventory-sync.mjs" https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/inventory-sync.mjs
printf 'TRIMSCOUT_API_KEY=%s\n' "$TRIMSCOUT_API_KEY" > "$DIR/.env"; chmod 600 "$DIR/.env"
test -f "$DATA" || { echo "no crawl output at $DATA yet"; exit 1; }
echo "--- syncing now ---"
( set -a; . "$DIR/.env"; set +a; node "$DIR/inventory-sync.mjs" "$DATA" ) | tee -a "$DIR/logs/sync-$(date +%F).log"
LINE="15 6 * * * cd $DIR && set -a && . ./.env && set +a && node inventory-sync.mjs $DATA >> logs/sync-\$(date +\\%F).log 2>&1"
( crontab -l 2>/dev/null | grep -v "inventory-sync.mjs" ; echo "$LINE" ) | crontab -
echo "--- crontab now ---"; crontab -l | grep -n "inventory-sync\|run-daily-crawl" || true
