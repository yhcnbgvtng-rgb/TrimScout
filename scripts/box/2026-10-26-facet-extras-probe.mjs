// READ-ONLY probe for the catalog facet extras (FACET_COND_PRICE): times the new per-make aggregate against the colour aggregate the rebuild already runs,
// on a sample of makes, and projects what turning the flag on would add to a full facet rebuild. Reader account only; SELECTs only; nothing is written.
// NOT RUN YET. Run it on box2 in an idle window (no crawl, no sync, nothing long-running on the table), from /opt/trimscout-deals (needs src/facetExtras.js,
// i.e. after 2026-10-26-facet-extras.mjs --apply, and .env.trimscout-db):
//   node 2026-10-26-facet-extras-probe.mjs [--make=Toyota,Ford] [--sample=8] [--explain]
// Output: per make the row count, ms for the colour aggregate (the baseline), ms for the new aggregate, and at the end the projected extra time for ALL makes
// (scaled by row counts) as a share of the last full build (inv_facet_meta.duration_ms). The go/no-go line is 8% (the budget in the code is 10%).
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const SAMPLE = Math.min(Math.max(Number(args.sample) || 8, 2), 40);
const GO_PCT = 8;

const { extraAggSql } = await import(path.resolve(process.cwd(), "src", "facetExtras.js"));
function loadDbEnv() {
  const raw = fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(t.slice(0, eq).trim() in process.env)) process.env[t.slice(0, eq).trim()] = value;
  }
}
loadDbEnv();
const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, database: process.env.DB_NAME, user: process.env.DB_READER_USER, password: process.env.DB_READER_PASSWORD, connectionLimit: 1 });

// The same filters the rebuild uses (RETAIL_ONLY_FACETS on unless "0"; STALE_HIDE_DAYS from the same env as deals-api).
const RETAIL = process.env.RETAIL_ONLY_FACETS !== "0";
const STALE = Number(process.env.STALE_HIDE_DAYS) || 0;
if (!process.env.STALE_HIDE_DAYS) console.log("NOTE: STALE_HIDE_DAYS is not set in this shell; the probe runs without the staleness filter. Copy deals-api's value for a like-for-like timing.");
const COLOR_SQL = `SELECT COALESCE(model, '') AS model, COALESCE(trim, '') AS trim, COALESCE(exterior_color, '') AS ext, COALESCE(interior_color, '') AS intr, COUNT(*) AS n
  FROM dealer_inventory FORCE INDEX (idx_inv_stock_make_model_trim)
  WHERE removed_at IS NULL AND make = ? AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL)${RETAIL ? " AND (cond IS NULL OR cond <> 'wholesale')" : ""}${STALE ? ` AND last_seen_at >= DATE_SUB(NOW(), INTERVAL ${STALE} DAY)` : ""}
  GROUP BY COALESCE(model, ''), COALESCE(trim, ''), COALESCE(exterior_color, ''), COALESCE(interior_color, '')`;
const EXTRA_SQL = extraAggSql({ retailOnly: RETAIL, staleDays: STALE });
const timed = async (sql, make) => { const t = Date.now(); const [rows] = await pool.query(`SET STATEMENT max_statement_time=60 FOR ${sql}`, [make]); return { ms: Date.now() - t, rows: rows.length }; };

try {
  const [counts] = await pool.query("SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC");
  const [[meta]] = await pool.query("SELECT duration_ms FROM inv_facet_meta WHERE id = 1");
  const total = counts.reduce((a, r) => a + Number(r.n), 0);
  let chosen = typeof args.make === "string" ? counts.filter((r) => args.make.split(",").includes(r.make)) : [...counts.slice(0, Math.ceil(SAMPLE / 2)), ...counts.slice(Math.ceil(SAMPLE / 2)).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / Math.floor(SAMPLE / 2))) === 0).slice(0, Math.floor(SAMPLE / 2))];
  if (!chosen.length) throw new Error("no makes matched");
  if (args.explain) {
    const [plan] = await pool.query(`EXPLAIN ${EXTRA_SQL}`, [chosen[0].make]);
    console.log(`EXPLAIN (${chosen[0].make}):`); console.table(plan.map((p) => ({ table: p.table, type: p.type, key: p.key, rows: p.rows, Extra: p.Extra })));
  }
  let sumRows = 0, sumColor = 0, sumExtra = 0;
  console.log("make".padEnd(16), "rows".padStart(8), "colour ms".padStart(10), "extra ms".padStart(9), "extra/colour".padStart(13));
  for (const r of chosen) {
    const c = await timed(COLOR_SQL, r.make), e = await timed(EXTRA_SQL, r.make);
    sumRows += Number(r.n); sumColor += c.ms; sumExtra += e.ms;
    console.log(String(r.make).padEnd(16), String(r.n).padStart(8), String(c.ms).padStart(10), String(e.ms).padStart(9), (e.ms / Math.max(1, c.ms)).toFixed(2).padStart(13), `   (${e.rows} result rows)`);
  }
  const projectedMs = (sumExtra / sumRows) * total;
  const pct = meta ? (100 * projectedMs) / Number(meta.duration_ms) : null;
  console.log(`\nsample: ${chosen.length} makes, ${sumRows} of ${total} in-stock rows. extra ${sumExtra} ms vs colour ${sumColor} ms.`);
  console.log(`projected extra for all makes: ${(projectedMs / 1000).toFixed(1)} s${meta ? `; last full build ${(Number(meta.duration_ms) / 1000).toFixed(0)} s => +${pct.toFixed(1)}%` : " (no last-build time on record)"}.`);
  console.log(pct == null ? "NO VERDICT (no inv_facet_meta row)" : pct <= GO_PCT ? `GO: projected +${pct.toFixed(1)}% is within ${GO_PCT}% (the rebuild also self-limits at FACET_EXTRA_BUDGET_PCT, max 10).` : `NO-GO: projected +${pct.toFixed(1)}% is over ${GO_PCT}%. Leave FACET_COND_PRICE off, or set FACET_EXTRA_BUDGET_PCT lower so the rebuild skips makes instead.`);
} finally { await pool.end(); }
