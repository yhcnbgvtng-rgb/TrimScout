// Box2 patcher: OPTIONS_PAID_ONLY (PR #563) as ANCHORED edits to the box's own deals-api files. Code only until Paul types GO.
// Never restarts anything, never sets the flag, never touches the database. Generated from the PR's diff; every edit is checked against the box's text.
//
//   node 2026-10-19-options-paid-only.mjs [--dir=/opt/trimscout-deals/src] [--apply]
//
// What it changes, and nothing else (all behaviour is behind OPTIONS_PAID_ONLY, which stays OFF unless someone sets it in the process env):
//   deals_api_server.js         PAID_ONLY const; price column DDL only when on; price written/compared only when on; facet rebuild counts price > 0 per row when on
//   inventoryOptionRows.js      optionRowsFromOptions({withPrice}); buyerOptionCatalog passes min/max price through when the rebuild stored them
//   factoryOptionAllowlist.js   policyFacetRows(..., {withPrice})
//   inventoryOptionsDiff.js     comparePrice option (off unless asked)
//   catalogSummary.js           min/max price in the all-makes summary (only when asked)
//   syncOptionClean.js          a kept stored paid line keeps its stored price
//   optionsPaidOnlyServer.js    NEW module next to the others
// Prerequisite: the sync-option-clean patch (2026-10-19-sync-option-clean.mjs) is installed; this refuses to run otherwise.
//
// Without --apply it is a DRY RUN: it reads the files, checks every anchor (each "find" must occur EXACTLY once, or the edit's marker must already be there),
// stages the patched modules in a temp dir, loads them and runs the smoke checks (including: the flag defaults to OFF and flag-off output is unchanged), and writes
// nothing to --dir. With --apply it
//   1. writes patched copies to <file>.new.mjs and node --check's them,
//   2. copies each original to <file>.bak.<timestamp> (cp -p), moves the new file into place (same mode), and installs optionsPaidOnlyServer.js.
// Takes effect at the next deals-api restart (idle window, Paul's call). Turning the flag ON additionally needs the price backfill (scripts/box/2026-10-19-backfill-option-prices.mjs).
//
// RESTORE: for each backup the apply printed: cp -p <file>.bak.<STAMP> <file>   (files: deals_api_server.js inventoryOptionRows.js factoryOptionAllowlist.js
//   inventoryOptionsDiff.js catalogSummary.js syncOptionClean.js); then rm optionsPaidOnlyServer.js; then restart only if deals-api was already restarted onto the new code.
//   Or all at once:  cd <dir> && for f in deals_api_server inventoryOptionRows factoryOptionAllowlist inventoryOptionsDiff catalogSummary syncOptionClean; do cp -p $f.js.bak.<STAMP> $f.js; done; rm -f optionsPaidOnlyServer.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
const DIR = path.resolve(args.dir || "/opt/trimscout-deals/src");
const APPLY = Boolean(args.apply);
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const count = (hay, needle) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; };

