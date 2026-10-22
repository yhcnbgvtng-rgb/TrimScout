// Trim RE-CLEAN of stored rows (dealer_inventory.trim): the same rule the crawl applies since #570 (cleanTrim in ingestSanitize.js - HTML entities
// decoded, ® / ™ dropped, trailing 4WD/AWD/4x4/RWD/FWD/2WD removed, Kia keeps its drivetrain word) applied to what the table holds today. Same shape and
// rails as scripts/box/2026-10-16-option-reclean.mjs. Phases, one script:
//
//   dryrun   READ-ONLY, reader account, no lock, WRITES NOTHING (no files, no DB): counts per make (rows that would change, by reason, distinct trims,
//            top-30 from -> to trim pairs with row counts). Keeps no VIN and no row anywhere. Refuses while the sync lock is held.
//   plan     READ-ONLY (reader account, no lock). Same reads, but writes into --out (mode 0600): plan.jsonl (one line per row that would change:
//            batch, make, model, vin, dealer_id, old trim, new trim - the VIN is unavoidable here, it is the only way restore can find the row again),
//            batches.json, plan-summary.json (counts only, with the md5 of plan.jsonl). Nothing in --out is ever printed or sent anywhere.
//   apply    Takes the sync lock (heartbeated), applies plan.jsonl batch by batch (ONE transaction per batch, <= --batch rows, default 2000, hard cap 5000),
//            each UPDATE guarded by the OLD trim (a row whose trim changed since the plan is left alone), checkpoint.json after each batch, applied.jsonl
//            lists exactly which rows were written. Resumes after checkpoint.lastBatch. HARD STOP at --deadline-et (default 21:40 ET).
//   verify   READ-ONLY. Re-reads the applied rows: none may still be dirty, and it reports rows that were changed or removed since.
//   restore  Puts the OLD trim back for the rows in applied.jsonl (optionally --through-batch=N), only where the row still holds the NEW trim. Dry unless --go.
//
// Access paths (every query is bounded by make AND model, nothing scans the table): makes and models are found by index skip-scans
// (idx_inv_make_model / idx_inv_make_model_trim, one seek each); a model's distinct trims come from the covering index idx_inv_make_model_trim
// (make, model, trim, dealer_name, vin) with GROUP BY; a dirty trim's rows are one equality range on the same index. Every query is capped at 20 s
// (SET STATEMENT max_statement_time=20); a timeout is retried ONCE in a different shape (rows split by year), a second timeout stops the run.
// Rows that are removed (removed_at set) are included, like the table's own index: they are not read separately.
// Writes go through the table's own BEFORE UPDATE trigger (trg_inv_rev_update), which keeps trim_rev in step. Facets (inv_option_facets / inv_option_summary,
// keyed on trim) are NOT touched here: rebuild them afterwards the usual way. Run it only AFTER the crawl boxes carry the #570 patch, or the next
// sync writes the dirty trims straight back.
//
// The box has no checkout. Ship it as ONE stdin-piped bundle (engine inlined; the dry run writes nothing on the box):
//   node scripts/box/2026-10-21-trim-reclean.mjs --emit | ssh box2 'cd /opt/trimscout-deals && node --input-type=module - --phase=dryrun'
// Flags: --makes=Ford,Kia (default: every make found)  --model=F-150 (with exactly one make)  --batch=N (<=5000)  --pause-ms=N  --deadline-et=HH:MM  --out=DIR  --env=FILE  --lock-log=FILE (deals-api's pm2 out log, for the lock check)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { classifyTrimChange, summarizeGroups } from "../lib/trimReclean.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));

if (args.emit) { // bundle this script with the engine into one ESM file on stdout
  const esbuild = await import("esbuild");
  const out = await esbuild.build({ entryPoints: [fileURLToPath(import.meta.url)], bundle: true, write: false, platform: "node", format: "esm", target: "node18", external: ["mysql2", "esbuild"] });
  await new Promise((resolve) => process.stdout.write(out.outputFiles[0].text, resolve)); // wait for the flush: exiting early cuts a pipe write short
  process.exit(0);
}

