// Deals box, one-off (2026-09-22 v3): builds the reversed columns, their triggers, and the
// forward/reverse indexes that the search-speedup PR
// (scripts/box/2026-09-22-inventory-search-prefix-suffix.sh) switches the q= search to use.
// Run this FIRST, before that box script. Idempotent — every DDL clause is IF NOT EXISTS and
// the backfill only touches rows it hasn't reached yet, so it's safe to re-run if interrupted.
//
// Supersedes v2 (generated columns): MariaDB rejects REVERSE() inside GENERATED ALWAYS AS
// ("Function or expression 'reverse(...)' cannot be used in the GENERATED ALWAYS AS clause",
// errno 1901, no error code populated) — confirmed live on this box. This version uses plain
// columns populated by BEFORE INSERT/BEFORE UPDATE triggers instead (triggers aren't subject
// to the same function restriction), verified first against a throwaway scratch table before
// being applied here.
//
// Also supersedes the earlier ngram attempt (v1): the ngram FULLTEXT parser doesn't exist on
// this box at all (not installed, no plugin file, no apt package either — confirmed live).
//
// Run on the box (ubuntu@3.208.49.1):
//   curl -fsSL -o 2026-09-22-build-search-prefix-suffix-index.mjs https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-build-search-prefix-suffix-index.mjs
//   sudo cp 2026-09-22-build-search-prefix-suffix-index.mjs /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo node 2026-09-22-build-search-prefix-suffix-index.mjs
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

function loadDbEnv() {
  const envPath = path.resolve(process.cwd(), ".env.trimscout-db");
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadDbEnv();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_WRITER_USER,
  password: process.env.DB_WRITER_PASSWORD,
  waitForConnections: true,
  connectionLimit: 2,
});

const ddls = [
  "ADD COLUMN IF NOT EXISTS vin_rev CHAR(17) NULL",
  "ADD COLUMN IF NOT EXISTS dealer_name_rev VARCHAR(255) NULL",
  "ADD COLUMN IF NOT EXISTS model_rev VARCHAR(96) NULL",
  "ADD COLUMN IF NOT EXISTS trim_rev VARCHAR(160) NULL",
  "ADD COLUMN IF NOT EXISTS stock_number_rev VARCHAR(64) NULL",
  "ADD INDEX IF NOT EXISTS idx_inv_vin_rev (vin_rev)",
  "ADD INDEX IF NOT EXISTS idx_inv_dealer_name_fwd (dealer_name)",
  "ADD INDEX IF NOT EXISTS idx_inv_dealer_name_rev (dealer_name_rev)",
  "ADD INDEX IF NOT EXISTS idx_inv_model_fwd (model)",
  "ADD INDEX IF NOT EXISTS idx_inv_model_rev (model_rev)",
  "ADD INDEX IF NOT EXISTS idx_inv_trim_fwd (trim)",
  "ADD INDEX IF NOT EXISTS idx_inv_trim_rev (trim_rev)",
  "ADD INDEX IF NOT EXISTS idx_inv_stock_fwd (stock_number)",
  "ADD INDEX IF NOT EXISTS idx_inv_stock_rev (stock_number_rev)",
];

for (const ddl of ddls) {
  const t0 = Date.now();
  await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${ddl}`);
}

for (const when of ["INSERT", "UPDATE"]) {
  const t0 = Date.now();
  await pool.query(`
    CREATE TRIGGER IF NOT EXISTS trg_inv_rev_${when.toLowerCase()} BEFORE ${when} ON dealer_inventory
    FOR EACH ROW SET
      NEW.vin_rev = REVERSE(NEW.vin),
      NEW.dealer_name_rev = REVERSE(NEW.dealer_name),
      NEW.model_rev = REVERSE(NEW.model),
      NEW.trim_rev = REVERSE(NEW.trim),
      NEW.stock_number_rev = REVERSE(NEW.stock_number)
  `);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  CREATE TRIGGER trg_inv_rev_${when.toLowerCase()}`);
}

// Triggers only populate rows written from here on — backfill the existing 570k+ rows in
// batches so this doesn't hold one long-running transaction/lock over the whole table.
const BATCH = 5000;
let totalBackfilled = 0;
for (;;) {
  const t0 = Date.now();
  const [result] = await pool.query(
    `UPDATE dealer_inventory SET
       vin_rev = REVERSE(vin),
       dealer_name_rev = REVERSE(dealer_name),
       model_rev = REVERSE(model),
       trim_rev = REVERSE(trim),
       stock_number_rev = REVERSE(stock_number)
     WHERE vin_rev IS NULL
     LIMIT ?`,
    [BATCH]
  );
  totalBackfilled += result.affectedRows;
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  backfilled ${result.affectedRows} rows (${totalBackfilled} total)`);
  if (result.affectedRows === 0) break;
}

console.log("Done.");
await pool.end();
