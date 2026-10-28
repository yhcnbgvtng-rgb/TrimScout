// Chevrolet / GMC / Toyota / Ram trim clean-up for rows already in dealer_inventory: "LT 2FL" -> "LT", "TRD Off Road V6" -> "TRD Off-Road", "BIG HORN CREW CAB 4X4 5'7 BOX" -> "Big Horn",
// with src/oemTrim.js - the same rule the crawler, the sync client and the deals API apply on every write (docs/trim-normalize/oem-probe-2026-10-27.md has the lists and the measured effect).
// Models: Silverado, Tahoe, Equinox, Sierra, Yukon, Tacoma, Tundra, RAV4, Camry, Highlander, Ram 1500 / 2500 (oemTrim.js decides; EV / chassis / other models are never touched).
// Only rows whose trim the normalizer can READ are rewritten ('fix'). Blank, already-official, ambiguous and unreadable trims are never touched. The dealer's original text goes into trim_raw.
//
//   node 2026-10-27-oem-trim-normalize.mjs                                  # DRY RUN (default, also --dry-run): counts only, writes nothing
//   node 2026-10-27-oem-trim-normalize.mjs --apply --fleet-idle             # rewrite, in batches
//   node 2026-10-27-oem-trim-normalize.mjs --apply --fleet-idle --limit=5000    # stop after ~5,000 rows (a first, small run)
//   node 2026-10-27-oem-trim-normalize.mjs --rollback=FILE                  # count how many rows of a backup file could be restored
//   node 2026-10-27-oem-trim-normalize.mjs --rollback=FILE --apply --fleet-idle    # restore them
//
// Safe by construction (same as the Ford script this is cut from):
//  - Reads one grouped query per (make, model prefix), each index-only (idx_inv_facet_make_model_state_trim, bounded by make + model) and capped at 20 s.
//  - --apply needs --fleet-idle, takes the deals-API sync lock (own owner id, heartbeated, released in finally; exit 4 and no change if it is held), and refuses to run against a retired box IP.
//  - Per (make, model, trim) group, rows are read in batches, and every batch is APPENDED TO THE BACKUP FILE (and flushed) BEFORE its UPDATE. The UPDATE is by primary key (vin, dealer_id)
//    and also requires `trim` to still be the value that was read, so a trim a crawl wrote in between is never overwritten.
//  - Rollback restores trim and trim_raw from the backup, only where trim is still the value this script wrote.
//  - Idempotent: a second run finds nothing left to fix.
// Run on the deals box (box2) from /opt/trimscout-deals (needs src/oemTrim.js AND src/fordTrim.js deployed there). NOT run as part of the PR that adds it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BATCH = 200; // rollback chunking
const TX_SIZE = 100; // rows per apply transaction
const SLOW_STATEMENT_MS = 10_000; // any single statement slower than this stops the run (the cap is 20 s)
const PAUSE_MS = 150;
const STATEMENT_CAP_S = 20;
export const MODEL_QUERIES = [["Chevrolet", ["Silverado%", "Tahoe", "Equinox%"]], ["GMC", ["Sierra%", "Yukon%"]], ["Toyota", ["Tacoma", "Tundra", "RAV4%", "Camry", "Highlander%"]], ["Ram", ["1500%", "2500%"]]];

/** Pure: one row per (make, model, trim) with its count -> what would change. `normalize` is normalizeOemTrimForWrite. */
export function planFromGroups(groups, normalize) {
  const byStatus = {};
  const changes = []; // { make, model, before, after, count }
  for (const g of groups) {
    const r = normalize({ make: g.make, model: g.model, trim: g.trim });
    byStatus[r.status] = (byStatus[r.status] || 0) + g.count;
    if (r.status === "fix" && r.trim !== g.trim) changes.push({ make: g.make, model: g.model, before: g.trim, after: r.trim, count: g.count });
  }
  changes.sort((a, b) => b.count - a.count);
  return { byStatus, changes, rowsToChange: changes.reduce((s, c) => s + c.count, 0) };
}

/** Pure: the backup line for one row about to change. */
export const backupLine = (row, after) => JSON.stringify({ vin: row.vin, dealer_id: row.dealer_id, make: row.make, model: row.model, trim_before: row.trim, trim_raw_before: row.trim_raw ?? null, trim_after: after });

/** Pure: parse a backup file's text into rows, ignoring blank lines. */
export function parseBackup(text) {
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * Pure apply loop. For each change group: read the group's rows once (fetchTargets, an index-bounded range that may also return case variants, because the
 * trim column is case-insensitive), keep only the rows whose trim is EXACTLY change.before (compared here, in JS, never in SQL), then work through them in
 * chunks of at most `txSize` rows: write the chunk's before-state first, then update that chunk (updateChunk: one transaction, one primary-key UPDATE per row).
 * `limit` is a hard cap on rows updated: a chunk is never larger than what is left of it. A chunk the UPDATE could not move at all (0 rows) ends its group.
 */
export async function applyChanges({ changes, limit = Infinity, txSize = 100, fetchTargets, writeBackup, updateChunk, sleep = async () => {} }) {
  let updated = 0, skipped = 0;
  outer: for (const c of changes) {
    if (limit - updated <= 0) break;
    const targets = (await fetchTargets(c)).filter((r) => r.trim === c.before);
    for (let i = 0; i < targets.length;) {
      const room = limit - updated;
      if (room <= 0) break outer;
      const chunk = targets.slice(i, i + Math.min(txSize, room));
      i += chunk.length;
      writeBackup(chunk, c); // before-state first, then the UPDATE
      const n = await updateChunk(chunk, c);
      updated += n; skipped += chunk.length - n;
      if (n === 0) break; // nothing moved: do not spin on rows we cannot change
      await sleep();
    }
  }
  return { updated, skipped };
}

