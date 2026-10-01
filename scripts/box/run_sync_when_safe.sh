#!/usr/bin/env bash
# Waits for every crawl this box can run to be genuinely done before starting the inventory
# sync — previously checked only one hardcoded lock file, driver.lock, which is NOT enough on
# box3/box4: they each run a second, separate crawl (CRAWLER_RUN_LABEL=core) that writes a
# DIFFERENT lock file, driver-core.lock (see LOCK_PATH in run-daily-crawl.mjs). Confirmed live
# 2026-09-30: box4's 07:45 cron saw driver.lock clear (its 23:00 expansion crawl had genuinely
# finished) and started the sync while its SEPARATE 04:00 core crawl was still 9+ hours into FL
# — driver-core.lock was never released early, this script just never looked at it. A later
# manual resync already fixed that day's data; this script is the fix for the next time.
#
# The actual "is anything still running" decision — every driver*.lock file on disk, PLUS a
# direct crawl-process check as a second, independent signal — lives in syncCrawlGate.js
# (unit-tested in syncCrawlGate.test.js) via check-crawl-gate.mjs, so what runs live here is
# the exact same logic CI covers, not a hand-mirrored bash copy that could drift from it.
#
# Same 20h cap as before, but the behavior at the cap has changed: it now REFUSES to start the
# sync rather than proceeding anyway — "a clear lock file alone is not enough" means a cap
# timeout isn't either. A sync that's waited 20h for a crawl to finish and still sees it running
# needs a human to look, not a sync against inevitably-incomplete data.
set -euo pipefail
RUNS_DIR="/home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/daily_crawl_runs"
GATE_SCRIPT="/home/ubuntu/nj-scraper/scrapers/lightsail-crawler/scripts/check-crawl-gate.mjs"
MAX_WAIT_S=72000
WAITED=0

check_gate() {
  node "$GATE_SCRIPT" "$RUNS_DIR"
}

reason=$(check_gate) || true
while [ -n "$reason" ] && [ "$WAITED" -lt "$MAX_WAIT_S" ]; do
  echo "[run_sync_when_safe] crawl still active ($reason) — waiting 300s ($WAITED/$MAX_WAIT_S elapsed)"
  sleep 300
  WAITED=$((WAITED + 300))
  reason=$(check_gate) || true
done

if [ -n "$reason" ]; then
  echo "[run_sync_when_safe] gave up waiting after ${MAX_WAIT_S}s — crawl still active ($reason), NOT starting sync"
  exit 1
fi
echo "[run_sync_when_safe] no crawl lock or process active — proceeding with sync"

cd /home/ubuntu/inventory-sync
set -a
. ./.env
set +a
exec node inventory-sync.mjs /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/inventory
