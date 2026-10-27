// Ford trim clean-up for rows already in dealer_inventory: "4X4 CREWCAB XLT" -> "XLT", per model, with src/fordTrim.js - the same rule the crawler and the
// deals API now apply on every write (docs/trim-normalize/ford-probe-2026-10-26.md has the mapping and the measured effect).
// Only rows whose trim the normalizer can READ are rewritten ('fix'). Blank, already-official, ambiguous and unreadable trims ("Preferred", engine text,
// "Base", the Escape "S") are never touched. No VIN tie-break. The dealer's original text goes into trim_raw, so nothing is lost.
//
//   node 2026-10-27-ford-trim-normalize.mjs                                 # DRY RUN (default, also --dry-run): counts only, writes nothing
//   node 2026-10-27-ford-trim-normalize.mjs --apply --fleet-idle            # rewrite, in batches
//   node 2026-10-27-ford-trim-normalize.mjs --apply --fleet-idle --limit=5000   # stop after ~5,000 rows (a first, small run)
//   node 2026-10-27-ford-trim-normalize.mjs --rollback=FILE                 # count how many rows of a backup file could be restored
//   node 2026-10-27-ford-trim-normalize.mjs --rollback=FILE --apply --fleet-idle   # restore them
//
// Safe by construction:
//  - Reads ONE grouped query (make='Ford' [AND removed_at IS NULL] GROUP BY model, trim): index-only on idx_inv_make_model_trim, bounded by the make prefix.
//  - --apply needs --fleet-idle, takes the deals-API sync lock (own owner id, heartbeated, released in finally; exit 4 and no change if it is held), and
//    refuses to run against a retired box IP. Every statement has a 20 s cap; any error or timeout stops the run, no retry.
//  - Per (model, trim) group, rows are read by the index prefix (make, model, trim) in batches, and every batch is APPENDED TO THE BACKUP FILE (and flushed)
//    BEFORE its UPDATE. The UPDATE is by primary key (vin, dealer_id) and also requires `trim` to still be the value that was read, so a trim a crawl wrote
//    in between is never overwritten.
//  - Rollback restores trim and trim_raw from the backup, only where trim is still the value this script wrote.
//  - trim_raw is added (ALGORITHM=INSTANT, no table copy) only on --apply if the deals API has not created it yet; a dry run only reports whether it exists.
//  - Idempotent: a second run finds nothing left to fix.
// Run on the deals box (box2) from /opt/trimscout-deals (needs src/fordTrim.js deployed there). NOT run as part of the PR that adds it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BATCH = 200;
const PAUSE_MS = 150;
const STATEMENT_CAP_S = 20;

/** Pure: one row per (model, trim) with its count -> what would change. `normalize` is normalizeFordTrimForWrite. */
export function planFromGroups(groups, normalize) {
  const byStatus = {};
  const changes = []; // { model, before, after, count }
  for (const g of groups) {
    const r = normalize({ make: "Ford", model: g.model, trim: g.trim });
    byStatus[r.status] = (byStatus[r.status] || 0) + g.count;
    if (r.status === "fix" && r.trim !== g.trim) changes.push({ model: g.model, before: g.trim, after: r.trim, count: g.count });
  }
  changes.sort((a, b) => b.count - a.count);
  return { byStatus, changes, rowsToChange: changes.reduce((s, c) => s + c.count, 0) };
}

/** Pure: the backup line for one row about to change. */
export const backupLine = (row, after) => JSON.stringify({ vin: row.vin, dealer_id: row.dealer_id, model: row.model, trim_before: row.trim, trim_raw_before: row.trim_raw ?? null, trim_after: after });

/** Pure: parse a backup file's text into rows, ignoring blank lines. */
export function parseBackup(text) {
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * Pure apply loop: for each change group, read an exact-text batch, back it up, update it, repeat until the group is drained or `limit` rows have been updated.
 * `limit` is a hard cap: a batch is never larger than what is left of it, so the run never changes more than `limit` rows. A batch the UPDATE could not move
 * (affectedRows 0) ends its group instead of spinning. fetchBatch(change, n) must return at most n rows whose trim is exactly change.before.
 */
export async function applyChanges({ changes, limit = Infinity, batchSize = 200, fetchBatch, writeBackup, updateBatch, sleep = async () => {} }) {
  let updated = 0, skipped = 0;
  outer: for (const c of changes) {
    for (;;) {
      const room = limit - updated;
      if (room <= 0) break outer;
      const batch = (await fetchBatch(c, Math.min(batchSize, room))).slice(0, Math.min(batchSize, room));
      if (!batch.length) break;
      writeBackup(batch, c); // before-state first, then the UPDATE
      const n = await updateBatch(batch, c);
      updated += n; skipped += batch.length - n;
      if (n === 0) break; // nothing moved: do not spin on rows we cannot change
      await sleep();
    }
  }
  return { updated, skipped };
}

async function loadNormalizer() {
  const candidates = [path.resolve(process.cwd(), "src/fordTrim.js"), new URL("../../scrapers/lightsail-crawler/src/fordTrim.js", import.meta.url).pathname];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) { console.error(`Missing src/fordTrim.js (looked in ${candidates.join(", ")}) - deploy it to the box first.`); process.exit(1); }
  return (await import(pathToFileURL(found).href)).normalizeFordTrimForWrite;
}

