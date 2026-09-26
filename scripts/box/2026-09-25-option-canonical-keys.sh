#!/usr/bin/env bash
# Redefines dealer_inventory_options around a stable canonical_key instead of the raw per-listing
# `code` a crawled listing carries.
#
# Confirmed live 2026-09-25: that `code` (e.g. "OPT-35") is just a listing-position number, not a
# stable factory/RPO code — the SAME real option ("Heated Front Seats") showed up as OPT-30 on one
# BMW iX, OPT-48 on another, OPT-62 on a third. A code-based must-have-ALL filter would silently
# miss most vehicles that actually have a given option. canonical_key normalizes the option's
# LABEL (lowercase, punctuation stripped, whitespace collapsed, common abbreviations like "B&W"
# expanded first) into a value that's the same across every vehicle with that real option,
# regardless of per-vehicle position — the same identity principle lib/factoryOptionCatalog.ts
# already uses for the window-sticker pipeline, applied independently here (separate table).
#
# Also folds in a fix that was written (PR #311) but never actually deployed to this box — only
# its supporting index was applied directly via SQL at the time: the option-codes query drove FROM
# dealer_inventory_options (scanning every option row) and filtered dealer_inventory's make=
# afterward, instead of the other way around. STRAIGHT_JOIN now drives from dealer_inventory
# (filtered by make=/removed_at first) into dealer_inventory_options by primary key.
#
# SAFETY: dealer_inventory_options is dropped and recreated with the new schema — this script
# checks it's currently empty first and ABORTS if it isn't, rather than silently discarding real
# data. Confirmed empty right before this script was written; if a crawl has run in between and
# populated real rows, do NOT force past this check — run the backfill script instead of dropping.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-25-option-canonical-keys.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-option-canonical-keys.sh?cb=$(date +%s)" && curl -fsSL -o inventoryListQuery.js "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src/inventoryListQuery.js?cb=$(date +%s)" && grep -c canonical_key inventoryListQuery.js && sudo cp 2026-09-25-option-canonical-keys.sh inventoryListQuery.js /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-25-option-canonical-keys.sh
set -euo pipefail
FILE=${FILE:-/opt/trimscout-deals/src/deals_api_server.js}
DIR=$(dirname "$FILE")
ON_BOX=$([ "$FILE" = /opt/trimscout-deals/src/deals_api_server.js ] && echo 1 || echo 0)
if [ "$ON_BOX" = 1 ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
  if [ ! -f "$DIR/inventoryListQuery.js" ]; then
    echo "ERROR: $DIR/inventoryListQuery.js not found — fetch it alongside this script first (see the usage line above). Always re-fetched whole, never patched in place." >&2
    exit 1
  fi
  if ! grep -q "canonical_key" "$DIR/inventoryListQuery.js"; then
    echo "ERROR: the fetched inventoryListQuery.js doesn't contain canonical_key — likely a stale cached copy from raw.githubusercontent.com. Re-fetch with a fresh cache-busting query param and try again." >&2
    exit 1
  fi

  EXISTING_ROWS=$(sudo mysql trimscout -N -e "SELECT COUNT(*) FROM dealer_inventory_options;" 2>/dev/null || echo "table_missing")
  if [ "$EXISTING_ROWS" != "table_missing" ] && [ "$EXISTING_ROWS" != "0" ]; then
    echo "ERROR: dealer_inventory_options has $EXISTING_ROWS existing rows — refusing to drop it. Run the backfill script (2026-09-25-backfill-dealer-inventory-options.mjs) to migrate that data forward instead, or investigate before proceeding." >&2
    exit 1
  fi
  echo "dealer_inventory_options is empty ($EXISTING_ROWS rows) — safe to redefine."
fi

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

if "canonical_key" not in s:
    rep('''  // One row per (vehicle, factory option code) — a normalized side table for the buyer
  // search's "must-have ALL of these options" filter. dealer_inventory.options_json is a
  // free-text blob (see inventoryRowFromDb) with no index, so "has every one of these codes"
  // can't be answered efficiently there at 1.5M+ rows. Populated in handleInventoryBulk by
  // deleting and reinserting each chunk's vehicles' rows on every upsert — always a full
  // replace of the set, never a partial add, so a vehicle that loses an option on a later
  // crawl doesn't keep matching it forever.
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_options (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    code VARCHAR(32) NOT NULL,
    PRIMARY KEY (vin, dealer_id, code),
    INDEX idx_opt_code (code)
  )`);
  inventoryReady = true;''', '''  // One row per (vehicle, canonicalized option) — a normalized side table for the buyer
  // search's "must-have ALL of these options" filter. dealer_inventory.options_json is a
  // free-text blob (see inventoryRowFromDb) with no index, so "has every one of these options"
  // can't be answered efficiently there at 1.5M+ rows.
  //
  // Search identity is canonical_key (normalizeOptionKey(label) below), NEVER the raw `code` a
  // listing carries. Confirmed live 2026-09-25: the crawled `code` field (e.g. "OPT-35") is just
  // that vehicle's listing-position number, not a stable factory RPO code — the SAME real option
  // ("Heated Front Seats") showed up as OPT-30 on one BMW iX, OPT-48 on another, OPT-62 on a
  // third. A raw-code containment search would silently miss most vehicles that actually have a
  // given option. canonical_key normalizes the option's LABEL (lowercased, punctuation stripped,
  // whitespace collapsed) into a value that's the same across every vehicle that has that same
  // real option, regardless of what position it was listed in or what per-vehicle code a scraper
  // assigned it — the same principle lib/factoryOptionCatalog.ts already uses for the
  // window-sticker pipeline, applied independently here since this is a separate table/pipeline.
  // `code` is kept purely as metadata (never used for matching); `label` keeps one real display
  // spelling for the UI.
  //
  // Populated in handleInventoryBulk by deleting and reinserting each chunk's vehicles' rows on
  // every upsert — always a full replace of the set, never a partial add, so a vehicle that loses
  // an option on a later crawl doesn't keep matching it forever.
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_options (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    canonical_key VARCHAR(80) NOT NULL,
    label VARCHAR(160) NOT NULL,
    code VARCHAR(32) NULL,
    PRIMARY KEY (vin, dealer_id, canonical_key),
    INDEX idx_opt_canonical (canonical_key)
  )`);
  inventoryReady = true;
}

// Lowercase, strip punctuation, collapse whitespace — mirrors lib/factoryOptionCatalog.ts's
// normalizeOptionKey() (a separate pipeline/table, but the same identity principle: two
// differently-worded/coded mentions of the same real option should resolve to the same key).
// Includes the OEM audio-brand synonym folding this table exists to fix: "Bowers & Wilkins",
// "Bowers and Wilkins", and "B&W" all need to land on one canonical_key, but naive normalization
// alone turns "B&W" into "b w" — two characters, meaningless and collision-prone — rather than
// the same key as the full name. Expand known abbreviations to their full form BEFORE
// normalizing so both spellings converge.
const OPTION_SYNONYM_EXPANSIONS = [
  [/\\bb\\s*&\\s*w\\b/gi, "bowers wilkins"],
];
function normalizeOptionKey(label) {
  let s = String(label || "").trim().toLowerCase();
  for (const [pattern, replacement] of OPTION_SYNONYM_EXPANSIONS) s = s.replace(pattern, replacement);
  return s.replace(/[^a-z0-9]+/g, " ").replace(/\\s+/g, " ").trim().slice(0, 80);''', "dealer_inventory_options schema + normalizeOptionKey")

    rep('''    // Replace each vehicle's option-code set (dealer_inventory_options) in the same chunk as
    // its main upsert — tied together so a chunk that fails partway through never leaves a
    // live VIN's row updated but its option set stale/empty. A full delete-then-reinsert per
    // chunk, not a per-vehicle diff: cheap at 500 rows, and correct when a later crawl drops
    // an option the vehicle no longer has (an additive-only write would keep matching it).
    const optionPairs = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId)]);
    await pool.query("DELETE FROM dealer_inventory_options WHERE (vin, dealer_id) IN (?)", [optionPairs]);
    const optionRows = [];
    for (const v of chunk) {
      if (!Array.isArray(v.options)) continue;
      const vin = v.vin.trim().toUpperCase(), dealerId = INV_DEALER(v.dealerId);
      const codes = new Set(v.options.map((o) => INV_STR(o && o.code, 32)).filter(Boolean));
      for (const code of codes) optionRows.push([vin, dealerId, code]);
    }
    if (optionRows.length) await pool.query("INSERT INTO dealer_inventory_options (vin, dealer_id, code) VALUES ? ON DUPLICATE KEY UPDATE vin = VALUES(vin)", [optionRows]);''', '''    // Replace each vehicle's canonicalized option set (dealer_inventory_options) in the same
    // chunk as its main upsert — tied together so a chunk that fails partway through never
    // leaves a live VIN's row updated but its option set stale/empty. A full delete-then-reinsert
    // per chunk, not a per-vehicle diff: cheap at 500 rows, and correct when a later crawl drops
    // an option the vehicle no longer has (an additive-only write would keep matching it).
    const optionPairs = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId)]);
    await pool.query("DELETE FROM dealer_inventory_options WHERE (vin, dealer_id) IN (?)", [optionPairs]);
    const optionRows = [];
    for (const v of chunk) {
      if (!Array.isArray(v.options)) continue;
      const vin = v.vin.trim().toUpperCase(), dealerId = INV_DEALER(v.dealerId);
      // Identity comes from the option's NAME, never its raw per-listing `code` (see the table's
      // own comment in ensureInventoryTable) — a name-only option (no code at all, common on
      // several sources) still canonicalizes and matches fine; a code with no name has nothing
      // stable to key on and is skipped.
      const byKey = new Map();
      for (const o of v.options) {
        const label = INV_STR(o && o.name, 160);
        if (!label) continue;
        const key = normalizeOptionKey(label);
        if (!key) continue;
        if (!byKey.has(key)) byKey.set(key, { label, code: INV_STR(o && o.code, 32) });
      }
      for (const [key, { label, code }] of byKey) optionRows.push([vin, dealerId, key, label, code]);
    }
    if (optionRows.length) await pool.query("INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ? ON DUPLICATE KEY UPDATE label = VALUES(label), code = VALUES(code)", [optionRows]);''', "handleInventoryBulk canonical-key population")

    rep('''  const whereSql = "WHERE " + where.join(" AND ");
  const cacheKey = `catalog-options:${make}|${model}|${trim}`;
  sendJson(res, 200, await invCached(cacheKey, async () => {
    const [optionRows] = await pool.query(
      `SELECT o.code, COUNT(*) AS vehicleCount FROM dealer_inventory_options o JOIN dealer_inventory i ON i.vin = o.vin AND i.dealer_id = o.dealer_id ${whereSql} GROUP BY o.code ORDER BY o.code`,
      args
    );
    const [colorRows] = await pool.query(
      `SELECT exterior_color, interior_color FROM dealer_inventory i ${whereSql} AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL) GROUP BY exterior_color, interior_color`,
      args
    );
    const exteriorColors = [...new Set(colorRows.map((r) => r.exterior_color).filter(Boolean))].sort();
    const interiorColors = [...new Set(colorRows.map((r) => r.interior_color).filter(Boolean))].sort();
    return {
      options: optionRows.map((r) => ({ code: r.code, vehicleCount: Number(r.vehicleCount) })),
      exteriorColors,
      interiorColors,
    };
  }));
}''', '''  const whereSql = "WHERE " + where.join(" AND ");
  // Both queries below only get a FORCE INDEX when make= is set — mirrors inventoryListQuery.js's
  // own rule (a hint is only safe/helpful when the leading equality column it expects is actually
  // pinned).
  const makeIndexHint = make ? "FORCE INDEX (idx_inv_stock_make_dealer)" : "";
  const makeColorsIndexHint = make ? "FORCE INDEX (idx_inv_stock_make_colors)" : "";
  const cacheKey = `catalog-options:${make}|${model}|${trim}`;
  sendJson(res, 200, await invCached(cacheKey, async () => {
    // STRAIGHT_JOIN drives from dealer_inventory (filtered by make=/removed_at first, typically
    // the far smaller side) into dealer_inventory_options by its (vin, dealer_id, canonical_key)
    // primary key, instead of scanning every row in dealer_inventory_options and only filtering
    // by make afterward.
    const [optionRows] = await pool.query(
      `SELECT STRAIGHT_JOIN o.canonical_key, MIN(o.label) AS label, COUNT(*) AS vehicleCount FROM dealer_inventory i ${makeIndexHint} JOIN dealer_inventory_options o ON o.vin = i.vin AND o.dealer_id = i.dealer_id ${whereSql} GROUP BY o.canonical_key ORDER BY o.canonical_key`,
      args
    );
    const [colorRows] = await pool.query(
      `SELECT exterior_color, interior_color FROM dealer_inventory i ${makeColorsIndexHint} ${whereSql} AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL) GROUP BY exterior_color, interior_color`,
      args
    );
    const exteriorColors = [...new Set(colorRows.map((r) => r.exterior_color).filter(Boolean))].sort();
    const interiorColors = [...new Set(colorRows.map((r) => r.interior_color).filter(Boolean))].sort();
    return {
      options: optionRows.map((r) => ({ key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicleCount) })),
      exteriorColors,
      interiorColors,
    };
  }));
}''', "handleInventoryCatalogOptions canonical-key + STRAIGHT_JOIN")
else:
    print("already patched")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"

echo "Dropping and recreating dealer_inventory_options with the new schema (confirmed empty above)..."
sudo mysql trimscout -e "DROP TABLE IF EXISTS dealer_inventory_options;"
sudo mysql trimscout -e "CREATE TABLE dealer_inventory_options (vin CHAR(17) NOT NULL, dealer_id INT NOT NULL DEFAULT 0, canonical_key VARCHAR(80) NOT NULL, label VARCHAR(160) NOT NULL, code VARCHAR(32) NULL, PRIMARY KEY (vin, dealer_id, canonical_key), INDEX idx_opt_canonical (canonical_key));"
echo "Schema applied."

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
sudo mysql trimscout -e "DESCRIBE dealer_inventory_options;"
echo "Done. Table is empty by design — run 2026-09-25-backfill-dealer-inventory-options.mjs next to populate it from existing options_json data instead of waiting for tonight's crawl."
