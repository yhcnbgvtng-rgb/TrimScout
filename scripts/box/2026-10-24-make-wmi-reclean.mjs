// MAKE-vs-VIN dry run on stored rows (dealer_inventory.make): which stored makes the VIN's WMI contradicts (a Dodge Challenger stored as "GMC" because
// a GMC-roster dealer listed it), counted per stored make, with the make each row would get (scrapers/lightsail-crawler/src/vinWmi.js reconcileMake: the
// same rule the crawler and the deals-API write path use). DRY RUN ONLY: there is no apply phase in this script; it never writes to the database, the
// disk or the sync lock. Same shape and rails as scripts/box/2026-10-21-trim-reclean.mjs. Phases:
//
//   dryrun   READ-ONLY, reader account, no lock. Per stored make: rows checked / agreeing / contradicted, what the contradicted rows would become
//            (by target make), the largest (model, VIN chars 1-5) groups, and the dealers those groups come from (dealer name + row count). Also the blank-make
//            rows (NULL or ''), and how many the VIN would fill. Counts only: no VIN, no row is kept or printed. Refuses while the sync lock is held.
//   lookup   READ-ONLY. --vins=A,B,C (<= 50): one primary-key read each, prints make, model, year, dealer, source, vdp_url host, removed_at for those VINs only.
//   selftest No DB. Proves the bundle loads and the rule behaves (the five VINs found stored as GMC, and a real GMC).
//
// Access paths (every query is bounded by make AND model or by a primary key, nothing scans the table): makes and models by index skip-scan
// (idx_inv_make_model / idx_inv_make_model_trim); a model's VIN prefixes from the covering index idx_inv_make_model_trim (make, model, trim, dealer_name, vin)
// with GROUP BY LEFT(vin, 5); a dealer breakdown is one equality range (make, model) plus a vin prefix on the same covering index, only for the largest
// contradicted groups (--dealer-groups, default 60); blank makes are one `make IS NULL` / `make = ''` range. Every query is capped at 20 s
// (SET STATEMENT max_statement_time=20); the first timeout stops the run. HARD STOP at --deadline-et (default 21:40 ET).
//
// The box has no checkout. Ship it as ONE stdin-piped bundle (the dry run writes nothing on the box):
//   node scripts/box/2026-10-24-make-wmi-reclean.mjs --emit | ssh box2 'cd /opt/trimscout-deals && node --input-type=module - --phase=dryrun'
// Flags: --makes=GMC,Buick (default: every make found)  --model=Sierra (with exactly one make)  --dealer-groups=N  --pause-ms=N  --deadline-et=HH:MM  --env=FILE  --lock-log=FILE
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyGroup, summarizeGroups, summarizeBlank, summarizeVpic } from "../lib/makeWmiReclean.mjs";
import { loadCache, decodePrefixes } from "../lib/vpicDecode.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));

if (args.emit) { // bundle this script with the engine into one ESM file on stdout
  const esbuild = await import("esbuild");
  const out = await esbuild.build({ entryPoints: [fileURLToPath(import.meta.url)], bundle: true, write: false, platform: "node", format: "esm", target: "node18", external: ["mysql2", "esbuild"] });
  await new Promise((resolve) => process.stdout.write(out.outputFiles[0].text, resolve)); // wait for the flush: exiting early cuts a pipe write short
  process.exit(0);
}

const PHASE = args.phase;
const CAP = 20, PAUSE = Number(args["pause-ms"] ?? 250);
const DEALER_GROUPS = Number(args["dealer-groups"] ?? 60);
const [DL_H, DL_M] = String(args["deadline-et"] || "21:40").split(":").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etMin = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()); return Number(p.find((x) => x.type === "hour").value) % 24 * 60 + Number(p.find((x) => x.type === "minute").value); };
const pastDeadline = () => etMin() >= DL_H * 60 + DL_M;
// --vpic: decode the shared-WMI rows with NHTSA vPIC (batch API, <= 50 VINs a request), cached in --vpic-cache (default ./make-wmi-vpic-cache.json, keyed by VIN chars 1-8).
const VPIC = Boolean(args.vpic), VPIC_CACHE = String(args["vpic-cache"] || "make-wmi-vpic-cache.json"), VPIC_PAUSE = Number(args["vpic-pause-ms"] ?? 1500), VPIC_MAX = Number(args["vpic-max-requests"] ?? 200);
const vpicCache = VPIC ? loadCache(VPIC_CACHE) : { makes: {} }, vpicRuns = []; let vpicStopped = null;
const dlText =`${DL_H}:${String(DL_M).padStart(2, "0")} ET`;

