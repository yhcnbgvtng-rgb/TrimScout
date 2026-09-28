#!/usr/bin/env bash
# Deals API: make dealer-listed factory options AND DealerOn's free-text feature mentions
# searchable/filterable in aggregate against the LIVE dealer_inventory pipeline.
#
# Supersedes an earlier same-named script that targeted the old porsche-tracker crawler box
# (inventory_api_server.js) — that box is decommissioned. The live inventory pipeline is
# dealer_inventory on this box; its options_json column is an opaque JSON blob with no facet
# infra, so this adds a normalized side table fed at bulk-upsert time. See
# docs/DEALER_LISTED_OPTION_SEARCH.md for the full picture.
#
# Adds:
#   - dealer_inventory_options (vin, dealer_id, make, code, name, price, kind) — one row per
#     option/feature per vehicle, populated in handleInventoryBulk whenever a bulk-upsert
#     payload carries a non-empty options[] for that vehicle (a vehicle with none is left
#     untouched, same COALESCE-preserve semantics as the main table)
#   - dealer_option_names (make, code) -> name, a small reference table so a coded facet row's
#     label resolves cheaply instead of an aggregate MIN(name) over the options table directly
#   - GET /api/inventory/options/facet?make=&type=coded|feature
#   - GET /api/inventory?make=&optionCode=  and  ?featureText=  exact-match filters
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-17-dealer-feature-facet.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-dealer-feature-facet.sh && bash 2026-09-17-dealer-feature-facet.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
#
# NOTE ON DRIFT: unlike the old crawler box, this file (deals_api_server.js) is known to drift
# from the repo mirror — many prior scripts/box/*.sh have already patched it live (see
# project_trimscout_box_file_drift in memory / git history of this directory). The `rep()`
# asserts below fail loudly rather than silently corrupt the file if any of the five anchors
# below don't match the box's actual current text — if that happens, `diff` the box's live file
# against scrapers/lightsail-crawler/src/deals_api_server.js at this commit and re-anchor by
# hand rather than forcing it through with --force-style edits.
#
# ALSO NEEDED, separately (not this script — different box, different coordination):
#   - scrapers/lightsail-crawler/src/standalone.js re-enables parseFeaturesFromDescription()
#     behind a new safety guard (looksUndelimited()) — runs on the CRAWL box
#     (ubuntu@98.92.140.11), which another session actively manages; coordinate before syncing.
#   - scripts/box/inventory-sync.mjs now preserves a real option code instead of always writing
#     null — also runs on the crawl box, same coordination need. Until both of those ship, this
#     script's new tables will exist and work, but every dealer-listed option/feature will keep
#     landing with code = null (nothing to facet on) until the crawl box starts sending real
#     codes through.
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
    s = s.replace(old, new); changed.append(label)

