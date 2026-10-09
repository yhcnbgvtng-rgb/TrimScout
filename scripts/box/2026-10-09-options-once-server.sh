#!/usr/bin/env bash
# Deals box, PART 1 of "options once per VIN": teach POST /api/inventory/bulk the rule in src/optionsCapture.js.
#
# What it does (anchored, idempotent, each snippet must match exactly once, backs up, node --check):
#   1. installs src/optionsCapture.js (pure module, no I/O)
#   2. patches /opt/trimscout-deals/src/deals_api_server.js: lazily adds options_captured_at / options_source / options_attempts /
#      options_checked_at (ALTER ... ADD COLUMN IF NOT EXISTS, run by ensureInventoryTable on start), and in handleInventoryBulk reads each
#      VIN's capture state, skips the options of a captured VIN, counts empty/junk tries (one retry after 7 days, then never), and
#      reports optionsSkipped/optionsCaptured/optionsFailedTry/optionsWaiting back to the sync.
#   3. does NOT restart deals-api. OPTIONS_ONCE_PER_VIN=0 in the pm2 env is the kill switch (old overwrite behavior).
# Nothing changes in the data until deals-api is restarted AND a sync runs; then run the stamp step (see docs/OPTIONS_ONCE_PER_VIN.md).
#
# DO NOT RUN until Paul says go, in an idle window (sync lock free, no crawl/sync, empty processlist) and AFTER the restart/facet-rebuild
# sequence. The restart re-runs ensureInventoryTable's ALTERs, which queue behind any long query holding a metadata lock.
#
# Run on the deals box (ubuntu@52.202.234.65), after merge:
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o optionsCapture.js "$B/scrapers/lightsail-crawler/src/optionsCapture.js?cb=$(date +%s)" && curl -fsSL -o 2026-10-09-options-once-server.sh "$B/scripts/box/2026-10-09-options-once-server.sh?cb=$(date +%s)" && sudo cp optionsCapture.js 2026-10-09-options-once-server.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-10-09-options-once-server.sh
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f /opt/trimscout-deals/src/optionsCapture.js ] || { echo "ERROR: src/optionsCapture.js missing — copy it first (see header)." >&2; exit 1; }
node --check /opt/trimscout-deals/src/optionsCapture.js
sudo cp "$FILE" "$FILE.bak.$STAMP"; echo "backup: $FILE.bak.$STAMP"
sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if "decideOptionsIngest" in s:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match on this box's file, found {n} (the box file has drifted from the repo mirror: stop, do not restart)"
    s = s.replace(old, new)
