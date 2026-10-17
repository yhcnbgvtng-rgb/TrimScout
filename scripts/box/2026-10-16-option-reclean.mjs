// Option RE-CLEAN of stored rows for the policy makes (Toyota, Ford, Chevrolet, GMC, Buick, Cadillac, Honda, Kia, Hyundai, Audi, BMW, Mercedes-Benz,
// Subaru, Nissan, Mazda): the current global junk list (src/optionJunkRules.json, 10 rules + rewrites) and the model policies applied to what
// dealer_inventory_options holds today. Same flow and rails as the Audi apply (2026-10-15-audi-option-policy-apply.mjs). Phases, one script:
//
//   dryrun   READ-ONLY, reader account, no lock, WRITES NOTHING (no files, no DB): counts per make (cars that would change, rows removed, ...) and the
//            top 30 labels removed. Keeps no VIN and no row anywhere. Refuses while the sync lock is held.
//   plan     READ-ONLY (reader account, no lock). Same reads, dealer-first in 20-dealer batches per make; writes into --out: backup.jsonl (the stored rows of
//            EVERY car the apply would change), plan.jsonl (what each should hold), batches.json (batch -> make + dealer ids), plan-summary.json.
//   apply    Takes the sync lock (heartbeated), applies plan.jsonl batch by batch (one transaction per 20-dealer batch), checkpoint.json after each batch,
//            applied.jsonl lists exactly which cars were written. Resumes after checkpoint.lastBatch. HARD STOP at --deadline-et (default 21:40 ET).
//   verify   READ-ONLY. Re-reads the applied cars: none may still be dirty, every paid sticker line the backup held must still be there.
//   restore  Puts the backup rows back for the cars in applied.jsonl (optionally --through-batch=N, --only=file.json). Dry unless --go.
//
// Skips: a car with a blank trim, and a policy-covered car whose trim the policy does not trust, are never touched. A paid sticker line of the car's own
// trim is never removed. Cars no policy covers only lose rows a `junk:*` rule drops (or get a rewrite such as SiriusXM); nothing is ever added to them.
//
// Limits: every query is capped at 20 s (SET STATEMENT max_statement_time=20). A first timeout is retried ONCE in a different shape (the batch's dealers
// split in two); a second timeout anywhere stops the run (lock released). Never touches facets, deals-api, facet-cache.json or the other tables.
//
// The box has no checkout. Ship it as ONE stdin-piped bundle (engine + junk list + all 16 policies inlined; nothing is written on the box by the dry run):
//   node scripts/box/2026-10-16-option-reclean.mjs --emit | ssh box2 'cd /opt/trimscout-deals && node --input-type=module - --phase=dryrun'
// Flags: --makes=Audi,Kia (default all 15)  --stride=K (dryrun/plan: only cars with MOD(CRC32(vin),K)=0)  --deadline-et=HH:MM  --out=DIR  --env=FILE
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildAllowlist, loadBundledModelPoliciesRaw } from "../../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";
import { compileJunkRules, setJunkRules } from "../../scrapers/lightsail-crawler/src/inventoryOptionRows.js";
import { recleanCar, buildPolicyMatchIndex, RECLEAN_MAKES } from "../lib/optionReclean.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));

if (args.emit) { // bundle this script with the engine and the data it needs into one ESM file on stdout
  const esbuild = await import("esbuild");
  const src = path.join(here, "..", "..", "scrapers", "lightsail-crawler", "src");
  const inline = { rules: JSON.parse(fs.readFileSync(path.join(src, "optionJunkRules.json"), "utf8")), policies: loadBundledModelPoliciesRaw() };
  const out = await esbuild.build({ entryPoints: [fileURLToPath(import.meta.url)], bundle: true, write: false, platform: "node", format: "esm", target: "node18", external: ["mysql2", "esbuild"], banner: { js: `globalThis.__INLINE__ = ${JSON.stringify(inline)};` }, logLevel: "error" });
  await new Promise((resolve) => process.stdout.write(out.outputFiles[0].text, resolve)); // wait for the flush: exiting early cuts a 4 MB pipe write short
  process.exit(0);
}