if (PHASE === "selftest") { // no DB
  const cases = [["2B3LJ", "GMC", "Challenger"], ["4S3GT", "GMC", "Impreza"], ["5LMCJ", "GMC", "Corsair"], ["JHMGK", "GMC", "Fit"], ["KL4CJ", "GMC", "Encore"], ["1GKB0", "GMC", "Yukon"]];
  console.log(JSON.stringify(cases.map(([k, m, model]) => [k, m, classifyGroup({ make: m, key: k, model }).next])));
  process.exit(0);
}

const mysql = (await import("mysql2/promise")).default;
const envFile = args.env || "/opt/trimscout-deals/.env.trimscout-db";
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
// Reader account only: this script has no write path.
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, connectionLimit: 2 });

let queries = 0, slowest = 0;
class StopRun extends Error {}
async function q(conn, shape, sql, params) {
  queries++; const t0 = Date.now();
  try { const [rows] = await conn.query(`SET STATEMENT max_statement_time=${CAP} FOR ${sql}`, params); slowest = Math.max(slowest, Date.now() - t0); return rows; }
  catch (err) {
    if (err && (err.errno === 1969 || /max_statement_time/.test(err.message))) throw new StopRun(`a query timed out (${CAP}s) in "${shape}" - stopping, nothing retried`);
    throw err;
  }
}
const lockHeld = () => { // read-only look at deals-api's own log (this script takes no lock, so it only checks)
  const f = String(args["lock-log"] || "/home/ubuntu/.pm2/logs/deals-api-out.log"), fd = fs.openSync(f, "r"), size = fs.fstatSync(fd).size, len = Math.min(size, 4_000_000), buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
  return /\bacquire\b/.test(buf.toString("utf8").split("\n").filter((l) => l.includes("[sync-lock]")).pop() || "");
};

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
const prefixesFor = (conn, make, model) => q(conn, `vin prefixes ${make}/${model}`, `SELECT LEFT(vin, 5) AS k, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (${IDX}) WHERE make = ? AND model = ? GROUP BY LEFT(vin, 5)`, [make, model]);
const dealersFor = (conn, make, model, key) => q(conn, `dealers ${make}/${model}/${key}`, `SELECT dealer_name, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (${IDX}) WHERE make = ? AND model = ? AND vin LIKE ? GROUP BY dealer_name`, [make, model, `${key}%`]);
const prefixes8For = (conn, make, model, key) => q(conn, `vin prefixes8 ${make}/${model}/${key}`, `SELECT LEFT(vin, 8) AS k, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (${IDX}) WHERE make = ? AND model = ? AND vin LIKE ? GROUP BY LEFT(vin, 8)`, [make, model, `${key}%`]);
const sampleVin = (conn, make, model, key8) => q(conn, `sample vin ${make}/${model}/${key8}`, `SELECT vin FROM dealer_inventory FORCE INDEX (${IDX}) WHERE make = ? AND model = ? AND vin LIKE ? LIMIT 1`, [make, model, `${key8}%`]); // one VIN per prefix, sent to vPIC, never stored or printed
const blankPrefixes =(conn, where) => q(conn, `blank makes ${where}`, `SELECT LEFT(vin, 5) AS k, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (${IDX}) WHERE make ${where} GROUP BY LEFT(vin, 5)`, []);

