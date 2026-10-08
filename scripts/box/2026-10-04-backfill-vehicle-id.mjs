// Backfill dealer_inventory.vehicle_id — the stable numeric vehicle id, one per VIN — for rows written before the id existed.
// New VINs get an id on insert (src/vehicleId.js, wired into handleInventoryBulk); this only fills the rows that predate it.
//
// NOT RUN BY THIS PR. Run it once, later, on box2 (the deals box) only when ALL FOUR boxes are idle, the sync lock is free
// and no long database query is running (same gate as the 2026-10-03 model fill).
//
// Prerequisite: the PR is deployed and deals-api has restarted, which creates the vehicle_ids table and the nullable vehicle_id
// column (ensureInventoryTable). This script never alters the schema; it refuses to run if either is missing.
//
// SAFE BY DEFAULT: with no flags it is a DRY RUN — read-only counts, a preview of the first VINs, and EXPLAINs of the two
// statements it would run. It writes nothing, not even registry rows.
//   --apply --fleet-idle   performs the backfill. --fleet-idle is the operator asserting nothing is crawling or syncing; the script also
//                          takes the deals-API sync lock for the whole run (refuses if held, exit 4) and heartbeats it.
//   --batch=500            VINs per batch (each batch: register new VINs, then one UPDATE by primary-key range).
//   --stop-at=21:40        stop cleanly after the batch that crosses this Eastern time (the checkpoint keeps the place).
//   --checkpoint=FILE      cursor file (default ~/vehicle-id-backfill-checkpoint.json).
//   --from-start           ignore the checkpoint and sweep from the first VIN (it only ever touches rows still without an id).
//
// RESUMING: just run the same command again. Every batch touches only rows whose vehicle_id IS NULL, so a stopped, killed or
// crashed run loses nothing and a second run repeats nothing; the checkpoint only skips the finished prefix. Use --from-start
// afterwards if anything other than the deployed sync wrote rows without an id.
//
// Run from /opt/trimscout-deals (needs src/vehicleId.js and src/vehicleIdBackfill.js deployed next to it):
//   sudo node 2026-10-04-backfill-vehicle-id.mjs                                       # dry run
//   sudo node 2026-10-04-backfill-vehicle-id.mjs --apply --fleet-idle --stop-at=21:30   # live
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const APPLY = flag("apply");
const FLEET_IDLE = flag("fleet-idle");
const FROM_START = flag("from-start");
const BATCH = Math.min(Math.max(Number(opt("batch")) || 500, 10), 2000);
const STOP_AT = opt("stop-at");
const CHECKPOINT = opt("checkpoint") || path.join(os.homedir(), "vehicle-id-backfill-checkpoint.json");
const PAUSE_MS = 150;
const fmt = (n) => Number(n).toLocaleString("en-US");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (APPLY && !FLEET_IDLE) {
  console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first).");
  process.exit(1);
}
if (STOP_AT && !/^\d{2}:\d{2}$/.test(STOP_AT)) { console.error("--stop-at must look like 21:40 (Eastern time)."); process.exit(1); }
const etNow = () => new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
if (APPLY && STOP_AT && etNow() >= STOP_AT) { console.error(`It is already ${etNow()} ET, past --stop-at=${STOP_AT}. Nothing was changed.`); process.exit(1); }

for (const f of ["src/vehicleId.js", "src/vehicleIdBackfill.js"]) {
  if (!fs.existsSync(path.resolve(process.cwd(), f))) { console.error(`Missing ${path.resolve(process.cwd(), f)} — deploy the PR's src files to the box first.`); process.exit(1); }
}
const { backfillBatch, nextVinsWithoutId, BACKFILL_UPDATE_SQL } = await import(path.resolve(process.cwd(), "src/vehicleIdBackfill.js"));

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

const pool = mysql.createPool({
  host: dbEnv.DB_HOST || process.env.DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout",
  user: dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER, password: dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD, connectionLimit: 2,
});

async function lockCall(action, owner, extra = {}) {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
}

// Read-only aggregates are capped so a busy database cannot be pinned by a status query.
// COUNT_CAP_S overrides the cap: on the live table (~3.3M rows) the full-table count takes ~4.5 min, over the default 180 s.
const capped = (sql) => pool.query(`SET STATEMENT max_statement_time=${Number(process.env.COUNT_CAP_S) || 180} FOR ${sql}`);

