// One-per-VIN loser bucket counts: create / EXPLAIN / dry run / backfill / verify / mark ready. Runs on box2 from /opt/trimscout-deals (or a repo checkout).
// Code only until Paul says GO: nothing here runs by itself. docs/box-patches/2026-10-31-loser-buckets/STEPS.md is the procedure.
//
//   --phase=explain   READ-ONLY (reader account). EXPLAIN of the shard aggregate, the shard pager and the facet read. Needs the buckets table (run create first).
//   --phase=create    Writer. CREATE TABLE IF NOT EXISTS for the buckets table and the meta table. Nothing else; dealer_inventory and the losers table are not altered.
//   --phase=dry       READ-ONLY. The whole backfill without writing: shards visited, aggregate rows it would write. Same pages, same 10 s stop per statement.
//   --phase=run       Writer. The backfill: walks the losers table by VIN shard, recomputes each page of shards (25 shards per statement, one small transaction
//                     per group). Resumable (--state=FILE keeps the last finished shard). Hard stop at --deadline-et. Every statement is stopped at 10 s, and the
//                     first failing statement ends the run (no retry). Sleeps --sleep-ms (default 200) between pages.
//   --phase=verify    READ-ONLY. Recomputes --sample=N random shards (default 300) in memory and compares them with the stored rows; also totals.
//   --phase=ready     Writer. Sets the buckets_ready marker (only if verify finds no mismatch in --sample shards and the stored total is within 0.5% of the
//                     visible-loser count). From then on a facet with ONE_PER_VIN_BUCKETS=1 reads the buckets table. --unready removes the marker.
//   --phase=status    READ-ONLY. Marker, row counts, sum(n), oldest/newest seen_on.
//
// It never writes dealer_inventory or the losers table, never takes the sync lock (it writes only the small buckets table), and must not be started while a
// sync is running (STEPS.md gate; the deals API's own recompute hook writes the same table, always per shard, always exactly).
import fs from "node:fs";
import mysql from "mysql2/promise";
import { LOSERS_TABLE, BUCKETS_TABLE, META_TABLE, BUCKETS_DDL, META_DDL, SHARD_LEN, backfillBuckets, verifyShards, shardBucketsSql, bucketCountsSql, bucketsReady } from "../../scrapers/lightsail-crawler/src/onePerVinLosers.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const PHASE = args.phase;
if (!["explain", "create", "dry", "run", "verify", "ready", "status"].includes(PHASE)) { console.error("usage: --phase=explain|create|dry|run|verify|ready|status [--env=FILE] [--state=FILE] [--page-shards=100] [--sleep-ms=200] [--deadline-et=HH:MM] [--sample=300] [--retail-only=0] [--unready]"); process.exit(1); }
const envFile = args.env || "/opt/trimscout-deals/.env.trimscout-db";
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const write = PHASE === "create" || PHASE === "run" || PHASE === "ready";
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: write ? env.DB_WRITER_USER : env.DB_READER_USER, password: write ? env.DB_WRITER_PASSWORD : env.DB_READER_PASSWORD, connectionLimit: 2 });
const retailOnly = args["retail-only"] !== "0";
const pageShards = Number(args["page-shards"] || 100), sleepMs = Number(args["sleep-ms"] ?? 200);
const [DL_H, DL_M] = String(args["deadline-et"] || "23:59").split(":").map(Number);
const etMin = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()); return Number(p.find((x) => x.type === "hour").value) % 24 * 60 + Number(p.find((x) => x.type === "minute").value); };
const pastDeadline = () => etMin() >= DL_H * 60 + DL_M;
const cap = (sql, s = 10) => `SET STATEMENT max_statement_time=${s} FOR ${sql}`;

async function explain() {
  const sample = (await pool.query(cap(`SELECT DISTINCT LEFT(vin, ${SHARD_LEN}) AS shard FROM ${LOSERS_TABLE} WHERE vin > ? ORDER BY vin LIMIT 3`), ["1FT"]))[0].map((r) => r.shard);
  const q = shardBucketsSql(sample, { retailOnly });
  const stmts = [
    ["shard pager (PK range, LIMIT)", `SELECT DISTINCT LEFT(vin, ${SHARD_LEN}) AS shard FROM ${LOSERS_TABLE} WHERE vin > ? ORDER BY vin LIMIT ?`, ["1FT", 100]],
    ["shard aggregate, 3 shards (what each recompute group runs, 25 at a time)", q.sql, q.args],
    ["delete a group's old rows", `SELECT 1 FROM ${BUCKETS_TABLE} WHERE shard IN (?)`, [sample]],
    ["facet read, all stores, 7-day window", ...Object.values(bucketCountsSql({ days: 7 }))],
    ["facet read, all stores, no window", ...Object.values(bucketCountsSql({}))],
  ];
  for (const [label, sql, a] of stmts) {
    console.log(`\n== ${label}\n${sql}`);
    try { const [rows] = await pool.query(`EXPLAIN ${sql}`, a); console.table(rows.map((r) => ({ id: r.id, table: r.table, type: r.type, key: r.key, key_len: r.key_len, rows: r.rows, Extra: r.Extra }))); }
    catch (e) { console.log(`  (EXPLAIN failed: ${e.message})`); }
  }
}