const PHASE = args.phase;
const OUT = path.resolve(args.out || ".");
const BATCH = Number(args.batch || 2000);
if (!Number.isInteger(BATCH) || BATCH < 1 || BATCH > 5000) throw new Error("--batch must be a whole number from 1 to 5000");
const CAP = 20, PK_CHUNK = 100, PAUSE = Number(args["pause-ms"] ?? 250);
const [DL_H, DL_M] = String(args["deadline-et"] || "21:40").split(":").map(Number);
const P = (f) => path.join(OUT, f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etMin = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()); return Number(p.find((x) => x.type === "hour").value) % 24 * 60 + Number(p.find((x) => x.type === "minute").value); };
const pastDeadline = () => etMin() >= DL_H * 60 + DL_M;
const dlText = `${DL_H}:${String(DL_M).padStart(2, "0")} ET`;
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const readLines = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

if (PHASE === "selftest") { // no DB: proves the bundle (or the checkout) loads and the rule behaves
  const cases = [["Platinum&reg;", "Ford"], ["XLT 4WD", "Ford"], ["Wind AWD", "Kia"], ["Lariat", "Ford"]];
  console.log(JSON.stringify(cases.map(([t, m]) => [t, m, classifyTrimChange(t, m)?.next ?? null])));
  process.exit(0);
}

const mysql = (await import("mysql2/promise")).default;
const envFile = args.env || "/opt/trimscout-deals/.env.trimscout-db";
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const write = PHASE === "apply" || (PHASE === "restore" && args.go);
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: write ? env.DB_WRITER_USER : env.DB_READER_USER, password: write ? env.DB_WRITER_PASSWORD : env.DB_READER_PASSWORD, connectionLimit: 2 });
const DEALS = `http://127.0.0.1:${env.DEALS_API_PORT || 3004}`;

let timeouts = 0, queries = 0, slowest = 0;
class StopRun extends Error {}
class Timeout extends Error {}
async function q(conn, shape, sql, params) {
  queries++; const t0 = Date.now();
  try { const [rows] = await conn.query(`SET STATEMENT max_statement_time=${CAP} FOR ${sql}`, params); slowest = Math.max(slowest, Date.now() - t0); return rows; }
  catch (err) {
    if (err && (err.errno === 1969 || /max_statement_time/.test(err.message))) {
      timeouts++; console.error(`  TIMEOUT (${CAP}s) in "${shape}" (timeout #${timeouts})`);
      if (timeouts >= 2) throw new StopRun(`a second query timed out ("${shape}") - stopping, nothing retried`);
      throw new Timeout(shape);
    }
    throw err;
  }
}

