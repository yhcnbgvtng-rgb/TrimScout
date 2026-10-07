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
//   sudo nohup node 2026-09-28-backfill-inventory-options.mjs [--apply] [--after=VIN:DEALER_ID]
//     [--make=Toyota[,Honda]] [--batch=250] [--pause-ms=150] [--min-free-mb=600] [--report=/path/report.csv] [--rebuild-facets] > ~/backfill.log 2>&1 &
//
// SAFE BY DEFAULT (changed 2026-10-07, option-normalize deny rules): with no flag this is a DRY RUN —
// plain SELECTs, no transaction, no row locks, nothing written, nothing rebuilt — and it writes a per-make
// report (make, rule, label, vehicles) of every label the rules would DROP and every truncated label they
// would REPAIR. Writing requires --apply. The catalog-facet rebuild is a separate, explicit --rebuild-facets
// (it used to fire automatically after a write); without it the buyer dropdown keeps serving its last build
// until the next nightly sync or a manual rebuild.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const DRY_RUN = !args.apply;
if (args.apply && args["dry-run"]) { console.error("--apply and --dry-run are mutually exclusive"); process.exit(1); }
// --make=Toyota[,Honda]: only those makes (exact match on dealer_inventory.make). Keyset paging still walks the
// (vin, dealer_id) primary key, so a make filter never changes ordering or resume (--after) semantics.
const MAKES = typeof args.make === "string" ? args.make.split(",").map((m) => m.trim()).filter(Boolean) : [];
const REBUILD_FACETS = Boolean(args["rebuild-facets"]) && !DRY_RUN;
const REPORT_PATH = typeof args.report === "string" ? args.report : path.resolve(process.cwd(), `option-normalize-report-${DRY_RUN ? "dry" : "apply"}.csv`);
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