const INL = globalThis.__INLINE__;
const policies = INL ? INL.policies : loadBundledModelPoliciesRaw();
const rulesRaw = INL ? INL.rules : JSON.parse(fs.readFileSync(path.join(here, "..", "..", "scrapers", "lightsail-crawler", "src", "optionJunkRules.json"), "utf8"));
const compiled = compileJunkRules(rulesRaw);
if (compiled.errors.length) throw new Error(`junk rules do not compile: ${compiled.errors.join("; ")}`);
setJunkRules(compiled);
const allow = buildAllowlist(null, policies);
const CTX = { allow };
const MATCH = buildPolicyMatchIndex(allow);
const normMake = (m) => String(m).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const PHASE = args.phase;
const OUT = path.resolve(args.out || ".");
const BATCH = 20, CAP = 20;
const [DL_H, DL_M] = String(args["deadline-et"] || "21:40").split(":").map(Number);
const STRIDE = Math.max(1, Number(args.stride || 1));
const MAKES = args.makes ? String(args.makes).split(",").map((s) => s.trim()).filter(Boolean) : [...RECLEAN_MAKES];
for (const m of MAKES) if (!RECLEAN_MAKES.includes(m)) throw new Error(`--makes: "${m}" is not a policy make (${RECLEAN_MAKES.join(", ")})`);
const P = (f) => path.join(OUT, f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etMin = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()); return Number(p.find((x) => x.type === "hour").value) % 24 * 60 + Number(p.find((x) => x.type === "minute").value); };
const pastDeadline = () => etMin() >= DL_H * 60 + DL_M;
const dlText = `${DL_H}:${String(DL_M).padStart(2, "0")} ET`;

if (PHASE === "selftest") { // no DB: one synthetic car through the engine, proves the bundle (or the checkout) loads policies and junk rules
  const car = { vin: "SELFTEST", dealer_id: 0, make: "Audi", model: "Q9", year: 2027, trim: "Prestige TFSI quattro tiptronic", options_json: [{ name: "Trailer hitch" }, { name: "Roadside Assistance" }] };
  const r = recleanCar(CTX, car, [["trailerhitch", "Trailer hitch", null], ["roadsideassistance", "Roadside Assistance", null]]);
  console.log(JSON.stringify({ junkRules: compiled.rules.length, policyScopes: Object.keys(policies).length, status: r.status, removed: r.removed?.map((x) => x.label), after: r.after?.map((x) => x[1]) }));
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
const sig = (k, l) => `${k}\u0001${l}`;
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);

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
const lockHeld = () => { // read-only look at deals-api's own log (the dry run takes no lock, so it only checks)
  const f = "/home/ubuntu/.pm2/logs/deals-api-out.log", fd = fs.openSync(f, "r"), size = fs.fstatSync(fd).size, len = Math.min(size, 4_000_000), buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
  return /\bacquire\b/.test(buf.toString("utf8").split("\n").filter((l) => l.includes("[sync-lock]")).pop() || "");
};

const STRIDE_SQL = STRIDE > 1 ? ` AND MOD(CRC32(vin), ${STRIDE}) = 0` : "";
const CAR_SQL = `SELECT vin, dealer_id, make, year, model, \`trim\`, options_json FROM dealer_inventory FORCE INDEX (idx_inv_by_dealer_covering) WHERE removed_at IS NULL AND dealer_id IN (?) AND make = ?${STRIDE_SQL}`;
const ROW_SQL = "SELECT vin, dealer_id, canonical_key, label, code FROM dealer_inventory_options WHERE vin IN (?)";

