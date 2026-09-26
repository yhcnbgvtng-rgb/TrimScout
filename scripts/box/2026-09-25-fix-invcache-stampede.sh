#!/usr/bin/env bash
# Fixes a cache stampede on invCached() (the 10-minute in-memory cache behind
# /api/inventory/stats, /api/inventory/by-dealer, /api/inventory/catalog).
# invCached only checked a TTL cache AFTER computing — it never deduped
# concurrent cache MISSES, so N requests arriving before the first finishes
# computing each independently launched the same expensive full-table
# aggregate query. This was rare before today (only the low-traffic admin
# sheet called /api/inventory/stats); the buyer /search page's new
# GET /api/catalog/makes (PR 4) calls the same "stats" key on every visit,
# and confirmed live 2026-09-25: 3 concurrent identical aggregate queries
# piled up on the box (50-150+ seconds each), timing out ordinary requests
# that had nothing to do with the slow query itself — including, misleadingly,
# a Gemini-configuration check that had nothing wrong with it.
#
# Code-only, no schema change. Verified in isolation (concurrent-miss dedup,
# cache-hit-after-resolve, invalidate-mid-flight forces a fresh compute) —
# see the commit message for the standalone sanity script; deals_api_server.js
# itself can't be unit-tested (it starts a real server unconditionally on
# import, no "am I the main module" guard).
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-fix-invcache-stampede.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-fix-invcache-stampede.sh?cb=$(date +%s)" && sudo cp 2026-09-25-fix-invcache-stampede.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-25-fix-invcache-stampede.sh
set -euo pipefail
FILE=${FILE:-/opt/trimscout-deals/src/deals_api_server.js}
ON_BOX=$([ "$FILE" = /opt/trimscout-deals/src/deals_api_server.js ] && echo 1 || echo 0)
if [ "$ON_BOX" = 1 ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
fi

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

if "invInFlight" not in s:
    rep('''// The aggregate endpoints (stats, by-dealer) scan the whole table and only change when a sync writes, so they
// are served from memory for 10 minutes and dropped by every bulk upsert / sweep.
const INV_CACHE_MS = 10 * 60_000;
const invCache = new Map();
const invCached = async (key, fn) => { const hit = invCache.get(key); if (hit && Date.now() - hit.at < INV_CACHE_MS) return hit.value; const value = await fn(); invCache.set(key, { at: Date.now(), value }); return value; };
const invInvalidate = () => invCache.clear();''', '''// The aggregate endpoints (stats, by-dealer, catalog options) scan the whole table and only change
// when a sync writes, so they are served from memory for 10 minutes and dropped by every bulk
// upsert / sweep.
const INV_CACHE_MS = 10 * 60_000;
const invCache = new Map();
// invInFlight dedupes concurrent cache MISSES on the same key — without it, N requests that all
// arrive before the first one finishes computing and populating invCache each independently kick
// off the same expensive full-table query. Confirmed live 2026-09-25 after /api/catalog/makes (the
// buyer /search page's make picker, PR 4) started calling the same "stats" key that used to see
// only rare admin-sheet traffic: 3 concurrent identical aggregate queries piled up on the box,
// each 50-150+ seconds, timing out ordinary buyer requests that had nothing to do with the slow
// query itself. The dedup key includes the cache generation so a concurrent invInvalidate() (a
// bulk upsert/sweep mid-computation) doesn't hand a request a result computed against data that
// was invalidated before it finished.
const invInFlight = new Map();
let invGeneration = 0;
const invCached = async (key, fn) => {
  const hit = invCache.get(key);
  if (hit && Date.now() - hit.at < INV_CACHE_MS) return hit.value;
  const generation = invGeneration;
  const flightKey = `${generation}:${key}`;
  const existing = invInFlight.get(flightKey);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const value = await fn();
      if (generation === invGeneration) invCache.set(key, { at: Date.now(), value });
      return value;
    } finally {
      invInFlight.delete(flightKey);
    }
  })();
  invInFlight.set(flightKey, promise);
  return promise;
};
const invInvalidate = () => {
  invGeneration++;
  invCache.clear();
};''', "invCached stampede fix")
else:
    print("already patched")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats)
echo "GET /api/inventory/stats without key -> $code (401 = server up and guarding)"
echo "Done."
