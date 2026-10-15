// Post-restart upsert test for the Mazda policy: one trusted-trim car and one untrusted-trim car (picked by pick-test-cars, backed up in --backup).
// Sends each car's OWN stored values (vdpUrl, trim, ...) to POST /api/inventory/bulk through deals-api, then reads the DB (reader account) and compares with the backup.
//   trusted:   payload options = stored options + one junk option the policy does not list  -> stored option rows must equal the policy rows, no junk row
//   untrusted: payload options = stored options                                             -> stored option rows must be unchanged (kept)
// Prints PASS/FAIL per car and every dealer_inventory column that changed. Does not roll back by itself.
import fs from "node:fs";
import mysql from "mysql2/promise";
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const env = {};
for (const line of fs.readFileSync("/opt/trimscout-deals/.env.trimscout-db", "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, connectionLimit: 1 });
const backup = JSON.parse(fs.readFileSync(args.backup, "utf8"));
const only = args.only; // "trusted" | "untrusted" | undefined (both)
const norm = (v) => (v instanceof Date ? v.toISOString() : v);
const sig = (rows) => rows.map((r) => `${r.canonical_key}\u0001${r.label}`).sort().join("|");
const results = {};
for (const kind of ["trusted", "untrusted"]) {
  if (only && only !== kind) continue;
  const { car: c, optionRows: beforeRows } = backup[kind];
  const stored = typeof c.options_json === "string" ? JSON.parse(c.options_json) : c.options_json;
  console.log(`${kind}: ${c.vin} dealer ${c.dealer_id} ${c.model} / ${c.trim}; stored option element shape: ${JSON.stringify(stored[0]).slice(0, 160)}`);
  const junk = { ...stored[0], name: "ZZ Policy Test Junk Option", label: "ZZ Policy Test Junk Option", code: "ZZTEST1" };
  const options = kind === "trusted" ? [...stored, junk] : stored;
  const vehicle = { vin: c.vin, dealerId: c.dealer_id, dealerName: c.dealer_name, condition: c.cond, year: c.year, make: c.make, model: c.model, trim: c.trim, vdpUrl: c.vdp_url, options };
  const r = await fetch("http://127.0.0.1:3004/api/inventory/bulk", { method: "POST", headers: { "X-Trimscout-Api-Key": env.TRIMSCOUT_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ vehicles: [vehicle] }) });
  const body = await r.text();
  console.log(`  HTTP ${r.status} ${body.slice(0, 300)}`);
  const [[after]] = await pool.query("SELECT * FROM dealer_inventory WHERE vin = ? AND dealer_id = ?", [c.vin, c.dealer_id]);
  const [afterRows] = await pool.query("SELECT canonical_key, label FROM dealer_inventory_options WHERE vin = ? AND dealer_id = ?", [c.vin, c.dealer_id]);
  const changed = Object.keys(c).filter((k) => JSON.stringify(norm(c[k])) !== JSON.stringify(norm(after[k])));
  const rowsSame = sig(beforeRows) === sig(afterRows);
  const junkRow = afterRows.some((x) => /zz policy test|zztest/i.test(`${x.canonical_key} ${x.label}`));
  const ok = r.ok && rowsSame && !junkRow;
  results[kind] = { ok, http: r.status, optionRowsBefore: beforeRows.length, optionRowsAfter: afterRows.length, optionRowsIdentical: rowsSame, junkRowPresent: junkRow, columnsChanged: changed };
  console.log(`  ${ok ? "PASS" : "FAIL"} ${JSON.stringify(results[kind])}`);
}
fs.writeFileSync(args.out, JSON.stringify(results, null, 1));
await pool.end();
