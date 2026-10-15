// READ-ONLY: pick one trusted-trim and one untrusted (non-blank) trim Mercedes-Benz 2026/27 car for the post-restart upsert tests, and dump their full
// dealer_inventory rows + dealer_inventory_options rows to --out (the rollback backup). Reader account, 20 s cap.
import fs from "node:fs";
import mysql from "mysql2/promise";
import { buildAllowlist, loadBundledModelPoliciesRaw, optionRowsForVehicle, modelPoliciesFor } from "../../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const env = {};
for (const line of fs.readFileSync("/opt/trimscout-deals/.env.trimscout-db", "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, connectionLimit: 1 });
const q = async (sql, p) => (await pool.query(`SET STATEMENT max_statement_time=20 FOR ${sql}`, p))[0];
const allow = buildAllowlist(null, loadBundledModelPoliciesRaw());
const batches = JSON.parse(fs.readFileSync(args.batches, "utf8"));
let trusted = null, untrusted = null;
for (const b of batches) {
  const cars = await q("SELECT * FROM dealer_inventory FORCE INDEX (idx_inv_by_dealer_covering) WHERE removed_at IS NULL AND dealer_id IN (?) AND make = 'Mercedes-Benz' AND year IN (2026, 2027) AND trim IS NOT NULL AND trim <> '' AND vdp_url IS NOT NULL AND options_json IS NOT NULL", [b.dealerIds]);
  for (const c of cars) {
    if (!modelPoliciesFor(allow, c).length) continue;
    let o; try { o = typeof c.options_json === "string" ? JSON.parse(c.options_json) : c.options_json; } catch { continue; }
    if (!Array.isArray(o) || !o.length) continue;
    const res = optionRowsForVehicle(allow, { vin: c.vin, make: c.make, model: c.model, year: c.year, trim: c.trim }, o);
    if (!res) continue;
    if (res.trimTrusted && !trusted && res.rows.length) trusted = c;
    if (!res.trimTrusted && !untrusted) untrusted = c;
  }
  if (trusted && untrusted) break;
}
const out = {};
for (const [name, c] of [["trusted", trusted], ["untrusted", untrusted]]) {
  if (!c) { out[name] = null; continue; }
  const rows = await q("SELECT * FROM dealer_inventory_options WHERE vin = ? AND dealer_id = ?", [c.vin, c.dealer_id]);
  out[name] = { car: c, optionRows: rows };
}
fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v && { vin: v.car.vin, dealer_id: v.car.dealer_id, model: v.car.model, trim: v.car.trim, optionsJsonLen: String(v.car.options_json).length, storedOptionRows: v.optionRows.length }])), null, 1));
await pool.end();
