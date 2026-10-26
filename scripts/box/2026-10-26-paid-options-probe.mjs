// READ-ONLY probe: is the price already in the data behind /search's "Factory options" list, and what would the paid-only rule keep?
// Reads dealer_inventory.options_json (the only place the price lives until OPTIONS_PAID_ONLY adds the price column) for one make/model/trim, then lists
// per option label: cars, cars with a price > 0, min/max price, the feed's kind flags, and the paid-only verdict (KEEP / drop and why).
// Reader account only, session READ ONLY, one bounded query (20 s server-side cap, LIMIT). Writes nothing. Run on box2 from /opt/trimscout-deals:
//   node 2026-10-26-paid-options-probe.mjs --make=Hyundai --model=Tucson --trim=SEL [--limit=3000] [--env=/opt/trimscout-deals/.env.trimscout-db] [--src=/opt/trimscout-deals/src]
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { pathToFileURL } from "node:url";
import { pointsAtDeadIp } from "../../config/boxes.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
const { make, model, trim } = args;
if (!make || !model) { console.error("usage: --make=Hyundai --model=Tucson [--trim=SEL]"); process.exit(1); }
const LIMIT = Math.min(Math.max(Number(args.limit) || 3000, 100), 10000);
const envFile = args.env || "/opt/trimscout-deals/.env.trimscout-db";
const srcDir = path.resolve(args.src || "/opt/trimscout-deals/src");
const { isAccessoryOrSubscription } = await import(pathToFileURL(fs.existsSync(path.join(srcDir, "paidCatalogFilter.js")) ? path.join(srcDir, "paidCatalogFilter.js") : new URL("../../scrapers/lightsail-crawler/src/paidCatalogFilter.js", import.meta.url).pathname).href);

const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (pointsAtDeadIp(env.DB_HOST, process.env.TRIMSCOUT_DEALS_HOST)) { console.error("Refusing to run: points at a retired box IP (docs/BOXES.md)."); process.exit(1); }
if (!env.DB_READER_USER) { console.error("No DB_READER_USER in the env file; this script only uses the reader account."); process.exit(1); }
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, database: env.DB_NAME, connectionLimit: 1 });

const where = ["removed_at IS NULL", "make = ?", "model = ?"], params = [make, model];
if (trim) { where.push("`trim` = ?"); params.push(trim); }
const conn = await pool.getConnection();
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  const [cars] = await conn.query(`SET STATEMENT max_statement_time=20 FOR SELECT vin, options_json FROM dealer_inventory WHERE ${where.join(" AND ")} AND options_json IS NOT NULL LIMIT ${LIMIT}`, params);
  const byLabel = new Map();
  for (const c of cars) {
    let opts; try { opts = typeof c.options_json === "string" ? JSON.parse(c.options_json) : c.options_json; } catch { continue; }
    if (!Array.isArray(opts)) continue;
    const seen = new Set();
    for (const o of opts) {
      const label = String(o && o.name || "").replace(/\s+/g, " ").trim();
      if (!label) continue;
      const e = byLabel.get(label.toLowerCase()) || { label, cars: 0, paid: 0, min: null, max: null, kinds: new Set() };
      if (!seen.has(label.toLowerCase())) { e.cars++; seen.add(label.toLowerCase()); }
      const p = typeof o.price === "number" ? o.price : Number(String(o.price ?? "").replace(/[$,\s]/g, ""));
      if (Number.isFinite(p) && p > 0) { e.paid++; e.min = e.min == null ? p : Math.min(e.min, p); e.max = e.max == null ? p : Math.max(e.max, p); }
      e.kinds.add(o.kind || "(none)");
      byLabel.set(label.toLowerCase(), e);
    }
  }
  const rows = [...byLabel.values()].sort((a, b) => b.cars - a.cars);
  console.log(`${make} ${model}${trim ? " " + trim : ""}: ${cars.length} cars read (limit ${LIMIT}), ${rows.length} distinct labels\n`);
  console.log("cars  paid  min-max            kinds            verdict                    label");
  for (const e of rows) {
    const verdict = e.paid === 0 ? "drop: never priced" : isAccessoryOrSubscription(e.label) ? "drop: accessory/subscr." : "KEEP";
    const range = e.min == null ? "-" : e.min === e.max ? `$${e.min}` : `$${e.min}-$${e.max}`;
    console.log(`${String(e.cars).padStart(4)}  ${String(e.paid).padStart(4)}  ${range.padEnd(17)}  ${[...e.kinds].join(",").padEnd(15)}  ${verdict.padEnd(25)}  ${e.label}`);
  }
} finally { conn.release(); await pool.end(); }
