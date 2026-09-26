#!/usr/bin/env bash
# Fixes GET /api/inventory/market-pulse returning a 500. MariaDB rejects an aggregate ALIAS used
# inside an ORDER BY EXPRESSION — confirmed live from the error log:
#   Reference 'removed7d' not supported (reference to group function)
# even though the bare alias works fine on its own in ORDER BY/HAVING. Ranking is now done in JS
# instead: the "moving makes" result set is one row per make (well under 100 after the volume
# floor), so sorting/slicing there costs nothing and sidesteps the quirk entirely.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-26-fix-market-pulse-order-by.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-26-fix-market-pulse-order-by.sh?cb=$(date +%s)" && grep -c "sort((a, b) => b.rate" 2026-09-26-fix-market-pulse-order-by.sh && sudo cp 2026-09-26-fix-market-pulse-order-by.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-26-fix-market-pulse-order-by.sh
set -euo pipefail
FILE=${FILE:-/opt/trimscout-deals/src/deals_api_server.js}
ON_BOX=$([ "$FILE" = /opt/trimscout-deals/src/deals_api_server.js ] && echo 1 || echo 0)
if [ "$ON_BOX" = 1 ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
fi

sudo python3 - "$FILE" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
changed = []

def rep(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, "%s: expected exactly 1 match, found %d:\n%s" % (label, n, old[:200])
    s = s.replace(old, new)
    changed.append(label)

if "sort((a, b) => b.rate" not in s:
    rep(
        '''  const [movingRows] = await pool.query(
    `SELECT make, SUM(removed_at IS NULL) AS inStock, SUM(removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7d
     FROM dealer_inventory
     WHERE make IS NOT NULL ${scopeWhere}
     GROUP BY make
     HAVING inStock >= ? OR removed7d >= ?
     ORDER BY (removed7d / GREATEST(inStock, 1)) DESC
     LIMIT 8`,
    [...scopeArgs, MOVING_MIN_IN_STOCK, MOVING_MIN_REMOVED_7D]
  );
  const movingMakes = movingRows.map((r) => {
    const inStock = Number(r.inStock || 0), removed7d = Number(r.removed7d || 0);
    return { make: r.make, removed7d, avgInStock7d: inStock, rate: inStock > 0 ? Math.round((removed7d / inStock) * 1000) / 10 : 0, sampleOk: true };
  });''',
        '''  // Ranking is done in JS, not SQL: MariaDB rejects an aggregate ALIAS used inside an ORDER BY
  // EXPRESSION ("Reference 'removed7d' not supported (reference to group function)") — confirmed
  // live — even though the bare alias works fine on its own in ORDER BY/HAVING. The result set
  // here is one row per make (well under 100 after the HAVING floor), so sorting/slicing in JS
  // costs nothing and sidesteps the quirk entirely rather than repeating both SUM(...)
  // expressions verbatim in the ORDER BY clause.
  const [movingRows] = await pool.query(
    `SELECT make, SUM(removed_at IS NULL) AS inStock, SUM(removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7d
     FROM dealer_inventory
     WHERE make IS NOT NULL ${scopeWhere}
     GROUP BY make
     HAVING inStock >= ? OR removed7d >= ?`,
    [...scopeArgs, MOVING_MIN_IN_STOCK, MOVING_MIN_REMOVED_7D]
  );
  const movingMakes = movingRows
    .map((r) => {
      const inStock = Number(r.inStock || 0), removed7d = Number(r.removed7d || 0);
      return { make: r.make, removed7d, avgInStock7d: inStock, rate: inStock > 0 ? Math.round((removed7d / inStock) * 1000) / 10 : 0, sampleOk: true };
    })
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8);''',
        "moving makes JS ranking",
    )
else:
    print("already patched")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PYEOF

node --check "$FILE" && echo "syntax ok"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
echo "Verify live, e.g.:"
echo '  curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory/market-pulse" -w "\n%{time_total}s\n"'