const EDITS =
[
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-1",
  "find": "import { createSummaryAccumulator, summaryToQueryRows } from \"./catalogSummary.js\";\nimport { groupExistingOptionRows, diffOptionSets, pairKey } from \"./inventoryOptionsDiff.js\";\n",
  "replace": "import { createSummaryAccumulator, summaryToQueryRows } from \"./catalogSummary.js\";\nimport { paidOnlyEnabled, paidSql } from \"./optionsPaidOnlyServer.js\";\nimport { groupExistingOptionRows, diffOptionSets, pairKey } from \"./inventoryOptionsDiff.js\";\n",
  "marker": "import { paidOnlyEnabled, paidSql } from \"./optionsPaidOnlyServer.js\";"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-2",
  "find": "const RETAIL_ONLY_FACETS = process.env.RETAIL_ONLY_FACETS !== \"0\";\n// Cars last seen more than this many days ago are hidden from buyers: the list/facets/makes calls carry it as seenWithinDays (the web app's\n",
  "replace": "const RETAIL_ONLY_FACETS = process.env.RETAIL_ONLY_FACETS !== \"0\";\n// OPTIONS_PAID_ONLY (default off): dealer_inventory_options stores each car's own price per option row, and the catalog facets count a row only\n// where that row's price is above 0 (per row, never per label), with the min/max paid price per option. Off = no column, no writes, same queries.\n// Needs the price backfill (scripts/box/2026-10-19-backfill-option-prices.mjs) before the counts are complete; docs/OPTIONS_PAID_ONLY_CATALOG_NOTE.md.\nconst PAID_ONLY = paidOnlyEnabled();\n// Cars last seen more than this many days ago are hidden from buyers: the list/facets/makes calls carry it as seenWithinDays (the web app's\n",
  "marker": "// Needs the price backfill (scripts/box/2026-10-19-backfill-option-prices.mjs) before the counts are complete; docs/OPTIONS_PAID_ONLY_CATALOG_NOTE.md."
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-3",
  "find": "  await pool.query(\"CREATE TABLE IF NOT EXISTS inv_color_summary (kind VARCHAR(3) NOT NULL, color VARCHAR(96) NOT NULL, PRIMARY KEY (kind, color))\");\n  inventoryReady = true;\n",
  "replace": "  await pool.query(\"CREATE TABLE IF NOT EXISTS inv_color_summary (kind VARCHAR(3) NOT NULL, color VARCHAR(96) NOT NULL, PRIMARY KEY (kind, color))\");\n  if (PAID_ONLY) {\n    // Nullable columns: an instant ADD COLUMN on MariaDB 10.3+, no table rewrite. NULL = \"not backfilled yet\", which the paid-only count treats as not paid.\n    await pool.query(\"ALTER TABLE dealer_inventory_options ADD COLUMN IF NOT EXISTS price INT NULL\");\n    await pool.query(\"ALTER TABLE inv_option_facets ADD COLUMN IF NOT EXISTS min_price INT NULL, ADD COLUMN IF NOT EXISTS max_price INT NULL\");\n    await pool.query(\"ALTER TABLE inv_option_summary ADD COLUMN IF NOT EXISTS min_price INT NULL, ADD COLUMN IF NOT EXISTS max_price INT NULL\");\n  }\n  inventoryReady = true;\n",
  "marker": "// Nullable columns: an instant ADD COLUMN on MariaDB 10.3+, no table rewrite. NULL = \"not backfilled yet\", which the paid-only count treats as not paid."
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-4",
  "find": "        const pol = policyFacetRows(OPTION_ALLOWLIST, { make, model: v.model, year: INV_INT(v.year), trim: INV_STR(v.trim, 160) }, v.options);\n",
  "replace": "        const pol = policyFacetRows(OPTION_ALLOWLIST, { make, model: v.model, year: INV_INT(v.year), trim: INV_STR(v.trim, 160) }, v.options, { withPrice: PAID_ONLY });\n",
  "marker": "const pol = policyFacetRows(OPTION_ALLOWLIST, { make, model: v.model, year: INV_INT(v.year), trim: INV_STR(v.trim, 160) }, v.options, { withPrice: PAID_ONLY });"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-5",
  "find": "        const { rows: facetRows, junkDropped } = pol || optionRowsFromOptions(v.options, { resolveKey: (key) => resolveAllowlisted(OPTION_ALLOWLIST, make, key) });\n",
  "replace": "        const { rows: facetRows, junkDropped } = pol || optionRowsFromOptions(v.options, { resolveKey: (key) => resolveAllowlisted(OPTION_ALLOWLIST, make, key), withPrice: PAID_ONLY });\n",
  "marker": "const { rows: facetRows, junkDropped } = pol || optionRowsFromOptions(v.options, { resolveKey: (key) => resolveAllowlisted(OPTION_ALLOWLIST, make, key), withPrice: PAID_ONLY });"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-6",
  "find": "        const { changed, unchanged } = diffOptionSets(desired, existing);\n",
  "replace": "        const { changed, unchanged } = diffOptionSets(desired, existing, { comparePrice: PAID_ONLY });\n",
  "marker": "const { changed, unchanged } = diffOptionSets(desired, existing, { comparePrice: PAID_ONLY });"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-7",
  "find": "        for (const d of toReplace) for (const { key, label, code } of d.rows) optionRows.push([d.vin, d.dealerId, key, label, code]);\n",
  "replace": "        for (const d of toReplace) for (const { key, label, code, price } of d.rows) optionRows.push(PAID_ONLY ? [d.vin, d.dealerId, key, label, code, price ?? null] : [d.vin, d.dealerId, key, label, code]);\n",
  "marker": "for (const d of toReplace) for (const { key, label, code, price } of d.rows) optionRows.push(PAID_ONLY ? [d.vin, d.dealerId, key, label, code, price ?? null] : [d.vin, d.dealerId, key, label, code]);"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-8",
  "find": "        if (optionRows.length) await pool.query(\"INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ? ON DUPLICATE KEY UPDATE label = VALUES(label), code = VALUES(code)\", [optionRows]);\n",
  "replace": "        if (optionRows.length) {\n          if (PAID_ONLY) await pool.query(\"INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code, price) VALUES ? ON DUPLICATE KEY UPDATE label = VALUES(label), code = VALUES(code), price = VALUES(price)\", [optionRows]);\n          else await pool.query(\"INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ? ON DUPLICATE KEY UPDATE label = VALUES(label), code = VALUES(code)\", [optionRows]);\n        }\n",
  "marker": "if (PAID_ONLY) await pool.query(\"INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code, price) VALUES ? ON DUPLICATE KEY UPDATE label = VALUES(label), code = VALUES(code), price = VALUES(price)\", [optionRows]);"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-9",
  "find": "  const [rows] = await pool.query(`SELECT vin, dealer_id, canonical_key, label, code FROM dealer_inventory_options WHERE ${conds}`, pairs.flatMap((d) => [d.vin, d.dealerId]));\n",
  "replace": "  const [rows] = await pool.query(`SELECT vin, dealer_id, canonical_key, label, code${PAID_ONLY ? \", price\" : \"\"} FROM dealer_inventory_options WHERE ${conds}`, pairs.flatMap((d) => [d.vin, d.dealerId]));\n",
  "marker": "const [rows] = await pool.query(`SELECT vin, dealer_id, canonical_key, label, code${PAID_ONLY ? \", price\" : \"\"} FROM dealer_inventory_options WHERE ${conds}`, pairs.flatMap((d) => [d.vin, d.dealerId]));"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-10",
  "find": "    const summary = createSummaryAccumulator();\n    for (const make of makes) {\n",
  "replace": "    const summary = createSummaryAccumulator();\n    // Paid-only: count a row only where ITS OWN price is above 0 (so a label paid on some cars and $0 on others counts the paid cars only) and keep the price range.\n    const paid = paidSql(PAID_ONLY);\n    for (const make of makes) {\n",
  "marker": "// Paid-only: count a row only where ITS OWN price is above 0 (so a label paid on some cars and $0 on others counts the paid cars only) and keep the price range."
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-11",
  "find": "        `SELECT STRAIGHT_JOIN COALESCE(i.model, '') AS model, COALESCE(i.trim, '') AS trim, o.canonical_key, MIN(o.label) AS label, COUNT(*) AS n\n",
  "replace": "        `SELECT STRAIGHT_JOIN COALESCE(i.model, '') AS model, COALESCE(i.trim, '') AS trim, o.canonical_key, MIN(o.label) AS label, COUNT(*) AS n${paid.select}\n",
  "marker": "`SELECT STRAIGHT_JOIN COALESCE(i.model, '') AS model, COALESCE(i.trim, '') AS trim, o.canonical_key, MIN(o.label) AS label, COUNT(*) AS n${paid.select}"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-12",
  "find": "         WHERE i.removed_at IS NULL AND i.make = ?${RETAIL_ONLY_FACETS ? \" AND (i.cond IS NULL OR i.cond <> 'wholesale')\" : \"\"}${STALE_HIDE_DAYS ? ` AND i.last_seen_at >= DATE_SUB(NOW(), INTERVAL ${STALE_HIDE_DAYS} DAY)` : \"\"}\n",
  "replace": "         WHERE i.removed_at IS NULL AND i.make = ?${RETAIL_ONLY_FACETS ? \" AND (i.cond IS NULL OR i.cond <> 'wholesale')\" : \"\"}${STALE_HIDE_DAYS ? ` AND i.last_seen_at >= DATE_SUB(NOW(), INTERVAL ${STALE_HIDE_DAYS} DAY)` : \"\"}${paid.where}\n",
  "marker": "WHERE i.removed_at IS NULL AND i.make = ?${RETAIL_ONLY_FACETS ? \" AND (i.cond IS NULL OR i.cond <> 'wholesale')\" : \"\"}${STALE_HIDE_DAYS ? ` AND i.last_seen_at >= DATE_SUB(NOW(), INTERVAL ${STALE_HIDE_DAYS} DAY)` : \"\"}${paid.where}"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-13",
  "find": "          await conn.query(\"INSERT INTO inv_option_facets (make, model, trim, canonical_key, label, vehicle_count) VALUES ?\", [optionAgg.slice(i, i + 2000).map((r) => [make, r.model, r.trim, r.canonical_key, r.label, Number(r.n)])]);\n",
  "replace": "          if (PAID_ONLY) await conn.query(\"INSERT INTO inv_option_facets (make, model, trim, canonical_key, label, vehicle_count, min_price, max_price) VALUES ?\", [optionAgg.slice(i, i + 2000).map((r) => [make, r.model, r.trim, r.canonical_key, r.label, Number(r.n), r.min_price, r.max_price])]);\n          else await conn.query(\"INSERT INTO inv_option_facets (make, model, trim, canonical_key, label, vehicle_count) VALUES ?\", [optionAgg.slice(i, i + 2000).map((r) => [make, r.model, r.trim, r.canonical_key, r.label, Number(r.n)])]);\n",
  "marker": "if (PAID_ONLY) await conn.query(\"INSERT INTO inv_option_facets (make, model, trim, canonical_key, label, vehicle_count, min_price, max_price) VALUES ?\", [optionAgg.slice(i, i + 2000).map((r) => [make, r.model, r.trim, r.canonical_key, r.label, Number(r.n), r.min_price, r.max_price])]);"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-14",
  "find": "      const { optionRows, colorRows } = summary.result({ minVehicles: CATALOG_MIN_VEHICLES });\n",
  "replace": "      const { optionRows, colorRows } = summary.result({ minVehicles: CATALOG_MIN_VEHICLES, paidPrices: PAID_ONLY });\n",
  "marker": "const { optionRows, colorRows } = summary.result({ minVehicles: CATALOG_MIN_VEHICLES, paidPrices: PAID_ONLY });"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-15",
  "find": "        if (optionRows.length) await sconn.query(\"INSERT INTO inv_option_summary (canonical_key, label, vehicle_count) VALUES ?\", [optionRows]);\n",
  "replace": "        if (optionRows.length) await sconn.query(PAID_ONLY ? \"INSERT INTO inv_option_summary (canonical_key, label, vehicle_count, min_price, max_price) VALUES ?\" : \"INSERT INTO inv_option_summary (canonical_key, label, vehicle_count) VALUES ?\", [optionRows]);\n",
  "marker": "if (optionRows.length) await sconn.query(PAID_ONLY ? \"INSERT INTO inv_option_summary (canonical_key, label, vehicle_count, min_price, max_price) VALUES ?\" : \"INSERT INTO inv_option_summary (canonical_key, label, vehicle_count) VALUES ?\", [optionRows]);"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-16",
  "find": "    const [options] = await pool.query(\"SELECT canonical_key, label, vehicle_count FROM inv_option_summary ORDER BY vehicle_count DESC\");\n",
  "replace": "    const [options] = await pool.query(`SELECT canonical_key, label, vehicle_count${PAID_ONLY ? \", min_price, max_price\" : \"\"} FROM inv_option_summary ORDER BY vehicle_count DESC`);\n",
  "marker": "const [options] = await pool.query(`SELECT canonical_key, label, vehicle_count${PAID_ONLY ? \", min_price, max_price\" : \"\"} FROM inv_option_summary ORDER BY vehicle_count DESC`);"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-17",
  "find": "        pool.query(`SET STATEMENT max_statement_time=${statementSeconds()} FOR SELECT canonical_key, MIN(label) AS label, SUM(vehicle_count) AS vehicleCount FROM inv_option_facets ${fWhereSql} GROUP BY canonical_key HAVING SUM(vehicle_count) >= ${CATALOG_MIN_VEHICLES} ORDER BY SUM(vehicle_count) DESC LIMIT 400`, fArgs),\n",
  "replace": "        pool.query(`SET STATEMENT max_statement_time=${statementSeconds()} FOR SELECT canonical_key, MIN(label) AS label, SUM(vehicle_count) AS vehicleCount${PAID_ONLY ? \", MIN(min_price) AS min_price, MAX(max_price) AS max_price\" : \"\"} FROM inv_option_facets ${fWhereSql} GROUP BY canonical_key HAVING SUM(vehicle_count) >= ${CATALOG_MIN_VEHICLES} ORDER BY SUM(vehicle_count) DESC LIMIT 400`, fArgs),\n",
  "marker": "pool.query(`SET STATEMENT max_statement_time=${statementSeconds()} FOR SELECT canonical_key, MIN(label) AS label, SUM(vehicle_count) AS vehicleCount${PAID_ONLY ? \", MIN(min_price) AS min_price, MAX(max_price) AS max_price\" : \"\"} FROM inv_option_facets ${fWhereSql} GROUP BY canonical_key HAVING SUM(vehicle_count) >= ${CATALOG_MIN_VEHICLES} ORDER BY SUM(vehicle_count) DESC LIMIT 400`, fArgs),"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-18",
  "find": "    // pool.query() calls, so it needed the same fix applied to it directly, not inherited.\n    const [optionRows] = await withPoolTimeout(\n",
  "replace": "    // pool.query() calls, so it needed the same fix applied to it directly, not inherited.\n    const livePaid = paidSql(PAID_ONLY);\n    const [optionRows] = await withPoolTimeout(\n",
  "marker": "const livePaid = paidSql(PAID_ONLY);"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-19",
  "find": "        `SET STATEMENT max_statement_time=${statementSeconds()} FOR SELECT STRAIGHT_JOIN o.canonical_key, MIN(o.label) AS label, COUNT(*) AS vehicleCount FROM dealer_inventory i ${makeIndexHint} JOIN dealer_inventory_options o ON o.vin = i.vin AND o.dealer_id = i.dealer_id ${whereSql} GROUP BY o.canonical_key ORDER BY o.canonical_key`,\n",
  "replace": "        `SET STATEMENT max_statement_time=${statementSeconds()} FOR SELECT STRAIGHT_JOIN o.canonical_key, MIN(o.label) AS label, COUNT(*) AS vehicleCount${livePaid.select} FROM dealer_inventory i ${makeIndexHint} JOIN dealer_inventory_options o ON o.vin = i.vin AND o.dealer_id = i.dealer_id ${whereSql}${livePaid.where} GROUP BY o.canonical_key ORDER BY o.canonical_key`,\n",
  "marker": "`SET STATEMENT max_statement_time=${statementSeconds()} FOR SELECT STRAIGHT_JOIN o.canonical_key, MIN(o.label) AS label, COUNT(*) AS vehicleCount${livePaid.select} FROM dealer_inventory i ${makeIndexHint} JOIN dealer_inventory_options o ON o.vin = i.vin AND o.dealer_id = i.dealer_id ${whereSql}${livePaid.where} GROUP BY o.canonical_key ORDER BY o.canonical_key`,"
 },
 {
  "file": "deals_api_server.js",
  "id": "deals_api_server-20",
  "find": "      options: optionRows.map((r) => ({ key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicleCount) })),\n",
  "replace": "      options: optionRows.map((r) => ({ key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicleCount), ...(PAID_ONLY && r.min_price != null && r.max_price != null ? { minPrice: Number(r.min_price), maxPrice: Number(r.max_price) } : {}) })),\n",
  "marker": "options: optionRows.map((r) => ({ key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicleCount), ...(PAID_ONLY && r.min_price != null && r.max_price != null ? { minPrice: Number(r.min_price), maxPrice: Number(r.max_price) } : {}) })),"
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "inventoryOptionRows-1",
  "find": "import { looksLikeOptionSentence } from \"./optionSentenceFilter.js\";\n\n",
  "replace": "import { looksLikeOptionSentence } from \"./optionSentenceFilter.js\";\nimport { positivePrice, maxPrice } from \"./optionsPaidOnlyServer.js\";\n\n",
  "marker": "import { positivePrice, maxPrice } from \"./optionsPaidOnlyServer.js\";"
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "inventoryOptionRows-2",
  "find": "  const junkRules = \"junkRules\" in opts ? opts.junkRules : activeJunkRules;\n  const byKey = new Map();\n",
  "replace": "  const junkRules = \"junkRules\" in opts ? opts.junkRules : activeJunkRules;\n  const withPrice = Boolean(opts.withPrice);\n  const byKey = new Map();\n",
  "marker": "const withPrice = Boolean(opts.withPrice);"
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "inventoryOptionRows-3",
  "find": "      if (!byKey.has(key)) byKey.set(key, { key, label, code });\n",
  "replace": "      // opts.withPrice (OPTIONS_PAID_ONLY on): each row also carries this car's own price for it. A price belongs only to a label that was\n      // listed alone (a joined list can't be attributed), and two lines of one key keep the paid one.\n      if (!byKey.has(key)) byKey.set(key, withPrice ? { key, label, code, price: null } : { key, label, code });\n      if (withPrice && parts.length === 1) { const row = byKey.get(key); row.price = maxPrice(row.price, positivePrice(o.price)); }\n",
  "marker": "// opts.withPrice (OPTIONS_PAID_ONLY on): each row also carries this car's own price for it. A price belongs only to a label that was"
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "inventoryOptionRows-4",
  "find": "    const vehicleCount = Number(r.vehicleCount);\n    if (!(vehicleCount >= CATALOG_MIN_VEHICLES) || !isBuyerFacingOption(r.canonical_key, r.label)) continue;\n",
  "replace": "    const vehicleCount = Number(r.vehicleCount);\n    const minPrice = positivePrice(r.min_price), maxP = positivePrice(r.max_price);\n    if (!(vehicleCount >= CATALOG_MIN_VEHICLES) || !isBuyerFacingOption(r.canonical_key, r.label)) continue;\n",
  "marker": "const minPrice = positivePrice(r.min_price), maxP = positivePrice(r.max_price);"
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "inventoryOptionRows-5",
  "find": "    if (!prev || vehicleCount > prev.vehicleCount) byLabel.set(label.toLowerCase(), { key: r.canonical_key, label, vehicleCount });\n",
  "replace": "    // minPrice/maxPrice exist only when the paid-only rebuild stored them; without them the entry is exactly what it always was.\n    if (!prev || vehicleCount > prev.vehicleCount) byLabel.set(label.toLowerCase(), { key: r.canonical_key, label, vehicleCount, ...(minPrice != null && maxP != null ? { minPrice, maxPrice: maxP } : {}) });\n",
  "marker": "if (!prev || vehicleCount > prev.vehicleCount) byLabel.set(label.toLowerCase(), { key: r.canonical_key, label, vehicleCount, ...(minPrice != null && maxP != null ? { minPrice, maxPrice: maxP } : {}) });"
 },
 {
  "file": "factoryOptionAllowlist.js",
  "id": "factoryOptionAllowlist-1",
  "find": "import { fileURLToPath } from \"node:url\";\nimport { normalizeOptionKey, optionRowsFromOptions, compileJunkRules, setJunkRules } from \"./inventoryOptionRows.js\";\n",
  "replace": "import { fileURLToPath } from \"node:url\";\nimport { positivePrice } from \"./optionsPaidOnlyServer.js\";\nimport { normalizeOptionKey, optionRowsFromOptions, compileJunkRules, setJunkRules } from \"./inventoryOptionRows.js\";\n",
  "marker": "import { positivePrice } from \"./optionsPaidOnlyServer.js\";"
 },
 {
  "file": "factoryOptionAllowlist.js",
  "id": "factoryOptionAllowlist-2",
  "find": "export function policyFacetRows(allowlist, vehicle, options) {\n",
  "replace": "export function policyFacetRows(allowlist, vehicle, options, { withPrice = false } = {}) {\n",
  "marker": "export function policyFacetRows(allowlist, vehicle, options, { withPrice = false } = {}) {"
 },
 {
  "file": "factoryOptionAllowlist.js",
  "id": "factoryOptionAllowlist-3",
  "find": "  return { rows: res.rows.map((r) => ({ key: r.key, label: r.label, code: r.code ?? null })), junkDropped: res.junkDropped };\n",
  "replace": "  return { rows: res.rows.map((r) => (withPrice ? { key: r.key, label: r.label, code: r.code ?? null, price: positivePrice(r.price) } : { key: r.key, label: r.label, code: r.code ?? null })), junkDropped: res.junkDropped };\n",
  "marker": "return { rows: res.rows.map((r) => (withPrice ? { key: r.key, label: r.label, code: r.code ?? null, price: positivePrice(r.price) } : { key: r.key, label: r.label, code: r.code ?? null })), junkDropped: res.junkDropped };"
 },
 {
  "file": "inventoryOptionsDiff.js",
  "id": "inventoryOptionsDiff-1",
  "find": "    list.push({ key: r.canonical_key, label: r.label, code: r.code ?? null });\n",
  "replace": "    list.push(\"price\" in r ? { key: r.canonical_key, label: r.label, code: r.code ?? null, price: r.price ?? null } : { key: r.canonical_key, label: r.label, code: r.code ?? null });\n",
  "marker": "list.push(\"price\" in r ? { key: r.canonical_key, label: r.label, code: r.code ?? null, price: r.price ?? null } : { key: r.canonical_key, label: r.label, code: r.code ?? null });"
 },
 {
  "file": "inventoryOptionsDiff.js",
  "id": "inventoryOptionsDiff-2",
  "find": "export function optionSetsEqual(existing, desired) {\n",
  "replace": "export function optionSetsEqual(existing, desired, { comparePrice = false } = {}) {\n",
  "marker": "export function optionSetsEqual(existing, desired, { comparePrice = false } = {}) {"
 },
 {
  "file": "inventoryOptionsDiff.js",
  "id": "inventoryOptionsDiff-3",
  "find": "    if (!e || !sameText(e.label, d.label) || !sameText(e.code, d.code)) return false;\n  }\n",
  "replace": "    if (!e || !sameText(e.label, d.label) || !sameText(e.code, d.code)) return false;\n    // OPTIONS_PAID_ONLY on: a changed or newly-known price is a change, so the rewrite stores it. Off: prices are never compared.\n    if (comparePrice && !sameText(e.price, d.price)) return false;\n  }\n",
  "marker": "// OPTIONS_PAID_ONLY on: a changed or newly-known price is a change, so the rewrite stores it. Off: prices are never compared."
 },
 {
  "file": "inventoryOptionsDiff.js",
  "id": "inventoryOptionsDiff-4",
  "find": "export function diffOptionSets(desired, existing) {\n",
  "replace": "export function diffOptionSets(desired, existing, opts = {}) {\n",
  "marker": "export function diffOptionSets(desired, existing, opts = {}) {"
 },
 {
  "file": "inventoryOptionsDiff.js",
  "id": "inventoryOptionsDiff-5",
  "find": "    if (optionSetsEqual(existing.get(d.pair) || [], d.rows)) unchanged++;\n",
  "replace": "    if (optionSetsEqual(existing.get(d.pair) || [], d.rows, opts)) unchanged++;\n",
  "marker": "if (optionSetsEqual(existing.get(d.pair) || [], d.rows, opts)) unchanged++;"
 },
 {
  "file": "catalogSummary.js",
  "id": "catalogSummary-1",
  "find": "        if (!cur) options.set(key, { key: r.canonical_key, label: r.label, count: n });\n",
  "replace": "        const lo = r.min_price == null ? null : Number(r.min_price), hi = r.max_price == null ? null : Number(r.max_price);\n        if (!cur) options.set(key, { key: r.canonical_key, label: r.label, count: n, lo, hi });\n",
  "marker": "const lo = r.min_price == null ? null : Number(r.min_price), hi = r.max_price == null ? null : Number(r.max_price);"
 },
 {
  "file": "catalogSummary.js",
  "id": "catalogSummary-2",
  "find": "          cur.count += n;\n          if (String(r.label).toLowerCase() < String(cur.label).toLowerCase()) cur.label = r.label;\n",
  "replace": "          cur.count += n;\n          if (lo != null) cur.lo = cur.lo == null ? lo : Math.min(cur.lo, lo);\n          if (hi != null) cur.hi = cur.hi == null ? hi : Math.max(cur.hi, hi);\n          if (String(r.label).toLowerCase() < String(cur.label).toLowerCase()) cur.label = r.label;\n",
  "marker": "if (lo != null) cur.lo = cur.lo == null ? lo : Math.min(cur.lo, lo);"
 },
 {
  "file": "catalogSummary.js",
  "id": "catalogSummary-3",
  "find": "    result({ minVehicles, limit = SUMMARY_OPTION_LIMIT }) {\n",
  "replace": "    result({ minVehicles, limit = SUMMARY_OPTION_LIMIT, paidPrices = false }) {\n",
  "marker": "result({ minVehicles, limit = SUMMARY_OPTION_LIMIT, paidPrices = false }) {"
 },
 {
  "file": "catalogSummary.js",
  "id": "catalogSummary-4",
  "find": "        .map(([, v]) => [v.key, v.label, v.count]);\n",
  "replace": "        .map(([, v]) => (paidPrices ? [v.key, v.label, v.count, v.lo, v.hi] : [v.key, v.label, v.count]));\n",
  "marker": ".map(([, v]) => (paidPrices ? [v.key, v.label, v.count, v.lo, v.hi] : [v.key, v.label, v.count]));"
 },
 {
  "file": "catalogSummary.js",
  "id": "catalogSummary-5",
  "find": "    optionRows: options.map((r) => ({ canonical_key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicle_count) })),\n",
  "replace": "    optionRows: options.map((r) => ({ canonical_key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicle_count), ...(\"min_price\" in r ? { min_price: r.min_price, max_price: r.max_price } : {}) })),\n",
  "marker": "optionRows: options.map((r) => ({ canonical_key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicle_count), ...(\"min_price\" in r ? { min_price: r.min_price, max_price: r.max_price } : {}) })),"
 },
 {
  "file": "syncOptionClean.js",
  "id": "syncOptionClean-1",
  "find": "    extra.push({ key: s.key, label: s.label, code: s.code ?? null });\n",
  "replace": "    extra.push(s.price != null ? { key: s.key, label: s.label, code: s.code ?? null, price: s.price } : { key: s.key, label: s.label, code: s.code ?? null });\n",
  "marker": "extra.push(s.price != null ? { key: s.key, label: s.label, code: s.code ?? null, price: s.price } : { key: s.key, label: s.label, code: s.code ?? null });"
 }
]
;
for (const e of EDITS) if (e.find.includes(e.marker) || !e.replace.includes(e.marker)) throw new Error(`edit ${e.id}: marker must be in the replacement and not in the anchor`);

