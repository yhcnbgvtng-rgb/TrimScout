// Ford trim fill from the VIN, for rows the text normalizer cannot help: blank trims and unreadable ones ("Preferred", "8 FOOT BED", engine text,
// a dealer name) on the nine profiled models. The trim is learned from the fleet itself: VIN positions 5-7 (line / body / drive code) plus position 10
// (model year), per model, over the CLEAN rows (trim already exactly an official trim, src/fordTrim.js). A key is trusted only when at least 5 clean rows
// carry it and 95% or more of them agree on one trim. Everything else is left exactly as it is. Never touches a clean row and never rewrites a row the
// text normalizer can read ('fix' - that is 2026-10-27-ford-trim-normalize.mjs's job).
//
//   node 2026-10-27-ford-trim-vin-fill.mjs                                  # DRY RUN (default, also --dry-run): counts only, per model, writes nothing
//   node 2026-10-27-ford-trim-vin-fill.mjs --apply --fleet-idle --limit=2000   # fill, in batches; --limit is REQUIRED with --apply and is a hard cap
//   node 2026-10-27-ford-trim-vin-fill.mjs --rollback=FILE                  # count how many rows of a rollback file could be restored
//   node 2026-10-27-ford-trim-vin-fill.mjs --rollback=FILE --apply --fleet-idle   # restore them
//
// Safe by construction (same rails as 2026-10-27-ford-trim-normalize.mjs):
//  - Dry run reads two grouped queries (active rows, make prefix on the index) and prints counts only: no VINs, no row data.
//  - --apply needs --fleet-idle and --limit, takes the deals-API sync lock (own owner id, heartbeated, released in finally; exit 4 and no change if it is
//    held), and refuses to run against a retired box IP. Every statement has a 20 s cap; any error or timeout stops the run, no retry.
//  - Rows are read per (model, exact trim text) by the index prefix, in keyset pages, and every batch is APPENDED TO THE ROLLBACK FILE (and fsynced) BEFORE its
//    UPDATE. The UPDATE is by primary key (vin, dealer_id) and also requires `trim` to still be the text that was read.
//  - trim_raw is set to the original text (an original that was blank stays NULL; a trim_raw already on the row is kept). The column must already exist
//    (the text normalizer / deals API creates it): this script never alters the table.
//  - Rollback restores trim and trim_raw from the file, only where trim is still the value this script wrote.
//  - Idempotent: a second run finds nothing left to fill. Run on box2 from /opt/trimscout-deals (needs src/fordTrim.js deployed). NOT run by the PR that adds it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { backupLine, parseBackup } from "./2026-10-27-ford-trim-normalize.mjs";

const BATCH = 200;
const PAUSE_MS = 150;
const STATEMENT_CAP_S = 20;
export const MIN_ROWS = 5;
export const MIN_SHARE = 0.95;
const FILLABLE = new Set(["blank", "leftover", "ambiguous"]);

/** Pure: the VIN key (positions 5-7 + position 10, 1-based) or null for anything that is not a 17-character VIN. */
export function vinKey(vin) {
  const v = String(vin || "").trim().toUpperCase();
  if (v.length !== 17) return null;
  return `${v.slice(4, 7)}|${v[9]}`;
}

/**
 * Pure: learn VIN key -> trim from grouped rows { model, trim, k, y, count } (k = positions 5-7, y = position 10).
 * Only CLEAN rows vote. A key is kept when it has >= minRows clean rows and the top trim holds >= minShare of them.
 * Returns Map "<model group>|<k>|<y>" -> { trim, rows, share }.
 */
