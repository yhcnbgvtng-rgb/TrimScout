#!/usr/bin/env bash
# Buyer search speed (Part A): concurrency gate, capped COUNT, short-page total, options catalog hygiene.
#
# Why (measured live 2026-09-30/10-01 on box2): bare buyer searches 503 at the 20s max_statement_time
# and four concurrent ones left three timeouts — slow queries hold a pool connection and the box's
# I/O while the rest queue behind them. F-150's factory-options catalog was 95,895 (model,trim,key)
# rows of which only 4,111 had 20+ vehicles — long-tail dealer free text, not a shopper's checklist.
#
# What this deploys (NOT a raised timeout — INV_LIST_STATEMENT_TIMEOUT_SECONDS stays 20):
#   - searchGate.js (new): at most INV_SEARCH_MAX_CONCURRENT (default 6) list queries run at once; a
#     caller that can't get a slot in INV_SEARCH_QUEUE_WAIT_MS (default 3000) gets a fast 503 +
#     Retry-After instead of queueing behind slow queries.
#   - inventoryListQuery.js: countCap -> COUNT over a LIMIT cap+1 derived table (stops early), plus
#     totalFromPage/applyCountCap helpers. Admin calls (no countCap) are byte-for-byte unchanged.
#   - inventoryListQuery.js also: deferredPageSql (buyer page = covering-index ids, then 24 whole rows),
#     sort=trim / sort=model index-order defaults, and index hints for make+model+state and make+state.
#   - handleListInventory: page first; COUNT only when the page can't prove the total; whole thing
#     holds one gate slot; response gains totalCapped when the total is a floor.
#   - inventoryOptionRows.js: buyerOptionCatalog (min 25 vehicles, <=60 options, junk/listing-code
#     keys dropped, labels cleaned) behind GET /api/inventory/catalog's facet path.
#
# Files are patched by EXACT anchored replacement (each must match once) because this box's
# deals_api_server.js drifts from the repo mirror — never replaced whole. The three small pure
# modules ARE replaced whole (they were identical to the repo's on 2026-10-01).
#
# Run on the deals box (ubuntu@52.202.234.65 — box2):
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && for f in searchGate.js inventoryListQuery.js inventoryOptionRows.js; do curl -fsSL -o $f "$B/scrapers/lightsail-crawler/src/$f?cb=$(date +%s)"; done && curl -fsSL -o 2026-10-01-buyer-search-gates.sh "$B/scripts/box/2026-10-01-buyer-search-gates.sh?cb=$(date +%s)" && grep -c countCap inventoryListQuery.js && sudo cp searchGate.js inventoryListQuery.js inventoryOptionRows.js 2026-10-01-buyer-search-gates.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-10-01-buyer-search-gates.sh
# Idempotent. Backup, anchored replace with asserts, node --check, pm2 restart, health check.
set -euo pipefail
DIR=/opt/trimscout-deals/src
FILE="$DIR/deals_api_server.js"

for f in searchGate.js inventoryListQuery.js inventoryOptionRows.js; do
  [ -f "$DIR/$f" ] || { echo "ERROR: $DIR/$f missing — fetch it first (see usage line)." >&2; exit 1; }
  node --check "$DIR/$f" && echo "syntax ok: $f"
done
grep -q "countCap" "$DIR/inventoryListQuery.js" || { echo "ERROR: stale inventoryListQuery.js (no countCap) — re-fetch with cache-busting." >&2; exit 1; }
grep -q "buyerOptionCatalog" "$DIR/inventoryOptionRows.js" || { echo "ERROR: stale inventoryOptionRows.js (no buyerOptionCatalog) — re-fetch with cache-busting." >&2; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if "invSearchGate" in s:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); print("patched:", label)