function readEnvFile(file) {
  const out = {};
  try { for (const line of fs.readFileSync(file, "utf-8").split("\n")) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq === -1) continue; let v = t.slice(eq + 1).trim(); if (/^["'].*["']$/.test(v)) v = v.slice(1, -1); out[t.slice(0, eq).trim()] = v; } } catch { /* missing file: empty */ }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(`--${n}`);
  const opt = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  const APPLY = flag("apply");
  const FLEET_IDLE = flag("fleet-idle");
  const ROLLBACK = opt("rollback");
  const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
  const ACTIVE_ONLY = !flag("include-removed");
  if (flag("dry-run") && APPLY) { console.error("--dry-run and --apply together: pick one."); process.exit(1); }
  if (APPLY && !FLEET_IDLE) { console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }
  if (!(LIMIT > 0)) { console.error("--limit must be a positive number"); process.exit(1); }

  const { pointsAtDeadIp } = await import("../../config/boxes.mjs").catch(() => import("./boxes.mjs")).catch(() => {
    console.error("Refusing to run: config/boxes.mjs (+ boxes.json) not found next to this script, so the retired-IP guard cannot load.");
    process.exit(1);
  });
  const mysql = (await import("mysql2/promise")).default;
  const dbEnv = readEnvFile(path.resolve(process.cwd(), ".env.trimscout-db"));
  const appEnv = readEnvFile(path.resolve(process.cwd(), ".env"));
  const API_KEY = process.env.TRIMSCOUT_API_KEY || appEnv.TRIMSCOUT_API_KEY || dbEnv.TRIMSCOUT_API_KEY || null;
  const DB_HOST = dbEnv.DB_HOST || process.env.DB_HOST;
  const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || dbEnv.DEALS_API_PORT || 3004}`;
  if (pointsAtDeadIp(DB_HOST, DEALS)) { console.error('Refusing to run: this points at a retired box IP (see docs/BOXES.md "Do not use").'); process.exit(1); }
  // A dry run uses the read-only account when the box has one; --apply needs the writer.
  const user = APPLY ? (dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER) : (dbEnv.DB_READER_USER || process.env.DB_READER_USER || dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER);
  const password = APPLY ? (dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD) : (dbEnv.DB_READER_PASSWORD || process.env.DB_READER_PASSWORD || dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD);
  const pool = mysql.createPool({ host: DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout", user, password, connectionLimit: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Every read and write: capped at 20 s; a timeout or any error throws and stops the run (no retry).
  const q = async (sql, params) => (await pool.query(`SET STATEMENT max_statement_time=${STATEMENT_CAP_S} FOR ${sql}`, params))[0];
  const lockCall = async (action, owner, extra = {}) => {
    const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
    if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
    return r.json();
  };
  const columnExists = async () => Number((await q("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dealer_inventory' AND column_name = 'trim_raw'"))[0].n) === 1;

  async function withLock(name, body) {
    if (!API_KEY) { console.error("No TRIMSCOUT_API_KEY found: refusing to apply without being able to take the sync lock."); await pool.end(); process.exit(3); }
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

  // -------------------------------------------------------------- rollback
  if (ROLLBACK) {
    const rows = parseBackup(fs.readFileSync(ROLLBACK, "utf-8"));
    console.log(`${APPLY ? "ROLLBACK (--apply)" : "ROLLBACK DRY RUN"}  ${new Date().toISOString()}  ${rows.length} rows in ${ROLLBACK}`);
    const stillWritten = async () => {
      let n = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const part = rows.slice(i, i + BATCH);
        const found = await q(`SELECT vin, dealer_id, trim FROM dealer_inventory WHERE ${part.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")}`, part.flatMap((r) => [r.vin, r.dealer_id]));
        const now = new Map(found.map((f) => [`${f.vin}|${f.dealer_id}`, f.trim]));
        n += part.filter((r) => now.get(`${r.vin}|${r.dealer_id}`) === r.trim_after).length;
      }
      return n;
    };
    console.log(`  rows still carrying the trim this script wrote (would be restored): ${await stillWritten()} of ${rows.length}; the rest changed since and are left alone`);
    if (!APPLY) { console.log("DRY RUN - nothing was changed."); await pool.end(); return; }
    await withLock("ford-trim-rollback", async () => {
      let restored = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        for (const r of rows.slice(i, i + BATCH)) {
          const res = await pool.query(`SET STATEMENT max_statement_time=${STATEMENT_CAP_S} FOR UPDATE dealer_inventory SET trim = ?, trim_raw = ? WHERE vin = ? AND dealer_id = ? AND trim = ?`, [r.trim_before, r.trim_raw_before, r.vin, r.dealer_id, r.trim_after]);
          restored += res[0].affectedRows;
        }
        await sleep(PAUSE_MS);
      }
      console.log(`restored ${restored} rows of ${rows.length}; verification: ${await stillWritten()} rows still carry the written trim (expected 0)`);
    });
    return;
  }

  // -------------------------------------------------------------- normalize
  const normalize = await loadNormalizer();
  console.log(`${APPLY ? "LIVE (--apply)" : "DRY RUN"}  ${new Date().toISOString()}  ${ACTIVE_ONLY ? "active rows" : "all rows incl. removed"}`);
  // trim is utf8mb4_general_ci: `GROUP BY trim` would merge "ST Line" / "St Line" / "ST LINE" under one representative (and hide a "LARIAT" inside a "Lariat" group),
  // so groups are by the exact bytes of the text. Still index-only on the make prefix (idx_inv_make_model_trim).
  const readGroups = async () => (await q(`SELECT model, CONVERT(BINARY trim USING utf8mb4) AS trim, COUNT(*) AS n FROM dealer_inventory WHERE make = 'Ford'${ACTIVE_ONLY ? " AND removed_at IS NULL" : ""} GROUP BY model, BINARY trim`)).map((r) => ({ model: r.model, trim: r.trim, count: Number(r.n) }));
  const plan = planFromGroups(await readGroups(), normalize);
  const total = Object.values(plan.byStatus).reduce((s, n) => s + n, 0);
  console.log(`  Ford rows read: ${total.toLocaleString()}   by status: ${JSON.stringify(plan.byStatus)}`);
  console.log(`  would be rewritten: ${plan.rowsToChange.toLocaleString()} rows in ${plan.changes.length} (model, trim) groups; trim_raw column exists: ${await columnExists()}`);
  for (const c of plan.changes.slice(0, 25)) console.log(`    ${c.count.toLocaleString().padStart(7)}  ${c.model} | ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  if (!APPLY) { console.log("DRY RUN - nothing was changed."); await pool.end(); return; }

  await withLock("ford-trim-normalize", async () => {
    if (!(await columnExists())) {
      console.log("  adding dealer_inventory.trim_raw (ALGORITHM=INSTANT)...");
      await q("ALTER TABLE dealer_inventory ADD COLUMN IF NOT EXISTS trim_raw VARCHAR(160) NULL, ALGORITHM=INSTANT");
    }
    // Re-read under the lock (nothing else is writing now), then work from that.
    const fresh = planFromGroups(await readGroups(), normalize);
    const backupFile = path.resolve(process.cwd(), `ford-trim-normalize-${new Date().toISOString().replace(/[:.]/g, "-")}.rollback.jsonl`);
    const fd = fs.openSync(backupFile, "a");
    console.log(`  backup of every changed row (before-state) -> ${backupFile}`);
    let result;
    try {
      result = await applyChanges({
        changes: fresh.changes, limit: LIMIT, batchSize: BATCH, sleep: () => sleep(PAUSE_MS),
        // The ci index range finds every case variant; BINARY keeps only the exact text, so a batch is never padded with rows we would skip and LIMIT counts real rows.
        fetchBatch: (c, n) => q(`SELECT vin, dealer_id, model, trim, trim_raw FROM dealer_inventory WHERE make = 'Ford' AND model = ? AND trim = ? AND BINARY trim = BINARY ?${ACTIVE_ONLY ? " AND removed_at IS NULL" : ""} LIMIT ${n}`, [c.model, c.before, c.before]),
        writeBackup: (batch, c) => { fs.writeSync(fd, batch.map((r) => backupLine(r, c.after)).join("\n") + "\n"); fs.fsyncSync(fd); }, // the before-state is on disk before the first row of this batch changes
        updateBatch: async (batch, c) => (await pool.query(`SET STATEMENT max_statement_time=${STATEMENT_CAP_S} FOR UPDATE dealer_inventory SET trim = ?, trim_raw = ? WHERE BINARY trim = BINARY ? AND (${batch.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")})`, [c.after, c.before, c.before, ...batch.flatMap((r) => [r.vin, r.dealer_id])]))[0].affectedRows,
      });
    } finally { fs.closeSync(fd); }
    const { updated, skipped } = result;
    const after = planFromGroups(await readGroups(), normalize);
    console.log(`rewritten: ${updated.toLocaleString()} rows; skipped (trim changed under us): ${skipped}. Still fixable after the run: ${after.rowsToChange.toLocaleString()} (nonzero only if --limit stopped it, or new rows arrived).`);
    console.log(`Rollback: node 2026-10-27-ford-trim-normalize.mjs --rollback=${backupFile} [--apply --fleet-idle]`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
