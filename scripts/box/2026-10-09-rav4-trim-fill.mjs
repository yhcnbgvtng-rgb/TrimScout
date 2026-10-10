// Fills a BLANK trim on 2026 RAV4 rows from a reviewed plan (docs/rav4-2026/trim_fill_dry_run.csv: URL slug / crawl snapshot evidence).
//
//   node 2026-10-09-rav4-trim-fill.mjs <plan.json>                       # dry run: reads, counts, writes nothing
//   node 2026-10-09-rav4-trim-fill.mjs <plan.json> --apply --fleet-idle  # live
//
// plan.json = [{ "vin": "...", "dealerId": 123, "trim": "XLE Premium" }, ...]
// Safety: each UPDATE has `WHERE vin = ? AND dealer_id = ? AND (trim IS NULL OR trim = '')` — a trim a crawl wrote since the dry run is never
// overwritten; the before-state of every row is saved to <plan>.rollback-<ts>.json BEFORE the first UPDATE; --apply takes the deals-API sync
// lock (own owner id, heartbeated, released at the end; exits 4 if held); refuses to run against 3.237.204.55; any error or timeout stops the run
// (no retry). No dealer page is fetched. Run on the deals box (box2) from /opt/trimscout-deals.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const PLAN = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const FORBIDDEN_HOST = "3.237.204.55";
if (!PLAN) { console.error("usage: rav4-trim-fill.mjs <plan.json> [--apply --fleet-idle]"); process.exit(1); }
if (APPLY && !args.includes("--fleet-idle")) { console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }
const TRUSTED = new Set(["LE", "SE", "XLE Premium", "Woodland", "XSE", "Limited"]);

function readEnvFile(file) {
  const out = {};
  try { for (const line of fs.readFileSync(file, "utf-8").split("\n")) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq === -1) continue; let v = t.slice(eq + 1).trim(); if (/^["'].*["']$/.test(v)) v = v.slice(1, -1); out[t.slice(0, eq).trim()] = v; } } catch { /* missing */ }
  return out;
}
const dbEnv = readEnvFile(path.resolve(process.cwd(), ".env.trimscout-db"));
const appEnv = readEnvFile(path.resolve(process.cwd(), ".env"));
const API_KEY = process.env.TRIMSCOUT_API_KEY || appEnv.TRIMSCOUT_API_KEY || dbEnv.TRIMSCOUT_API_KEY || null;
const DB_HOST = dbEnv.DB_HOST || process.env.DB_HOST;
const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || dbEnv.DEALS_API_PORT || 3004}`;
if ([DB_HOST, DEALS].some((h) => String(h || "").includes(FORBIDDEN_HOST))) { console.error(`Refusing to run: this points at ${FORBIDDEN_HOST}.`); process.exit(1); }

const plan = JSON.parse(fs.readFileSync(PLAN, "utf-8"));
if (!Array.isArray(plan) || plan.some((r) => !/^[A-HJ-NPR-Z0-9]{17}$/.test(r.vin) || !Number.isInteger(Number(r.dealerId)) || !TRUSTED.has(r.trim))) { console.error("plan.json must be an array of { vin, dealerId, trim } with trim one of: " + [...TRUSTED].join(", ")); process.exit(1); }
if (new Set(plan.map((r) => `${r.vin}|${r.dealerId}`)).size !== plan.length) { console.error("plan.json has duplicate (vin, dealerId) rows"); process.exit(1); }

const pool = mysql.createPool({ host: DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout", user: dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER, password: dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD, connectionLimit: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockCall = async (action, owner, extra = {}) => {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
};
// 20 s statement cap on every read/write; a timeout or any error throws and stops the run (no retry).
async function q(sql, params) { const [rows] = await pool.query(`SET STATEMENT max_statement_time=20 FOR ${sql}`, params); return rows; }
async function readRows() {
  const found = new Map();
  for (let i = 0; i < plan.length; i += 150) {
    const part = plan.slice(i, i + 150);
    const rows = await q(`SELECT vin, dealer_id, make, model, year, trim, removed_at, last_seen_at FROM dealer_inventory WHERE ${part.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")}`, part.flatMap((r) => [r.vin, Number(r.dealerId)]));
    for (const r of rows) found.set(`${r.vin}|${r.dealer_id}`, r);
  }
  return found;
}
const blank = (v) => v == null || String(v).trim() === "";
function classify(found) {
  const c = { blank: [], notBlank: [], missing: [] };
  for (const p of plan) { const r = found.get(`${p.vin}|${p.dealerId}`); if (!r) c.missing.push(p); else if (blank(r.trim)) c.blank.push({ p, r }); else c.notBlank.push({ p, r }); }
  return c;
}