const NEW_MODULE = "optionsPaidOnlyServer.js";
const MODULE_TEXT = "// Server side of the paid-only factory-options filter (flag OPTIONS_PAID_ONLY, default OFF; the web app reads the same name in lib/optionsPaidOnly.ts).\n//\n// ON:  dealer_inventory_options carries each car's own stored price per option row (`price`, INT NULL). The facet rebuild counts a row only\n//      where THAT row's price is above 0 \u2014 decided per row, never per label, because ~300 labels are paid on some cars and $0 on others \u2014 and\n//      records the min/max of those paid prices so the filter can show \"+$1,225\" or \"+$800\u2013$1,400\" next to the option.\n//      A row with a NULL price (not backfilled yet) is not paid, so it is not counted.\n// OFF: nothing here is used. No column is added, no price is written, and every query is byte-for-byte what it was.\n//\n// Pure: no database, no env reads except through the argument, so it is unit-testable (deals_api_server.js starts a server at import time).\n\nconst ON = /^(1|true|yes|on)$/i;\n\nexport function paidOnlyEnabled(env = process.env) {\n  const raw = env.OPTIONS_PAID_ONLY;\n  return raw != null && ON.test(String(raw).trim());\n}\n\n/** A line's price as a positive whole-dollar integer, or null when it is 0, missing or not a number (\"$1,225\" strings are read). */\nexport function positivePrice(v) {\n  let n = v;\n  if (typeof n === \"string\") {\n    const s = n.replace(/[$,\\s]/g, \"\");\n    n = /^\\d+(\\.\\d+)?$/.test(s) ? Number(s) : NaN;\n  }\n  if (typeof n !== \"number\" || !Number.isFinite(n) || n <= 0) return null;\n  const r = Math.round(n);\n  return r > 0 && r <= 2_000_000_000 ? r : null;\n}\n\n/** Larger of two prices where either may be null. Two lines of one key on one car collapse to one row; the paid one wins. */\nexport const maxPrice = (a, b) => (a == null ? b ?? null : b == null ? a : Math.max(a, b));\n\n/** SQL fragments for the facet rebuild / live catalog query. All empty when the flag is off. */\nexport function paidSql(enabled, alias = \"o\") {\n  return enabled\n    ? { where: ` AND ${alias}.price > 0`, select: `, MIN(${alias}.price) AS min_price, MAX(${alias}.price) AS max_price` }\n    : { where: \"\", select: \"\" };\n}\n\n/** Per-row test the SQL `price > 0` applies, for the unit tests and the backfill's dry-run counts. */\nexport const isPaidRow = (row) => positivePrice(row && row.price) != null;\n\n/** Counts rows per canonical key under the paid-only rule: [{ key, label, n, minPrice, maxPrice }]. Mirrors the rebuild's GROUP BY. */\nexport function paidFacetCounts(cars) {\n  const byKey = new Map();\n  for (const rows of cars) {\n    for (const r of rows) {\n      const p = positivePrice(r.price);\n      if (p == null) continue;\n      const cur = byKey.get(r.key) || { key: r.key, label: r.label, n: 0, minPrice: p, maxPrice: p };\n      cur.n++;\n      cur.minPrice = Math.min(cur.minPrice, p);\n      cur.maxPrice = Math.max(cur.maxPrice, p);\n      byKey.set(r.key, cur);\n    }\n  }\n  return [...byKey.values()];\n}\n";

