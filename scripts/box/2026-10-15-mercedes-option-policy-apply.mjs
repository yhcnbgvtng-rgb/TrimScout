// Mercedes-Benz option-policy APPLY (the 2026-27 Mercedes-Benz policy: src/optionPolicies/mercedes-2026-2027.json) for the deals box. Three phases, one script:
//
//   plan     READ-ONLY (reader account, no lock). Reads Mercedes-Benz stock dealer-first (20 dealers per batch), classifies every policy-covered car with
//            the bundled policy, and writes into --out: backup.jsonl (the stored dealer_inventory_options rows of EVERY car the full apply would change),
//            plan.jsonl (what each of those cars should hold), batches.json (batch -> dealer ids).
//   apply    Takes the sync lock (heartbeated), then applies plan.jsonl batch by batch (one transaction per 20-dealer batch), checkpoint.json after
//            each batch, applied.jsonl lists exactly which cars were written. Resumes after checkpoint.lastBatch. Hard stop at --deadline-et.
//   restore  Puts the backup rows back for the cars in applied.jsonl (optionally only --through-batch=N). Dry unless --go.
//
// Limits: every query is capped at 20 s (SET STATEMENT max_statement_time=20). A first timeout is retried ONCE in a different shape (the batch's dealers
// split in two); a second timeout anywhere stops the run (lock released). The same query shape is never retried. Mercedes-Benz VIN/dealer pairs only.
// Never touches facets, deals-api, facet-cache.json or any other make (the car queries are make = 'Mercedes-Benz' AND year IN (2026, 2027)).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { buildAllowlist, loadBundledModelPoliciesRaw, optionRowsForVehicle, modelPoliciesFor } from "../../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const PHASE = args.phase;
const OUT = path.resolve(args.out || ".");
const BATCH = 20, CAP = 20;
const [DL_H, DL_M] = String(args["deadline-et"] || "20:40").split(":").map(Number);
const envFile = args.env || "/opt/trimscout-deals/.env.trimscout-db";
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const write = PHASE === "apply" || (PHASE === "restore" && args.go);
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: write ? env.DB_WRITER_USER : env.DB_READER_USER, password: write ? env.DB_WRITER_PASSWORD : env.DB_READER_PASSWORD, connectionLimit: 2 });
const DEALS = `http://127.0.0.1:${env.DEALS_API_PORT || 3004}`;
const P = (f) => path.join(OUT, f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etMin = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()); return Number(p.find((x) => x.type === "hour").value) % 24 * 60 + Number(p.find((x) => x.type === "minute").value); };
const pastDeadline = () => etMin() >= DL_H * 60 + DL_M;

