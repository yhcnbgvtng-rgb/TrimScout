// Deals box, one-off (2026-09-22 v2): builds the reversed generated columns + forward/reverse
// indexes that the search-speedup PR (scripts/box/2026-09-22-inventory-search-prefix-suffix.sh)
// switches the q= search to use. Run this FIRST, before that box script. Idempotent — every
// clause is IF NOT EXISTS, so it can be safely re-run if interrupted partway.
//
// Supersedes the earlier ngram attempt (2026-09-22 v1): the ngram FULLTEXT parser doesn't
// exist on this box at all (not installed, no plugin file, no apt package either — confirmed
// live). This is a from-scratch, plain-B-tree approach: no plugins, no server config, no
// restart.
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
  "ADD COLUMN IF NOT EXISTS vin_rev CHAR(17) GENERATED ALWAYS AS (REVERSE(vin)) STORED",
  "ADD COLUMN IF NOT EXISTS dealer_name_rev VARCHAR(255) GENERATED ALWAYS AS (REVERSE(dealer_name)) STORED",
  "ADD COLUMN IF NOT EXISTS model_rev VARCHAR(96) GENERATED ALWAYS AS (REVERSE(model)) STORED",
  "ADD COLUMN IF NOT EXISTS trim_rev VARCHAR(160) GENERATED ALWAYS AS (REVERSE(trim)) STORED",
  "ADD COLUMN IF NOT EXISTS stock_number_rev VARCHAR(64) GENERATED ALWAYS AS (REVERSE(stock_number)) STORED",
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
console.log("Done.");
await pool.end();