const vpicTotal = () => { const t = { prefixesRequested: 0, fromCache: 0, decodedNow: 0, failed: 0, requests: 0 }; for (const r of vpicRuns) { t.prefixesRequested += r.requested; t.fromCache += r.cached; t.decodedNow += r.decoded; t.failed += r.failed; t.requests += r.requests; } return t; };

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
    for (const model of await modelsFor(conn, make)) { for (const g of await prefixesFor(conn, make, model)) groups.push({ model, key: g.k, n: Number(g.n) }); await sleep(PAUSE); }
    const s = summarizeGroups(make, groups, { top: Math.max(30, DEALER_GROUPS) });
    // Which dealers the largest contradicted groups come from (names + counts only).
    const dealers = new Map();
    for (const g of s.conflictGroups.slice(0, DEALER_GROUPS)) {
      if (pastDeadline()) { stopReason = `deadline ${dlText}`; break; }
      for (const d of await dealersFor(conn, make, g.model, g.key)) dealers.set(d.dealer_name, (dealers.get(d.dealer_name) || 0) + Number(d.n));
      await sleep(PAUSE);
    }
    s.dealersOfLargestConflictGroups = [...dealers].map(([dealer, rows]) => ({ dealer, rows })).sort((a, b) => b.rows - a.rows).slice(0, 30);
    s.conflictGroups = s.conflictGroups.slice(0, 30);
    if (VPIC && s.unresolvedGroups.length && stopReason === "all makes done") { // shared-WMI rows: split by VIN chars 1-8, decode one VIN per prefix, count again
      const subs = [], sample = new Map();
      for (const g of s.unresolvedGroups) { for (const p of await prefixes8For(conn, make, g.model, g.key)) subs.push({ model: g.model, key8: p.k, n: Number(p.n) }); await sleep(PAUSE); }
      for (const g of subs) if (!Object.hasOwn(vpicCache.makes, g.key8) && !sample.has(g.key8)) { const r = await sampleVin(conn, make, g.model, g.key8); if (r.length) sample.set(g.key8, r[0].vin); await sleep(PAUSE); }
      const run = await decodePrefixes([...sample].map(([key8, vin]) => ({ key8, vin })), vpicCache, { cachePath: VPIC_CACHE, pauseMs: VPIC_PAUSE, maxRequests: VPIC_MAX, shouldStop: pastDeadline });
      vpicRuns.push(run); if (run.stopped) vpicStopped = run.stopped;
      s.vpic = { ...summarizeVpic(make, subs, vpicCache.makes), decode: run };
    }
    delete s.unresolvedGroups;
    perMake.push(s);
    console.error(`  ${make}: ${s.rowsConflict} of ${s.rowsChecked} rows contradicted by the VIN (${queries} queries, slowest ${slowest} ms)`);
  }
  let blank = null;
  if (!args.makes && stopReason === "all makes done" && !pastDeadline()) {
    const gs = [...await blankPrefixes(conn, "IS NULL"), ...await blankPrefixes(conn, "= ''")].map((g) => ({ key: g.k, n: Number(g.n) }));
    blank = summarizeBlank(gs);
  }
  conn.release();
  const total = perMake.reduce((t, m) => { t.rowsChecked += m.rowsChecked; t.rowsConflict += m.rowsConflict; t.rowsToMake += m.rowsToMake; t.rowsToNull += m.rowsToNull; return t; }, { rowsChecked: 0, rowsConflict: 0, rowsToMake: 0, rowsToNull: 0 });
  console.log(JSON.stringify({ phase: "dryrun", complete: stopReason === "all makes done", stopReason, elapsedS: Math.round((Date.now() - started) / 1000), queries, wrote: VPIC ? `nothing in the database; vPIC cache file ${VPIC_CACHE} only` : "nothing", readerAccount: true, vpic: VPIC ? { stopped: vpicStopped, ...vpicTotal() } : "off (pass --vpic)", total, perMake: perMake.filter((m) => m.rowsConflict), makesWithNothingToDo: perMake.filter((m) => !m.rowsConflict).map((m) => m.make), blankMake: blank }, null, 1));
}

// ================= lookup =================
async function lookup() {
  const vins = String(args.vins || "").split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
  if (!vins.length || vins.length > 50) throw new Error("--vins=A,B,C (1 to 50)");
  const conn = await pool.getConnection();
  const rows = await q(conn, "vin lookup", `SELECT vin, dealer_id, dealer_name, make, model, year, source, vdp_url, removed_at FROM dealer_inventory WHERE vin IN (${vins.map(() => "?").join(",")})`, vins);
  conn.release();
  const host = (u) => { try { return new URL(u).host; } catch { return null; } };
  console.log(JSON.stringify({ phase: "lookup", wrote: "nothing", found: rows.length, rows: rows.map((r) => ({ vin: r.vin, dealer_id: r.dealer_id, dealer: r.dealer_name, make: r.make, model: r.model, year: r.year, source: r.source, vdpHost: host(r.vdp_url), removedAt: r.removed_at, wouldBeMake: classifyGroup({ make: r.make, key: String(r.vin).slice(0, 5), model: r.model }).next })) }, null, 1));
}

try { await ({ dryrun, lookup }[PHASE] || (() => { throw new Error("--phase=dryrun|lookup|selftest"); }))(); }
catch (err) { console.error(err instanceof StopRun ? `STOPPED: ${err.message}` : `FAILED: ${err.stack || err.message}`); process.exitCode = err instanceof StopRun ? 3 : 1; }
finally { await pool.end(); }
