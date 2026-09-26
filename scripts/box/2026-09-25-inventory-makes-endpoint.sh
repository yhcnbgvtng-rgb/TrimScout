#!/usr/bin/env bash
# Adds GET /api/inventory/makes — a cheap, dedicated make-list query, and fixes
# computeInventoryStats()'s byState aggregate to read the denormalized i.state
# column (PR #296) instead of JOINing dealership_contacts (the exact shape
# that fix replaced everywhere else, but this function was never updated).
#
# Why: the buyer /search page's GET /api/catalog/makes (PR 4) was calling
# GET /api/inventory/stats just to read byMake — which also computes byState
# (the un-denormalized JOIN) and a movement aggregate that scans effectively
# the whole table via an OR condition. Confirmed live 2026-09-25 right after
# Gemini was enabled: 3 concurrent computeInventoryStats() calls piled up on
# the box, 52-151+ seconds each, timing out ordinary requests — including
# ones with nothing to do with Gemini. The invCached() stampede itself was
# fixed separately (2026-09-25-fix-invcache-stampede.sh); this script fixes
# the underlying slow/unnecessary computation.
#
# Code-only, no schema change (dealer_inventory.state already exists, PR #296).
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-inventory-makes-endpoint.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-inventory-makes-endpoint.sh?cb=$(date +%s)" && grep -c handleInventoryMakes 2026-09-25-inventory-makes-endpoint.sh && sudo cp 2026-09-25-inventory-makes-endpoint.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-25-inventory-makes-endpoint.sh
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

if "handleInventoryMakes" not in s:
    rep('''async function computeInventoryStats(pool) {
  const [[tot]] = await pool.query("SELECT COUNT(*) AS total, SUM(removed_at IS NULL) AS inStock, COUNT(DISTINCT dealer_id) AS dealers, COUNT(DISTINCT vin) AS vins, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory");
  const [byMake] = await pool.query("SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100");
  const [byState] = await pool.query("SELECT d.state AS state, COUNT(*) AS n FROM dealer_inventory i JOIN dealership_contacts d ON d.id = i.dealer_id WHERE i.removed_at IS NULL GROUP BY d.state ORDER BY n DESC");
  const [byCond] = await pool.query("SELECT cond, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL GROUP BY cond");
  const [[mv]] = await pool.query("SELECT SUM(change_type = 'NEW_ARRIVAL') AS arrivals, SUM(price_diff < 0) AS priceDrops, SUM(price_diff > 0) AS priceIncreases, SUM(window_sticker_url IS NOT NULL) AS withSticker, SUM(removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) AS removedToday FROM dealer_inventory WHERE removed_at IS NULL OR removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
  return { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), vins: Number(tot.vins), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond,
    movement: { arrivals: Number(mv.arrivals || 0), priceDrops: Number(mv.priceDrops || 0), priceIncreases: Number(mv.priceIncreases || 0), withSticker: Number(mv.withSticker || 0), removedToday: Number(mv.removedToday || 0) } };
}''', '''async function computeInventoryStats(pool) {
  const [[tot]] = await pool.query("SELECT COUNT(*) AS total, SUM(removed_at IS NULL) AS inStock, COUNT(DISTINCT dealer_id) AS dealers, COUNT(DISTINCT vin) AS vins, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory");
  const [byMake] = await pool.query("SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100");
  // Reads i.state directly (denormalized onto dealer_inventory in PR #296 specifically to kill
  // this exact JOIN-into-dealership_contacts-then-GROUP-BY shape — confirmed live 2026-09-25,
  // 27.4s -> 0.29s for the equivalent list-query case) rather than the STRAIGHT_JOIN this
  // function never got updated to drop.
  const [byState] = await pool.query("SELECT state, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND state IS NOT NULL GROUP BY state ORDER BY n DESC");
  const [byCond] = await pool.query("SELECT cond, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL GROUP BY cond");
  const [[mv]] = await pool.query("SELECT SUM(change_type = 'NEW_ARRIVAL') AS arrivals, SUM(price_diff < 0) AS priceDrops, SUM(price_diff > 0) AS priceIncreases, SUM(window_sticker_url IS NOT NULL) AS withSticker, SUM(removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) AS removedToday FROM dealer_inventory WHERE removed_at IS NULL OR removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
  return { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), vins: Number(tot.vins), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond,
    movement: { arrivals: Number(mv.arrivals || 0), priceDrops: Number(mv.priceDrops || 0), priceIncreases: Number(mv.priceIncreases || 0), withSticker: Number(mv.withSticker || 0), removedToday: Number(mv.removedToday || 0) } };
}

// GET /api/inventory/makes — just the make list, for the buyer /search page's make picker
// (GET /api/catalog/makes). Deliberately NOT a call into computeInventoryStats(): that function
// also computes byState (until just above, an unindexed JOIN into dealership_contacts) and a
// movement aggregate that scans effectively the whole table via an OR condition neither of which
// this needs — sharing that one "stats" cache key/computation meant every buyer visiting /search
// paid for the admin sheet's full stats payload just to populate a <select>. Confirmed live
// 2026-09-25: this is the same fast, indexed byMake query computeInventoryStats already runs
// first, on its own with nothing slow to wait behind.
async function handleInventoryMakes(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("makes", async () => {
    const [rows] = await pool.query("SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100");
    return { makes: rows.map((r) => ({ make: r.make, n: Number(r.n) })) };
  }));
}''', "computeInventoryStats byState fix + handleInventoryMakes handler")

    rep('''  if (req.method === "GET" && pathname === "/api/inventory/stats") return run(handleInventoryStats);''', '''  if (req.method === "GET" && pathname === "/api/inventory/stats") return run(handleInventoryStats);
  if (req.method === "GET" && pathname === "/api/inventory/makes") return run(handleInventoryMakes);''', "makes route registration")
else:
    print("already patched")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/makes)
echo "GET /api/inventory/makes without key -> $code (401 = server up and guarding)"
echo "Done."