async function status() {
  const [[a]] = await pool.query(cap(`SELECT COUNT(*) AS rows_, COALESCE(SUM(n), 0) AS total, MIN(seen_on) AS oldest, MAX(seen_on) AS newest, COUNT(DISTINCT shard) AS shards FROM ${BUCKETS_TABLE}`, 60));
  const [[b]] = await pool.query(cap(`SELECT COUNT(*) AS n FROM ${LOSERS_TABLE}`, 60));
  console.log(JSON.stringify({ ready: await bucketsReady(pool), bucketRows: Number(a.rows_), shards: Number(a.shards), sumN: Number(a.total), oldest: a.oldest, newest: a.newest, loserRows: Number(b.n) }));
}

async function main() {
  if (PHASE === "explain") return explain();
  if (PHASE === "create") { await pool.query(BUCKETS_DDL); await pool.query(META_DDL); const [[c]] = await pool.query(`SHOW CREATE TABLE ${BUCKETS_TABLE}`); console.log(c["Create Table"]); return; }
  if (PHASE === "status") return status();
  if (PHASE === "verify" || PHASE === "ready") {
    const n = Number(args.sample || 300);
    if (PHASE === "ready" && args.unready) { await pool.query(`DELETE FROM ${META_TABLE} WHERE k = 'buckets_ready'`); console.log("buckets_ready removed: facets read the losers-table GROUP BY again"); return; }
    const [all] = await pool.query(cap(`SELECT DISTINCT LEFT(vin, ${SHARD_LEN}) AS shard FROM ${LOSERS_TABLE} ORDER BY vin`, 60));
    const shards = all.map((r) => r.shard);
    const picks = [...shards].sort(() => Math.random() - 0.5).slice(0, n);
    const v = await verifyShards(pool, picks, { retailOnly, statementSeconds: 10 });
    const [[s]] = await pool.query(cap(`SELECT COALESCE(SUM(n), 0) AS total FROM ${BUCKETS_TABLE}`, 60));
    const [[l]] = await pool.query(cap(`SELECT COUNT(*) AS n FROM ${LOSERS_TABLE}`, 60));
    const total = Number(s.total), stored = Number(l.n);
    const within = stored === 0 ? total === 0 : Math.abs(total - stored) / stored <= 0.005;
    console.log(JSON.stringify({ losersShards: shards.length, sampled: v.checked, mismatched: v.mismatched, bucketSum: total, loserRows: stored, withinHalfPercent: within }));
    if (PHASE === "verify") { if (v.mismatched.length || !within) process.exitCode = 3; return; }
    if (v.mismatched.length || !within) { console.error("NOT marking ready: verify failed"); process.exitCode = 3; return; }
    await pool.query(`INSERT INTO ${META_TABLE} (k, v) VALUES ('buckets_ready', '1') ON DUPLICATE KEY UPDATE v = '1', at = NOW()`);
    console.log("buckets_ready set: a facet with ONE_PER_VIN_BUCKETS=1 now reads the buckets table");
    return;
  }
  const stateFile = args.state || null;
  let startAfter = "";
  if (stateFile && fs.existsSync(stateFile)) { try { startAfter = JSON.parse(fs.readFileSync(stateFile, "utf8")).lastShard || ""; console.log(`resuming after ${startAfter}`); } catch { /* start over */ } }
  const t0 = Date.now();
  const stats = await backfillBuckets(pool, {
    pageShards, retailOnly, sleepMs, startAfter, dryRun: PHASE === "dry", statementSeconds: 10,
    shouldStop: pastDeadline,
    onPage: (s) => {
      if (stateFile && PHASE === "run") fs.writeFileSync(stateFile, JSON.stringify({ lastShard: s.lastShard, at: new Date().toISOString() }));
      if (s.pages % 10 === 0 || s.done) console.log(`page ${s.pages}  shards ${s.shards}  rows ${s.rows}  at ${s.lastShard}  ${Math.round((Date.now() - t0) / 1000)}s`);
    },
  });
  console.log(JSON.stringify({ phase: PHASE, ...stats, seconds: Math.round((Date.now() - t0) / 1000) }));
  if (!stats.done) { console.log(`STOPPED at the deadline (${DL_H}:${String(DL_M).padStart(2, "0")} ET) - resume with --state=${stateFile || "<file>"}`); process.exitCode = 3; }
}
try { await main(); } catch (e) { console.error(`ERROR - stopping, no retry: ${e.message}`); process.exitCode = 1; } finally { await pool.end(); }
