#!/usr/bin/env bash
# Adds GET /api/inventory/market-pulse — the public homepage's crawl-derived Market Pulse widget
# (arrivals, removals ["left dealer lots", never "sold" — a velocity proxy], price drops, median
# days on lot, moving makes, just-arrived cards). Cached the same way stats/analytics are
# (invCached, 10-min TTL, dropped on every write) — no dedicated cron needed to satisfy "nightly
# minimum, hourly nice". Code-only, plus one new index (idx_inv_stock_first_seen) for the
# "just arrived" query's ORDER BY.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-26-market-pulse.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-26-market-pulse.sh?cb=$(date +%s)" && grep -c computeMarketPulse 2026-09-26-market-pulse.sh && sudo cp 2026-09-26-market-pulse.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-26-market-pulse.sh
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

MARKET_PULSE_BLOCK = r'''// GET /api/inventory/market-pulse?state= — the public homepage's crawl-derived market pulse
// (arrivals, removals, price drops, days on lot, moving makes, just-arrived cards). Cached the
// same way stats/analytics are (invCached, 10-min TTL, dropped on every bulk upsert/sweep) —
// that already satisfies "nightly minimum, hourly nice" with no dedicated cron: whenever the
// cache is cold (first hit after a write, or after 10 minutes), the next request recomputes it;
// otherwise it's served from memory. A dedicated key (not shared with "stats"/"analytics") so a
// public homepage visitor never pays for or is exposed to admin-only aggregates.
//
// "Removed" here means the crawl stopped seeing the VIN at that store — a velocity PROXY, never
// a confirmed sale. Every field name and the response itself avoid the word "sold" on purpose;
// the homepage copy must say "left dealer lots" / "removed from inventory".
async function handleMarketPulse(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const state = (params.get("state") || "").trim().toUpperCase().slice(0, 2);
  const cacheKey = `market-pulse:${state || "national"}`;
  sendJson(res, 200, await invCached(cacheKey, () => computeMarketPulse(pool, state || null)));
}

// Volume floor for "moving makes" — below this, a single vehicle selling/leaving swings the rate
// too much to be a meaningful signal (a state with 3 Porsches in stock and 1 removed this week
// would otherwise show a wildly misleading 33% weekly turn rate). Either threshold qualifies a
// make, since a very high-volume make can have a meaningful rate even with modest weekly removals.
const MOVING_MIN_IN_STOCK = 200;
const MOVING_MIN_REMOVED_7D = 15;

async function computeMarketPulse(pool, state) {
  const scopeWhere = state ? "AND state = ?" : "";
  const scopeArgs = state ? [state] : [];

  // Windows. Kept in one query since every field here is a plain SUM() over the same base rows —
  // a row scoped in (in-stock, or removed within the last 7 days so it still counts toward the
  // 7d "removed" window) needs scanning once, not per metric.
  const [[w]] = await pool.query(
    `SELECT
       SUM(removed_at IS NULL) AS inStock,
       SUM(first_seen_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) AND removed_at IS NULL) AS arrivals24h,
       SUM(first_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND removed_at IS NULL) AS arrivals7d,
       SUM(removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) AS removed24h,
       SUM(removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7d,
       SUM(removed_at IS NULL AND price_diff < 0) AS priceDrops24h,
       SUM(removed_at IS NULL AND price_diff > 0) AS priceIncreases24h
     FROM dealer_inventory
     WHERE (removed_at IS NULL OR removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) ${scopeWhere}`,
    scopeArgs
  );

  // Median days-on-lot, in-stock only, this scope. Same MariaDB-version guard as
  // computeInventoryAnalytics's medians() (MEDIAN() OVER () needs MariaDB >= 10.3) — a market
  // pulse tile is exactly the kind of place that must degrade to null, never a 500, on an older build.
  let medianDaysOnLot = null;
  try {
    const [[m]] = await pool.query(
      `SELECT MAX(med) AS med FROM (SELECT MEDIAN(${INV_DOM.replace(/i\./g, "")}) OVER () AS med FROM dealer_inventory WHERE removed_at IS NULL ${scopeWhere}) t`,
      scopeArgs
    );
    medianDaysOnLot = m && m.med != null ? Math.round(Number(m.med)) : null;
  } catch {
    medianDaysOnLot = null;
  }

  // Moving makes: 7-day removal rate, volume-floored, ranked highest-first. `avgInStock7d` is
  // actually the CURRENT in-stock count, not a true rolling 7-day average (no daily inventory
  // snapshot table exists to compute one) — documented here rather than overclaiming precision;
  // for a make with a reasonably stable count week to week this is a fine proxy.
  const [movingRows] = await pool.query(
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
  });

  // Just arrived: newest in-stock vehicles first seen in the last 24h — thin cards, no essays.
  const [justArrivedRows] = await pool.query(
    `SELECT vin, year, make, model, trim, price, image_url, dealer_name, state, vdp_url, first_seen_at
     FROM dealer_inventory
     WHERE removed_at IS NULL AND first_seen_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) ${scopeWhere}
     ORDER BY first_seen_at DESC
     LIMIT 12`,
    scopeArgs
  );

  return {
    asOf: new Date().toISOString(),
    scope: state ? { state } : "national",
    windows: {
      "24h": {
        inStock: Number(w.inStock || 0),
        arrivals: Number(w.arrivals24h || 0),
        removed: Number(w.removed24h || 0),
        priceDrops: Number(w.priceDrops24h || 0),
        priceIncreases: Number(w.priceIncreases24h || 0),
        medianDaysOnLot,
      },
      "7d": { arrivals: Number(w.arrivals7d || 0), removed: Number(w.removed7d || 0) },
    },
    movingMakes,
    justArrived: justArrivedRows.map((r) => ({
      vin: r.vin,
      year: r.year,
      make: r.make,
      model: r.model,
      trim: r.trim,
      price: r.price,
      imageUrl: r.image_url,
      dealerName: r.dealer_name,
      dealerState: r.state,
      vdpUrl: r.vdp_url,
      firstSeenAt: r.first_seen_at,
    })),
  };
}

'''