// ---- prerequisites on the box ----
for (const f of [...new Set(EDITS.map((e) => e.file))]) if (!fs.existsSync(path.join(DIR, f))) { console.error(`ABORT: ${path.join(DIR, f)} is missing - is --dir the box's src directory? Nothing written.`); process.exit(2); }
if (!fs.existsSync(path.join(DIR, "syncOptionClean.js"))) { console.error("ABORT: syncOptionClean.js is missing - apply 2026-10-19-sync-option-clean.mjs first. Nothing written."); process.exit(2); }

const files = [...new Set(EDITS.map((e) => e.file))];
const plan = [];
let abort = false;
for (const f of files) {
  const p = path.join(DIR, f);
  const original = fs.readFileSync(p, "utf8");
  let text = original;
  for (const e of EDITS.filter((x) => x.file === f)) {
    const nFind = count(text, e.find), nMark = count(text, e.marker);
    let status;
    if (nMark >= 1) status = nMark === 1 ? "already applied" : `MARKER PROBLEM: marker occurs ${nMark}x`;
    else if (nFind === 1) { text = text.replace(e.find, () => e.replace); status = "will apply"; }
    else status = `ANCHOR PROBLEM: find occurs ${nFind}x, marker ${nMark}x`;
    if (/PROBLEM/.test(status)) abort = true;
    console.log(`${f} :: ${e.id} :: ${status}`);
  }
  plan.push({ f, p, original, text });
}
if (abort) { console.error("ABORT: nothing written. (The box's file differs from the repo's at that anchor: send me the lines around it.)"); process.exit(2); }

