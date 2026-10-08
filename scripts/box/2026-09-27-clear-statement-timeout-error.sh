#!/usr/bin/env bash
# Maps MariaDB's own statement-timeout error (1969) to a clear 503, instead of the generic 500
# "Internal server error" every other uncaught exception gets — PR #328.
#
# Confirmed live 2026-09-27, after #322/#324/#326 (the full /api/search/parse fan-out audit)
# deployed: retesting the flow found a consistently reproducible failure — make=Ford,
# model=F-150, trim=Lariat (no color/options) reliably fails at ~20.2-20.3s with:
#   status=502 time=20.247483s
#   {"error":"Internal server error"}
# This isn't a bug in the fan-out fixes — it's INV_LIST_STATEMENT_TIMEOUT_SECONDS (20s, from
# #320) working exactly as designed: MariaDB's own SET STATEMENT max_statement_time is killing a
# genuinely slow query (error 1969). But nothing recognized that error specially, so it fell
# through to the generic 500 (mapped to 502 by app/api/search/parse/route.ts) — indistinguishable
# from an actual crash, even though the box knows exactly what happened and why.
#
# Fix: catches err.errno === 1969 (confirmed via mysql2's own source — packets/packet.js sets
# this exact property from the server's error code) in run()'s catch handler and returns a 503
# with an actionable message instead — the same clear-status treatment PoolTimeoutError already
# gets. This does NOT fix the underlying query slowness itself (a separate, real performance
# question worth its own follow-up) — it only makes the failure legible instead of opaque.
#
# Run on the deals box (ubuntu@52.202.234.65 — box2):
#   cd ~ && curl -fsSL -o 2026-09-27-clear-statement-timeout-error.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-27-clear-statement-timeout-error.sh?cb=$(date +%s)" && sudo cp 2026-09-27-clear-statement-timeout-error.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-27-clear-statement-timeout-error.sh
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    if new in s:
        return
    n = s.count(old)
    assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

rep('''        console.error(`${new Date().toISOString()} ${pathname} -> 503 (pool timeout):`, err.message);
        return sendJson(res, 503, { error: err.message });
      }
      console.error(`${new Date().toISOString()} ${pathname} -> 500:`, err.message);
      sendJson(res, 500, { error: "Internal server error" });''', '''        console.error(`${new Date().toISOString()} ${pathname} -> 503 (pool timeout):`, err.message);
        return sendJson(res, 503, { error: err.message });
      }
      // MariaDB's own SET STATEMENT max_statement_time=... FOR ... (see
      // INV_LIST_STATEMENT_TIMEOUT_SECONDS) throws error 1969 when it kills a query — a real,
      // expected outcome for a genuinely slow filter combination, not a bug. Confirmed live
      // 2026-09-27: this fell through to the generic 500 below, which lib/inventoryApi.ts then
      // shows the caller as an opaque "Internal server error" (mapped to 502 by
      // app/api/search/parse/route.ts) — no different from an actual crash, even though the box
      // knows exactly what happened and why. Giving it the same clear-503 treatment as
      // PoolTimeoutError lets a buyer's search page tell them to narrow their filters instead of
      // just failing silently.
      if (err && err.errno === 1969) {
        console.error(`${new Date().toISOString()} ${pathname} -> 503 (statement timeout):`, err.message);
        return sendJson(res, 503, { error: "Search took too long and was stopped — try narrowing your filters (make/model, a smaller radius, or fewer must-have options)" });
      }
      console.error(`${new Date().toISOString()} ${pathname} -> 500:`, err.message);
      sendJson(res, 500, { error: "Internal server error" });''', "run() errno 1969 -> 503 mapping")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok: deals_api_server.js"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Verify live, e.g. against a filter combination known to be slow — should now come back"
echo "with a clear 503 'Search took too long...' message around 20s, not a generic 500/502."