if "computeMarketPulse" not in s:
    rep(
        '''    "ADD INDEX IF NOT EXISTS idx_inv_stock_seen (removed_at, last_seen_at)",''',
        '''    "ADD INDEX IF NOT EXISTS idx_inv_stock_seen (removed_at, last_seen_at)",
    // For the homepage Market Pulse's "just arrived" cards — WHERE removed_at IS NULL AND
    // first_seen_at >= ... ORDER BY first_seen_at DESC. Mirrors idx_inv_stock_seen exactly, one
    // column different (first_seen_at instead of last_seen_at).
    "ADD INDEX IF NOT EXISTS idx_inv_stock_first_seen (removed_at, first_seen_at)",''',
        "first_seen_at index",
    )

    rep(
        '''async function handleInventoryStats(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);''',
        MARKET_PULSE_BLOCK + '''
async function handleInventoryStats(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);''',
        "computeMarketPulse + handleMarketPulse",
    )

    rep(
        '''  if (req.method === "GET" && pathname === "/api/inventory/analytics") return run(handleInventoryAnalytics, url.searchParams);''',
        '''  if (req.method === "GET" && pathname === "/api/inventory/analytics") return run(handleInventoryAnalytics, url.searchParams);
  if (req.method === "GET" && pathname === "/api/inventory/market-pulse") return run(handleMarketPulse, url.searchParams);''',
        "market-pulse route registration",
    )
else:
    print("already patched")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PYEOF

node --check "$FILE" && echo "syntax ok"

echo "Applying idx_inv_stock_first_seen directly (idempotent — same DDL ensureInventoryTable() runs lazily, but only on the next AUTHENTICATED request, which this restart's own health check deliberately doesn't send)..."
sudo mysql trimscout -e "ALTER TABLE dealer_inventory ADD INDEX IF NOT EXISTS idx_inv_stock_first_seen (removed_at, first_seen_at);"
echo "Index applied."

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/market-pulse)
echo "GET /api/inventory/market-pulse without key -> $code (401 = server up and guarding)"
echo "Done. Verify live, e.g.:"
echo '  curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory/market-pulse" -w "\n%{time_total}s\n"'