async function main() {
  console.log(`${APPLY ? "LIVE (--apply)" : "DRY RUN"}  ${new Date().toISOString()}  ${plan.length} planned rows`);
  const c = classify(await readRows());
  const byTrim = {}; for (const { p } of c.blank) byTrim[p.trim] = (byTrim[p.trim] || 0) + 1;
  console.log(`  still blank (would be updated): ${c.blank.length} ${JSON.stringify(byTrim)}   no longer blank (skipped): ${c.notBlank.length}   row not found: ${c.missing.length}   of the blank ones, already retired (removed_at set): ${c.blank.filter((x) => x.r.removed_at).length}`);
  for (const { p, r } of c.notBlank.slice(0, 10)) console.log(`    skipped: ${p.vin} now trim=${JSON.stringify(r.trim)} (plan ${p.trim})`);
  if (!APPLY) { console.log("DRY RUN — nothing was changed."); await pool.end(); return; }
  if (!API_KEY) { console.error("No TRIMSCOUT_API_KEY found: refusing to apply without being able to take the sync lock."); await pool.end(); process.exit(3); }

  const owner = `rav4-trim-fill-${process.pid}`;
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`Sync lock taken as ${owner}.`);
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
  process.on("SIGTERM", async () => { await release(); process.exit(143); });
  let failed = null;
  try {
    // Re-read under the lock (nothing else is writing now), then save the before-state first.
    const fresh = classify(await readRows());
    const rb = `${PLAN}.rollback-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    fs.writeFileSync(rb, JSON.stringify(plan.map((p) => { const r = fresh.blank.concat(fresh.notBlank).find((x) => x.p === p)?.r; return r ? { vin: r.vin, dealer_id: r.dealer_id, trim_before: r.trim, planned_trim: p.trim, removed_at: r.removed_at, last_seen_at: r.last_seen_at } : { vin: p.vin, dealer_id: p.dealerId, missing: true }; }), null, 1));
    console.log(`  before-state of ${plan.length} rows saved to ${rb}`);
    let updated = 0, skipped = 0;
    for (const { p } of fresh.blank) {
      const rows = await pool.query("SET STATEMENT max_statement_time=20 FOR UPDATE dealer_inventory SET trim = ? WHERE vin = ? AND dealer_id = ? AND (trim IS NULL OR trim = '')", [p.trim, p.vin, Number(p.dealerId)]);
      const n = rows[0].affectedRows; updated += n; skipped += 1 - n;
      await sleep(30);
    }
    console.log(`trim filled: ${updated} rows; skipped because the trim was no longer blank at write time: ${skipped + fresh.notBlank.length} (${fresh.notBlank.length} already non-blank at the re-read, ${skipped} changed in between); row not found: ${fresh.missing.length}`);
    const after = await readRows();
    console.log(`  verification: ${plan.filter((p) => { const r = after.get(`${p.vin}|${p.dealerId}`); return r && r.trim === p.trim; }).length} of ${plan.length} planned rows now carry exactly the planned trim`);
  } catch (e) { failed = e; console.error("ERROR — stopping, no retry:", e.message); }
  finally { await release(); console.log("Sync lock released."); }
  await pool.end();
  if (failed) process.exit(1);
}
main().catch(async (e) => { console.error(e); try { await pool.end(); } catch { /* */ } process.exit(1); });