let timeouts = 0, queries = 0, slowest = 0;
class StopRun extends Error {}
class Timeout extends Error {}
async function q(conn, shape, sql, params) {
  queries++; const t0 = Date.now();
  try { const [rows] = await conn.query(`SET STATEMENT max_statement_time=${CAP} FOR ${sql}`, params); slowest = Math.max(slowest, Date.now() - t0); return rows; }
  catch (err) {
    if (err && (err.errno === 1969 || /max_statement_time/.test(err.message))) {
      timeouts++; console.log(`  TIMEOUT (${CAP}s) in "${shape}" (timeout #${timeouts})`);
      if (timeouts >= 2) throw new StopRun(`a second query timed out ("${shape}") - stopping, nothing retried`);
      throw new Timeout(shape);
    }
    throw err;
  }
}
const sig = (k, l) => `${k}\u0001${l}`;
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// ---- lock ----
let owner = null, hb = null, lostLock = false, released = false;
const lockCall = async (action, extra = {}) => { const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": env.TRIMSCOUT_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) }); if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`); return r.json(); };
async function takeLock(tag) {
  owner = `${tag}-${process.pid}`;
  const l = await lockCall("acquire", { heartbeat: true });
  if (!l.acquired) { console.log(`LOCK BUSY - ${JSON.stringify(l)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`Sync lock taken as ${owner}`);
  hb = setInterval(async () => { try { const r = await lockCall("heartbeat"); if (!r.renewed) { lostLock = true; console.error(`LOCK LOST: ${JSON.stringify(r)}`); } } catch (e) { console.error(`heartbeat failed: ${e.message}`); } }, 30_000);
}
async function releaseLock() { if (released || !owner) return; released = true; clearInterval(hb); try { await lockCall("release"); console.log("Sync lock released."); } catch (e) { console.error(`RELEASE FAILED: ${e.message} (frees itself after 10 min without heartbeat)`); } }
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, async () => { console.error(`${s}: releasing lock`); await releaseLock(); process.exit(143); });

const allow = buildAllowlist(null, loadBundledModelPoliciesRaw());
const CAR_SQL = "SELECT vin, dealer_id, make, year, model, trim, options_json FROM dealer_inventory FORCE INDEX (idx_inv_by_dealer_covering) WHERE removed_at IS NULL AND dealer_id IN (?) AND make = 'Mercedes-Benz' AND year IN (2026, 2027)";
const ROW_SQL = "SELECT vin, dealer_id, canonical_key, label, code FROM dealer_inventory_options WHERE vin IN (?)";

// ================= plan =================
async function plan() {
  fs.mkdirSync(OUT, { recursive: true });
  const conn = await pool.getConnection();
  const started = Date.now();
  const ids = (await q(conn, "dealer ids", "SELECT DISTINCT dealer_id FROM dealer_inventory FORCE INDEX (idx_inv_stock_make_dealer) WHERE removed_at IS NULL AND make = 'Mercedes-Benz'", [])).map((r) => Number(r.dealer_id)).sort((a, b) => a - b);
  const batches = chunks(ids, BATCH).map((d, i) => ({ batch: i + 1, dealerIds: d }));
  fs.writeFileSync(P("batches.json"), JSON.stringify(batches));
  const bk = fs.openSync(P("backup.jsonl"), "w"), pl = fs.openSync(P("plan.jsonl"), "w");
  const t = { dealers: ids.length, batches: batches.length, policyCars: 0, skippedNoTrustedTrim: 0, changedCars: 0, backupRows: 0, rowsToRemove: 0, rowsToChangeLabel: 0, rowsToAdd: 0 };
  async function readDealers(dealerIds, label, canSplit) {
    try {
      const cars = await q(conn, `cars ${label}`, CAR_SQL, [dealerIds]);
      const pol = cars.filter((c) => modelPoliciesFor(allow, { make: c.make, model: c.model, year: c.year, trim: c.trim }).length);
      const vins = [...new Set(pol.map((c) => c.vin))]; const wanted = new Set(pol.map((c) => `${c.vin}|${c.dealer_id}`));
      const rows = [];
      for (const part of chunks(vins, 1000)) rows.push(...(await q(conn, `options ${label}`, ROW_SQL, [part])).filter((r) => wanted.has(`${r.vin}|${r.dealer_id}`)));
      return { pol, rows };
    } catch (e) {
      if (e instanceof Timeout && canSplit) { const mid = Math.ceil(dealerIds.length / 2); const a = await readDealers(dealerIds.slice(0, mid), `${label}a`, false), b = await readDealers(dealerIds.slice(mid), `${label}b`, false); return { pol: [...a.pol, ...b.pol], rows: [...a.rows, ...b.rows] }; }
      if (e instanceof Timeout) throw new StopRun(`timeout in split shape "${label}"`);
      throw e;
    }
  }
  for (const b of batches) {
    const { pol, rows } = await readDealers(b.dealerIds, `#${b.batch}`, true);
    const by = new Map();
    for (const r of rows) { const k = `${r.vin}|${r.dealer_id}`; (by.get(k) || by.set(k, []).get(k)).push([r.canonical_key, r.label, r.code ?? null]); }
    for (const c of pol) {
      t.policyCars++;
      let o = null; try { o = c.options_json ? (typeof c.options_json === "string" ? JSON.parse(c.options_json) : c.options_json) : null; } catch { o = null; }
      const res = optionRowsForVehicle(allow, { vin: c.vin, make: c.make, model: c.model, year: c.year, trim: c.trim }, Array.isArray(o) ? o : []);
      if (!res) continue;
      // No trusted trim (blank, or a trim the policy does not know): SKIP the car and leave its stored rows alone. Never plan a wipe from a trim we cannot read.
      if (!res.trimTrusted) { t.skippedNoTrustedTrim++; continue; }
      const before = by.get(`${c.vin}|${c.dealer_id}`) || [];
      const after = res.rows.map((r) => [r.key, r.label, r.code ?? null]);
      const bm = new Map(before.map((r) => [r[0], r[1]])), am = new Map(after.map((r) => [r[0], r[1]]));
      let rem = 0, rel = 0, add = 0;
      for (const [k, l] of bm) { if (!am.has(k)) rem++; else if (am.get(k) !== l) rel++; }
      for (const k of am.keys()) if (!bm.has(k)) add++;
      if (!rem && !rel && !add) continue;
      t.changedCars++; t.backupRows += before.length; t.rowsToRemove += rem; t.rowsToChangeLabel += rel; t.rowsToAdd += add;
      fs.writeSync(bk, JSON.stringify({ batch: b.batch, vin: c.vin, dealer_id: c.dealer_id, scope: res.scope, rows: before }) + "\n");
      fs.writeSync(pl, JSON.stringify({ batch: b.batch, vin: c.vin, dealer_id: c.dealer_id, after }) + "\n");
    }
    if (b.batch % 50 === 0) console.log(`  plan batch ${b.batch}/${batches.length}, ${t.changedCars} cars to change, ${queries} queries, slowest ${slowest} ms`);
  }
  fs.fsyncSync(bk); fs.fsyncSync(pl); fs.closeSync(bk); fs.closeSync(pl);
  const md5 = crypto.createHash("md5").update(fs.readFileSync(P("backup.jsonl"))).digest("hex");
  const summary = { ...t, queries, timeouts, slowestQueryMs: slowest, elapsedS: Math.round((Date.now() - started) / 1000), backupFile: P("backup.jsonl"), backupFileLines: t.changedCars, backupMd5: md5, backupBytes: fs.statSync(P("backup.jsonl")).size };
  fs.writeFileSync(P("plan-summary.json"), JSON.stringify(summary, null, 1)); console.log("PLAN DONE", JSON.stringify(summary, null, 1));
  conn.release();
}

// ================= apply =================
async function apply() {
  const batches = JSON.parse(fs.readFileSync(P("batches.json"), "utf8"));
  const backupBy = new Map(), planBy = new Map();
  for (const l of fs.readFileSync(P("backup.jsonl"), "utf8").split("\n").filter(Boolean)) { const o = JSON.parse(l); (backupBy.get(o.batch) || backupBy.set(o.batch, []).get(o.batch)).push(o); }
  for (const l of fs.readFileSync(P("plan.jsonl"), "utf8").split("\n").filter(Boolean)) { const o = JSON.parse(l); (planBy.get(o.batch) || planBy.set(o.batch, []).get(o.batch)).push(o); }
  let ck = { lastBatch: 0, batchesDone: 0, totalBatches: batches.length, carsApplied: 0, carsSkippedStale: 0, rowsDeleted: 0, rowsInserted: 0, lastDealerId: null };
  try { ck = { ...ck, ...JSON.parse(fs.readFileSync(P("checkpoint.json"), "utf8")) }; } catch {}
  const totalCars = [...planBy.values()].reduce((a, b) => a + b.length, 0), totalRows = [...backupBy.values()].reduce((a, b) => a + b.reduce((x, y) => x + y.rows.length, 0), 0);
  console.log(`APPLY resume after batch ${ck.lastBatch} of ${batches.length}; plan = ${totalCars} cars / ${totalRows} stored rows; deadline ${DL_H}:${String(DL_M).padStart(2, "0")} ET`);
  const saveCk = () => { const tmp = P("checkpoint.json.tmp"); const fd = fs.openSync(tmp, "w"); fs.writeSync(fd, JSON.stringify({ ...ck, savedAt: new Date().toISOString() }, null, 1)); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(tmp, P("checkpoint.json")); };
  const ap = fs.openSync(P("applied.jsonl"), "a");
  await takeLock("mercedes-option-policy-apply");
  const started = Date.now(); let stopReason = "all batches done";
  try {
    // applies the planned cars of `plans` (a subset of one batch) in one transaction
    async function applyCars(plans, label, canSplit) {
      if (!plans.length) return { applied: 0, stale: 0, del: 0, ins: 0 };
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const vins = plans.map((p) => p.vin);
        const cur = await q(conn, `guard ${label}`, "SELECT vin, dealer_id, canonical_key, label FROM dealer_inventory_options WHERE vin IN (?)", [vins]);
        const curBy = new Map(); for (const r of cur) { const k = `${r.vin}|${r.dealer_id}`; (curBy.get(k) || curBy.set(k, []).get(k)).push(sig(r.canonical_key, r.label)); }
        const bkByKey = new Map(backupBy.get(plans[0].batch).map((b) => [`${b.vin}|${b.dealer_id}`, b]));
        const ok = [], stale = [];
        for (const p of plans) {
          const k = `${p.vin}|${p.dealer_id}`; const b = bkByKey.get(k);
          const want = new Set((b?.rows || []).map((r) => sig(r[0], r[1]))), have = new Set(curBy.get(k) || []);
          (b && want.size === have.size && [...want].every((s) => have.has(s)) ? ok : stale).push(p);
        }
        let del = 0, ins = 0;
        const pairs = ok.map((p) => [p.vin, p.dealer_id]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
        for (const part of chunks(pairs, 100)) {
          const r = await conn.query(`SET STATEMENT max_statement_time=${CAP} FOR DELETE FROM dealer_inventory_options WHERE ${part.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")}`, part.flat()).catch((e) => { if (e && (e.errno === 1969 || /max_statement_time/.test(e.message))) { timeouts++; console.log(`  TIMEOUT in delete ${label} (#${timeouts})`); throw timeouts >= 2 ? new StopRun("a second query timed out (delete) - stopping") : new Timeout("delete"); } throw e; });
          del += r[0].affectedRows; queries++;
        }
        const rows = ok.flatMap((p) => p.after.map((a) => [p.vin, p.dealer_id, a[0], a[1], a[2]]));
        for (const part of chunks(rows, 1000)) { await q(conn, `insert ${label}`, "INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ?", [part]); ins += part.length; }
        for (const p of ok) fs.writeSync(ap, JSON.stringify({ batch: p.batch, vin: p.vin, dealer_id: p.dealer_id }) + "\n");
        fs.fsyncSync(ap); // applied.jsonl is on disk before the commit, so restore never misses a written car (it may list one that rolled back; restoring that is a no-op)
        await conn.commit();
        return { applied: ok.length, stale: stale.length, del, ins };
      } catch (e) {
        await conn.rollback().catch(() => {});
        if (e instanceof Timeout && canSplit) { const mid = Math.ceil(plans.length / 2); const a = await applyCars(plans.slice(0, mid), `${label}a`, false), b = await applyCars(plans.slice(mid), `${label}b`, false); return { applied: a.applied + b.applied, stale: a.stale + b.stale, del: a.del + b.del, ins: a.ins + b.ins }; }
        if (e instanceof Timeout) throw new StopRun(`timeout in split shape "${label}"`);
        throw e;
      } finally { conn.release(); }
    }
    for (const b of batches) {
      if (b.batch <= ck.lastBatch) continue;
      if (lostLock) { stopReason = "sync lock lost"; break; }
      if (pastDeadline()) { stopReason = `deadline ${DL_H}:${String(DL_M).padStart(2, "0")} ET`; break; }
      const r = await applyCars(planBy.get(b.batch) || [], `#${b.batch}`, true);
      ck.lastBatch = b.batch; ck.batchesDone++; ck.carsApplied += r.applied; ck.carsSkippedStale += r.stale; ck.rowsDeleted += r.del; ck.rowsInserted += r.ins; ck.lastDealerId = b.dealerIds[b.dealerIds.length - 1];
      ck.runSeconds = Math.round((Date.now() - started) / 1000); saveCk();
      if (b.batch % 25 === 0) console.log(`  batch ${b.batch}/${batches.length}: ${ck.carsApplied} cars, ${ck.rowsDeleted} rows deleted, ${Math.round((Date.now() - started) / 60000)} min`);
      await sleep(100);
    }
  } catch (e) { stopReason = e instanceof StopRun ? e.message : `ERROR ${e.stack || e.message}`; process.exitCode = e instanceof StopRun ? 3 : 1; }
  finally { saveCk(); fs.closeSync(ap); await releaseLock(); }
  const mins = (Date.now() - started) / 60000;
  console.log(`APPLY STOPPED: ${stopReason}. batches ${ck.lastBatch}/${batches.length}, cars ${ck.carsApplied}/${totalCars} (stale-skipped ${ck.carsSkippedStale}), rows deleted ${ck.rowsDeleted}/${totalRows} (stored rows of planned cars), ${mins.toFixed(1)} min, ${(ck.rowsDeleted / mins).toFixed(0)} rows/min, queries ${queries}, timeouts ${timeouts}, slowest ${slowest} ms`);
}

// ================= restore =================
async function restore() {
  const upto = Number(args["through-batch"] || 1e9);
  const applied = new Set(fs.readFileSync(P("applied.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.batch <= upto).map((o) => `${o.vin}|${o.dealer_id}`));
  // --only=<file.json>: a JSON array of "vin|dealer_id" keys. Restores just those cars (a targeted restore), and only cars that STILL hold no rows when the
  // restore runs (checked inside the lock): a car whose rows were rewritten since is never overwritten. Without --only: every applied car, as before.
  const only = args.only ? new Set(JSON.parse(fs.readFileSync(path.resolve(String(args.only)), "utf8"))) : null;
  if (only) for (const k of only) if (!applied.has(k)) throw new Error(`--only lists ${k}, which this apply never changed`);
  let lines = fs.readFileSync(P("backup.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => applied.has(`${o.vin}|${o.dealer_id}`) && (!only || only.has(`${o.vin}|${o.dealer_id}`)));
  console.log(`${args.go ? "RESTORE" : "[DRY] restore"}${only ? " (--only)" : ""} ${lines.length} cars (${lines.reduce((a, b) => a + b.rows.length, 0)} rows)`);
  if (!args.go) return;
  await takeLock("mercedes-option-policy-restore");
  let skippedHasRows = 0;
  try {
    for (const part0 of chunks(lines, 100)) {
      if (lostLock) throw new Error("lock lost");
      let part = part0;
      if (only) {
        const have = await q(pool, "restore check", "SELECT vin, dealer_id FROM dealer_inventory_options WHERE vin IN (?) GROUP BY vin, dealer_id", [[...new Set(part0.map((c) => c.vin))]]);
        const hasRows = new Set(have.map((r) => `${r.vin}|${r.dealer_id}`));
        part = part0.filter((c) => !hasRows.has(`${c.vin}|${c.dealer_id}`)); skippedHasRows += part0.length - part.length;
        if (!part.length) continue;
      }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const sp = part.map((c) => [c.vin, c.dealer_id]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
        await q(conn, "restore delete", `DELETE FROM dealer_inventory_options WHERE ${sp.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")}`, sp.flat());
        const ins = part.flatMap((c) => c.rows.map((r) => [c.vin, c.dealer_id, r[0], r[1], r[2]]));
        for (const p of chunks(ins, 1000)) await q(conn, "restore insert", "INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ?", [p]);
        await conn.commit();
      } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
    }
    console.log(`restore done${only ? ` (${skippedHasRows} cars skipped because they hold rows again)` : ""}`);
  } finally { await releaseLock(); }
}

try { await ({ plan, apply, restore }[PHASE] || (() => { throw new Error("--phase=plan|apply|restore"); }))(); }
catch (err) { console.error(err instanceof StopRun ? `STOPPED: ${err.message}` : `FAILED: ${err.stack || err.message}`); process.exitCode = err instanceof StopRun ? 3 : 1; await releaseLock(); }
finally { await pool.end(); }
