// Puts the Armada test car back exactly as backed up: the columns the test touches (source, price_diff, price_change_type, change_type, options_json) and its option rows (delete + reinsert the backup rows), in one transaction.
import fs from "node:fs"; import mysql from "mysql2/promise";
const f = process.argv[2];
const env = {}; for (const l of fs.readFileSync("/opt/trimscout-deals/.env.trimscout-db", "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const mk = (u) => mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME, user: env[u + "_USER"], password: env[u + "_PASSWORD"], connectionLimit: 1 });
const W = mk("DB_WRITER"), R = mk("DB_READER");
const { car: c, optionRows } = JSON.parse(fs.readFileSync(f)).trusted;
const conn = await W.getConnection(); await conn.beginTransaction();
await conn.query("UPDATE dealer_inventory SET source=?, price_diff=?, price_change_type=?, change_type=?, options_json=? WHERE vin=? AND dealer_id=?", [c.source, c.price_diff, c.price_change_type, c.change_type, typeof c.options_json === "string" ? c.options_json : JSON.stringify(c.options_json), c.vin, c.dealer_id]);
await conn.query("DELETE FROM dealer_inventory_options WHERE vin=? AND dealer_id=?", [c.vin, c.dealer_id]);
if (optionRows.length) await conn.query("INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ?", [optionRows.map((r) => [r.vin, r.dealer_id, r.canonical_key, r.label, r.code ?? null])]);
await conn.commit(); conn.release();
const iso = (v) => (v instanceof Date ? v.toISOString() : v);
const [[a]] = await R.query("SELECT * FROM dealer_inventory WHERE vin=? AND dealer_id=?", [c.vin, c.dealer_id]);
const [rows] = await R.query("SELECT canonical_key, label FROM dealer_inventory_options WHERE vin=? AND dealer_id=? ORDER BY canonical_key", [c.vin, c.dealer_id]);
const want = optionRows.map((r) => `${r.canonical_key}|${r.label}`).sort().join(";"), got = rows.map((r) => `${r.canonical_key}|${r.label}`).sort().join(";");
console.log("columns still different:", Object.keys(c).filter((k) => JSON.stringify(iso(c[k])) !== JSON.stringify(iso(a[k]))).join(",") || "none", "| option rows identical to backup:", want === got, `(${rows.length})`);
await W.end(); await R.end();
