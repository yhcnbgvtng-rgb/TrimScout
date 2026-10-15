// READ-ONLY audit of an earlier option-policy apply (reader account, no lock, no writes).
//   node 2026-10-15-applied-audit.mjs --make=Mazda --applied=/home/ubuntu/mazda-apply-20261015/out [--env=...]
// For every car in applied.jsonl that is still active: does its stored dealer_inventory_options equal what the apply wrote (plan.jsonl "after"),
// and what the CURRENT bundled policy would keep? Split by whether the car's trim is trusted today. Same 20 s cap / dealer-first batches as the apply.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { buildAllowlist, loadBundledModelPoliciesRaw, optionRowsForVehicle, modelPoliciesFor } from "../../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const MAKE = args.make, DIR = path.resolve(args.applied), BATCH = 20, CAP = 20;
const envFile = args.env || "/opt/trimscout-deals/.env.trimscout-db";
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, connectionLimit: 2 });
let timeouts = 0;
async function q(shape, sql, params) {
  try { const [rows] = await pool.query(`SET STATEMENT max_statement_time=${CAP} FOR ${sql}`, params); return rows; }
  catch (e) { if (e && (e.errno === 1969 || /max_statement_time/.test(e.message))) { timeouts++; console.log(`TIMEOUT in ${shape} (#${timeouts})`); if (timeouts >= 2) throw new Error("second timeout - stopping"); } throw e; }
}
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const lines = (f) => fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sigSet = (rows) => new Set(rows.map((r) => `${r[0]}\u0001${r[1]}`));
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

const applied = new Set(lines("applied.jsonl").map((o) => `${o.vin}|${o.dealer_id}`));
const planAfter = new Map(lines("plan.jsonl").map((o) => [`${o.vin}|${o.dealer_id}`, sigSet(o.after)]));
const batches = JSON.parse(fs.readFileSync(path.join(DIR, "batches.json"), "utf8"));
const allow = buildAllowlist(null, loadBundledModelPoliciesRaw());
const CAR_SQL = "SELECT vin, dealer_id, make, year, model, trim, options_json FROM dealer_inventory FORCE INDEX (idx_inv_by_dealer_covering) WHERE removed_at IS NULL AND dealer_id IN (?) AND make = ? AND year IN (2026, 2027)";
const ROW_SQL = "SELECT vin, dealer_id, canonical_key, label FROM dealer_inventory_options WHERE vin IN (?)";

const mk = () => ({ cars: 0, equalsApplied: 0, differsFromApplied: 0, empty: 0, equalsCurrentPolicy: 0, differsFromCurrentPolicy: 0, noPolicyNow: 0 });
const T = { trusted: mk(), untrusted: mk() };
const samples = { trustedDiffer: [], untrustedDiffer: [], trustedEmpty: [], untrustedEmpty: [] };
let appliedSeen = 0;
for (const b of batches) {
  const cars = (await q(`cars #${b.batch}`, CAR_SQL, [b.dealerIds, MAKE])).filter((c) => applied.has(`${c.vin}|${c.dealer_id}`));
  if (!cars.length) continue;
  const rows = [];
  for (const part of chunks([...new Set(cars.map((c) => c.vin))], 1000)) rows.push(...await q(`options #${b.batch}`, ROW_SQL, [part]));
  const by = new Map();
  for (const r of rows) { const k = `${r.vin}|${r.dealer_id}`; (by.get(k) || by.set(k, []).get(k)).push([r.canonical_key, r.label]); }
  for (const c of cars) {
    appliedSeen++;
    const k = `${c.vin}|${c.dealer_id}`;
    let o = null; try { o = c.options_json ? (typeof c.options_json === "string" ? JSON.parse(c.options_json) : c.options_json) : null; } catch {}
    const res = modelPoliciesFor(allow, c).length ? optionRowsForVehicle(allow, { vin: c.vin, make: c.make, model: c.model, year: c.year, trim: c.trim }, Array.isArray(o) ? o : []) : null;
    const g = res && res.trimTrusted ? T.trusted : T.untrusted;
    g.cars++;
    const cur = sigSet(by.get(k) || []);
    if (!cur.size) { g.empty++; const s = res && res.trimTrusted ? samples.trustedEmpty : samples.untrustedEmpty; if (s.length < 5) s.push({ vin: c.vin, dealer_id: c.dealer_id, trim: c.trim }); }
    if (same(cur, planAfter.get(k))) g.equalsApplied++; else { g.differsFromApplied++; const s = res && res.trimTrusted ? samples.trustedDiffer : samples.untrustedDiffer; if (s.length < 5) s.push({ vin: c.vin, dealer_id: c.dealer_id, trim: c.trim, now: cur.size, applied: planAfter.get(k).size }); }
    if (!res) g.noPolicyNow++;
    else if (same(cur, sigSet(res.rows.map((r) => [r.key, r.label])))) g.equalsCurrentPolicy++; else g.differsFromCurrentPolicy++;
  }
}
console.log(JSON.stringify({ make: MAKE, appliedInFile: applied.size, stillActiveFound: appliedSeen, goneOrMoved: applied.size - appliedSeen, ...T, samples, timeouts }, null, 1));
await pool.end();
