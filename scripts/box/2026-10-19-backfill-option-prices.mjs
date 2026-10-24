// Fills dealer_inventory_options.price (OPTIONS_PAID_ONLY) from each in-stock car's stored dealer_inventory.options_json.
// UPDATE-only: never inserts or deletes an option row, and never touches a row whose price already matches. Same derivation as the nightly
// upsert (model policy first, else the generic rules with the make allowlist), so a backfilled price equals what the next sync would write.
//
// NOT RUN YET. Order on box2 (see docs/OPTIONS_PAID_ONLY_CATALOG_NOTE.md): deploy the new src files, start deals-api once with OPTIONS_PAID_ONLY=1 so the
// column exists (or ALTER by hand), then run this OUTSIDE the sync window, one small make first. Dry run is the default and writes nothing:
//   node 2026-10-19-backfill-option-prices.mjs [--apply] [--make=Volvo[,Honda]] [--after=VIN:DEALER_ID] [--batch=250] [--pause-ms=150] [--min-free-mb=600] [--rebuild-facets]
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const DRY_RUN = !args.apply;
const MAKES = typeof args.make === "string" ? args.make.split(",").map((m) => m.trim()).filter(Boolean) : [];
const BATCH = Math.min(Math.max(Number(args.batch) || 250, 50), 1000);
const PAUSE_MS = Math.max(Number(args["pause-ms"]) || 150, 0);
const MIN_AVAILABLE_MB = Math.max(Number(args["min-free-mb"]) || 600, 100);

