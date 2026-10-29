// Fix stored makes that the VIN contradicts on dealer_inventory (a Dodge Challenger stored as "GMC", a Hyundai stored as "Kia"): make := the make reconcileMake
// (scrapers/lightsail-crawler/src/vinWmi.js) derives from the VIN, the same rule the crawler and the deals-API write path use. Counterpart to the read-only
// dry run scripts/box/2026-10-24-make-wmi-reclean.mjs, cut from the #609 apply (scripts/box/2026-10-27-oem-trim-normalize.mjs).
//
// Only `wmi-conflict` rows are rewritten. Blank makes (`wmi-fill`) and shared-WMI conflicts that need a vPIC decode (`conflict-unresolved`, `unresolved`) are
// only COUNTED; a stored make that agrees with, or whose WMI is not in the table, is never touched.
//
// The box has no checkout and the deals-api patch that ships vinWmi.js is not installed, so ship ONE stdin-piped bundle (vinWmi + tables inside, nothing installed):
//   node scripts/box/2026-10-28-make-from-vin-fix.mjs --emit > /tmp/make-fix.bundle.mjs        # on the Mac; needs esbuild (npm i)
//   ssh box2 'cd /opt/trimscout-deals && node --input-type=module - [flags]' < /tmp/make-fix.bundle.mjs
//
//   (no flags | --dry-run)                      DRY RUN: reader account, counts only, writes nothing, takes no lock
//   --apply --fleet-idle [--limit=N]            rewrite, 100 rows per chunk; --limit stops after N rows changed (a first small run: --limit=200)
//   --rollback=FILE                             count the rows of a backup file that could be restored
//   --rollback=FILE --apply --fleet-idle        restore them
// Other flags: --wmi=2B3,1GK (only these WMIs)  --include-removed (default: active rows only)  --deadline-et=HH:MM (default 21:30, graceful stop)  --out=DIR (backup dir, default cwd)  --pause-ms=N
//
// Rails (same as #609):
//  - Every statement runs under SET STATEMENT max_statement_time=10. Discovery (dry run and the re-read under the lock) is a primary-key walk, 5000 rows per chunk, grouped in Node, so no statement scans more than a chunk;
//    ANY error or timeout stops the run (no retry). Reads and writes are bounded by the primary key: `vin LIKE 'p5%'` plus a (vin, dealer_id) keyset cursor.
//  - --apply needs --fleet-idle, takes the deals-API sync lock (own owner id, heartbeated, released in finally; exit 4 and no change if held), refuses a retired box IP.
//  - Each chunk's before-state (vin, dealer_id, make_before, make_after, model) is APPENDED TO THE ROLLBACK JSONL AND fsync'd BEFORE its UPDATE. The UPDATE is by
//    (vin, dealer_id) and also requires make to still be the value that was read, so a make a crawl wrote in between is never overwritten.
//  - Rollback restores make only where make is still the value this script wrote. Idempotent: a second run finds nothing left to fix.
//  - After a real apply, rebuild the make-keyed facets (inv_color_facets, inv_option_facets); this script does not touch them (docs/box-patches/2026-10-28-make-from-vin-fix/STEPS.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planFromGroups, walkGroups, backupLine, parseBackup, applyConflicts, readPrefixByWalk } from "../lib/makeFromVinFix.mjs";
import { STELLANTIS_WMI } from "../../scrapers/lightsail-crawler/src/vinWmi.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
const SELF = fileURLToPath(import.meta.url);

if (args.emit) { // bundle this script with the engine into one ESM file on stdout
  const esbuild = await import("esbuild");
  const deadIps = JSON.parse(fs.readFileSync(new URL("../../config/boxes.json", import.meta.url), "utf-8")).deadIps;
  const out = await esbuild.build({ entryPoints: [SELF], bundle: true, write: false, platform: "node", format: "esm", target: "node18", external: ["mysql2", "esbuild"], define: { __DEAD_IPS__: JSON.stringify(deadIps) } });
  await new Promise((resolve) => process.stdout.write(out.outputFiles[0].text, resolve));
  process.exit(0);
}

const APPLY = Boolean(args.apply), FLEET_IDLE = Boolean(args["fleet-idle"]), ROLLBACK = args.rollback && args.rollback !== true ? String(args.rollback) : null;
const LIMIT = args.limit ? Number(args.limit) : Infinity, ACTIVE_ONLY = !args["include-removed"], PAUSE = Number(args["pause-ms"] ?? 150);
const BATCH = 100, CAP = 10, OUT = String(args.out || process.cwd());
const ONLY = args.wmi ? String(args.wmi).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
const [DL_H, DL_M] = String(args["deadline-et"] || "21:30").split(":").map(Number);
if (args["dry-run"] && APPLY) { console.error("--dry-run and --apply together: pick one."); process.exit(1); }
if (APPLY && !FLEET_IDLE) { console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }
if (!(LIMIT > 0)) { console.error("--limit must be a positive number"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etMin = () => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()); return Number(p.find((x) => x.type === "hour").value) % 24 * 60 + Number(p.find((x) => x.type === "minute").value); };
const pastDeadline = () => etMin() >= DL_H * 60 + DL_M;
const CH = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ".split("");