// Same write-time key normalization as the nightly upsert (deals_api_server.js), so a backfilled
// vehicle's dealer spellings land on the allowlisted canonical key too. Optional on purpose: a box
// without src/factoryOptionAllowlist.js, or with OPTION_ALLOWLIST_PATH unset, behaves as before.
const allowlistPath = path.resolve(process.cwd(), "src/factoryOptionAllowlist.js");
let resolveForMake = () => null;
if (fs.existsSync(allowlistPath)) {
  const { loadAllowlistFromEnv, resolveAllowlisted } = await import(allowlistPath);
  const { allowlist, error } = loadAllowlistFromEnv();
  if (error) console.warn(`allowlist not loaded (${error}); keeping dealer keys as-is`);
  resolveForMake = (make) => (key) => resolveAllowlisted(allowlist, make, key);
}

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
const dropReport = new Map(); // `${make}\t${rule}\t${label}` -> vehicles (rule-attributed drops only; "legacy" = pre-existing filters)
const repairReport = new Map(); // `${make}\t${from}\t${to}` -> vehicles
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}backfilling in-stock facet rows from options_json, batch=${BATCH}, ${MAKES.length ? `makes=${MAKES.join(",")}, ` : ""}starting after ${cursor.vin || "(start)"}:${cursor.dealerId}`);
  for (;;) {
    await waitForMemory();
    if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
    const conn = await pool.getConnection();
    let rows;
    try {
      if (!DRY_RUN) await conn.beginTransaction();
      // FOR UPDATE: a nightly upsert touching the same vehicles waits for this small batch instead
      // of racing it and having fresher options overwritten by this run's older read.
      // Dry run: plain consistent read, no FOR UPDATE — it must never block a nightly upsert on a live box.
      [rows] = await conn.query(
        `SELECT vin, dealer_id, make, options_json FROM dealer_inventory
         WHERE (vin, dealer_id) > (?, ?) AND removed_at IS NULL${MAKES.length ? " AND make IN (?)" : ""}
         ORDER BY vin, dealer_id LIMIT ?${DRY_RUN ? "" : " FOR UPDATE"}`,
        MAKES.length ? [cursor.vin, cursor.dealerId, MAKES, BATCH] : [cursor.vin, cursor.dealerId, BATCH]
      );
      if (!rows.length) { if (!DRY_RUN) await conn.rollback(); break; }
      cursor = { vin: rows[rows.length - 1].vin, dealerId: rows[rows.length - 1].dealer_id };
      totals.scanned += rows.length;

      const pairs = [], inserts = [];
      for (const r of rows) {
        if (!r.options_json) continue;
        let options;
        try { options = JSON.parse(r.options_json); } catch { totals.unparseable++; continue; }
        if (!Array.isArray(options) || !options.length) continue;
        totals.withOptionsJson++;
        const { rows: facetRows, junkDropped, dropped = [], repaired = [] } = optionRowsFromOptions(options, { resolveKey: resolveForMake(r.make) });
        totals.junkDropped += junkDropped;
        // One count per vehicle per distinct label, so the report reads as "vehicles affected".
        const mk = r.make || "(none)";
        for (const d of new Set(dropped.map((x) => `${x.rule}\t${x.label}`))) bump(dropReport, `${mk}\t${d}`);
        for (const x of new Set(repaired.map((y) => `${y.from}\t${y.to}`))) bump(repairReport, `${mk}\t${x}`);
        pairs.push([r.vin, r.dealer_id]);
        totals.replaced++;
        const m = byMake.get(r.make || "(none)") || { replaced: 0, nowWithFacet: 0 };
        m.replaced++;
        if (facetRows.length) { m.nowWithFacet++; totals.nowWithFacet++; }
        byMake.set(r.make || "(none)", m);
        for (const { key, label, code } of facetRows) inserts.push([r.vin, r.dealer_id, key, label, code]);
      }
      if (!DRY_RUN && pairs.length) {
        // NOT `WHERE (vin, dealer_id) IN (?)` — same fix as PR #355 on the sync write path: MariaDB
        // can't use this table's own (vin, dealer_id, canonical_key) primary key for a row-value
        // IN-list, so every call fell back to a full table scan instead of an index range scan.
        const sortedPairs = pairs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
        const pairConds = sortedPairs.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ");
        await conn.query(`DELETE FROM dealer_inventory_options WHERE ${pairConds}`, sortedPairs.flat());
        if (inserts.length) await conn.query("INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ?", [inserts]);
      }
      totals.rowsWritten += inserts.length;
      if (!DRY_RUN) await conn.commit();
    } catch (err) {
      if (!DRY_RUN) await conn.rollback().catch(() => {});
      console.error(`\nFailed after cursor ${cursor.vin}:${cursor.dealerId} — resume with --after=${cursor.vin}:${cursor.dealerId}`);
      throw err;
    } finally {
      conn.release();
    }
    if (totals.scanned % 25000 < BATCH) writeCsv(); // checkpoint: a killed run still leaves a usable partial report
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
  writeReport();
  await pool.end();

  // The buyer dropdown reads precomputed counts (inv_option_facets); rebuild them now rather than
  // waiting for the next nightly sync to trigger it.
  if (REBUILD_FACETS) {
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

function writeCsv() {
  const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = ["kind,make,rule,label,repaired_to,vehicles"];
  for (const [k, n] of dropReport) { const [make, rule, label] = k.split("\t"); lines.push(["drop", make, rule, label, "", n].map(csvCell).join(",")); }
  for (const [k, n] of repairReport) { const [make, from, to] = k.split("\t"); lines.push(["repair", make, "truncation-repair", from, to, n].map(csvCell).join(",")); }
  fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
}

function writeReport() {
  writeCsv();
  const deny = [...dropReport].filter(([k]) => k.split("\t")[1] !== "legacy");
  console.log(`\nPer-make report: ${REPORT_PATH} (${dropReport.size} drop lines, ${repairReport.size} repair lines)`);
  console.log(`New deny-rule drops (vehicle x label): ${deny.reduce((a, [, n]) => a + n, 0)}; repairs: ${[...repairReport.values()].reduce((a, n) => a + n, 0)}`);
  const perMake = new Map();
  for (const [k, n] of deny) { const make = k.split("\t")[0]; perMake.set(make, (perMake.get(make) || 0) + n); }
  for (const [make, n] of [...perMake].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${make.padEnd(18)} ${String(n).padStart(9)} vehicle-label drops`);
}

main().catch((err) => { console.error("Backfill failed:", err); process.exit(1); });
