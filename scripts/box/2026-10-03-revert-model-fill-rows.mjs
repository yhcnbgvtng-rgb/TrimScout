// Undo specific rows of 2026-10-03-fill-blank-model-from-vin.mjs: set model back to NULL for exactly the listed rows, and
// only where the model is still the one the fill wrote (a model a dealer sends later is never touched).
//
// Why it exists: the fill trusts NHTSA vPIC, and vPIC is wrong for a few VIN patterns (2026 Audi Q5 Sportback VINs
// decode as "SQ5"; one 2019 Lexus LX 570 decodes as "GX"). Comparing every written model with what dealers themselves sent
// for the same VIN pattern found them; a wrong model is worse than a blank one, so those rows go back to blank.
//
// SAFE BY DEFAULT: with no flags this only counts how many of the listed rows still carry the model the fill wrote.
//   --apply --fleet-idle   performs the updates; takes the deals-API sync lock for the duration (refuses if held, exit 4)
//                          and heartbeats it, exactly like the fill script. Updates are by primary key in small batches.
//   --rows=FILE            required: JSON array of { vin, dealerId, make, model }.
//
// Run on the deals box from /opt/trimscout-deals:
//   sudo node 2026-10-03-revert-model-fill-rows.mjs --rows=/root/fill-blank-model-revert-rows-XXXX.json                       # count only
//   sudo node 2026-10-03-revert-model-fill-rows.mjs --rows=/root/fill-blank-model-revert-rows-XXXX.json --apply --fleet-idle
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const APPLY = flag("apply");
const FLEET_IDLE = flag("fleet-idle");
const ROWS_FILE = opt("rows");
const BATCH = 200;
const PAUSE_MS = 150;
if (!ROWS_FILE) { console.error("--rows=FILE is required"); process.exit(1); }
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
const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || dbEnv.DEALS_API_PORT || 3004}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = mysql.createPool({
  host: dbEnv.DB_HOST || process.env.DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout",
  user: dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER, password: dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD, connectionLimit: 2,
});
async function lockCall(action, owner, extra = {}) {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
}
const fmt = (n) => Number(n).toLocaleString("en-US");

async function main() {
  const rows = JSON.parse(fs.readFileSync(ROWS_FILE, "utf8"));
  if (!Array.isArray(rows) || !rows.every((r) => /^[A-HJ-NPR-Z0-9]{17}$/.test(r.vin) && Number.isInteger(r.dealerId) && r.make && r.model)) throw new Error("rows file must be an array of { vin, dealerId, make, model }");
  console.log(`${APPLY ? "LIVE (--apply)" : "COUNT ONLY"}  ${new Date().toISOString()}  ${fmt(rows.length)} listed rows from ${ROWS_FILE}`);
  const groups = new Map();
  for (const r of rows) { const k = `${r.make}\u0000${r.model}`; if (!groups.has(k)) groups.set(k, { make: r.make, model: r.model, pairs: [] }); groups.get(k).pairs.push([r.vin, r.dealerId]); }
  const countStill = async () => {
    let n = 0;
    for (const g of groups.values()) for (let i = 0; i < g.pairs.length; i += BATCH) {
      const chunk = g.pairs.slice(i, i + BATCH);
      const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE make = ? AND model = ? AND (${chunk.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")})`, [g.make, g.model, ...chunk.flat()]);
      n += Number(c.n);
    }
    return n;
  };
  const before = await countStill();
  for (const g of groups.values()) console.log(`  ${g.make} / ${g.model}: ${fmt(g.pairs.length)} listed`);
  console.log(`Rows that still carry the model the fill wrote: ${fmt(before)} of ${fmt(rows.length)}`);
  if (!APPLY) { console.log("COUNT ONLY — nothing was changed."); await pool.end(); return; }
  if (!API_KEY) { console.error("No TRIMSCOUT_API_KEY found (env, .env): refusing to apply without being able to take the sync lock."); await pool.end(); process.exit(3); }
  const owner = `revert-model-fill-${process.pid}`;
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`Sync lock taken as ${owner}; reverting...`);
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
  process.on("SIGTERM", async () => { await release(); process.exit(143); });
  let updated = 0, statements = 0;
  try {
    for (const g of groups.values()) {
      for (let i = 0; i < g.pairs.length; i += BATCH) {
        const chunk = g.pairs.slice(i, i + BATCH);
        // FORCE INDEX (PRIMARY): same plan the fill used (range on the primary key, ~200 rows). The model = ? guard means a
        // model a dealer's sync wrote since is never reverted.
        const [res] = await pool.query(
          `UPDATE dealer_inventory FORCE INDEX (PRIMARY) SET model = NULL WHERE make = ? AND model = ? AND (${chunk.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")})`,
          [g.make, g.model, ...chunk.flat()]);
        updated += res.affectedRows; statements++;
        await sleep(PAUSE_MS);
      }
    }
    console.log(`Reverted: ${fmt(updated)} rows set back to blank in ${fmt(statements)} statements.`);
  } finally {
    await release();
  }
  console.log(`Rows still carrying the filled model: ${fmt(await countStill())}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