const mysql = (await import("mysql2/promise")).default;
const env = {};
for (const line of fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || env.DEALS_API_PORT || 3004}`;
if (APPLY || ROLLBACK) {
  if (typeof __DEAD_IPS__ === "undefined") { console.error("Refusing to run unbundled: the retired-IP list is only baked in by --emit."); process.exit(1); }
  const dead = __DEAD_IPS__.some((ip) => String(env.DB_HOST || "").includes(ip) || DEALS.includes(ip));
  if (dead) { console.error('Refusing to run: this points at a retired box IP (see docs/BOXES.md "Do not use").'); process.exit(1); }
}
const writing = APPLY; // dry run and rollback counting use the reader account; only --apply uses the writer
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME || "trimscout", user: writing ? env.DB_WRITER_USER : (env.DB_READER_USER || env.DB_WRITER_USER), password: writing ? env.DB_WRITER_PASSWORD : (env.DB_READER_PASSWORD || env.DB_WRITER_PASSWORD), connectionLimit: 2 });
const q = async (sql, params) => (await pool.query(`SET STATEMENT max_statement_time=${CAP} FOR ${sql}`, params))[0];
const isTimeout = (e) => /max_statement_time|interrupted|timeout/i.test(String(e?.message));

// ---- discovery: (VIN chars 1-5, stored make[, model for Stellantis]) groups, one WMI at a time, as a primary-key walk (vin, dealer_id) in DISC_CHUNK-row chunks,
// grouped in Node: no GROUP BY, and every statement is bounded by the chunk size, so none can approach the 10 s cap. Any error or timeout stops the run.
const DISC_CHUNK = 5000;
async function readPrefix(prefix, out) {
  const withModel = STELLANTIS_WMI.has(prefix.slice(0, 3));
  const t0 = Date.now(), tag = `[${new Date().toISOString().slice(11, 19)}Z] ${prefix}`;
  let slowest = 0;
  try {
    const r = await readPrefixByWalk({
      prefix, withModel, activeOnly: ACTIVE_ONLY, chunk: DISC_CHUNK, shouldStop: pastDeadline,
      fetchChunk: (p, cur, n) => q(`SELECT vin, dealer_id, CONVERT(BINARY make USING utf8mb4) AS make, model, (removed_at IS NULL) AS active FROM dealer_inventory WHERE vin LIKE ?${cur ? " AND (vin > ? OR (vin = ? AND dealer_id > ?))" : ""} ORDER BY vin, dealer_id LIMIT ${Number(n)}`, [p + "%", ...(cur ? [cur.vin, cur.vin, cur.dealer_id] : [])]),
      onChunk: (c) => { slowest = Math.max(slowest, c.ms); },
    });
    out.push(...r.groups);
    console.log(`  ${tag} ok ${((Date.now() - t0) / 1000).toFixed(2)}s chunks=${r.chunks} scanned=${r.scanned} active=${r.active} groups=${r.groups.length} slowest-chunk=${slowest}ms`);
  } catch (e) {
    console.log(`  ${tag} ${isTimeout(e) ? "TIMEOUT" : "ERROR"} after ${((Date.now() - t0) / 1000).toFixed(2)}s (slowest chunk so far ${slowest}ms): ${e.message}`);
    throw e;
  }
}
async function discover() {
  const { WMI_LIST } = await import("../../scrapers/lightsail-crawler/src/vinWmi.js");
  const out = [];
  for (const w of ONLY || WMI_LIST) { if (pastDeadline()) throw new Error("deadline reached during discovery"); await readPrefix(w, out); await sleep(100); }
  return out;
}

function report(plan) {
  console.log(`  rows read: ${plan.total.toLocaleString()}   agree/unknown WMI: ${plan.kept.toLocaleString()}   to rewrite: ${plan.rowsToChange.toLocaleString()}   counted only (not touched): ${JSON.stringify(plan.counted)}`);
  console.log("  top pairs (stored -> VIN make):");
  for (const [k, n] of Object.entries(plan.pairs).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    ${String(n).padStart(7)}  ${k}`);
}

