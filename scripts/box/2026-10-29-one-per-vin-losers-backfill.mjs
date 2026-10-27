// One-per-VIN losers table: create / EXPLAIN / dry run / backfill (and the same pass is the nightly verification). Runs on box2, from this repo checkout.
// Code only until Paul says GO: nothing here runs by itself. docs/box-patches/2026-10-29-one-per-vin-losers/STEPS.md is the procedure.
//
//   --phase=explain   READ-ONLY (reader account). Prints EXPLAIN for every query the feature runs, against the live tables. Needs the table to exist
//                     for the losers-table statements (run create after backup, then explain again).
//   --phase=create    Writer. CREATE TABLE IF NOT EXISTS dealer_inventory_vin_losers (nothing else; dealer_inventory is not altered).
//   --phase=dry       READ-ONLY. The whole backfill pass without writing: how many losers it would add / delete. Same pages as run.
//   --phase=run       Writer. The backfill: dealer_inventory in primary-key order, 5,000 rows per statement, each page decided and written to the losers
//                     table only. Resumable (--state=FILE keeps the last finished VIN). Hard stop at --deadline-et. Every statement capped at 15 s.
//   --phase=count     READ-ONLY. Losers stored, and how many of them are still visible (the number the facets would subtract).
//
// It never writes dealer_inventory, never takes the sync lock (it reads one page at a time and writes only the side table), and sleeps --sleep-ms
// (default 150) between pages so the nightly sync and the buyer search keep their connections. Do not start it while a sync is running (STEPS.md gate).
import fs from "node:fs";
import mysql from "mysql2/promise";
import { LOSERS_DDL, LOSERS_TABLE, backfillLosers, visibleSql, loserBucketsSql } from "../../scrapers/lightsail-crawler/src/onePerVinLosers.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const PHASE = args.phase;
if (!["explain", "create", "dry", "run", "count"].includes(PHASE)) { console.error("usage: --phase=explain|create|dry|run|count [--env=FILE] [--state=FILE] [--page-rows=5000] [--sleep-ms=150] [--deadline-et=HH:MM] [--retail-only=0|1]"); process.exit(2); }
const envFile = args.env || "/opt/trimscout-deals/.env.trimscout-db";
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const write = PHASE === "create" || PHASE === "run";
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: write ? env.DB_WRITER_USER : env.DB_READER_USER, password: write ? env.DB_WRITER_PASSWORD : env.DB_READER_PASSWORD, connectionLimit: 2 });
const retailOnly = args["retail-only"] !== "0";
const pageRows = Number(args["page-rows"] || 5000), sleepMs = Number(args["sleep-ms"] ?? 150);
const [DL_H, DL_M] = String(args["deadline-et"] || "23:59").split(":").map(Number);
const etMin = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()); return Number(p.find((x) => x.type === "hour").value) % 24 * 60 + Number(p.find((x) => x.type === "minute").value); };
const pastDeadline = () => etMin() >= DL_H * 60 + DL_M;

async function explain() {
  const sample = (await pool.query("SELECT vin FROM dealer_inventory WHERE vin >= '1FT' ORDER BY vin LIMIT 3"))[0].map((r) => r.vin);
  const stmts = [
    ["backfill page (PK range scan, LIMIT)", `SELECT vin, dealer_id, last_seen_at, price FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin > ? AND ${visibleSql({ retailOnly })} ORDER BY vin, dealer_id LIMIT ?`, ["1FT", pageRows]],
    ["upsert hook / refresh: a chunk's rows by VIN (PK prefix ranges)", `SELECT vin, dealer_id, last_seen_at, price FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin IN (?) AND ${visibleSql({ retailOnly })}`, [sample]],
    ["upsert hook / refresh: stored losers by VIN", `SELECT vin, dealer_id FROM ${LOSERS_TABLE} WHERE vin IN (?)`, [sample]],
    ["backfill page: stored losers in the page's VIN range", `SELECT vin, dealer_id FROM ${LOSERS_TABLE} WHERE vin > ? AND vin <= ?`, ["1FT", "1FTZ"]],
    ["reconcile keyset", `SELECT DISTINCT vin FROM ${LOSERS_TABLE} WHERE vin > ? ORDER BY vin LIMIT ?`, ["1FT", 500]],
    ["single-row delete (const lookup)", `SELECT 1 FROM ${LOSERS_TABLE} WHERE vin = ? AND dealer_id = ?`, [sample[0], 1]],
    ["facet buckets, all stores, 7-day window", ...Object.values(loserBucketsSql({ days: 7, retailOnly })), ],
    ["facet buckets, contact set", ...Object.values(loserBucketsSql({ days: 7, dealerIds: new Set([1, 2, 3]), retailOnly })), ],
  ];
  for (const [label, sql, a] of stmts) {
    console.log(`\n== ${label}\n${sql}`);
    try { const [rows] = await pool.query(`EXPLAIN ${sql}`, a); console.table(rows.map((r) => ({ id: r.id, table: r.table, type: r.type, key: r.key, key_len: r.key_len, rows: r.rows, Extra: r.Extra }))); }
    catch (e) { console.log(`  (EXPLAIN failed: ${e.message})`); }
  }
}

async function main() {
  if (PHASE === "explain") return explain();
  if (PHASE === "create") { await pool.query(LOSERS_DDL); const [[c]] = await pool.query(`SHOW CREATE TABLE ${LOSERS_TABLE}`); console.log(c["Create Table"]); return; }
  if (PHASE === "count") {
    const [[a]] = await pool.query(`SET STATEMENT max_statement_time=60 FOR SELECT COUNT(*) AS n FROM ${LOSERS_TABLE}`);
    const [[b]] = await pool.query(`SET STATEMENT max_statement_time=60 FOR SELECT COUNT(*) AS n FROM ${LOSERS_TABLE} l JOIN dealer_inventory i ON i.vin = l.vin AND i.dealer_id = l.dealer_id WHERE i.removed_at IS NULL AND i.stale_at IS NULL${retailOnly ? " AND (i.cond IS NULL OR i.cond <> 'wholesale')" : ""}`);
    console.log(JSON.stringify({ stored: Number(a.n), stillVisible: Number(b.n) })); return;
  }
  const stateFile = args.state || null;
  let startAfter = "";
  if (stateFile && fs.existsSync(stateFile)) { try { startAfter = JSON.parse(fs.readFileSync(stateFile, "utf8")).lastVin || ""; console.log(`resuming after ${startAfter}`); } catch { /* start over */ } }
  const t0 = Date.now();
  const stats = await backfillLosers({ query: (sql, a) => pool.query(sql, a) }, {
    pageRows, retailOnly, sleepMs, startAfter, dryRun: PHASE === "dry",
    shouldStop: pastDeadline,
    onPage: (s) => {
      if (stateFile) fs.writeFileSync(stateFile, JSON.stringify({ lastVin: s.lastVin, at: new Date().toISOString() }));
      if (s.pages % 20 === 0 || s.done) console.log(`page ${s.pages}  rows ${s.rowsRead}  losers ${s.losers}  +${s.added} -${s.deleted}  at ${s.lastVin}  ${Math.round((Date.now() - t0) / 1000)}s`);
    },
  });
  console.log(JSON.stringify({ phase: PHASE, ...stats, seconds: Math.round((Date.now() - t0) / 1000) }));
  if (!stats.done) { console.log(`STOPPED at the deadline (${DL_H}:${String(DL_M).padStart(2, "0")} ET) - resume with --state=${stateFile || "<file>"}`); process.exitCode = 3; }
}
try { await main(); } finally { await pool.end(); }