// Reads the cars of one make at these dealers plus the rows they hold; a timeout is retried once with the dealers split in two.
async function readDealers(conn, make, dealerIds, label, canSplit) {
  try {
    const cars = await q(conn, `cars ${label}`, CAR_SQL, [dealerIds, make]);
    const vins = [...new Set(cars.map((c) => c.vin))]; const wanted = new Set(cars.map((c) => `${c.vin}|${c.dealer_id}`));
    const by = new Map();
    for (const part of chunks(vins, 1000)) for (const r of (await q(conn, `options ${label}`, ROW_SQL, [part])).filter((x) => wanted.has(`${x.vin}|${x.dealer_id}`))) { const k = `${r.vin}|${r.dealer_id}`; (by.get(k) || by.set(k, []).get(k)).push([r.canonical_key, r.label, r.code ?? null]); }
    return { cars, by };
  } catch (e) {
    if (e instanceof Timeout && canSplit) { const mid = Math.ceil(dealerIds.length / 2); const a = await readDealers(conn, make, dealerIds.slice(0, mid), `${label}a`, false), b = await readDealers(conn, make, dealerIds.slice(mid), `${label}b`, false); return { cars: [...a.cars, ...b.cars], by: new Map([...a.by, ...b.by]) }; }
    if (e instanceof Timeout) throw new StopRun(`timeout in split shape "${label}"`);
    throw e;
  }
}

// ---- tallies (counts and label text only; no VIN, no row) ----
const newStat = () => ({ carsScanned: 0, policyCars: 0, uncoveredCars: 0, skippedBlankTrim: 0, skippedUntrustedTrim: 0, carsChanged: 0, rowsRemoved: 0, rowsRewritten: 0, rowsRelabeled: 0, rowsAdded: 0, paidLinesKept: 0, legacyOnlyNotApplied: 0, backupRows: 0 });
const stats = new Map(MAKES.map((m) => [m, newStat()]));
const labelCounts = new Map(), ruleCounts = new Map(), policyHits = new Map();
const ownTrimPaidRemoved = { n: 0 };
function tally(make, car, res, storedCount) {
  const s = stats.get(make); s.carsScanned++;
  s[res.covered ? "policyCars" : "uncoveredCars"]++;
  if (res.status === "skip-blank-trim") { s.skippedBlankTrim++; return; }
  if (res.status === "skip-untrusted-trim") { s.skippedUntrustedTrim++; return; }
  s.legacyOnlyNotApplied += res.legacyOnly || 0; s.paidLinesKept += res.paidKept || 0;
  if (res.status !== "change") return;
  s.carsChanged++; s.backupRows += storedCount;
  for (const r of res.removed) {
    if (r.rule === "rewrite") continue;
    s.rowsRemoved++; bump(ruleCounts, r.rule); bump(labelCounts, `${make}\u0001${r.label.replace(/\s+/g, " ").trim().slice(0, 80)}\u0001${r.rule}`);
    // Does the removed row match an entry of ANY policy of this make? (a paid sticker line must never be on the removal list for the car's own trim)
    for (const h of MATCH.get(normMake(make))?.get(r.key) || []) {
      const own = res.covered && h.scope === res.scope && h.trim === res.ownTrimLabel;
      const where = own ? "own-trim" : res.covered && h.scope === res.scope ? "other-trim-same-model" : "other-policy";
      if (own && h.paid) ownTrimPaidRemoved.n++;
      bump(policyHits, `${make}\u0001${h.paid ? "PAID" : "unpaid"}\u0001${where}\u0001${h.label}\u0001${h.scope}|${h.trim}`);
    }
  }
  s.rowsRewritten += res.rewritten || 0; s.rowsRelabeled += res.relabeled || 0; s.rowsAdded += res.added || 0;
}
function report(extra) {
  const total = newStat(); for (const s of stats.values()) for (const k of Object.keys(total)) total[k] += s[k];
  const perMakeTop = Object.fromEntries(MAKES.map((m) => [m, [...labelCounts.entries()].map(([k, n]) => ({ k: k.split("\u0001"), n })).filter((x) => x.k[0] === m).sort((a, b) => b.n - a.n).slice(0, 30).map((x) => ({ label: x.k[1], rule: x.k[2], rows: x.n }))]));
  const hits = [...policyHits.entries()].map(([k, n]) => { const [make, paid, where, label, trim] = k.split("\u0001"); return { make, paid, where, label, policyTrim: trim, rows: n }; }).sort((a, b) => b.rows - a.rows);
  const policyMatches = { removedRowsMatchingAnyPolicyEntry: hits.reduce((n, h) => n + h.rows, 0), ownTrimPaidLinesRemoved: ownTrimPaidRemoved.n, paidOtherTrimOrPolicy: hits.filter((h) => h.paid === "PAID"), unpaid: hits.filter((h) => h.paid !== "PAID").slice(0, 100) };
  return { ...extra, makes: MAKES, stride: STRIDE, junkRules: compiled.rules.length, junkRulesVersion: compiled.version, perMake: Object.fromEntries(stats), total, rowsRemovedByRule: [...ruleCounts.entries()].sort((a, b) => b[1] - a[1]), top30LabelsRemovedPerMake: perMakeTop, policyMatches, queries, timeouts, slowestQueryMs: slowest };
}
async function dealerIdsFor(conn, make) {
  return (await q(conn, `dealer ids ${make}`, "SELECT DISTINCT dealer_id FROM dealer_inventory FORCE INDEX (idx_inv_stock_make_dealer) WHERE removed_at IS NULL AND make = ?", [make])).map((r) => Number(r.dealer_id)).sort((a, b) => a - b);
}
const batchesFor = async (conn) => { const out = []; let n = 0; for (const make of MAKES) { const ids = await dealerIdsFor(conn, make); for (const d of chunks(ids, BATCH)) out.push({ batch: ++n, make, dealerIds: d }); } return out; };

