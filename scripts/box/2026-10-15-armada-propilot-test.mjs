// Post-deploy check of the ProPILOT rule (#519) through deals-api: upsert a 2026 Armada (SL / Platinum / Platinum Reserve, trusted trim) with its own stored options PLUS
// "<trim> ProPILOT Assist 2.1 Package". With the fix the package is a normal option name, so the policy keeps it and the car gains a "... propilot assist 2 1 package" row.
// Reads back with the reader account; does not roll back by itself (restore-armada.mjs does).
import fs from "node:fs"; import mysql from "mysql2/promise";
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const env = {}; for (const l of fs.readFileSync("/opt/trimscout-deals/.env.trimscout-db", "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, connectionLimit: 1 });
const { car: c, optionRows: before } = JSON.parse(fs.readFileSync(args.backup, "utf8")).trusted;
const stored = typeof c.options_json === "string" ? JSON.parse(c.options_json) : c.options_json;
const tl = /^platinum reserve/i.test(c.trim) ? "Platinum Reserve" : /^platinum/i.test(c.trim) ? "Platinum" : "SL";
const pkg = { code: "PKG-PP", name: `${tl} ProPILOT Assist 2.1 Package`, price: 1500, kind: "package" };
const vehicle = { vin: c.vin, dealerId: c.dealer_id, dealerName: c.dealer_name, condition: c.cond, year: c.year, make: c.make, model: c.model, trim: c.trim, vdpUrl: c.vdp_url, options: [...stored, pkg] };
const r = await fetch("http://127.0.0.1:3004/api/inventory/bulk", { method: "POST", headers: { "X-Trimscout-Api-Key": env.TRIMSCOUT_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ vehicles: [vehicle] }) });
console.log(`car ${c.vin} dealer ${c.dealer_id} ${c.model} / ${c.trim}; package "${pkg.name}"; HTTP ${r.status} ${(await r.text()).slice(0, 220)}`);
const [after] = await pool.query("SELECT canonical_key, label FROM dealer_inventory_options WHERE vin = ? AND dealer_id = ?", [c.vin, c.dealer_id]);
const has = after.some((x) => /propilot assist 2 1 package/.test(x.canonical_key));
console.log(`option rows before ${before.length}, after ${after.length}; ProPILOT package row present: ${has}`);
console.log(has && r.ok ? "PASS" : "FAIL");
await pool.end();
