// Rebuilds dealer_inventory_options (buyer /search's factory-options facet) for every IN-STOCK
// vehicle from its stored dealer_inventory.options_json, using the exact same rules as the live
// nightly upsert (src/inventoryOptionRows.js: #333 junk-sentence filter, then canonical key).
//
// Why it's needed even though the 2026-09-25 backfill already ran:
//   1. Until 2026-09-28 the nightly upsert deleted a vehicle's facet rows whenever that night's
//      crawl extracted no options, while options_json kept the last real value — so vehicles that
//      HAD options lost them from the facet. options_json still holds them; this restores them.
//   2. The 2026-09-25 backfill was additive and unfiltered, and #333's junk filter only ever ran at
//      one crawler extraction site — ~1.19M stored rows were marketing sentences. This REPLACES each
//      vehicle's rows with the filtered set, so the junk goes too.
//
// Never invents options: a vehicle with no stored options_json is left exactly as it is.
// Replace semantics per vehicle + keyset paging => idempotent and safe to re-run or resume.
//
// Needs src/inventoryOptionRows.js deployed on the box first (it's loaded from there, not copied,
// so the backfill and the live upsert can never disagree). Run on box2 from /opt/trimscout-deals,
// OUTSIDE the nightly sync window, in the background so a dropped SSH session doesn't kill it:
//   sudo nohup node 2026-09-28-backfill-inventory-options.mjs [--dry-run] [--after=VIN:DEALER_ID]
//     [--batch=250] [--pause-ms=150] [--min-free-mb=600] > ~/backfill.log 2>&1 &
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const DRY_RUN = Boolean(args["dry-run"]);
// box2 is a shared box (MariaDB + deals/auth APIs + crawls). The first dry run (2026-09-28) read
// 2,000 vehicles' full options_json per batch and the box stopped responding around 600K scanned.
// Small batches, a pause between them, and a free-memory guard keep this a background job.
const BATCH = Math.min(Math.max(Number(args.batch) || 250, 50), 1000);
const PAUSE_MS = Math.max(Number(args["pause-ms"]) || 150, 0);
const MIN_AVAILABLE_MB = Math.max(Number(args["min-free-mb"]) || 600, 100);