// Stage the patched modules in a temp dir and exercise them.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "paidonly-stage-"));
const verify = async () => {
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ type: "module" }));
  for (const f of fs.readdirSync(DIR)) if (/\.(js|json)$/.test(f) && f !== "package.json") fs.copyFileSync(path.join(DIR, f), path.join(stage, f));
  if (fs.existsSync(path.join(DIR, "optionPolicies"))) { fs.mkdirSync(path.join(stage, "optionPolicies")); for (const f of fs.readdirSync(path.join(DIR, "optionPolicies"))) if (f.endsWith(".json")) fs.copyFileSync(path.join(DIR, "optionPolicies", f), path.join(stage, "optionPolicies", f)); }
  for (const x of plan) fs.writeFileSync(path.join(stage, x.f), x.text);
  fs.writeFileSync(path.join(stage, NEW_MODULE), MODULE_TEXT);
  execFileSync(process.execPath, ["--check", path.join(stage, "deals_api_server.js")], { stdio: "pipe" });
  const imp = (f) => import(pathToFileURL(path.join(stage, f)).href);
  const ps = await imp(NEW_MODULE), rows = await imp("inventoryOptionRows.js"), diff = await imp("inventoryOptionsDiff.js"), summ = await imp("catalogSummary.js");
  const server = plan.find((x) => x.f === "deals_api_server.js").text;

  // 1. the flag defaults to OFF
  if (ps.paidOnlyEnabled({}) !== false) throw new Error("paidOnlyEnabled({}) is not false");
  for (const v of ["", "0", "off", "false"]) if (ps.paidOnlyEnabled({ OPTIONS_PAID_ONLY: v })) throw new Error(`flag read as ON for "${v}"`);
  if (!/const PAID_ONLY = paidOnlyEnabled\(\);/.test(server)) throw new Error("deals_api_server.js does not read the flag through paidOnlyEnabled()");
  if (/OPTIONS_PAID_ONLY\s*[=:]\s*["']?(1|true|on)/i.test(server)) throw new Error("the patched server hard-codes the flag on");
  if (process.env.OPTIONS_PAID_ONLY) console.log(`NOTE: OPTIONS_PAID_ONLY=${process.env.OPTIONS_PAID_ONLY} is set in THIS shell; the server reads its own pm2 environment, not this one.`);
  // 2. flag-off output is what it always was
  const opts = [{ name: "Panoramic Roof", price: 1500 }, { name: "Floor Mats", price: 0 }];
  const off = rows.optionRowsFromOptions(opts, { junkRules: null }).rows;
  if (off.some((r) => "price" in r)) throw new Error("flag-off option rows carry a price key");
  if (ps.paidSql(false).where !== "" || ps.paidSql(false).select !== "") throw new Error("flag-off SQL fragments are not empty");
  const cat = rows.buyerOptionCatalog([{ canonical_key: "panoramic roof", label: "Panoramic Roof", vehicleCount: 50 }]);
  if (Object.keys(cat[0]).sort().join() !== "key,label,vehicleCount") throw new Error("flag-off catalog entry changed shape");
  const ex = diff.groupExistingOptionRows([{ vin: "V", dealer_id: 1, canonical_key: "a", label: "A", code: null }]);
  if (diff.diffOptionSets([{ pair: "V|1", rows: [{ key: "a", label: "A", code: null, price: 5 }] }], ex).changed.length) throw new Error("price compared with the flag off");
  const acc = summ.createSummaryAccumulator(); acc.addOptions([{ canonical_key: "a", label: "A", n: 30 }]);
  if (acc.result({ minVehicles: 25 }).optionRows[0].length !== 3) throw new Error("flag-off summary rows changed shape");
  // 3. flag-on rule, per row
  const on = rows.optionRowsFromOptions(opts, { withPrice: true, junkRules: null }).rows;
  const roof = on.find((r) => r.key === "panoramic roof"), mats = on.find((r) => r.key === "floor mats");
  if (roof.price !== 1500 || mats.price !== null) throw new Error("flag-on rows: paid/$0 prices wrong");
  const counts = ps.paidFacetCounts([[{ key: "k", label: "K", price: 900 }], [{ key: "k", label: "K", price: 0 }], [{ key: "k", label: "K", price: 1500 }]]);
  if (counts.length !== 1 || counts[0].n !== 2 || counts[0].minPrice !== 900 || counts[0].maxPrice !== 1500) throw new Error("flag-on per-row count wrong");
  console.log("staged modules load; flag defaults OFF and flag-off output is unchanged; flag-on counts a row only where its own price is above 0");
};
try { await verify(); } catch (err) { console.error(`ABORT (nothing written to ${DIR}): ${err.message}`); fs.rmSync(stage, { recursive: true, force: true }); process.exit(3); }
fs.rmSync(stage, { recursive: true, force: true });
if (!APPLY) { console.log("DRY RUN ok - nothing written. Re-run with --apply."); process.exit(0); }

const staged = [];
try {
  for (const x of plan) {
    if (x.text === x.original) { console.log(`${x.f}: nothing to change`); continue; }
    const newPath = path.join(DIR, x.f.replace(/\.js$/, ".new.mjs"));
    staged.push({ ...x, newPath });
    fs.writeFileSync(newPath, x.text);
    execFileSync(process.execPath, ["--check", newPath], { stdio: "pipe" });
  }
} catch (err) {
  for (const x of staged) fs.rmSync(x.newPath, { force: true });
  console.error(`ABORT (originals untouched, temp files removed): ${err.message}`);
  process.exit(3);
}
for (const x of staged) {
  const bak = `${x.p}.bak.${STAMP}`;
  fs.copyFileSync(x.p, bak); fs.chmodSync(bak, fs.statSync(x.p).mode);
  fs.chmodSync(x.newPath, fs.statSync(x.p).mode);
  fs.renameSync(x.newPath, x.p);
  console.log(`${x.f}: backup ${bak}; patched file in place. Rollback: cp -p ${bak} ${x.p}`);
}
const mp = path.join(DIR, NEW_MODULE);
if (fs.existsSync(mp) && fs.readFileSync(mp, "utf8") === MODULE_TEXT) console.log(`${NEW_MODULE}: already installed, unchanged.`);
else {
  if (fs.existsSync(mp)) { fs.copyFileSync(mp, `${mp}.bak.${STAMP}`); console.log(`${NEW_MODULE}: existing file backed up to ${mp}.bak.${STAMP}`); }
  fs.writeFileSync(mp + ".new", MODULE_TEXT); fs.chmodSync(mp + ".new", 0o664); fs.renameSync(mp + ".new", mp);
  console.log(`${NEW_MODULE}: installed (${mp}). Rollback: rm it, or restore the .bak.`);
}
console.log(`DONE (backup stamp ${STAMP}). deals-api has NOT been restarted and OPTIONS_PAID_ONLY was not set; the new code loads at the next restart with the flag still off.`);