async function preflight() {
  const [[c]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dealer_inventory' AND COLUMN_NAME = 'vehicle_id'");
  const [[t]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicle_ids'");
  if (!Number(c.n) || !Number(t.n)) {
    console.error(`Schema not ready (dealer_inventory.vehicle_id: ${Number(c.n) ? "ok" : "MISSING"}, vehicle_ids table: ${Number(t.n) ? "ok" : "MISSING"}). Deploy the PR and restart deals-api first — this script never alters the schema.`);
    await pool.end(); process.exit(2);
  }
}

async function counts() {
  const [[a]] = await capped("SELECT COUNT(*) AS total, SUM(vehicle_id IS NULL) AS without_id FROM dealer_inventory");
  const [[r]] = await pool.query("SELECT COUNT(*) AS n, MAX(vehicle_id) AS max_id FROM vehicle_ids");
  return { total: Number(a.total), withoutId: Number(a.without_id || 0), registry: Number(r.n), maxId: Number(r.max_id || 0) };
}

const readCheckpoint = () => { try { return JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")); } catch { return null; } };
const writeCheckpoint = (o) => fs.writeFileSync(CHECKPOINT, JSON.stringify({ ...o, savedAt: new Date().toISOString() }, null, 2));

async function main() {
  console.log(`${APPLY ? "LIVE (--apply)" : "DRY RUN"}  ${new Date().toISOString()}  batch=${BATCH}${STOP_AT ? `  stop-at=${STOP_AT} ET` : ""}`);
  await preflight();
  const before = await counts();
  console.log(`dealer_inventory rows: ${fmt(before.total)}; with an id: ${fmt(before.total - before.withoutId)}; WITHOUT an id: ${fmt(before.withoutId)}`);
  console.log(`vehicle_ids registry: ${fmt(before.registry)} VINs (highest id ${fmt(before.maxId)})`);
  const ck = FROM_START ? null : readCheckpoint();
  let cursor = ck?.cursor || "";
  console.log(ck ? `Checkpoint ${CHECKPOINT}: continuing after VIN ${cursor} (saved ${ck.savedAt}).` : "No checkpoint in use: starting from the first VIN.");

  if (!APPLY) {
    const preview = await nextVinsWithoutId(pool, cursor, 5);
    console.log(`First VINs that would be processed: ${preview.length ? preview.join(", ") : "(none — nothing left to backfill)"}`);
    if (preview.length) {
      const [sel] = await pool.query("EXPLAIN SELECT DISTINCT vin FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin > ? AND vehicle_id IS NULL ORDER BY vin LIMIT ?", [cursor, BATCH]);
      const [upd] = await pool.query(`EXPLAIN ${BACKFILL_UPDATE_SQL}`, [preview]);
      console.log("EXPLAIN of the batch SELECT:", JSON.stringify(sel.map((p) => ({ table: p.table, type: p.type, key: p.key, rows: p.rows, Extra: p.Extra }))));
      console.log("EXPLAIN of the batch UPDATE (5 VINs):", JSON.stringify(upd.map((p) => ({ table: p.table, type: p.type, key: p.key, rows: p.rows, Extra: p.Extra }))));
    }
    console.log("DRY RUN — nothing was changed.");
    await pool.end(); return;
  }

  if (!API_KEY) { console.error("No TRIMSCOUT_API_KEY found (env, .env): refusing to apply without being able to take the sync lock."); await pool.end(); process.exit(3); }
  const owner = `vehicle-id-backfill-${process.pid}`;
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`\nSync lock taken as ${owner}; backfilling...`);
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
  let stopRequested = false;
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { stopRequested = true; console.log(`\n${sig}: finishing the current batch, then releasing the lock...`); });

  let vinsDone = 0, rowsUpdated = 0, batches = 0, retries = 0, slowest = 0, finished = false;
  const withRetry = async (fn) => {
    for (let attempt = 1; ; attempt++) {
      try { return await fn(); } catch (err) {
        if (!(err && (err.errno === 1213 || err.errno === 1205)) || attempt >= 5) throw err;
        retries++; console.error(`  batch hit ${err.code} (attempt ${attempt}); retrying in ${2 * attempt}s`);
        await sleep(2000 * attempt);
      }
    }
  };
  try {
    for (;;) {
      if (stopRequested) { console.log("Stopped on request."); break; }
      if (STOP_AT && etNow() >= STOP_AT) { console.log(`Reached --stop-at=${STOP_AT} ET; stopping with the checkpoint saved.`); break; }
      const t0 = Date.now();
      const r = await withRetry(() => backfillBatch(pool, cursor, BATCH));
      const took = Date.now() - t0;
      slowest = Math.max(slowest, took);
      batches++; vinsDone += r.vins; rowsUpdated += r.updated; cursor = r.nextCursor;
      writeCheckpoint({ cursor, vinsDone, rowsUpdated });
      if (batches % 20 === 0) console.log(`  ...${fmt(vinsDone)} VINs, ${fmt(rowsUpdated)} rows updated so far (cursor ${cursor}, slowest batch ${slowest} ms)`);
      if (r.done) { finished = true; break; }
      await sleep(took > 1500 ? PAUSE_MS + took : PAUSE_MS); // a slow batch means the database is busy: give it room
    }
  } finally {
    await release();
  }
  const after = await counts();
  console.log(`\n${finished ? "Backfill complete" : "Stopped early (run the same command again to continue)"}: ${fmt(vinsDone)} VINs, ${fmt(rowsUpdated)} rows updated in ${fmt(batches)} batches (${retries} retries, slowest batch ${slowest} ms).`);
  console.log(`Rows WITHOUT an id: ${fmt(after.withoutId)} (before: ${fmt(before.withoutId)}); registry: ${fmt(after.registry)} VINs (highest id ${fmt(after.maxId)}).`);
  if (finished) {
    const [[bad]] = await capped("SELECT COUNT(*) AS n FROM dealer_inventory i JOIN vehicle_ids v ON v.vin = i.vin WHERE i.vehicle_id <> v.vehicle_id");
    console.log(`Rows whose id differs from the registry's id for their VIN: ${fmt(bad.n)} (must be 0).`);
    if (after.withoutId > 0) console.log("Some rows still have no id — a writer other than the deployed sync wrote them while this ran; run the command once more with --from-start.");
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
