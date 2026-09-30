#!/usr/bin/env bash
# Waits for the expansion crawl's driver.lock to clear before starting this box's separate 4am
# core crawl — same is_locked() pattern as run_sync_when_safe.sh's wait for this same lock, just
# guarding a second run-daily-crawl.mjs instead of the sync client. Added 2026-09-30 after box3's
# 2026-09-28 expansion crawl ran until 04:53 ET, past its own 04:00 core cron, so the two crawls
# briefly overlapped instead of core waiting its turn. Only box3 and box4 run both an expansion
# (23:00) and a core (04:00) crawl on the same box — box1/box2 are core-only at 23:00 and never
# see this collision, so this wrapper is deployed there only.
#
# Same 20h cap and stale-lock self-heal as run_sync_when_safe.sh: is_locked() already treats a
# lock file whose PID is dead as unlocked, so a normal crash-without-cleanup doesn't need the cap
# to recover — only a crawler truly hung forever ever hits it, and even then this exits non-zero
# and logs rather than starting a second crawl process on top of a live one.
#
# Wraps the actual crawl command (passed as "$@", e.g. `env CRAWL_STATES=... node
# scripts/run-daily-crawl.mjs`) instead of re-specifying it, so each box's own env vars stay in
# its crontab line exactly as today, with no duplication to drift out of sync.
set -euo pipefail
LOCK="/home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/daily_crawl_runs/driver.lock"
MAX_WAIT_S=72000
WAITED=0

is_locked() {
  [ -f "$LOCK" ] || return 1
  local pid
  pid=$(python3 -c "import json,sys
try:
    print(json.load(open('$LOCK'))['pid'])
except Exception:
    pass" 2>/dev/null || true)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

while is_locked && [ "$WAITED" -lt "$MAX_WAIT_S" ]; do
  echo "[run_core_crawl_when_safe] expansion crawl's driver.lock is live (pid alive) — waiting 300s ($WAITED/$MAX_WAIT_S elapsed)"
  sleep 300
  WAITED=$((WAITED + 300))
done

if is_locked; then
  echo "[run_core_crawl_when_safe] gave up waiting after ${MAX_WAIT_S}s — expansion crawl still running, NOT starting core (no second crawl process on this box)"
  exit 1
fi

echo "[run_core_crawl_when_safe] expansion crawl's lock is clear — starting core crawl"
exec "$@"
