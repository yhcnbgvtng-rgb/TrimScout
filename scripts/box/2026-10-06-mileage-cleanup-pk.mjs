// Finish the used/CPO "mileage = 0 -> NULL" cleanup (step 1 of scripts/box/2026-10-04-ingest-cleanup.mjs) using
// primary-key range batching. The old loop ran `UPDATE ... WHERE cond IN (...) AND mileage = 0 LIMIT 2000` with no
// key to seek on, so every batch re-scanned the table from the start looking for the next 2,000 matches (~1-2 min
// each; two runs only got through ~230k then ~95k rows). Here each statement is restricted to a vin range
// (`vin > lo AND vin <= hi`, a PRIMARY-key range), so it only reads the rows in that range and the whole table is
// walked exactly once, in order.
//
// SAFE BY DEFAULT: no flags = dry run (EXPLAIN + count inside the first range; writes nothing).
//   --apply --fleet-idle   do it. Takes the deals-API sync lock as its own job id (ingest-cleanup-mileage-<pid>),
//                          heartbeats it, refuses if it is held (exit 4), releases on finish / --stop-at / SIGTERM / error.
//   --stop-at=HH:MM        America/New_York wall clock; stops cleanly between batches once reached (default 20:30).
//   --range=20000          rows of PRIMARY key per batch (default 20000).
// Resumable by construction: rows leave the WHERE once updated, so rerunning just walks again and finds fewer.
// Run on the deals box (box2) from /opt/trimscout-deals. Never against 3.237.204.55.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const APPLY = flag("apply");
const FLEET_IDLE = flag("fleet-idle");
const RANGE = Number(opt("range") || 20000);
const STOP_AT = opt("stop-at") || "20:30";
const PAUSE_MS = 100;
const FORBIDDEN_HOST = "3.237.204.55";
if (!Number.isInteger(RANGE) || RANGE < 1000) { console.error("--range must be an integer >= 1000"); process.exit(1); }
if (!/^\d{2}:\d{2}$/.test(STOP_AT)) { console.error("--stop-at must be HH:MM"); process.exit(1); }
if (APPLY && !FLEET_IDLE) { console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }

function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, eq).trim()] = v;
    }
  } catch { /* missing file: nothing from it */ }
  return out;
}
const dbEnv = readEnvFile(path.resolve(process.cwd(), ".env.trimscout-db"));
const appEnv = readEnvFile(path.resolve(process.cwd(), ".env"));
const API_KEY = process.env.TRIMSCOUT_API_KEY || appEnv.TRIMSCOUT_API_KEY || dbEnv.TRIMSCOUT_API_KEY || null;
const DB_HOST = dbEnv.DB_HOST || process.env.DB_HOST;
const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || dbEnv.DEALS_API_PORT || 3004}`;
if ([DB_HOST, DEALS, process.env.TRIMSCOUT_DEALS_HOST].some((h) => String(h || "").includes(FORBIDDEN_HOST))) {
  console.error(`Refusing to run: this points at ${FORBIDDEN_HOST}.`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n).toLocaleString("en-US");
const pool = mysql.createPool({
  host: DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout",
  user: dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER, password: dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD, connectionLimit: 2,
});
async function lockCall(action, owner, extra = {}) {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
}

const MILES = "cond IN ('used','cpo') AND mileage = 0";
const nowEt = () => new Date().toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const pastStop = () => nowEt() >= STOP_AT;

// The vin that ends the next range of RANGE rows after `lo` (an index-only PRIMARY scan), or null for "to the end".
async function nextBoundary(lo) {
  const [rows] = await pool.query("SELECT vin FROM dealer_inventory WHERE vin > ? ORDER BY vin LIMIT 1 OFFSET ?", [lo, RANGE - 1]);
  return rows.length ? rows[0].vin : null;
}
const rangeSql = (hi) => (hi === null ? "vin > ?" : "vin > ? AND vin <= ?");
const rangeArgs = (lo, hi) => (hi === null ? [lo] : [lo, hi]);

async function walk({ onRange }) {
  let lo = "", ranges = 0;
  for (;;) {
    const hi = await nextBoundary(lo);
    ranges++;
    const stop = await onRange(lo, hi, ranges);
    if (stop || hi === null) return { done: hi === null && !stop, ranges, lastVin: lo };
    lo = hi;
  }
}

async function main() {
  console.log(`${APPLY ? "LIVE (--apply)" : "DRY RUN"}  ${new Date().toISOString()}  range=${fmt(RANGE)} PK rows  stop-at=${STOP_AT} ET`);
  if (!APPLY) {
    const hi = await nextBoundary("");
    const [ex] = await pool.query(`EXPLAIN SELECT COUNT(*) FROM dealer_inventory WHERE ${rangeSql(hi)} AND ${MILES}`, rangeArgs("", hi));
    console.log("EXPLAIN (first range):", JSON.stringify(ex[0]));
    const t = Date.now();
    const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM dealer_inventory WHERE ${rangeSql(hi)} AND ${MILES}`, rangeArgs("", hi));
    console.log(`first range (vin <= ${hi}): ${fmt(c.n)} rows match, counted in ${Date.now() - t}ms`);
    console.log("DRY RUN — nothing was changed.");
    await pool.end();
    return;
  }
  if (!API_KEY) { console.error("No TRIMSCOUT_API_KEY found: refusing to apply without being able to take the sync lock."); await pool.end(); process.exit(3); }
  const owner = `ingest-cleanup-mileage-${process.pid}`;
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`Sync lock taken as ${owner}`);
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  let released = false;
  const release = async () => { if (released) return; released = true; clearInterval(hb); await lockCall("release", owner).catch(() => {}); console.log("Sync lock released."); };
  process.on("SIGTERM", async () => { console.log("SIGTERM — stopping."); await release(); process.exit(143); });
  const started = Date.now();
  let updated = 0, stoppedEarly = false, result = null;
  try {
    result = await walk({
      onRange: async (lo, hi, n) => {
        if (pastStop()) { stoppedEarly = true; return true; }
        const [res] = await pool.query(`UPDATE dealer_inventory SET mileage = NULL WHERE ${rangeSql(hi)} AND ${MILES}`, rangeArgs(lo, hi));
        updated += res.affectedRows;
        if (n % 10 === 0) console.log(`  ${nowEt()} ET  range ${n}  updated so far ${fmt(updated)}  (at vin ${hi ?? "END"})`);
        await sleep(PAUSE_MS);
        return false;
      },
    });
  } finally {
    await release();
  }
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`miles -> NULL: ${fmt(updated)} rows updated in ${mins} min over ${result?.ranges ?? "?"} ranges; ${stoppedEarly ? `STOPPED at ${STOP_AT} ET before the end (resume by rerunning; last vin ${result?.lastVin})` : result?.done ? "walked the whole table" : "did not finish"}`);
  if (!stoppedEarly && result?.done) {
    // Counting the leftovers is itself a full-table scan, so only do it when there is time left.
    if (!pastStop()) {
      const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM dealer_inventory WHERE ${MILES}`);
      console.log(`remaining used/CPO miles = 0: ${fmt(c.n)}`);
    } else console.log("remaining: not counted (past the stop time); a completed walk leaves only rows written since.");
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
