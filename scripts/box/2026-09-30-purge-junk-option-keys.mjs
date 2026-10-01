// One-shot purge of junk rows already sitting in dealer_inventory_options (buyer /search's
// factory-options facet) from BEFORE this session's filter hardening (src/inventoryOptionRows.js:
// bare calendar dates, cash/bonus/financed incentive-program names, bare numbers/currency with no
// letters, mileage/location/delivery sentences — see that file's own comments for the live samples
// that prompted each one). Deliberately separate from re-running the backfill: the backfill rebuilds
// a vehicle's rows from options_json (slow, one vehicle at a time, and this session's backfill is
// already mid-run from an earlier date) — this instead targets the junk DIRECTLY, in one pass, and
// is safe to run concurrently with that backfill (see below).
//
// Operates on DISTINCT canonical_key values, not individual rows or labels: dealer_inventory_options
// is ~24M rows / ~850K distinct keys, and a junk key like "09 30 2026" is heavily duplicated (57,501
// rows, one real value). Confirmed live 2026-09-30: grouping by canonical_key WHILE ALSO pulling one
// real label per group (needed to run the write-time, raw-label junk checks) took 13+ minutes;
// reading canonical_key alone off its own covering index (idx_opt_canonical) took 28s. This uses
// looksLikeJunkCanonicalKey (inventoryOptionRows.js) — a classifier built for the already-normalized
// key text specifically so this script never needs to touch the label column at all — then deletes
// by canonical_key, so each delete is targeted via idx_opt_canonical, not a full table scan either.
//
// Safe alongside the running options backfill (2026-09-28-backfill-inventory-options.mjs): that
// script REPLACES one vehicle's full row set inside its own transaction, keyed on (vin, dealer_id);
// this DELETEs by canonical_key globally. The two can only ever conflict by touching the very same
// (vin, dealer_id, canonical_key) row at the same instant, which MariaDB's own row locking
// serializes correctly either way — worst case, a canonical_key this purge deletes gets re-inserted
// moments later by the backfill reaching that vehicle with fresh (also junk, since the backfill is
// running with the OLD filter until it's restarted) data; re-running this purge afterward cleans
// that up too. Never invents or edits a real option — delete-only.
//
// Usage (from /opt/trimscout-deals on box2):
//   node 2026-09-30-purge-junk-option-keys.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const DRY_RUN = process.argv.includes("--dry-run");

const modPath = path.resolve(process.cwd(), "src/inventoryOptionRows.js");
if (!fs.existsSync(modPath)) {
  console.error(`Missing ${modPath} — deploy src/inventoryOptionRows.js to the box first.`);
  process.exit(1);
}
const { looksLikeJunkCanonicalKey } = await import(modPath);

function loadDbEnv() {
  const raw = fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function main() {
  const env = loadDbEnv();
  const pool = await mysql.createPool({
    host: env.DB_HOST, user: env.DB_WRITER_USER || env.DB_USER, password: env.DB_WRITER_PASSWORD || env.DB_PASSWORD,
    database: env.DB_NAME || "trimscout", connectionLimit: 2,
  });

  console.log(DRY_RUN ? "DRY RUN — no deletes will be made" : "LIVE — matching keys will be deleted");

  // canonical_key alone, off its own covering index — see the header comment for why this
  // deliberately never reads the label column here.
  const [rows] = await pool.query("SELECT canonical_key, COUNT(*) AS n FROM dealer_inventory_options GROUP BY canonical_key");
  console.log(`${rows.length} distinct canonical_key values, ${rows.reduce((s, r) => s + r.n, 0)} total rows`);

  const junkKeys = rows.filter((r) => looksLikeJunkCanonicalKey(r.canonical_key));
  const junkRowCount = junkKeys.reduce((s, r) => s + r.n, 0);
  console.log(`${junkKeys.length} junk keys covering ${junkRowCount} rows to delete`);
  console.log("sample junk keys:", junkKeys.slice(0, 20).map((r) => `${r.canonical_key} (${r.n})`));

  if (DRY_RUN) {
    await pool.end();
    return;
  }

  let deleted = 0;
  for (const { canonical_key } of junkKeys) {
    const [result] = await pool.query("DELETE FROM dealer_inventory_options WHERE canonical_key = ?", [canonical_key]);
    deleted += result.affectedRows;
  }
  console.log(`Deleted ${deleted} rows across ${junkKeys.length} junk keys.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