rep('import { groupExistingOptionRows, diffOptionSets, pairKey } from "./inventoryOptionsDiff.js";', 'import { groupExistingOptionRows, diffOptionSets, pairKey } from "./inventoryOptionsDiff.js";\nimport { decideOptionsIngest, normalizeOptionsSource } from "./optionsCapture.js";', 'import')
rep('const OPTIONS_DIFF_WRITE = process.env.INVENTORY_OPTIONS_DIFF_WRITE !== "0";', 'const OPTIONS_DIFF_WRITE = process.env.INVENTORY_OPTIONS_DIFF_WRITE !== "0";\n// "Options once per VIN" (optionsCapture.js): a VIN with a good options capture is never re-taken — later nights update price,\n// stock, last_seen and removed only; an empty/junk capture is tried once more after 7 days, then never again. OPTIONS_ONCE_PER_VIN=0\n// restores the old "options in every payload overwrite" behavior without a code change.\nconst OPTIONS_ONCE_PER_VIN = process.env.OPTIONS_ONCE_PER_VIN !== "0";', 'flag')
rep('    "ADD COLUMN IF NOT EXISTS base_msrp INT NULL",', '    "ADD COLUMN IF NOT EXISTS base_msrp INT NULL",\n    // Options once per VIN (optionsCapture.js): when a good capture was taken and from where (vdp | sticker | feed), plus the\n    // bookkeeping for the single retry of an empty/junk capture. NULL = never captured.\n    "ADD COLUMN IF NOT EXISTS options_captured_at DATETIME NULL",\n    "ADD COLUMN IF NOT EXISTS options_source VARCHAR(16) NULL",\n    "ADD COLUMN IF NOT EXISTS options_attempts TINYINT UNSIGNED NULL",\n    "ADD COLUMN IF NOT EXISTS options_checked_at DATETIME NULL",', 'columns')
rep('let upserted = 0, skipped = 0, optionSetsReplaced = 0,', 'let upserted = 0, skipped = 0, optionsSkipped = 0, optionsCaptured = 0, optionsFailedTry = 0, optionsWaiting = 0, optionSetsReplaced = 0,', 'counters')
rep("    // Sorted by the table's own primary key (vin, dealer_id) before the multi-row INSERT below.", '    // Options once per VIN (optionsCapture.js): what is stored for each VIN decides whether this payload\'s options are taken at all.\n    // A skipped / waiting / given-up VIN has its options written as null here, which the upsert\'s COALESCE turns into "keep what\n    // is stored", and it is left out of the facet rewrite below.\n    const optionDecisions = new Map(); // `${vin}|${dealerId}` -> decision\n    if (OPTIONS_ONCE_PER_VIN) {\n      const pairs = values.map((r) => [r[0], r[1]]);\n      const conds = pairs.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ");\n      const [stored] = await pool.query(`SELECT vin, dealer_id, options_captured_at, options_attempts, options_checked_at FROM dealer_inventory WHERE ${conds}`, pairs.flat());\n      const storedByPair = new Map(stored.map((s) => [pairKey(s.vin, s.dealer_id), { capturedAt: s.options_captured_at, attempts: s.options_attempts, checkedAt: s.options_checked_at }]));\n      const now = new Date();\n      for (const v of chunk) {\n        const vin = v.vin.trim().toUpperCase(), dealerId = INV_DEALER(v.dealerId);\n        const make = normalizeMakeForWrite({ make: v.make, vin: v.vin, model: v.model });\n        const d = decideOptionsIngest({ existing: storedByPair.get(pairKey(vin, dealerId)) || null, incoming: { options: v.options, source: v.optionsSource }, now, resolveKey: (key) => resolveAllowlisted(OPTION_ALLOWLIST, make, key) });\n        optionDecisions.set(pairKey(vin, dealerId), d);\n        if (d.action === "skip") optionsSkipped++;\n        else if (d.action === "capture") optionsCaptured++;\n        else if (d.action === "attempt_failed") optionsFailedTry++;\n        else optionsWaiting++; // wait / give_up\n      }\n    }\n    // Sorted by the table\'s own primary key (vin, dealer_id) before the multi-row INSERT below.', 'decisions')
rep('    for (const row of values) row.push(vehicleIds.get(row[0]));', '    for (const row of values) {\n      row.push(vehicleIds.get(row[0]));\n      // Capture columns (last four of the INSERT): options_captured_at, options_source, options_attempts, options_checked_at.\n      const d = optionDecisions.get(pairKey(row[0], row[1]));\n      if (d && !d.useIncoming) { row[27] = null; row[28] = null; } // options_json, options_total: keep what is stored\n      row.push(d?.set.capturedAt ?? null, d?.set.capturedAt ? normalizeOptionsSource(d.set.source) : null, d?.set.attempts ?? null, d?.set.checkedAt ?? null);\n    }', 'row push')
rep('options_total, base_msrp, crawl_first_seen, source_box, vehicle_id)\n       VALUES ?', 'options_total, base_msrp, crawl_first_seen, source_box, vehicle_id,\n        options_captured_at, options_source, options_attempts, options_checked_at)\n       VALUES ?', 'insert columns')
rep('vehicle_id = COALESCE(vehicle_id, VALUES(vehicle_id))`,', 'vehicle_id = COALESCE(vehicle_id, VALUES(vehicle_id)),\n        options_captured_at = COALESCE(VALUES(options_captured_at), options_captured_at), options_source = COALESCE(VALUES(options_source), options_source), options_attempts = COALESCE(VALUES(options_attempts), options_attempts), options_checked_at = COALESCE(VALUES(options_checked_at), options_checked_at)`,', 'on duplicate')
rep('    const withOptions = chunk.filter((v) => payloadHasOptions(v.options));', '    const withOptions = chunk.filter((v) => payloadHasOptions(v.options) && (optionDecisions.get(pairKey(v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId)))?.useIncoming ?? true));', 'withOptions')
rep('sendJson(res, 200, { upserted, skipped, optionSetsReplaced,', 'sendJson(res, 200, { upserted, skipped, optionsSkipped, optionsCaptured, optionsFailedTry, optionsWaiting, optionSetsReplaced,', 'response')

open(p, "w").write(s)
print("patched")
PY
sudo node --check "$FILE" && echo "syntax ok"
echo "NOT restarted. Restart deals-api yourself in the idle window; rollback: sudo cp $FILE.bak.$STAMP $FILE && sudo -u ubuntu pm2 restart deals-api"
