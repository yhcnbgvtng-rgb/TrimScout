#!/usr/bin/env bash
# Completes the /api/search/parse fan-out audit: applies the same statement/pool timeout
# protection (#320/#322/#324) to handleInventoryMakes (/api/inventory/makes) — PR #326.
#
# Confirmed live 2026-09-27, after #322 and #324 (handleListInventory and
# handleInventoryCatalogOptions) were both deployed: the full AI search flow still 503'd at 60s.
# Isolated it to the third and final helper /api/search/parse calls:
#   GET /api/catalog/makes -> 503 in 60.2s (Vercel-side "Inventory request timed out")
# This completes the audit of /api/search/parse's own fan-out — it calls exactly 3 box endpoints
# (inventoryMakes(), catalogOptions(), runBuyerSearch()->listInventory()), and this was the only
# one left bare. Checked box2 directly at the time: the connection pool was NOT exhausted
# (SHOW FULL PROCESSLIST showed 4 of 5 connections idle, one running the routine backfill), but
# `top` showed 23.3% iowait — the box is under real disk contention, and this endpoint simply had
# no ceiling of its own to fail fast under it, unlike its two now-fixed siblings.
#
# Fix: wraps handleInventoryMakes's single query in the same SET STATEMENT max_statement_time +
# withPoolTimeout pattern already established in #320/#322/#324 — reuses the existing
# constants/helper, no new mechanism.
#
# Run on the deals box (ubuntu@52.202.234.65 — box2):
#   cd ~ && curl -fsSL -o 2026-09-27-makes-pool-timeout.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-27-makes-pool-timeout.sh?cb=$(date +%s)" && sudo cp 2026-09-27-makes-pool-timeout.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-27-makes-pool-timeout.sh
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

rep('''    const [rows] = await pool.query("SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100");
    return { makes: rows.map((r) => ({ make: r.make, n: Number(r.n) })) };''', '''    // Wrapped the same way handleListInventory/handleInventoryCatalogOptions are (SET STATEMENT
    // + withPoolTimeout) — confirmed live 2026-09-27 this was the last unprotected call in
    // /api/search/parse's own fan-out (Promise.all([inventoryMakes(), catalogOptions()]) then
    // runBuyerSearch()): after #322/#324 fixed the other two, this endpoint alone still hung the
    // full 60s caller-side abort under load, with nothing on either side to show for it.
    const [rows] = await withPoolTimeout(
      pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100`),
      POOL_WAIT_TIMEOUT_MS,
      "Timed out waiting for an available database connection or a slow query"
    );
    return { makes: rows.map((r) => ({ make: r.make, n: Number(r.n) })) };''', "handleInventoryMakes query wrapping")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok: deals_api_server.js"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Verify live, e.g.:"
echo '  time curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory/makes" -o /dev/null -w "%{http_code}\n"'