async function loadNormalizer() {
  const candidates = [path.resolve(process.cwd(), "src/oemTrim.js"), new URL("../../scrapers/lightsail-crawler/src/oemTrim.js", import.meta.url).pathname];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) { console.error(`Missing src/oemTrim.js (looked in ${candidates.join(", ")}) - deploy it (and src/fordTrim.js beside it) to the box first.`); process.exit(1); }
  return (await import(pathToFileURL(found).href)).normalizeOemTrimForWrite;
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
  // Every statement of the apply is timed: one slower than SLOW_STATEMENT_MS stops the run (before the 20 s cap does).
  const timed = async (what, fn) => {
    const t0 = Date.now();
    const out = await fn();
    const ms = Date.now() - t0;
    if (ms > SLOW_STATEMENT_MS) throw new Error(`${what} took ${ms} ms (> ${SLOW_STATEMENT_MS} ms): stopping`);
    return out;
  };
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
    await withLock("oem-trim-rollback", async () => {
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
  // One bounded query per (make, model prefix); models oemTrim.js does not cover (EV, chassis cab, ...) come back skipped and are never changed.
  const readGroups = async () => {
    const out = [];
    for (const [make, patterns] of MODEL_QUERIES) {
      for (const pattern of patterns) {
        const rows = await q(`SELECT model, CONVERT(BINARY trim USING utf8mb4) AS trim, COUNT(*) AS n FROM dealer_inventory WHERE make = ? AND model LIKE ?${ACTIVE_ONLY ? " AND removed_at IS NULL" : ""} GROUP BY model, BINARY trim`, [make, pattern]);
        for (const r of rows) out.push({ make, model: r.model, trim: r.trim, count: Number(r.n) });
      }
    }
    return out;
  };
  const plan = planFromGroups(await readGroups(), normalize);
  const total = Object.values(plan.byStatus).reduce((s, n) => s + n, 0);
  console.log(`  rows read: ${total.toLocaleString()}   by status: ${JSON.stringify(plan.byStatus)}`);
  console.log(`  would be rewritten: ${plan.rowsToChange.toLocaleString()} rows in ${plan.changes.length} (model, trim) groups; trim_raw column exists: ${await columnExists()}`);
  for (const c of plan.changes.slice(0, 40)) console.log(`    ${c.count.toLocaleString().padStart(7)}  ${c.make} ${c.model} | ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  if (!APPLY) { console.log("DRY RUN - nothing was changed."); await pool.end(); return; }

  await withLock("oem-trim-normalize", async () => {
    if (!(await columnExists())) {
      console.log("  adding dealer_inventory.trim_raw (ALGORITHM=INSTANT)...");
      await q("ALTER TABLE dealer_inventory ADD COLUMN IF NOT EXISTS trim_raw VARCHAR(160) NULL, ALGORITHM=INSTANT");
    }
    // Re-read under the lock (nothing else is writing now), then work from that.
    const fresh = planFromGroups(await readGroups(), normalize);
    const backupFile = path.resolve(process.cwd(), `oem-trim-normalize-${new Date().toISOString().replace(/[:.]/g, "-")}.rollback.jsonl`);
    const fd = fs.openSync(backupFile, "a");
    console.log(`  backup of every changed row (before-state) -> ${backupFile}`);
    let result;
    try {
      result = await applyChanges({
        changes: fresh.changes, limit: LIMIT, txSize: TX_SIZE, sleep: () => sleep(PAUSE_MS),
        // Index-bounded range on (make, model, trim) with NO BINARY in the WHERE (BINARY defeats the index). The ci range also returns case variants; applyChanges keeps only the exact text.
        fetchTargets: (c) => timed(`read ${c.make} ${c.model} ${JSON.stringify(c.before)}`, () => q(`SELECT vin, dealer_id, make, model, trim, trim_raw FROM dealer_inventory WHERE make = ? AND model = ? AND trim = ?${ACTIVE_ONLY ? " AND removed_at IS NULL" : ""}`, [c.make, c.model, c.before])),
        writeBackup: (batch, c) => { fs.writeSync(fd, batch.map((r) => backupLine(r, c.after)).join("\n") + "\n"); fs.fsyncSync(fd); }, // the before-state is on disk before the first row of this chunk changes
        // One transaction per chunk (<= TX_SIZE rows), one UPDATE per row by primary key alone (vin, dealer_id). Any error rolls the chunk back and stops the run.
        updateChunk: async (chunk, c) => {
          const conn = await pool.getConnection();
          try {
            await conn.beginTransaction();
            let n = 0;
            for (const r of chunk) n += (await timed(`update ${r.vin}/${r.dealer_id}`, () => conn.query(`SET STATEMENT max_statement_time=${STATEMENT_CAP_S} FOR UPDATE dealer_inventory SET trim = ?, trim_raw = ? WHERE vin = ? AND dealer_id = ?`, [c.after, c.before, r.vin, r.dealer_id])))[0].affectedRows;
            await conn.commit();
            return n;
          } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
        },
      });
    } finally { fs.closeSync(fd); }
    const { updated, skipped } = result;
    const after = planFromGroups(await readGroups(), normalize);
    console.log(`rewritten: ${updated.toLocaleString()} rows; skipped (trim changed under us): ${skipped}. Still fixable after the run: ${after.rowsToChange.toLocaleString()} (nonzero only if --limit stopped it, or new rows arrived).`);
    console.log(`Rollback: node 2026-10-27-oem-trim-normalize.mjs --rollback=${backupFile} [--apply --fleet-idle]`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