function availableMb() {
  try { const m = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB/m); return m ? Math.round(Number(m[1]) / 1024) : Infinity; } catch { return Infinity; }
}
async function waitForMemory() {
  const started = Date.now();
  while (availableMb() < MIN_AVAILABLE_MB) {
    if (Date.now() - started > 10 * 60_000) throw new Error(`available memory stayed under ${MIN_AVAILABLE_MB}MB for 10 minutes — stopping to protect the box`);
    console.log(`  paused: ${availableMb()}MB available (< ${MIN_AVAILABLE_MB}MB), waiting 30s`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

const src = (f) => path.resolve(process.cwd(), "src", f);
for (const f of ["inventoryOptionRows.js", "optionsPaidOnlyServer.js", "factoryOptionAllowlist.js", "mazdaPaidOptions.js"]) {
  if (!fs.existsSync(src(f))) { console.error(`Missing ${src(f)} — deploy the OPTIONS_PAID_ONLY src files first.`); process.exit(1); }
}
const { optionRowsFromOptions } = await import(src("inventoryOptionRows.js"));
const { prepareMazdaVehicle } = await import(src("mazdaPaidOptions.js"));
const { positivePrice } = await import(src("optionsPaidOnlyServer.js"));
const { loadAllowlistFromEnv, resolveAllowlisted, policyFacetRows, installJunkRulesFromEnv } = await import(src("factoryOptionAllowlist.js"));

function loadDbEnv() {
  const raw = fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDbEnv();
installJunkRulesFromEnv();
const { allowlist } = loadAllowlistFromEnv();

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, database: process.env.DB_NAME,
  user: process.env.DB_WRITER_USER, password: process.env.DB_WRITER_PASSWORD, connectionLimit: 2,
});

let cursor = { vin: "", dealerId: -1 };
if (typeof args.after === "string") { const [vin, dealerId] = args.after.split(":"); cursor = { vin, dealerId: Number(dealerId) }; }

const totals = { scanned: 0, withOptions: 0, rowsChecked: 0, rowsToPrice: 0, rowsUpdated: 0, rowsNowPaid: 0, unparseable: 0 };
const byMake = new Map();

// Desired rows with prices for one car, exactly as the sync derives them.
function desiredRows(r, options) {
  const make = r.make;
  const v = prepareMazdaVehicle({ model: r.model, year: r.year, options }, { make, allowlist, paidOnly: true });
  options = v.options;
  const vehicle = { make, model: v.model, year: r.year, trim: r.trim };
  const pol = policyFacetRows(allowlist, vehicle, options, { withPrice: true });
  if (pol && pol.skip) return null; // untrusted / blank trim: the sync leaves this car's rows alone, so do we
  return (pol || optionRowsFromOptions(options, { resolveKey: (key) => resolveAllowlisted(allowlist, make, key), withPrice: true })).rows;
}

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}pricing option rows from options_json, batch=${BATCH}${MAKES.length ? `, makes=${MAKES.join(",")}` : ""}, after ${cursor.vin || "(start)"}:${cursor.dealerId}`);
  for (;;) {
    await waitForMemory();
    if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
    // Plain consistent read: never blocks a sync.
    const [cars] = await pool.query(
      `SELECT vin, dealer_id, make, model, year, trim, options_json FROM dealer_inventory
       WHERE vin >= ? AND (vin > ? OR dealer_id > ?) AND removed_at IS NULL${MAKES.length ? " AND make IN (?)" : ""}
       ORDER BY vin, dealer_id LIMIT ?`,
      MAKES.length ? [cursor.vin, cursor.vin, cursor.dealerId, MAKES, BATCH] : [cursor.vin, cursor.vin, cursor.dealerId, BATCH]
    );
    if (!cars.length) break;
    cursor = { vin: cars[cars.length - 1].vin, dealerId: cars[cars.length - 1].dealer_id };
    totals.scanned += cars.length;

    const work = [];
    for (const r of cars) {
      if (!r.options_json) continue;
      let options;
      try { options = JSON.parse(r.options_json); } catch { totals.unparseable++; continue; }
      if (!Array.isArray(options) || !options.length) continue;
      totals.withOptions++;
      const rows = desiredRows(r, options);
      if (rows) work.push({ r, rows });
    }
    if (work.length) {
      const conds = work.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ");
      const [stored] = await pool.query(`SELECT vin, dealer_id, canonical_key, price FROM dealer_inventory_options WHERE ${conds}`, work.flatMap((w) => [w.r.vin, w.r.dealer_id]));
      const storedPrice = new Map(stored.map((s) => [`${s.vin}|${s.dealer_id}|${s.canonical_key}`, s.price]));
      const updates = [];
      for (const { r, rows } of work) {
        const m = byMake.get(r.make || "(none)") || { cars: 0, paidRows: 0, update: 0 };
        m.cars++;
        for (const row of rows) {
          const k = `${r.vin}|${r.dealer_id}|${row.key}`;
          if (!storedPrice.has(k)) continue; // UPDATE-only: a row the sync has not written is not ours to create
          totals.rowsChecked++;
          const want = positivePrice(row.price) ?? 0; // 0 = checked, not paid. NULL stays "not backfilled yet".
          if (want > 0) { totals.rowsNowPaid++; m.paidRows++; }
          if (storedPrice.get(k) !== want) { updates.push([want, r.vin, r.dealer_id, row.key]); m.update++; }
        }
        byMake.set(r.make || "(none)", m);
      }
      totals.rowsToPrice += updates.length;
      if (!DRY_RUN && updates.length) {
        updates.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] - b[2]));
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const u of updates) await conn.query("UPDATE dealer_inventory_options SET price = ? WHERE vin = ? AND dealer_id = ? AND canonical_key = ?", u);
          await conn.commit();
          totals.rowsUpdated += updates.length;
        } catch (err) {
          await conn.rollback().catch(() => {});
          console.error(`\nFailed after cursor ${cursor.vin}:${cursor.dealerId} — resume with --after=${cursor.vin}:${cursor.dealerId}`);
          throw err;
        } finally { conn.release(); }
      }
    }
    if (totals.scanned % 25000 < BATCH) console.log(`...${totals.scanned} scanned, ${totals.rowsToPrice} rows to price, ${availableMb()}MB available, cursor ${cursor.vin}:${cursor.dealerId}`);
  }
  console.log(`\n=== ${DRY_RUN ? "DRY RUN — nothing written" : "Price backfill complete"} ===`);
  console.log(JSON.stringify(totals, null, 2));
  for (const [make, m] of [...byMake].sort((a, b) => b[1].cars - a[1].cars).slice(0, 25)) console.log(`  ${make.padEnd(18)} cars ${String(m.cars).padStart(8)}  paid rows ${String(m.paidRows).padStart(8)}  rows to update ${m.update}`);
  await pool.end();
  if (args["rebuild-facets"] && !DRY_RUN) {
    const port = process.env.DEALS_API_PORT || 3004;
    const res = await fetch(`http://127.0.0.1:${port}/api/inventory/catalog-facets/rebuild`, { method: "POST", headers: { "X-Trimscout-Api-Key": process.env.TRIMSCOUT_API_KEY || "" } }).catch((e) => ({ status: e.message, text: async () => "" }));
    console.log(`Catalog facet rebuild requested: ${res.status}`);
  }
}
main().catch((err) => { console.error("Price backfill failed:", err); process.exit(1); });