// ================= dryrun =================
async function dryrun() {
  if (lockHeld()) throw new StopRun("the sync lock is held - not reading now");
  const conn = await pool.getConnection(); const started = Date.now();
  const batches = await batchesFor(conn); let stopReason = "all batches done";
  console.error(`dryrun: ${batches.length} batches of <=${BATCH} dealers over ${MAKES.length} makes, stride ${STRIDE}, hard stop ${dlText}`);
  for (const b of batches) {
    if (pastDeadline()) { stopReason = `deadline ${dlText}`; break; }
    if (lockHeld()) { stopReason = "the sync lock was taken - stopped"; break; }
    const { cars, by } = await readDealers(conn, b.make, b.dealerIds, `#${b.batch}`, true);
    for (const c of cars) { const st = by.get(`${c.vin}|${c.dealer_id}`) || []; tally(b.make, c, recleanCar(CTX, c, st), st.length); }
    if (b.batch % 50 === 0) console.error(`  batch ${b.batch}/${batches.length} (${b.make}), ${queries} queries, slowest ${slowest} ms, ${Math.round((Date.now() - started) / 60000)} min`);
    await sleep(250);
  }
  conn.release();
  console.log(JSON.stringify(report({ phase: "dryrun", complete: stopReason === "all batches done", stopReason, batches: batches.length, elapsedS: Math.round((Date.now() - started) / 1000), wrote: "nothing", readerAccount: true }), null, 1));
}