const lockCall = async (action, owner, extra = {}) => {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": env.TRIMSCOUT_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
};
async function withLock(name, body) {
  if (!env.TRIMSCOUT_API_KEY) { console.error("No TRIMSCOUT_API_KEY in .env.trimscout-db: refusing to apply without being able to take the sync lock."); await pool.end(); process.exit(3); }
  const owner = `${name}-${process.pid}`;
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY - ${JSON.stringify(lock)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`Sync lock taken as ${owner}.`);
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
  process.on("SIGTERM", async () => { await release(); process.exit(143); });
  let failed = null;
  try { await body(); } catch (e) { failed = e; console.error("ERROR - stopping, no retry:", e.message); } finally { await release(); console.log("Sync lock released."); }
  await pool.end();
  if (failed) process.exit(1);
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const rows = parseBackup(fs.readFileSync(ROLLBACK, "utf-8"));
  console.log(`${APPLY ? "ROLLBACK (--apply)" : "ROLLBACK DRY RUN"}  ${new Date().toISOString()}  ${rows.length} rows in ${ROLLBACK}`);
  const stillWritten = async () => {
    let n = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = rows.slice(i, i + BATCH);
      const found = await q(`SELECT vin, dealer_id, make FROM dealer_inventory WHERE ${part.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")}`, part.flatMap((r) => [r.vin, r.dealer_id]));
      const now = new Map(found.map((f) => [`${f.vin}|${f.dealer_id}`, f.make]));
      n += part.filter((r) => now.get(`${r.vin}|${r.dealer_id}`) === r.make_after).length;
    }
    return n;
  };
  console.log(`  rows still carrying the make this script wrote (would be restored): ${await stillWritten()} of ${rows.length}; the rest changed since and are left alone`);
  if (!APPLY) { console.log("DRY RUN - nothing was changed."); await pool.end(); process.exit(0); }
  await withLock("make-from-vin-rollback", async () => {
    let restored = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      if (pastDeadline()) { console.log("deadline reached: stopping the rollback here (rerun to continue)."); break; }
      for (const r of rows.slice(i, i + BATCH)) restored += (await pool.query(`SET STATEMENT max_statement_time=${CAP} FOR UPDATE dealer_inventory SET make = ? WHERE vin = ? AND dealer_id = ? AND BINARY make = BINARY ?`, [r.make_before, r.vin, r.dealer_id, r.make_after]))[0].affectedRows;
      await sleep(PAUSE);
    }
    console.log(`restored ${restored} rows of ${rows.length}; verification: ${await stillWritten()} rows still carry the written make`);
  });
  process.exit(0);
}

// ---------------------------------------------------------------- dry run / apply
console.log(`${APPLY ? "LIVE (--apply)" : "DRY RUN"}  ${new Date().toISOString()}  ${ACTIVE_ONLY ? "active rows" : "all rows incl. removed"}${ONLY ? `  WMIs ${ONLY.join(",")}` : ""}  deadline ${DL_H}:${String(DL_M).padStart(2, "0")} ET`);
if (!APPLY) {
  report(planFromGroups(await discover()));
  console.log("DRY RUN - nothing was changed.");
  await pool.end();
  process.exit(0);
}

await withLock("make-from-vin-fix", async () => {
  const plan = planFromGroups(await discover()); // re-read under the lock: nothing else is writing now
  report(plan);
  const groups = walkGroups(plan.conflicts);
  fs.mkdirSync(OUT, { recursive: true });
  const backupFile = path.resolve(OUT, `make-from-vin-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.rollback.jsonl`);
  const fd = fs.openSync(backupFile, "a");
  console.log(`  rollback file (before-state of every changed row, fsync'd before each UPDATE) -> ${backupFile}`);
  let result;
  try {
    result = await applyConflicts({
      groups, limit: LIMIT, batchSize: BATCH, sleep: () => sleep(PAUSE), shouldStop: pastDeadline,
      fetchBatch: (g, cur, n) => q(`SELECT vin, dealer_id, make, model FROM dealer_inventory WHERE vin LIKE ? AND BINARY make = BINARY ?${ACTIVE_ONLY ? " AND removed_at IS NULL" : ""}${cur ? " AND (vin > ? OR (vin = ? AND dealer_id > ?))" : ""} ORDER BY vin, dealer_id LIMIT ${Number(n)}`, [g.p5 + "%", g.make, ...(cur ? [cur.vin, cur.vin, cur.dealer_id] : [])]),
      writeBackup: (rows, to) => { fs.writeSync(fd, rows.map((r) => backupLine(r, to)).join("\n") + "\n"); fs.fsyncSync(fd); },
      updateBatch: async (rows, to) => (await pool.query(`SET STATEMENT max_statement_time=${CAP} FOR UPDATE dealer_inventory SET make = ? WHERE BINARY make = BINARY ? AND (${rows.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")})`, [to, rows[0].make, ...rows.flatMap((r) => [r.vin, r.dealer_id])]))[0].affectedRows,
    });
  } finally { fs.closeSync(fd); }
  console.log(`rewritten: ${result.updated.toLocaleString()} rows; skipped (make changed under us): ${result.skipped}; read: ${result.read.toLocaleString()}; left alone by the per-row recheck: ${result.left}; stopped by: ${result.stopped || "finished"}`);
  const after = planFromGroups(await discover());
  console.log(`still to fix after the run: ${after.rowsToChange.toLocaleString()} (nonzero only if --limit or the deadline stopped it, or new rows arrived)`);
  console.log(`Rollback: node --input-type=module - --rollback=${backupFile} [--apply --fleet-idle] < bundle`);
});