// ---- lock (apply / restore only) ----
let owner = null, hb = null, lostLock = false, released = false;
const lockCall = async (action, extra = {}) => { const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": env.TRIMSCOUT_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) }); if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`); return r.json(); };
async function takeLock(tag) {
  owner = `${tag}-${process.pid}`;
  const l = await lockCall("acquire", { heartbeat: true });
  if (!l.acquired) { console.log(`LOCK BUSY - ${JSON.stringify(l)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`Sync lock taken as ${owner}`);
  hb = setInterval(async () => { try { const r = await lockCall("heartbeat"); if (!r.renewed) { lostLock = true; console.error(`LOCK LOST: ${JSON.stringify(r)}`); } } catch (e) { console.error(`heartbeat failed: ${e.message}`); } }, 60_000);
}
async function releaseLock() { if (released || !owner) return; released = true; clearInterval(hb); try { await lockCall("release"); console.log("Sync lock released."); } catch (e) { console.error(`RELEASE FAILED: ${e.message} (frees itself after its TTL)`); } }
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, async () => { console.error(`${s}: releasing lock`); await releaseLock(); process.exit(143); });
const lockHeld = () => { // read-only look at deals-api's own log (the read phases take no lock, so they only check)
  const f = String(args["lock-log"] || "/home/ubuntu/.pm2/logs/deals-api-out.log"), fd = fs.openSync(f, "r"), size = fs.fstatSync(fd).size, len = Math.min(size, 4_000_000), buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
  return /\bacquire\b/.test(buf.toString("utf8").split("\n").filter((l) => l.includes("[sync-lock]")).pop() || "");
};

// ---- bounded reads: always make + model, via the (make, model, trim, dealer_name, vin) index ----
const IDX = "idx_inv_make_model_trim";
async function makesInDb(conn) {
  if (args.makes) return String(args.makes).split(",").map((s) => s.trim()).filter(Boolean);
  const out = []; let last = "";
  for (;;) { const r = await q(conn, "next make", `SELECT make FROM dealer_inventory FORCE INDEX (idx_inv_make_model) WHERE make > ? ORDER BY make LIMIT 1`, [last]); if (!r.length) break; last = r[0].make; out.push(last); }
  return out;
}
async function modelsFor(conn, make) {
  if (args.model) return [String(args.model)];
  const out = []; let last = "";
  for (;;) { const r = await q(conn, `next model ${make}`, `SELECT model FROM dealer_inventory FORCE INDEX (${IDX}) WHERE make = ? AND model > ? ORDER BY model LIMIT 1`, [make, last]); if (!r.length) break; last = r[0].model; out.push(last); }
  return out;
}
const groupsFor = (conn, make, model) => q(conn, `trims ${make}/${model}`, `SELECT trim, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (${IDX}) WHERE make = ? AND model = ? GROUP BY BINARY trim`, [make, model]);
// One dirty trim's rows. A timeout is retried once with the rows split by year (two narrower ranges of the same index).
async function rowsOf(conn, make, model, trim, label) {
  const sql = (extra) => `SELECT vin, dealer_id, make, trim FROM dealer_inventory FORCE INDEX (${IDX}) WHERE make = ? AND model = ? AND trim = ?${extra}`;
  try { return await q(conn, `rows ${label}`, sql(""), [make, model, trim]); }
  catch (e) {
    if (!(e instanceof Timeout)) throw e;
    const a = await q(conn, `rows ${label} a`, sql(" AND year >= 2026"), [make, model, trim]).catch((x) => { throw x instanceof Timeout ? new StopRun(`timeout in split shape "${label}"`) : x; });
    const b = await q(conn, `rows ${label} b`, sql(" AND (year < 2026 OR year IS NULL)"), [make, model, trim]).catch((x) => { throw x instanceof Timeout ? new StopRun(`timeout in split shape "${label}"`) : x; });
    return [...a, ...b];
  }
}

// ================= dryrun =================
async function dryrun() {
  if (lockHeld()) throw new StopRun("the sync lock is held - not reading now");
  const conn = await pool.getConnection(); const started = Date.now();
  const makes = await makesInDb(conn); let stopReason = "all makes done"; const perMake = [];
  console.error(`dryrun: ${makes.length} makes, hard stop ${dlText}`);
  for (const make of makes) {
    if (pastDeadline()) { stopReason = `deadline ${dlText}`; break; }
    if (lockHeld()) { stopReason = "the sync lock was taken - stopped"; break; }
    const groups = [];
    for (const model of await modelsFor(conn, make)) { for (const g of await groupsFor(conn, make, model)) groups.push({ model, trim: g.trim, n: Number(g.n) }); await sleep(PAUSE); }
    perMake.push(summarizeGroups(make, groups));
    console.error(`  ${make}: ${perMake.at(-1).rowsToChange} rows in ${perMake.at(-1).changedTrims} trims (${queries} queries, slowest ${slowest} ms)`);
  }
  conn.release();
  const total = perMake.reduce((t, m) => { t.rowsToChange += m.rowsToChange; t.changedTrims += m.changedTrims; t.distinctTrims += m.distinctTrims; t.mergesIntoExistingTrim += m.mergesIntoExistingTrim; for (const [k, v] of Object.entries(m.byReason)) t.byReason[k] = (t.byReason[k] || 0) + v; return t; }, { rowsToChange: 0, changedTrims: 0, distinctTrims: 0, mergesIntoExistingTrim: 0, byReason: {} });
  console.log(JSON.stringify({ phase: "dryrun", complete: stopReason === "all makes done", stopReason, elapsedS: Math.round((Date.now() - started) / 1000), wrote: "nothing", readerAccount: true, total, perMake: perMake.filter((m) => m.rowsToChange), makesWithNothingToDo: perMake.filter((m) => !m.rowsToChange).map((m) => m.make) }, null, 1));
}

// ================= plan =================
async function plan() {
  if (lockHeld()) throw new StopRun("the sync lock is held - not reading now");
  fs.mkdirSync(OUT, { recursive: true });
  const conn = await pool.getConnection(); const started = Date.now();
  const makes = await makesInDb(conn); const batches = []; const perMake = [];
  const pl = fs.openSync(P("plan.jsonl"), "w", 0o600); fs.chmodSync(P("plan.jsonl"), 0o600);
  let stopReason = "all makes done", batch = 1, inBatch = 0, total = 0;
  for (const make of makes) {
    if (pastDeadline()) { stopReason = `deadline ${dlText}`; break; }
    if (lockHeld()) { stopReason = "the sync lock was taken - stopped"; break; }
    const groups = [];
    for (const model of await modelsFor(conn, make)) {
      const gs = (await groupsFor(conn, make, model)).map((g) => ({ model, trim: g.trim, n: Number(g.n) }));
      groups.push(...gs);
      for (const g of gs) {
        if (!classifyTrimChange(g.trim, make)) continue;
        for (const r of await rowsOf(conn, make, model, g.trim, `${make}/${model}`)) {
          const c = r.trim === g.trim ? classifyTrimChange(r.trim, r.make) : null; // the index compares case-insensitively: only the exact string counts
          if (!c) continue;
          if (inBatch >= BATCH) { batch++; inBatch = 0; }
          if (!batches.length || batches.at(-1).batch !== batch) batches.push({ batch, make, rows: 0 });
          batches.at(-1).rows++; inBatch++; total++;
          fs.writeSync(pl, JSON.stringify({ batch, make: r.make, model, vin: r.vin, dealer_id: r.dealer_id, old: r.trim, next: c.next }) + "\n");
        }
        await sleep(PAUSE);
      }
    }
    perMake.push(summarizeGroups(make, groups));
  }
  fs.fsyncSync(pl); fs.closeSync(pl);
  fs.writeFileSync(P("batches.json"), JSON.stringify(batches));
  const md5 = crypto.createHash("md5").update(fs.readFileSync(P("plan.jsonl"))).digest("hex");
  const summary = { phase: "plan", complete: stopReason === "all makes done", stopReason, batchSize: BATCH, batches: batches.length, rowsPlanned: total, elapsedS: Math.round((Date.now() - started) / 1000), planMd5: md5, planBytes: fs.statSync(P("plan.jsonl")).size, perMake: perMake.filter((m) => m.rowsToChange) };
  fs.writeFileSync(P("plan-summary.json"), JSON.stringify(summary, null, 1)); console.log("PLAN DONE", JSON.stringify(summary, null, 1));
  conn.release();
}

// ================= apply =================
const pairWhere = (part) => part.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ");
async function apply() {
  const summary = JSON.parse(fs.readFileSync(P("plan-summary.json"), "utf8"));
  if (!summary.complete) throw new Error("the plan is incomplete (it stopped early) - re-run --phase=plan");
  const md5 = crypto.createHash("md5").update(fs.readFileSync(P("plan.jsonl"))).digest("hex");
  if (md5 !== summary.planMd5) throw new Error("plan.jsonl does not match plan-summary.json (planMd5) - re-run --phase=plan");
  const planBy = new Map();
  for (const o of readLines(P("plan.jsonl"))) (planBy.get(o.batch) || planBy.set(o.batch, []).get(o.batch)).push(o);
  for (const rows of planBy.values()) if (rows.length > 5000) throw new Error("a planned batch is over 5000 rows");
  const batchNos = [...planBy.keys()].sort((a, b) => a - b);
  let ck = { lastBatch: 0, batchesDone: 0, totalBatches: batchNos.length, rowsApplied: 0, rowsSkippedChangedSince: 0 };
  try { ck = { ...ck, ...JSON.parse(fs.readFileSync(P("checkpoint.json"), "utf8")) }; } catch {}
  console.log(`APPLY resume after batch ${ck.lastBatch} of ${batchNos.length}; plan = ${summary.rowsPlanned} rows; hard stop ${dlText}`);
  const saveCk = () => { const tmp = P("checkpoint.json.tmp"); const fd = fs.openSync(tmp, "w"); fs.writeSync(fd, JSON.stringify({ ...ck, savedAt: new Date().toISOString() }, null, 1)); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(tmp, P("checkpoint.json")); };
  const ap = fs.openSync(P("applied.jsonl"), "a", 0o600);
  await takeLock("trim-reclean-apply");
  const started = Date.now(); let stopReason = "all batches done";
  try {
    for (const n of batchNos) {
      if (n <= ck.lastBatch) continue;
      if (lostLock) { stopReason = "sync lock lost"; break; }
      if (pastDeadline()) { stopReason = `hard stop ${dlText}`; break; }
      const rows = planBy.get(n); const conn = await pool.getConnection(); let changed = 0;
      try {
        await conn.beginTransaction();
        const groups = new Map(); // (old -> next) -> rows, one UPDATE per group chunk
        for (const r of rows) { const k = `${r.old}\u0001${r.next}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
        for (const [k, rs] of groups) {
          const [old, next] = k.split("\u0001");
          const sorted = rs.map((r) => [r.vin, r.dealer_id]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
          for (const part of chunks(sorted, PK_CHUNK)) {
            const res = await conn.query(`SET STATEMENT max_statement_time=${CAP} FOR UPDATE dealer_inventory SET trim = ? WHERE BINARY trim = BINARY ? AND (${pairWhere(part)})`, [next, old, ...part.flat()]); queries++;
            changed += res[0].affectedRows;
          }
        }
        for (const r of rows) fs.writeSync(ap, JSON.stringify({ batch: n, vin: r.vin, dealer_id: r.dealer_id }) + "\n");
        fs.fsyncSync(ap); // applied.jsonl is on disk before the commit, so restore never misses a written row (it may list one that rolled back; restoring that is a no-op)
        await conn.commit();
      } catch (e) {
        await conn.rollback().catch(() => {});
        if (e && (e.errno === 1969 || /max_statement_time/.test(e.message))) throw new StopRun(`timeout in apply batch ${n} (rolled back)`);
        throw e;
      } finally { conn.release(); }
      ck.lastBatch = n; ck.batchesDone++; ck.rowsApplied += changed; ck.rowsSkippedChangedSince += rows.length - changed; ck.runSeconds = Math.round((Date.now() - started) / 1000); saveCk();
      if (n % 5 === 0) console.log(`  batch ${n}/${batchNos.length}: ${ck.rowsApplied} rows, ${Math.round((Date.now() - started) / 60000)} min`);
      await sleep(PAUSE);
    }
  } catch (e) { stopReason = e instanceof StopRun ? e.message : `ERROR ${e.stack || e.message}`; process.exitCode = e instanceof StopRun ? 3 : 1; }
  finally { saveCk(); fs.closeSync(ap); await releaseLock(); }
  console.log(`APPLY STOPPED: ${stopReason}. batches ${ck.lastBatch}/${batchNos.length}, rows ${ck.rowsApplied}/${summary.rowsPlanned} (changed-since skipped ${ck.rowsSkippedChangedSince}), ${Math.round((Date.now() - started) / 60000)} min`);
}

// ================= verify =================
// Read-only. Every applied row is re-read by primary key: none may still be dirty; rows changed or removed since are counted, not errors.
async function verify() {
  const planKey = new Map(readLines(P("plan.jsonl")).map((o) => [`${o.vin}|${o.dealer_id}`, o]));
  const applied = readLines(P("applied.jsonl")).map((o) => o); const conn = await pool.getConnection();
  const v = { appliedRows: applied.length, atPlannedValue: 0, cleanButDifferent: 0, stillDirty: 0, missing: 0 };
  for (const part of chunks(applied, 500)) {
    if (pastDeadline()) throw new StopRun(`hard stop ${dlText} during verify`);
    const rows = await q(conn, "verify read", `SELECT vin, dealer_id, make, trim FROM dealer_inventory WHERE ${pairWhere(part)}`, part.flatMap((o) => [o.vin, o.dealer_id]));
    const by = new Map(rows.map((r) => [`${r.vin}|${r.dealer_id}`, r]));
    for (const o of part) {
      const r = by.get(`${o.vin}|${o.dealer_id}`); if (!r) { v.missing++; continue; }
      if (classifyTrimChange(r.trim, r.make)) v.stillDirty++;
      else if (r.trim === planKey.get(`${o.vin}|${o.dealer_id}`)?.next) v.atPlannedValue++;
      else v.cleanButDifferent++; // a later crawl wrote a different (clean) trim
    }
    await sleep(100);
  }
  conn.release();
  console.log("VERIFY", JSON.stringify(v));
  if (v.stillDirty) process.exitCode = 1;
}

// ================= restore =================
async function restore() {
  const upto = Number(args["through-batch"] || 1e9);
  const applied = new Set(readLines(P("applied.jsonl")).filter((o) => o.batch <= upto).map((o) => `${o.vin}|${o.dealer_id}`));
  const lines = readLines(P("plan.jsonl")).filter((o) => applied.has(`${o.vin}|${o.dealer_id}`));
  console.log(`${args.go ? "RESTORE" : "[DRY] restore"} ${lines.length} rows`);
  if (!args.go) return;
  await takeLock("trim-reclean-restore");
  let restored = 0;
  try {
    for (const part0 of chunks(lines, BATCH)) {
      if (lostLock) throw new Error("lock lost");
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const groups = new Map();
        for (const r of part0) { const k = `${r.next}\u0001${r.old}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
        for (const [k, rs] of groups) {
          const [next, old] = k.split("\u0001");
          const sorted = rs.map((r) => [r.vin, r.dealer_id]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
          for (const part of chunks(sorted, PK_CHUNK)) { const res = await conn.query(`SET STATEMENT max_statement_time=${CAP} FOR UPDATE dealer_inventory SET trim = ? WHERE BINARY trim = BINARY ? AND (${pairWhere(part)})`, [old, next, ...part.flat()]); restored += res[0].affectedRows; }
        }
        await conn.commit();
      } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
      await sleep(PAUSE);
    }
    console.log(`restore done: ${restored} of ${lines.length} rows put back (the rest no longer held the cleaned trim)`);
  } finally { await releaseLock(); }
}

try { await ({ dryrun, plan, apply, verify, restore }[PHASE] || (() => { throw new Error("--phase=dryrun|plan|apply|verify|restore|selftest"); }))(); }
catch (err) { console.error(err instanceof StopRun ? `STOPPED: ${err.message}` : `FAILED: ${err.stack || err.message}`); process.exitCode = err instanceof StopRun ? 3 : 1; await releaseLock(); }
finally { await pool.end(); }