export function buildMapping(groups, mod, { minRows = MIN_ROWS, minShare = MIN_SHARE } = {}) {
  const votes = new Map(); // key -> Map(trim -> n)
  for (const g of groups) {
    if (!g.k || !g.y) continue;
    const group = mod.fordModelGroup(g.model);
    if (!group || mod.normalizeFordTrim({ make: "Ford", model: g.model, trim: g.trim }).status !== "clean") continue;
    const key = `${group}|${g.k}|${g.y}`;
    const m = votes.get(key) || new Map();
    m.set(g.trim, (m.get(g.trim) || 0) + g.count);
    votes.set(key, m);
  }
  const out = new Map();
  for (const [key, m] of votes) {
    const rows = [...m.values()].reduce((s, n) => s + n, 0);
    const [trim, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (rows >= minRows && n / rows >= minShare) out.set(key, { trim, rows, share: n / rows });
  }
  return out;
}

/** Pure: the fill for one row, or null (not a fillable status, no VIN key, or the key is not trusted). */
export function fillFor(row, mapping, mod) {
  const group = mod.fordModelGroup(row.model);
  const k = vinKey(row.vin);
  if (!group || !k) return null;
  if (!FILLABLE.has(mod.normalizeFordTrim({ make: "Ford", model: row.model, trim: row.trim }).status)) return null;
  const hit = mapping.get(`${group}|${k}`);
  if (hit && group === "F-150" && hit.trim === "Raptor" && String(row.vin).toUpperCase()[7] === "5") return null; // Raptor R (VIN position 8 = 5) is on hold: never filled
  return hit ? hit.trim : null;
}

/** Pure: the trim_raw to store: a value already there wins, else the original text, else NULL (a blank original has no text to keep). */
export function trimRawFor(row) {
  if (row.trim_raw != null && String(row.trim_raw).trim() !== "") return row.trim_raw;
  const t = row.trim == null ? "" : String(row.trim).trim();
  return t ? t.slice(0, 160) : null;
}

/**
 * Pure: grouped rows { model, trim, k, y, count } -> the dry-run report. `perModel[group]` counts rows by what would happen; `groups` lists the
 * (model, exact trim text) groups that hold at least one fillable row, which is what --apply walks.
 */
export function planFills(groups, mapping, mod) {
  const perModel = {};
  const touched = new Map(); // "model\0trim" -> { model, trim, rows }
  for (const g of groups) {
    const group = mod.fordModelGroup(g.model);
    if (!group) continue;
    const m = (perModel[group] ||= { rows: 0, clean: 0, fixable: 0, fillable: 0, unreadableNoRule: 0 });
    const status = mod.normalizeFordTrim({ make: "Ford", model: g.model, trim: g.trim }).status;
    m.rows += g.count;
    if (status === "clean") m.clean += g.count;
    else if (status === "fix") m.fixable += g.count; // left for the text normalizer
    else if (FILLABLE.has(status)) {
      const hit = g.k && g.y ? mapping.get(`${group}|${g.k}|${g.y}`) : null;
      if (hit) {
        m.fillable += g.count;
        const id = `${g.model}\0${g.trim ?? ""}\0${g.trim == null ? "n" : "s"}`;
        const t = touched.get(id) || { model: g.model, trim: g.trim, rows: 0 };
        t.rows += g.count;
        touched.set(id, t);
      } else m.unreadableNoRule += g.count;
    }
  }
  const groupsToWalk = [...touched.values()].sort((a, b) => b.rows - a.rows);
  const rowsToFill = Object.values(perModel).reduce((s, m) => s + m.fillable, 0);
  return { perModel, groups: groupsToWalk, rowsToFill };
}

/**
 * Pure apply loop. For each (model, trim) group, page through its rows (keyset: fetchPage(group, cursor, n) -> rows ordered by (vin, dealer_id) after the
 * cursor), keep the ones with a trusted fill, write the rollback lines, update, continue until the group ends. `limit` is a HARD cap on rows updated:
 * a batch is never larger than what is left of it. A batch whose UPDATE moved nothing ends its group.
 */
export async function applyFills({ groups, mapping, mod, limit, batchSize = BATCH, fetchPage, writeBackup, updateBatch, sleep = async () => {} }) {
  if (!(limit > 0)) throw new Error("applyFills needs a positive limit");
  let updated = 0, skipped = 0;
  const perModel = {};
  outer: for (const g of groups) {
    let cursor = null;
    for (;;) {
      const room = limit - updated;
      if (room <= 0) break outer;
      const page = await fetchPage(g, cursor, batchSize);
      if (!page.length) break;
      cursor = { vin: page[page.length - 1].vin, dealer_id: page[page.length - 1].dealer_id };
      const batch = [];
      for (const row of page) {
        const after = fillFor(row, mapping, mod);
        if (after != null) batch.push({ row, after });
        if (batch.length >= room) break;
      }
      if (batch.length) {
        writeBackup(batch); // before-state first, then the UPDATE
        const n = await updateBatch(batch);
        updated += n; skipped += batch.length - n;
        const name = mod.fordModelGroup(g.model);
        perModel[name] = (perModel[name] || 0) + n;
        await sleep();
        if (n === 0) break; // nothing moved: do not spin
        if (batch.length >= room) continue; // loop top ends the run
      }
      if (page.length < batchSize) break;
    }
  }
  return { updated, skipped, perModel };
}

/** Pure: the rollback line for one filled row (same shape as the text normalizer's, plus how it was found). */
export const fillBackupLine = ({ row, after }) => backupLine(row, after);

async function loadNormalizer() {
  const candidates = [path.resolve(process.cwd(), "src/fordTrim.js"), new URL("../../scrapers/lightsail-crawler/src/fordTrim.js", import.meta.url).pathname];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) { console.error(`Missing src/fordTrim.js (looked in ${candidates.join(", ")}) - deploy it to the box first.`); process.exit(1); }
  return import(pathToFileURL(found).href);
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
  const LIMIT = opt("limit") != null ? Number(opt("limit")) : null;
  if (flag("dry-run") && APPLY) { console.error("--dry-run and --apply together: pick one."); process.exit(1); }
  if (APPLY && !FLEET_IDLE) { console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }
  if (APPLY && !ROLLBACK && !(LIMIT > 0)) { console.error("--apply needs --limit=N (a hard cap on rows changed). Start small."); process.exit(1); }
  if (LIMIT != null && !(LIMIT > 0)) { console.error("--limit must be a positive number"); process.exit(1); }

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
  const user = APPLY ? (dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER) : (dbEnv.DB_READER_USER || process.env.DB_READER_USER || dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER);
  const password = APPLY ? (dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD) : (dbEnv.DB_READER_PASSWORD || process.env.DB_READER_PASSWORD || dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD);
  const pool = mysql.createPool({ host: DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout", user, password, connectionLimit: 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    await withLock("ford-trim-vin-rollback", async () => {
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

  // -------------------------------------------------------------- fill
  const mod = await loadNormalizer();
  console.log(`${APPLY ? "LIVE (--apply)" : "DRY RUN"}  ${new Date().toISOString()}  active rows; rule: >= ${MIN_ROWS} clean rows, >= ${MIN_SHARE * 100}% agree, key = VIN 5-7 + 10, per model`);
  // Exact bytes of the trim (the column is case-insensitive), grouped with the VIN key. Active Ford rows only.
  const readGroups = async () => (await q("SELECT model, CONVERT(BINARY trim USING utf8mb4) AS trim, SUBSTRING(vin, 5, 3) AS k, SUBSTRING(vin, 10, 1) AS y, COUNT(*) AS n FROM dealer_inventory WHERE make = 'Ford' AND removed_at IS NULL AND CHAR_LENGTH(vin) = 17 GROUP BY model, BINARY trim, k, y"))
    .map((r) => ({ model: r.model, trim: r.trim, k: String(r.k || "").toUpperCase(), y: String(r.y || "").toUpperCase(), count: Number(r.n) }));
  const report = (groups) => {
    const mapping = buildMapping(groups, mod);
    const plan = planFills(groups, mapping, mod);
    return { mapping, plan };
  };
  const { mapping, plan } = report(await readGroups());
  console.log(`  trusted VIN keys: ${mapping.size.toLocaleString()}   trim_raw column exists: ${await columnExists()}`);
  console.log("  per model (rows):");
  for (const [name, m] of Object.entries(plan.perModel).sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`    ${name.padEnd(11)} total ${String(m.rows).padStart(7)}  clean ${String(m.clean).padStart(7)}  would fill ${String(m.fillable).padStart(6)}  no trusted rule ${String(m.unreadableNoRule).padStart(6)}  left to the text normalizer ${String(m.fixable).padStart(6)}`);
  }
  console.log(`  would fill: ${plan.rowsToFill.toLocaleString()} rows in ${plan.groups.length} (model, trim text) groups`);
  if (!APPLY) { console.log("DRY RUN - nothing was changed."); await pool.end(); return; }

  await withLock("ford-trim-vin-fill", async () => {
    if (!(await columnExists())) throw new Error("dealer_inventory.trim_raw does not exist yet - deploy the Ford trim normalizer (it creates the column) first. This script never alters the table.");
    // Re-read under the lock (nothing else is writing now), then work from that.
    const fresh = report(await readGroups());
    const backupFile = path.resolve(process.cwd(), `ford-trim-vin-fill-${new Date().toISOString().replace(/[:.]/g, "-")}.rollback.jsonl`);
    const fd = fs.openSync(backupFile, "a");
    console.log(`  rollback file (before-state of every changed row) -> ${backupFile}`);
    let result;
    try {
      result = await applyFills({
        groups: fresh.plan.groups, mapping: fresh.mapping, mod, limit: LIMIT, batchSize: BATCH, sleep: () => sleep(PAUSE_MS),
        fetchPage: (g, cursor, n) => {
          const t = g.trim == null ? "trim IS NULL" : "trim = ? AND BINARY trim = BINARY ?";
          const params = [g.model, ...(g.trim == null ? [] : [g.trim, g.trim]), ...(cursor ? [cursor.vin, cursor.vin, cursor.dealer_id] : [])];
          return q(`SELECT vin, dealer_id, model, trim, trim_raw FROM dealer_inventory WHERE make = 'Ford' AND model = ? AND ${t} AND removed_at IS NULL${cursor ? " AND (vin > ? OR (vin = ? AND dealer_id > ?))" : ""} ORDER BY vin, dealer_id LIMIT ${n}`, params);
        },
        writeBackup: (batch) => { fs.writeSync(fd, batch.map(fillBackupLine).join("\n") + "\n"); fs.fsyncSync(fd); }, // on disk before the first row of this batch changes
        updateBatch: async (batch) => {
          let n = 0;
          for (const { row, after } of batch) {
            const same = row.trim == null ? "trim IS NULL" : "BINARY trim = BINARY ?";
            const res = await pool.query(`SET STATEMENT max_statement_time=${STATEMENT_CAP_S} FOR UPDATE dealer_inventory SET trim = ?, trim_raw = ? WHERE vin = ? AND dealer_id = ? AND ${same}`, [after, trimRawFor(row), row.vin, row.dealer_id, ...(row.trim == null ? [] : [row.trim])]);
            n += res[0].affectedRows;
          }
          return n;
        },
      });
    } finally { fs.closeSync(fd); }
    const after = report(await readGroups());
    console.log(`filled: ${result.updated.toLocaleString()} rows ${JSON.stringify(result.perModel)}; skipped (trim changed under us): ${result.skipped}. Still fillable after the run: ${after.plan.rowsToFill.toLocaleString()} (nonzero only if --limit stopped it, or new rows arrived).`);
    console.log(`Rollback: node 2026-10-27-ford-trim-vin-fill.mjs --rollback=${backupFile} [--apply --fleet-idle]`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