rep(r'''import path from "node:path";
import mysql from "mysql2/promise";
import { inventoryListQuery } from "./inventoryListQuery.js";
import { optionRowsFromOptions, payloadHasOptions } from "./inventoryOptionRows.js";
''', r'''import path from "node:path";
import mysql from "mysql2/promise";
import { inventoryListQuery, totalFromPage, applyCountCap, deferredPageSql } from "./inventoryListQuery.js";
import { createGate, SearchBusyError } from "./searchGate.js";
import { optionRowsFromOptions, payloadHasOptions, buyerOptionCatalog, CATALOG_MIN_VEHICLES } from "./inventoryOptionRows.js";
''', 'imports')
rep(r'''const INV_LIST_STATEMENT_TIMEOUT_SECONDS = 20;

async function handleListInventory(req, res, params) {
  const pool = getPool();
''', r'''const INV_LIST_STATEMENT_TIMEOUT_SECONDS = 20;

// At most this many list queries run at once; a caller that can't get a slot within the wait is
// refused with a 503 instead of queueing behind slow queries (see searchGate.js). Env-tunable so
// the cap can be adjusted on the box without a code change.
const invSearchGate = createGate({
  max: Number(process.env.INV_SEARCH_MAX_CONCURRENT) || 6,
  waitMs: Number(process.env.INV_SEARCH_QUEUE_WAIT_MS) || 3000,
});

async function handleListInventory(req, res, params) {
  const pool = getPool();
''', 'gate + handleListInventory head')
rep(r'''  const pool = getPool();
  await ensureInventoryTable(pool);
  const { sql, countSql, args, orderBy } = inventoryListQuery(params);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
''', r'''  const pool = getPool();
  await ensureInventoryTable(pool);
  const { sql, countSql, countCap, cappedCountSql, args, orderBy } = inventoryListQuery(params);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
''', 'page-then-capped-count body')
rep(r'''  // only bounds a query once it's actually executing; this bounds "waiting for a free pool
  // connection" too, which that statement-level cap can't see at all.
  const [rows] = await withPoolTimeout(
    pool.query(
      `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    ),
    POOL_WAIT_TIMEOUT_MS,
    "Timed out waiting for an available database connection or a slow query"
  );
  const [[{ total }]] = await withPoolTimeout(
    pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT COUNT(*) AS total ${countSql}`, args),
    POOL_WAIT_TIMEOUT_MS,
    "Timed out waiting for an available database connection or a slow query"
  );
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}

''', r'''  // only bounds a query once it's actually executing; this bounds "waiting for a free pool
  // connection" too, which that statement-level cap can't see at all.
  // The page goes first, and the COUNT only runs when the page can't already prove the total
  // (totalFromPage) — a short page IS the total. With countCap (buyer search) the count also stops
  // early instead of visiting every matching row (see inventoryListQuery.js). The whole thing holds
  // one concurrency slot, so a burst of searches queues briefly or is told to retry rather than
  // all hitting MariaDB at once.
  const result = await invSearchGate.run(async () => {
    const [rows] = await withPoolTimeout(
      pool.query(
        `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR ${countCap
          // Buyer search (countCap set): deferred join — page ids off the covering index first.
          ? deferredPageSql({ countSql, orderBy })
          : `SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`}`,
        [...args, limit, offset]
      ),
      POOL_WAIT_TIMEOUT_MS,
      "Timed out waiting for an available database connection or a slow query"
    );
    const known = totalFromPage(offset, limit, rows.length);
    if (known !== null) return { rows, total: known, totalCapped: false };
    const [[{ total }]] = await withPoolTimeout(
      pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR ${cappedCountSql || `SELECT COUNT(*) AS total ${countSql}`}`, args),
      POOL_WAIT_TIMEOUT_MS,
      "Timed out waiting for an available database connection or a slow query"
    );
    return { rows, ...applyCountCap(total, countCap) };
  });
  const body = { total: result.total, limit, offset, vehicles: result.rows.map(inventoryRowFromDb) };
  if (result.totalCapped) body.totalCapped = true;
  sendJson(res, 200, body);
}

''', 'SearchBusyError -> 503 mapping')
rep(r'''    sendJson(res, 200, await invCached(`catalog-facets:${make}|${model}|${trim}`, async () => {
      const [optionRows] = await withPoolTimeout(
        pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT canonical_key, MIN(label) AS label, SUM(vehicle_count) AS vehicleCount FROM inv_option_facets ${fWhereSql} GROUP BY canonical_key ORDER BY canonical_key`, fArgs),
        POOL_WAIT_TIMEOUT_MS,
        "Timed out waiting for an available database connection or a slow query"
''', r'''    sendJson(res, 200, await invCached(`catalog-facets:${make}|${model}|${trim}`, async () => {
      const [optionRows] = await withPoolTimeout(
        pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT canonical_key, MIN(label) AS label, SUM(vehicle_count) AS vehicleCount FROM inv_option_facets ${fWhereSql} GROUP BY canonical_key HAVING SUM(vehicle_count) >= ${CATALOG_MIN_VEHICLES} ORDER BY SUM(vehicle_count) DESC LIMIT 400`, fArgs),
        POOL_WAIT_TIMEOUT_MS,
        "Timed out waiting for an available database connection or a slow query"
''', 'options import')
rep(r'''      );
      return {
        options: optionRows.map((r) => ({ key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicleCount) })),
        exteriorColors: [...new Set(colorRows.map((r) => r.exterior_color).filter(Boolean))].sort(),
        interiorColors: [...new Set(colorRows.map((r) => r.interior_color).filter(Boolean))].sort(),
''', r'''      );
      return {
        // Cleaned and capped for the buyer's checklist — see buyerOptionCatalog.
        options: buyerOptionCatalog(optionRows),
        exteriorColors: [...new Set(colorRows.map((r) => r.exterior_color).filter(Boolean))].sort(),
        interiorColors: [...new Set(colorRows.map((r) => r.interior_color).filter(Boolean))].sort(),
''', 'catalog facet query HAVING/LIMIT')
rep(r'''      // 500 every other uncaught exception here gets, so the caller (lib/inventoryApi.ts) can
      // tell "this box is overloaded, try again" apart from an actual bug.
      if (err instanceof PoolTimeoutError) {
        console.error(`${new Date().toISOString()} ${pathname} -> 503 (pool timeout):`, err.message);
''', r'''      // 500 every other uncaught exception here gets, so the caller (lib/inventoryApi.ts) can
      // tell "this box is overloaded, try again" apart from an actual bug.
      if (err instanceof SearchBusyError) {
        console.error(`${new Date().toISOString()} ${pathname} -> 503 (search gate full):`, JSON.stringify(invSearchGate.stats()));
        res.setHeader("Retry-After", "2");
        return sendJson(res, 503, { error: err.message });
      }
      if (err instanceof PoolTimeoutError) {
        console.error(`${new Date().toISOString()} ${pathname} -> 503 (pool timeout):`, err.message);
''', 'catalog options cleanup')
open(p, "w").write(s)
PY

node --check "$FILE" && echo "syntax ok: deals_api_server.js"
# The deals API runs as "deals-api" under the ubuntu user's pm2 (not root's) — plain restart keeps its
# stored env (e.g. DISABLE_FACET_REBUILD), which --update-env would overwrite from this shell.
sudo -u ubuntu pm2 restart deals-api >/dev/null && sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Rollback: sudo cp $FILE.bak.$STAMP $FILE && sudo -u ubuntu pm2 restart deals-api"