// ================= plan =================
async function plan() {
  if (lockHeld()) throw new StopRun("the sync lock is held - not reading now");
  fs.mkdirSync(OUT, { recursive: true });
  const conn = await pool.getConnection(); const started = Date.now();
  const batches = await batchesFor(conn);
  fs.writeFileSync(P("batches.json"), JSON.stringify(batches));
  const bk = fs.openSync(P("backup.jsonl"), "w"), pl = fs.openSync(P("plan.jsonl"), "w"); let stopReason = "all batches done";
  for (const b of batches) {
    if (pastDeadline()) { stopReason = `deadline ${dlText}`; break; }
    if (lockHeld()) { stopReason = "the sync lock was taken - stopped"; break; }
    const { cars, by } = await readDealers(conn, b.make, b.dealerIds, `#${b.batch}`, true);
    for (const c of cars) {
      const before = by.get(`${c.vin}|${c.dealer_id}`) || [];
      const res = recleanCar(CTX, c, before); tally(b.make, c, res, before.length);
      if (res.status !== "change") continue;
      fs.writeSync(bk, JSON.stringify({ batch: b.batch, make: b.make, vin: c.vin, dealer_id: c.dealer_id, scope: res.scope || null, rows: before, paid: res.paid }) + "\n");
      fs.writeSync(pl, JSON.stringify({ batch: b.batch, vin: c.vin, dealer_id: c.dealer_id, after: res.after }) + "\n");
    }
    await sleep(250);
    if (b.batch % 50 === 0) console.log(`  plan batch ${b.batch}/${batches.length} (${b.make}), ${queries} queries, slowest ${slowest} ms`);
  }
  fs.fsyncSync(bk); fs.fsyncSync(pl); fs.closeSync(bk); fs.closeSync(pl);
  const md5 = crypto.createHash("md5").update(fs.readFileSync(P("backup.jsonl"))).digest("hex");
  const summary = report({ phase: "plan", complete: stopReason === "all batches done", stopReason, batches: batches.length, elapsedS: Math.round((Date.now() - started) / 1000), backupFile: P("backup.jsonl"), backupMd5: md5, backupBytes: fs.statSync(P("backup.jsonl")).size });
  fs.writeFileSync(P("plan-summary.json"), JSON.stringify(summary, null, 1)); console.log("PLAN DONE", JSON.stringify(summary, null, 1));
  conn.release();
}

