#!/usr/bin/env bash
# cron entry point for the Dealer Analytics nightly job (box2). Sources the env file, refuses to overlap itself (flock), and logs per day.
# Not installed anywhere until Paul says GO — see docs/DEALER_ANALYTICS_NIGHTLY.md.
set -euo pipefail
DIR="${DEALER_ANALYTICS_DIR:-$HOME/dealer-analytics}"
mkdir -p "$DIR/logs"
exec 9>"$DIR/run.lock"
flock -n 9 || { echo "[run_dealer_analytics] another run is active"; exit 0; }
set -a
. "$HOME/inventory-sync/.env"
. "$DIR/.env"
set +a
cd "$DIR"
exec node dealer-analytics-nightly.mjs "$@" >> "$DIR/logs/nightly-$(date +%F).log" 2>&1
