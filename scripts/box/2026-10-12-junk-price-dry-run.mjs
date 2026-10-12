// READ-ONLY dry run: lists the in-stock dealer_inventory rows whose price the crawler's parser guard (priceGuard.js) would reject -
// price over 5x the car's previous price or its MSRP, or over the make's absolute ceiling. Writes nothing to any database, takes no
// sync lock, restarts nothing. The CLEANUP of these rows is a separate, later step that needs Paul's GO in an idle window.
//
//   node 2026-10-12-junk-price-dry-run.mjs --env /opt/trimscout-deals/.env.trimscout-db [--out ./out] [--min-price 75000] [--limit 20000]
//
// Limits: READER account only, the session is READ ONLY, every query has a 20 s server-side cap (SET STATEMENT max_statement_time=20), and
// the one candidate query is an index range scan on idx_inv_stock_price (removed_at, price). A timeout stops the run; nothing is retried.
// Pre-filter: price > --min-price (default 75,000: 5x the smallest usable MSRP of 15,000, so the 5x-MSRP rule cannot hit anything lower)
// and (price > 150,000, or price > 5x msrp, or price > 5x old_price). The exact decision is made by the guard itself, not by the SQL.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { classifyRows, namedCaseReport, renderReport } from "../lib/junkPriceReport.mjs";
import { pointsAtDeadIp } from "../../config/boxes.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const envFile = opt("env", "/opt/trimscout-deals/.env.trimscout-db");
const outDir = path.resolve(opt("out", "./out"));
const MIN_PRICE = Math.max(25_000, Number(opt("min-price", 75_000)) || 75_000);
const LIMIT = Math.min(100_000, Math.max(100, Number(opt("limit", 20_000)) || 20_000));
const CAP_SECONDS = 20;

const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (pointsAtDeadIp(env.DB_HOST, process.env.TRIMSCOUT_DEALS_HOST)) { console.error("Refusing to run: points at a retired box IP (docs/BOXES.md)."); process.exit(1); }
if (!env.DB_READER_USER) { console.error("No DB_READER_USER in the env file; this script only uses the reader account."); process.exit(1); }
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, database: env.DB_NAME, connectionLimit: 1 });

async function q(sql, params = []) {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    const [rows] = await conn.query(`SET STATEMENT max_statement_time=${CAP_SECONDS} FOR ${sql}`, params);
    return rows;
  } finally { conn.release(); }
}

const COLS = "vin, dealer_id, dealer_name, state, cond, year, make, model, `trim`, price, msrp, old_price, last_seen_at";
try {
  const [{ n: inStock }] = await q("SELECT COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND price IS NOT NULL");
  const rows = await q(
    `SELECT ${COLS} FROM dealer_inventory WHERE removed_at IS NULL AND price > ? AND (price > 150000 OR (msrp >= 15000 AND price > msrp * 5) OR (old_price >= 5000 AND price > old_price * 5)) ORDER BY price DESC LIMIT ?`,
    [MIN_PRICE, LIMIT],
  );
  const result = classifyRows(rows);
  const named = namedCaseReport(result.flagged, rows);
  const text = renderReport(result, named, { inStock: Number(inStock), minPrice: MIN_PRICE, truncated: rows.length >= LIMIT });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "junk-price-dry-run.txt"), text + "\n");
  fs.writeFileSync(path.join(outDir, "junk-price-dry-run.json"), JSON.stringify({ ...result, named, inStock: Number(inStock) }, null, 1));
  console.log(text);
  console.log(`\nWrote ${path.join(outDir, "junk-price-dry-run.txt")} and .json`);
} catch (err) {
  console.error(/max_statement_time/.test(err.message) ? `STOPPED: the query hit the ${CAP_SECONDS}s cap; nothing was retried.` : `STOPPED: ${err.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
