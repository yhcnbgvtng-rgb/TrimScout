#!/usr/bin/env bash
# Deals API: GET /api/inventory/analytics — dealership analytics for the admin page (DOM = days on the lot,
# velocity, pricing, assortment, coverage, data quality), aggregated in SQL over dealer_inventory and
# dealer_inventory_days, cached 10 min per filter set and refreshed by the nightly sync (bulk/sweep invalidate).
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-17-inventory-analytics.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-inventory-analytics.sh && bash 2026-09-17-inventory-analytics.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
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
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    if new in s: return
    s = s.replace(old, new); changed.append(label)

rep('''async function handleInventoryStats(req, res) {''',
'''// GET /api/inventory/analytics?state=&make=&dealerId=&model=&from=&to=
// Dealership analytics for the admin page: days on market (DOM = days on the lot,
// NOT the HTML DOM), velocity, pricing, assortment, TrimScout coverage, data quality.
// Aggregated in SQL over dealer_inventory (+ dealer_inventory_days for price cuts),
// cached 10 minutes per filter set and invalidated by every bulk upsert / sweep — so
// a page load never scans raw rows twice, and the nightly sync refreshes it.
//
// DOM formula: the crawl's days_on_lot when it carried one, else
//   DATEDIFF(COALESCE(removed_at, NOW()), COALESCE(crawl_first_seen, first_seen_at)).
// Bands: 0–14 / 15–45 / 46–90 / 90+.
const INV_DOM = "COALESCE(NULLIF(i.days_on_lot, 0), DATEDIFF(COALESCE(i.removed_at, NOW()), COALESCE(i.crawl_first_seen, i.first_seen_at)))";
const INV_BANDS = `SUM(${INV_DOM} <= 14) AS d0_14, SUM(${INV_DOM} BETWEEN 15 AND 45) AS d15_45, SUM(${INV_DOM} BETWEEN 46 AND 90) AS d46_90, SUM(${INV_DOM} > 90) AS d90p`;
const INV_DRIVETRAIN = `CASE WHEN CONCAT_WS(' ', i.trim, i.engine, i.body_style) REGEXP 'AWD|4WD|4x4|4MATIC|xDrive|quattro|4Motion|All[- ]Wheel|SH-AWD|e-4ORCE|Symmetrical' THEN 'AWD / 4WD' WHEN CONCAT_WS(' ', i.trim, i.engine) REGEXP 'RWD|Rear[- ]Wheel|sDrive' THEN 'RWD' WHEN CONCAT_WS(' ', i.trim, i.engine) REGEXP 'FWD|Front[- ]Wheel' THEN 'FWD' ELSE 'Not stated' END`;
const INV_POWERTRAIN = `CASE WHEN CONCAT_WS(' ', i.trim, i.engine, i.model) REGEXP 'Plug-in|PHEV|Prime|Recharge|e-hybrid' THEN 'Plug-in hybrid' WHEN CONCAT_WS(' ', i.trim, i.engine, i.model) REGEXP 'Hybrid|HEV|e:HEV|[0-9]h\\\\b' THEN 'Hybrid' WHEN CONCAT_WS(' ', i.trim, i.engine, i.model) REGEXP 'Electric|\\\\bEV\\\\b|kWh|bZ4X|EV6|EV9|Ioniq 5|Ioniq 6|ID\\\\.4|iX|EQ[A-Z]|Ariya|Solterra|Taycan|Macan Electric' THEN 'Electric' WHEN i.engine REGEXP 'Diesel|TDI' THEN 'Diesel' WHEN i.engine IS NOT NULL AND i.engine <> '' THEN 'Gas' ELSE 'Not stated' END`;
async function handleInventoryAnalytics(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const p = (k) => (params.get(k) || "").trim();
  const f = { state: p("state").toUpperCase().slice(0, 2), make: p("make").slice(0, 64), dealerId: INV_INT(p("dealerId")), model: p("model").slice(0, 96), from: INV_DATE(p("from")), to: INV_DATE(p("to")) };
  const key = "analytics:" + JSON.stringify(f);
  sendJson(res, 200, await invCached(key, () => computeInventoryAnalytics(pool, f)));
}
async function computeInventoryAnalytics(pool, f) {
  const where = [], args = [];
  if (f.state) { where.push("d.state = ?"); args.push(f.state); }
  if (f.make) { where.push("i.make = ?"); args.push(f.make); }
  if (f.dealerId != null) { where.push("i.dealer_id = ?"); args.push(f.dealerId); }
  if (f.model) { where.push("i.model = ?"); args.push(f.model); }
  // Date range = the observation window: rows the crawl saw inside it.
  if (f.from) { where.push("i.last_seen_at >= ?"); args.push(f.from); }
  if (f.to) { where.push("i.first_seen_at <= ?"); args.push(f.to + " 23:59:59"); }
  const scope = `FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const stock = where.length ? `${scope} AND i.removed_at IS NULL` : `${scope} WHERE i.removed_at IS NULL`;
  const q = (sql, extra = []) => pool.query(sql, [...args, ...extra]).then(([rows]) => rows);
  const num = (v) => (v == null ? null : Number(v));
  const round1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
  // Medians: MariaDB ≥ 10.3 has MEDIAN() as a window function; older builds get null medians, not a 500.
  async function medians(partition, keyCols) {
    try {
      const rows = await q(`SELECT ${keyCols}, MAX(med) AS med FROM (SELECT ${keyCols}, MEDIAN(${INV_DOM}) OVER (PARTITION BY ${partition}) AS med ${stock}) t GROUP BY ${keyCols}`);
      return rows;
    } catch { return null; }
  }
  const medKey = (r, cols) => cols.map((c) => String(r[c] ?? "")).join("|");
  const attachMedian = (rows, meds, cols) => {
    const m = new Map((meds || []).map((r) => [medKey(r, cols), round1(r.med)]));
    for (const r of rows) r.medianDom = meds ? (m.get(medKey(r, cols)) ?? null) : null;
    return rows;
  };
  const shape = (r) => ({ ...r, n: Number(r.n), avgDom: round1(r.avgDom), bands: { d0_14: Number(r.d0_14 || 0), d15_45: Number(r.d15_45 || 0), d46_90: Number(r.d46_90 || 0), d90p: Number(r.d90p || 0) }, d0_14: undefined, d15_45: undefined, d46_90: undefined, d90p: undefined });

  const [[totals]] = await pool.query(`SELECT COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS}, MAX(i.last_seen_at) AS lastSeenAt, COUNT(DISTINCT i.dealer_id) AS dealers, COUNT(DISTINCT CONCAT(i.make, '|', i.model)) AS models ${stock}`, args);
  // --- DOM by model / dealer / trim / year / drivetrain / powertrain
  const byModel = (await q(`SELECT i.make, i.model, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS}, AVG(CASE WHEN i.msrp > 0 AND i.price > 0 THEN (i.msrp - i.price) / i.msrp END) AS avgDiscount, SUM(i.window_sticker_url IS NOT NULL) AS withSticker ${stock} AND i.make IS NOT NULL AND i.model IS NOT NULL GROUP BY i.make, i.model ORDER BY n DESC LIMIT 400`)).map(shape);
  attachMedian(byModel, await medians("i.make, i.model", "i.make, i.model"), ["make", "model"]);
  const byDealer = (await q(`SELECT i.dealer_id AS dealerId, i.dealer_name AS dealerName, d.state, d.city, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS}, AVG(CASE WHEN i.msrp > 0 AND i.price > 0 THEN (i.msrp - i.price) / i.msrp END) AS avgDiscount, SUM(i.window_sticker_url IS NOT NULL) AS withSticker, SUM(i.options_json IS NOT NULL) AS withOptions, SUM(i.price IS NULL OR i.price <= 0) AS missingPrice, SUM(i.image_url IS NULL OR i.image_url = '') AS missingPhoto, SUM(i.last_seen_at < DATE_SUB(NOW(), INTERVAL 2 DAY)) AS stale, MAX(d.contact_email IS NOT NULL AND d.contact_email <> '') AS hasEmail, MAX(i.last_seen_at) AS lastSeenAt ${stock} GROUP BY i.dealer_id, i.dealer_name, d.state, d.city ORDER BY n DESC LIMIT 1500`)).map(shape);
  attachMedian(byDealer, await medians("i.dealer_id", "i.dealer_id AS dealerId"), ["dealerId"]);
  const byTrim = (await q(`SELECT i.make, i.model, i.trim, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS}, AVG(CASE WHEN i.msrp > 0 AND i.price > 0 THEN (i.msrp - i.price) / i.msrp END) AS avgDiscount ${stock} AND i.make IS NOT NULL AND i.model IS NOT NULL AND i.trim IS NOT NULL AND i.trim <> '' GROUP BY i.make, i.model, i.trim HAVING n >= 2 ORDER BY n DESC LIMIT 400`)).map(shape);
  attachMedian(byTrim, await medians("i.make, i.model, i.trim", "i.make, i.model, i.trim"), ["make", "model", "trim"]);
  const byYear = (await q(`SELECT i.make, i.model, i.year, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS} ${stock} AND i.make IS NOT NULL AND i.model IS NOT NULL AND i.year IS NOT NULL GROUP BY i.make, i.model, i.year ORDER BY n DESC LIMIT 600`)).map(shape);
  const byDrivetrain = (await q(`SELECT ${INV_DRIVETRAIN} AS drivetrain, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS} ${stock} GROUP BY drivetrain ORDER BY n DESC`)).map(shape);
  const byPowertrain = (await q(`SELECT ${INV_POWERTRAIN} AS powertrain, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS} ${stock} GROUP BY powertrain ORDER BY n DESC`)).map(shape);

  // --- Velocity: churn inferred from removed_at (a VIN the crawl stopped seeing = sold-ish / moved).
  const [[turn]] = await pool.query(`SELECT SUM(i.removed_at IS NULL) AS onLot, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 28 DAY)) AS removed28, SUM(i.first_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND i.removed_at IS NULL) AS arrived7 ${scope}`, args);
  const velocityByModel = (await q(`SELECT i.make, i.model, SUM(i.removed_at IS NULL) AS onLot, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 28 DAY)) AS removed28 ${scope} ${where.length ? "AND" : "WHERE"} i.make IS NOT NULL AND i.model IS NOT NULL GROUP BY i.make, i.model HAVING onLot > 0 ORDER BY onLot DESC LIMIT 400`)).map((r) => {
    const onLot = Number(r.onLot), removed7 = Number(r.removed7 || 0), removed28 = Number(r.removed28 || 0);
    const weeklyPace = removed28 > 0 ? removed28 / 4 : removed7;
    return { make: r.make, model: r.model, onLot, removed7, removed28, turnRate: onLot ? round1((removed7 / onLot) * 100) : null, daysSupply: weeklyPace > 0 ? Math.round(onLot / (weeklyPace / 7)) : null };
  });
  const velocityByDealer = (await q(`SELECT i.dealer_id AS dealerId, i.dealer_name AS dealerName, SUM(i.removed_at IS NULL) AS onLot, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7 ${scope} GROUP BY i.dealer_id, i.dealer_name HAVING onLot > 0 ORDER BY onLot DESC LIMIT 1500`)).map((r) => ({ dealerId: Number(r.dealerId), dealerName: r.dealerName, onLot: Number(r.onLot), removed7: Number(r.removed7 || 0), turnRate: Number(r.onLot) ? round1((Number(r.removed7 || 0) / Number(r.onLot)) * 100) : null }));

  // --- Pricing: list vs MSRP, and cuts from the day-by-day observations, by lot age at the cut.
  const [[disc]] = await pool.query(`SELECT AVG(CASE WHEN i.msrp > 0 AND i.price > 0 THEN (i.msrp - i.price) / i.msrp END) AS avgDiscount, SUM(i.msrp > 0 AND i.price > 0) AS priced, SUM(i.price_diff < 0) AS dropsNow, AVG(CASE WHEN i.price_diff < 0 THEN -i.price_diff END) AS avgDropNow ${stock}`, args);
  let priceCuts = null;
  try {
    const cutSql = `SELECT CASE WHEN age < 30 THEN 'lt30' WHEN age < 60 THEN 'd30' WHEN age < 90 THEN 'd60' ELSE 'd90' END AS band, COUNT(*) AS cuts, AVG(cut) AS avgCut, AVG(cut / prev) AS avgCutPct FROM (
        SELECT x.vin, x.dealer_id, x.seen_on, x.price, LAG(x.price) OVER w AS prev, DATEDIFF(x.seen_on, MIN(x.seen_on) OVER (PARTITION BY x.vin, x.dealer_id)) AS age, (LAG(x.price) OVER w - x.price) AS cut
        FROM dealer_inventory_days x JOIN dealer_inventory i ON i.vin = x.vin AND i.dealer_id = x.dealer_id LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}
        WINDOW w AS (PARTITION BY x.vin, x.dealer_id ORDER BY x.seen_on)
      ) c WHERE c.prev > 0 AND c.cut > 0 GROUP BY band`;
    const rows = await q(cutSql);
    const [[obs]] = await pool.query(`SELECT COUNT(DISTINCT CONCAT(x.vin, '|', x.dealer_id)) AS vehicles FROM dealer_inventory_days x JOIN dealer_inventory i ON i.vin = x.vin AND i.dealer_id = x.dealer_id LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`, args);
    priceCuts = { vehiclesObserved: Number(obs.vehicles || 0), bands: Object.fromEntries(rows.map((r) => [r.band, { cuts: Number(r.cuts), avgCut: Math.round(Number(r.avgCut)), avgCutPct: round1(Number(r.avgCutPct) * 100) }])) };
  } catch { priceCuts = null; }

  // --- Assortment: this scope's model mix vs the brand's mix across every store we crawl (the norm).
  const makes = f.make ? [f.make] : byModel.map((r) => r.make).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
  const brandNorm = makes.length ? await pool.query(`SELECT make, model, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IN (?) AND model IS NOT NULL GROUP BY make, model`, [makes]).then(([rows]) => rows.map((r) => ({ make: r.make, model: r.model, n: Number(r.n) }))) : [];

  // --- Coverage by brand (dealer-level coverage rides on byDealer).
  const coverageByMake = await q(`SELECT i.make, COUNT(*) AS n, SUM(i.window_sticker_url IS NOT NULL) AS withSticker, SUM(i.options_json IS NOT NULL) AS withOptions, SUM(i.price IS NULL OR i.price <= 0) AS missingPrice, SUM(i.image_url IS NULL OR i.image_url = '') AS missingPhoto ${stock} AND i.make IS NOT NULL GROUP BY i.make ORDER BY n DESC LIMIT 60`).then((rows) => rows.map((r) => ({ make: r.make, n: Number(r.n), withSticker: Number(r.withSticker || 0), withOptions: Number(r.withOptions || 0), missingPrice: Number(r.missingPrice || 0), missingPhoto: Number(r.missingPhoto || 0) })));
  const [[emails]] = await pool.query(`SELECT COUNT(DISTINCT i.dealer_id) AS dealers, COUNT(DISTINCT CASE WHEN d.contact_email IS NOT NULL AND d.contact_email <> '' THEN i.dealer_id END) AS withEmail ${stock}`, args);

  return {
    computedAt: new Date().toISOString(),
    filters: f,
    domFormula: "days_on_lot from the crawl when present, else days between the first day the crawl saw the VIN at this store (crawl_first_seen, else first_seen_at) and today (or the day it was removed)",
    totals: { n: Number(totals.n), avgDom: round1(totals.avgDom), bands: { d0_14: Number(totals.d0_14 || 0), d15_45: Number(totals.d15_45 || 0), d46_90: Number(totals.d46_90 || 0), d90p: Number(totals.d90p || 0) }, dealers: Number(totals.dealers), models: Number(totals.models), lastSeenAt: totals.lastSeenAt },
    dom: { byModel, byDealer: byDealer.map((r) => ({ ...r, dealerId: Number(r.dealerId), withOptions: Number(r.withOptions || 0), missingPrice: Number(r.missingPrice || 0), missingPhoto: Number(r.missingPhoto || 0), stale: Number(r.stale || 0), hasEmail: Boolean(Number(r.hasEmail)), withSticker: Number(r.withSticker || 0), avgDiscount: r.avgDiscount == null ? null : round1(Number(r.avgDiscount) * 100) })), byTrim, byYear, byDrivetrain, byPowertrain },
    velocity: { onLot: Number(turn.onLot || 0), removed7: Number(turn.removed7 || 0), removed28: Number(turn.removed28 || 0), arrived7: Number(turn.arrived7 || 0), turnRate: Number(turn.onLot) ? round1((Number(turn.removed7 || 0) / Number(turn.onLot)) * 100) : null, byModel: velocityByModel, byDealer: velocityByDealer },
    pricing: { avgDiscount: disc.avgDiscount == null ? null : round1(Number(disc.avgDiscount) * 100), priced: Number(disc.priced || 0), dropsNow: Number(disc.dropsNow || 0), avgDropNow: disc.avgDropNow == null ? null : Math.round(Number(disc.avgDropNow)), cuts: priceCuts },
    assortment: { brandNorm },
    coverage: { byMake: coverageByMake, dealersWithEmail: Number(emails.withEmail || 0), dealers: Number(emails.dealers || 0) },
  };
}

async function handleInventoryStats(req, res) {''', "analytics handler")
# byModel/byTrim discount shaping happens in JS for those too
rep('''  if (req.method === "GET" && pathname === "/api/inventory/stats") return run(handleInventoryStats);''',
'''  if (req.method === "GET" && pathname === "/api/inventory/stats") return run(handleInventoryStats);
  if (req.method === "GET" && pathname === "/api/inventory/analytics") return run(handleInventoryAnalytics, url.searchParams);''', "analytics route")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory/analytics")
echo "GET /api/inventory/analytics without key -> $code (401 = server up and guarding)"