// ================= apply =================
async function apply() {
  const summary = JSON.parse(fs.readFileSync(P("plan-summary.json"), "utf8"));
  if (!summary.complete) throw new Error("the plan is incomplete (it stopped early) - re-run --phase=plan");
  if (summary.stride > 1) throw new Error("the plan was made with --stride - re-run --phase=plan without it");
  const batches = JSON.parse(fs.readFileSync(P("batches.json"), "utf8"));
  const backupBy = new Map(), planBy = new Map();
  for (const l of fs.readFileSync(P("backup.jsonl"), "utf8").split("\n").filter(Boolean)) { const o = JSON.parse(l); (backupBy.get(o.batch) || backupBy.set(o.batch, []).get(o.batch)).push(o); }
  for (const l of fs.readFileSync(P("plan.jsonl"), "utf8").split("\n").filter(Boolean)) { const o = JSON.parse(l); (planBy.get(o.batch) || planBy.set(o.batch, []).get(o.batch)).push(o); }
  let ck = { lastBatch: 0, batchesDone: 0, totalBatches: batches.length, carsApplied: 0, carsSkippedStale: 0, carsSkippedPaidGuard: 0, rowsDeleted: 0, rowsInserted: 0, lastDealerId: null, lastMake: null };
  try { ck = { ...ck, ...JSON.parse(fs.readFileSync(P("checkpoint.json"), "utf8")) }; } catch {}
  const totalCars = [...planBy.values()].reduce((a, b) => a + b.length, 0), totalRows = [...backupBy.values()].reduce((a, b) => a + b.reduce((x, y) => x + y.rows.length, 0), 0);
  console.log(`APPLY resume after batch ${ck.lastBatch} of ${batches.length}; plan = ${totalCars} cars / ${totalRows} stored rows; hard stop ${dlText}`);
  const saveCk = () => { const tmp = P("checkpoint.json.tmp"); const fd = fs.openSync(tmp, "w"); fs.writeSync(fd, JSON.stringify({ ...ck, savedAt: new Date().toISOString() }, null, 1)); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(tmp, P("checkpoint.json")); };
  const ap = fs.openSync(P("applied.jsonl"), "a");
  await takeLock("option-reclean-apply");
  const started = Date.now(); let stopReason = "all batches done";
  try {
    async function applyCars(plans, label, canSplit) {
      if (!plans.length) return { applied: 0, stale: 0, guard: 0, del: 0, ins: 0 };
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const cur = await q(conn, `guard ${label}`, "SELECT vin, dealer_id, canonical_key, label FROM dealer_inventory_options WHERE vin IN (?)", [plans.map((p) => p.vin)]);
        const curBy = new Map(); for (const r of cur) { const k = `${r.vin}|${r.dealer_id}`; (curBy.get(k) || curBy.set(k, []).get(k)).push(sig(r.canonical_key, r.label)); }
        const bkByKey = new Map(backupBy.get(plans[0].batch).map((b) => [`${b.vin}|${b.dealer_id}`, b]));
        const ok = [], stale = [], guard = [];
        for (const p of plans) {
          const k = `${p.vin}|${p.dealer_id}`; const b = bkByKey.get(k);
          const want = new Set((b?.rows || []).map((r) => sig(r[0], r[1]))), have = new Set(curBy.get(k) || []);
          if (!(b && want.size === have.size && [...want].every((s) => have.has(s)))) { stale.push(p); continue; } // rows changed since the plan: leave the car alone
          const afterKeys = new Set(p.after.map((r) => r[0]));
          if ((b.paid || []).some((key) => !afterKeys.has(key))) { guard.push(p); continue; } // would lose a paid sticker line: never
          ok.push(p);
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
        return { applied: ok.length, stale: stale.length, guard: guard.length, del, ins };
      } catch (e) {
        await conn.rollback().catch(() => {});
        if (e instanceof Timeout && canSplit) { const mid = Math.ceil(plans.length / 2); const a = await applyCars(plans.slice(0, mid), `${label}a`, false), b = await applyCars(plans.slice(mid), `${label}b`, false); return { applied: a.applied + b.applied, stale: a.stale + b.stale, guard: a.guard + b.guard, del: a.del + b.del, ins: a.ins + b.ins }; }
        if (e instanceof Timeout) throw new StopRun(`timeout in split shape "${label}"`);
        throw e;
      } finally { conn.release(); }
    }
    for (const b of batches) {
      if (b.batch <= ck.lastBatch) continue;
      if (lostLock) { stopReason = "sync lock lost"; break; }
      if (pastDeadline()) { stopReason = `hard stop ${dlText}`; break; }
      const r = await applyCars(planBy.get(b.batch) || [], `#${b.batch}`, true);
      ck.lastBatch = b.batch; ck.batchesDone++; ck.carsApplied += r.applied; ck.carsSkippedStale += r.stale; ck.carsSkippedPaidGuard += r.guard; ck.rowsDeleted += r.del; ck.rowsInserted += r.ins; ck.lastDealerId = b.dealerIds[b.dealerIds.length - 1]; ck.lastMake = b.make;
      ck.runSeconds = Math.round((Date.now() - started) / 1000); saveCk();
      if (b.batch % 25 === 0) console.log(`  batch ${b.batch}/${batches.length} (${b.make}): ${ck.carsApplied} cars, ${ck.rowsDeleted} rows deleted, ${Math.round((Date.now() - started) / 60000)} min`);
      await sleep(100);
    }
  } catch (e) { stopReason = e instanceof StopRun ? e.message : `ERROR ${e.stack || e.message}`; process.exitCode = e instanceof StopRun ? 3 : 1; }
  finally { saveCk(); fs.closeSync(ap); await releaseLock(); }
  const mins = (Date.now() - started) / 60000;
  console.log(`APPLY STOPPED: ${stopReason}. batches ${ck.lastBatch}/${batches.length}, cars ${ck.carsApplied}/${totalCars} (stale-skipped ${ck.carsSkippedStale}, paid-guard-skipped ${ck.carsSkippedPaidGuard}), rows deleted ${ck.rowsDeleted}/${totalRows}, ${mins.toFixed(1)} min, queries ${queries}, timeouts ${timeouts}, slowest ${slowest} ms`);
}