if "dealer_inventory_options" not in s:
    rep('''  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_days (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    seen_on DATE NOT NULL,
    price INT NULL,
    mileage INT NULL,
    PRIMARY KEY (vin, dealer_id, seen_on),
    INDEX idx_days_vin (vin)
  )`);
  inventoryReady = true;
}''', '''  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_days (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    seen_on DATE NOT NULL,
    price INT NULL,
    mileage INT NULL,
    PRIMARY KEY (vin, dealer_id, seen_on),
    INDEX idx_days_vin (vin)
  )`);
  // Per-item option/feature rows behind dealer_inventory.options_json — a normalized side
  // table so options can be grouped/faceted in SQL instead of scanning a MEDIUMTEXT JSON blob
  // over 250K+ rows (the same lesson the old crawler-box vehicle_options table already
  // learned: an unindexed scan-and-parse at this scale is minutes, not milliseconds). Delete +
  // reinsert per (vin, dealer_id) on every bulk upsert that carries an options[] array — see
  // handleInventoryBulk. `make` is denormalized from the vehicle row for the same reason the
  // old system denormalized brand_id/status onto vehicle_options: the overwhelmingly common
  // facet query is "for this one make", and that should never need a join back to
  // dealer_inventory just to know it.
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_options (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    make VARCHAR(64) NULL,
    code VARCHAR(64) NULL,
    name VARCHAR(255) NOT NULL,
    price INT NULL,
    kind VARCHAR(16) NULL,
    INDEX idx_dio_vin (vin, dealer_id),
    INDEX idx_dio_make_code (make, code),
    INDEX idx_dio_make_name (make, name)
  )`);
  // Small reference table (make, code) -> canonical name, same role as the old crawler box's
  // option_names table: resolving a facet row's display label via a cheap lookup instead of an
  // aggregate MIN(name)/ANY_VALUE(name) over the full options table — confirmed live on that
  // old system that the aggregate version alone took 45s at a comparable row count.
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_option_names (
    make VARCHAR(64) NOT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    PRIMARY KEY (make, code)
  )`);
  inventoryReady = true;
}

// The shared placeholder code every DealerOn free-text feature line gets
// (parseFeaturesFromDescription() in standalone.js — there's no real per-item code for a
// free-text mention). Grouping these by code the way a real coded package/option facet does
// would collapse every DealerOn feature mention on every vehicle of a make into one
// meaningless bucket keyed on this one shared string — see handleInventoryOptionFacet.
const UNCODED_FEATURE_CODE = "FEATURE";''', "side tables + placeholder const")

    rep('''    if (days.length) await pool.query("INSERT INTO dealer_inventory_days (vin, dealer_id, seen_on, price, mileage) VALUES ? ON DUPLICATE KEY UPDATE price = COALESCE(VALUES(price), price), mileage = COALESCE(VALUES(mileage), mileage)", [days]);
  }
  invInvalidate();
  sendJson(res, 200, { upserted, skipped });
}''', '''    if (days.length) await pool.query("INSERT INTO dealer_inventory_days (vin, dealer_id, seen_on, price, mileage) VALUES ? ON DUPLICATE KEY UPDATE price = COALESCE(VALUES(price), price), mileage = COALESCE(VALUES(mileage), mileage)", [days]);

    // Side-table option rows, scoped to just the vehicles in this chunk that actually carried
    // an options[] array — a vehicle with none is left untouched here (like the main upsert's
    // COALESCE above) rather than having its existing option rows erased by a partial sync.
    const withOptions = chunk.filter((v) => Array.isArray(v.options) && v.options.length);
    if (withOptions.length) {
      const optKeys = withOptions.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId)]);
      await pool.query(
        `DELETE FROM dealer_inventory_options WHERE (vin, dealer_id) IN (${optKeys.map(() => "(?,?)").join(",")})`,
        optKeys.flat()
      );
      const oValues = [];
      const namesSeen = new Map(); // `${make}|${code}` -> [make, code, name]
      for (const v of withOptions) {
        const vin = v.vin.trim().toUpperCase(), dealerId = INV_DEALER(v.dealerId), make = INV_STR(v.make, 64);
        for (const o of v.options) {
          const name = INV_STR(o && o.name, 255);
          if (!name) continue;
          const code = o && o.code ? INV_STR(String(o.code), 64) : null;
          oValues.push([vin, dealerId, make, code, name, INV_INT(o && o.price), INV_STR(o && o.kind, 16)]);
          if (code && make) namesSeen.set(`${make}|${code}`, [make, code, name]);
        }
      }
      if (oValues.length) await pool.query("INSERT INTO dealer_inventory_options (vin, dealer_id, make, code, name, price, kind) VALUES ?", [oValues]);
      if (namesSeen.size) await pool.query("INSERT INTO dealer_option_names (make, code, name) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name)", [[...namesSeen.values()]]);
    }
  }
  invInvalidate();
  sendJson(res, 200, { upserted, skipped });
}''', "populate side tables in handleInventoryBulk")

    rep('''  if (p("minDays")) { where.push("i.days_on_lot >= ?"); args.push(Number(p("minDays"))); }
  if (p("q")) { where.push("(i.vin LIKE ? OR i.dealer_name LIKE ? OR i.model LIKE ? OR i.trim LIKE ? OR i.stock_number LIKE ?)"); const like = `%${p("q")}%`; args.push(like, like, like, like, like); }''', '''  if (p("minDays")) { where.push("i.days_on_lot >= ?"); args.push(Number(p("minDays"))); }
  if (p("q")) { where.push("(i.vin LIKE ? OR i.dealer_name LIKE ? OR i.model LIKE ? OR i.trim LIKE ? OR i.stock_number LIKE ?)"); const like = `%${p("q")}%`; args.push(like, like, like, like, like); }
  // Exact-match filters against dealer_inventory_options — the caller is expected to pass a
  // `value` straight off GET /api/inventory/options/facet, not an arbitrary substring.
  if (p("optionCode")) { where.push("EXISTS (SELECT 1 FROM dealer_inventory_options oi WHERE oi.vin = i.vin AND oi.dealer_id = i.dealer_id AND oi.code = ?)"); args.push(p("optionCode")); }
  if (p("featureText")) { where.push("EXISTS (SELECT 1 FROM dealer_inventory_options oi WHERE oi.vin = i.vin AND oi.dealer_id = i.dealer_id AND oi.code = ? AND oi.name = ?)"); args.push(UNCODED_FEATURE_CODE, p("featureText")); }''', "optionCode/featureText filters")

    rep('''  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}

// GET /api/inventory/stats — counts for the admin sheet's filter menus.''', '''  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}

// GET /api/inventory/options/facet?make=&type=coded|feature — aggregate option/feature names
// for one make, in-stock only, each with a count of vehicles carrying it. `type=coded` (the
// default) groups by the real per-item code — Dealer.com structured packages/options and any
// other source that supplies one — with the label resolved via dealer_option_names, mirroring
// the old crawler box's fetchOptionCodeFacet fast path. `type=feature` groups by the free-text
// name itself instead, scoped to DealerOn's uncoded mentions (code = UNCODED_FEATURE_CODE) —
// see the const's own comment for why those can't be grouped by code like the coded ones are.
// Cached like the other aggregate endpoints; invalidated by every bulk upsert.
async function handleInventoryOptionFacet(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const p = (k) => (params.get(k) || "").trim();
  const make = p("make");
  if (!make) return badRequest(res, "make is required");
  const type = p("type") === "feature" ? "feature" : "coded";
  sendJson(res, 200, await invCached(`option-facet:${make}:${type}`, () => computeOptionFacet(pool, make, type)));
}
async function computeOptionFacet(pool, make, type) {
  if (type === "feature") {
    const [rows] = await pool.query(
      `SELECT oi.name AS value, oi.name AS label, COUNT(*) AS count
       FROM dealer_inventory_options oi
       JOIN dealer_inventory i ON i.vin = oi.vin AND i.dealer_id = oi.dealer_id AND i.removed_at IS NULL
       WHERE oi.make = ? AND oi.code = ?
       GROUP BY oi.name ORDER BY count DESC LIMIT 500`,
      [make, UNCODED_FEATURE_CODE]
    );
    return { make, type, facet: rows };
  }
  const [rows] = await pool.query(
    `SELECT oi.code AS value, n.name AS label, COUNT(*) AS count
     FROM dealer_inventory_options oi
     JOIN dealer_inventory i ON i.vin = oi.vin AND i.dealer_id = oi.dealer_id AND i.removed_at IS NULL
     LEFT JOIN dealer_option_names n ON n.make = oi.make AND n.code = oi.code
     WHERE oi.make = ? AND oi.code IS NOT NULL AND oi.code <> ?
     GROUP BY oi.code, n.name ORDER BY count DESC LIMIT 500`,
    [make, UNCODED_FEATURE_CODE]
  );
  return { make, type, facet: rows };
}

// GET /api/inventory/stats — counts for the admin sheet's filter menus.''', "handleInventoryOptionFacet")

    rep('''  if (req.method === "GET" && pathname === "/api/inventory") return run(handleListInventory, url.searchParams);''', '''  if (req.method === "GET" && pathname === "/api/inventory") return run(handleListInventory, url.searchParams);
  if (req.method === "GET" && pathname === "/api/inventory/options/facet") return run(handleInventoryOptionFacet, url.searchParams);''', "wire route")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY")
echo "GET /api/inventory/stats -> $code"
echo "the new tables are created lazily on first request to any /api/inventory* route (ensureInventoryTable) — that just happened above."