// MemAvailable (not os.freemem(), which reports MemFree and ignores reclaimable cache).
function availableMb() {
  try {
    const m = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB/m);
    return m ? Math.round(Number(m[1]) / 1024) : Infinity;
  } catch {
    return Infinity;
  }
}
async function waitForMemory() {
  const started = Date.now();
  while (availableMb() < MIN_AVAILABLE_MB) {
    if (Date.now() - started > 10 * 60_000) throw new Error(`available memory stayed under ${MIN_AVAILABLE_MB}MB for 10 minutes — stopping to protect the box`);
    console.log(`  paused: ${availableMb()}MB available (< ${MIN_AVAILABLE_MB}MB), waiting 30s`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

const modPath = path.resolve(process.cwd(), "src/inventoryOptionRows.js");
if (!fs.existsSync(modPath)) {
  console.error(`Missing ${modPath} — deploy src/inventoryOptionRows.js to the box before running this.`);
  process.exit(1);
}
const { optionRowsFromOptions } = await import(modPath);

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

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_WRITER_USER,
  password: process.env.DB_WRITER_PASSWORD,
  connectionLimit: 2,
});

let cursor = { vin: "", dealerId: -1 };
if (typeof args.after === "string") {
  const [vin, dealerId] = args.after.split(":");
  cursor = { vin, dealerId: Number(dealerId) };
}

const totals = { scanned: 0, withOptionsJson: 0, replaced: 0, nowWithFacet: 0, rowsWritten: 0, junkDropped: 0, unparseable: 0 };
const byMake = new Map(); // make -> { replaced, nowWithFacet }

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}backfilling in-stock facet rows from options_json, batch=${BATCH}, starting after ${cursor.vin || "(start)"}:${cursor.dealerId}`);
  for (;;) {
    await waitForMemory();
    if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
    const conn = await pool.getConnection();
    let rows;
    try {
      await conn.beginTransaction();
      // FOR UPDATE: a nightly upsert touching the same vehicles waits for this small batch instead
      // of racing it and having fresher options overwritten by this run's older read.
      [rows] = await conn.query(
        `SELECT vin, dealer_id, make, options_json FROM dealer_inventory
         WHERE (vin, dealer_id) > (?, ?) AND removed_at IS NULL
         ORDER BY vin, dealer_id LIMIT ? FOR UPDATE`,
        [cursor.vin, cursor.dealerId, BATCH]
      );
      if (!rows.length) { await conn.rollback(); break; }
      cursor = { vin: rows[rows.length - 1].vin, dealerId: rows[rows.length - 1].dealer_id };
      totals.scanned += rows.length;

      const pairs = [], inserts = [];
      for (const r of rows) {
        if (!r.options_json) continue;
        let options;
        try { options = JSON.parse(r.options_json); } catch { totals.unparseable++; continue; }
        if (!Array.isArray(options) || !options.length) continue;
        totals.withOptionsJson++;
        const { rows: facetRows, junkDropped } = optionRowsFromOptions(options);
        totals.junkDropped += junkDropped;
        pairs.push([r.vin, r.dealer_id]);
        totals.replaced++;
        const m = byMake.get(r.make || "(none)") || { replaced: 0, nowWithFacet: 0 };
        m.replaced++;
        if (facetRows.length) { m.nowWithFacet++; totals.nowWithFacet++; }
        byMake.set(r.make || "(none)", m);
        for (const { key, label, code } of facetRows) inserts.push([r.vin, r.dealer_id, key, label, code]);
      }
      if (!DRY_RUN && pairs.length) {
        await conn.query("DELETE FROM dealer_inventory_options WHERE (vin, dealer_id) IN (?)", [pairs]);
        if (inserts.length) await conn.query("INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ?", [inserts]);
      }
      totals.rowsWritten += inserts.length;
      if (DRY_RUN) await conn.rollback(); else await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(`\nFailed after cursor ${cursor.vin}:${cursor.dealerId} — resume with --after=${cursor.vin}:${cursor.dealerId}`);
      throw err;
    } finally {
      conn.release();
    }
    if (totals.scanned % 25000 < BATCH) console.log(`...${totals.scanned} in-stock scanned, ${totals.replaced} rebuilt, ${totals.rowsWritten} rows, ${availableMb()}MB available, cursor ${cursor.vin}:${cursor.dealerId}`);
  }

  console.log(`\n=== ${DRY_RUN ? "DRY RUN — nothing written" : "Backfill complete"} ===`);
  console.log(`In-stock vehicles scanned:        ${totals.scanned}`);
  console.log(`  with stored options_json:       ${totals.withOptionsJson}`);
  console.log(`  facet rows rebuilt:             ${totals.replaced}`);
  console.log(`  ...of which now have >=1 option: ${totals.nowWithFacet}`);
  console.log(`Option rows written:              ${totals.rowsWritten}`);
  console.log(`Junk sentences dropped:           ${totals.junkDropped}`);
  console.log(`Unparseable options_json:         ${totals.unparseable}`);
  console.log(`\nTop makes by vehicles rebuilt (rebuilt / now with >=1 option):`);
  for (const [make, m] of [...byMake].sort((a, b) => b[1].replaced - a[1].replaced).slice(0, 25)) {
    console.log(`  ${make.padEnd(18)} ${String(m.replaced).padStart(8)} / ${m.nowWithFacet}`);
  }
  await pool.end();

  // The buyer dropdown reads precomputed counts (inv_option_facets); rebuild them now rather than
  // waiting for the next nightly sync to trigger it.
  if (!DRY_RUN) {
    const port = process.env.DEALS_API_PORT || 3004;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/inventory/catalog-facets/rebuild`, { method: "POST", headers: { "X-Trimscout-Api-Key": process.env.TRIMSCOUT_API_KEY || "" } });
      console.log(`\nCatalog facet rebuild requested: HTTP ${res.status} ${await res.text()}`);
      console.log(`Check progress: curl -s -H "X-Trimscout-Api-Key: $KEY" http://127.0.0.1:${port}/api/inventory/catalog-facets/status`);
    } catch (err) {
      console.error(`\nCould not request a catalog facet rebuild (${err.message}) — it will run automatically after the next sync, or trigger it manually.`);
    }
  }
}

main().catch((err) => { console.error("Backfill failed:", err); process.exit(1); });