// ================= verify =================
// Read-only. Every applied car is re-read and re-evaluated: none may still have something to change, and every paid line the backup held must still be there.
async function verify() {
  const batches = new Map(JSON.parse(fs.readFileSync(P("batches.json"), "utf8")).map((b) => [b.batch, b]));
  const appliedBy = new Map();
  for (const l of fs.readFileSync(P("applied.jsonl"), "utf8").split("\n").filter(Boolean)) { const o = JSON.parse(l); (appliedBy.get(o.batch) || appliedBy.set(o.batch, new Set()).get(o.batch)).add(`${o.vin}|${o.dealer_id}`); }
  const paidBy = new Map();
  for (const l of fs.readFileSync(P("backup.jsonl"), "utf8").split("\n").filter(Boolean)) { const o = JSON.parse(l); if (o.paid?.length) paidBy.set(`${o.vin}|${o.dealer_id}`, o.paid); }
  const conn = await pool.getConnection();
  const v = { appliedCars: 0, stillDirty: 0, paidLinesLost: 0, carsMissing: 0 };
  for (const [n, set] of [...appliedBy.entries()].sort((a, b) => a[0] - b[0])) {
    if (pastDeadline()) throw new StopRun(`hard stop ${dlText} during verify`);
    const b = batches.get(n); const { cars, by } = await readDealers(conn, b.make, b.dealerIds, `verify #${n}`, true);
    const seen = new Set();
    for (const c of cars) {
      const k = `${c.vin}|${c.dealer_id}`; if (!set.has(k)) continue;
      seen.add(k); v.appliedCars++;
      const have = by.get(k) || [];
      if (recleanCar(CTX, c, have).status === "change") v.stillDirty++;
      const keys = new Set(have.map((r) => r[0]));
      for (const pk of paidBy.get(k) || []) if (!keys.has(pk)) v.paidLinesLost++;
    }
    v.carsMissing += [...set].filter((k) => !seen.has(k)).length; // sold / removed since: not an error
    await sleep(100);
  }
  conn.release();
  console.log("VERIFY", JSON.stringify(v));
  if (v.paidLinesLost) process.exitCode = 1;
}

// ================= restore =================
async function restore() {
  const upto = Number(args["through-batch"] || 1e9);
  const applied = new Set(fs.readFileSync(P("applied.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.batch <= upto).map((o) => `${o.vin}|${o.dealer_id}`));
  // --only=<file.json>: a JSON array of "vin|dealer_id" keys. Restores just those cars, and only cars that STILL hold no rows when the restore runs
  // (checked inside the lock): a car whose rows were rewritten since is never overwritten. Without --only: every applied car.
  const only = args.only ? new Set(JSON.parse(fs.readFileSync(path.resolve(String(args.only)), "utf8"))) : null;
  if (only) for (const k of only) if (!applied.has(k)) throw new Error(`--only lists ${k}, which this apply never changed`);
  const lines = fs.readFileSync(P("backup.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => applied.has(`${o.vin}|${o.dealer_id}`) && (!only || only.has(`${o.vin}|${o.dealer_id}`)));
  console.log(`${args.go ? "RESTORE" : "[DRY] restore"}${only ? " (--only)" : ""} ${lines.length} cars (${lines.reduce((a, b) => a + b.rows.length, 0)} rows)`);
  if (!args.go) return;
  await takeLock("option-reclean-restore");
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

try { await ({ dryrun, plan, apply, verify, restore }[PHASE] || (() => { throw new Error("--phase=dryrun|plan|apply|verify|restore"); }))(); }
catch (err) { console.error(err instanceof StopRun ? `STOPPED: ${err.message}` : `FAILED: ${err.stack || err.message}`); process.exitCode = err instanceof StopRun ? 3 : 1; await releaseLock(); }
finally { await pool.end(); }
