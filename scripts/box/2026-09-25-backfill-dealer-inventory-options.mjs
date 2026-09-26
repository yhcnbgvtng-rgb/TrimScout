// One-shot backfill: dealer_inventory_options was redefined (canonical_key/label/code instead of
// the old, unstable per-listing `code` identity — see the schema comment in
// deals_api_server.js's ensureInventoryTable) after the table had already gone live empty. This
// reads every existing dealer_inventory row's options_json and writes canonicalized rows for it,
// instead of waiting for tonight's crawl to touch each VIN again.
//
// Idempotent (ON DUPLICATE KEY UPDATE) — safe to re-run. Keyset-paginated over the
// (vin, dealer_id) primary key (no OFFSET — degrades badly at 1.6M+ rows).
//
// Run on the deals box (ubuntu@3.237.204.55 — box2), from /opt/trimscout-deals so it picks up
// .env.trimscout-db and the existing node_modules (mysql2) the same way deals_api_server.js does:
//   cd /opt/trimscout-deals && curl -fsSL -o 2026-09-25-backfill-dealer-inventory-options.mjs "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-25-backfill-dealer-inventory-options.mjs?cb=$(date +%s)" && sudo node 2026-09-25-backfill-dealer-inventory-options.mjs
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

function loadDbEnv() {
  const envPath = path.resolve(process.cwd(), ".env.trimscout-db");
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDbEnv();

// Mirrors normalizeOptionKey() in deals_api_server.js exactly — kept as a literal copy rather
// than an import since this is a standalone one-shot script, not a module this package re-exports.
const OPTION_SYNONYM_EXPANSIONS = [[/\bb\s*&\s*w\b/gi, "bowers wilkins"]];
function normalizeOptionKey(label) {
  let s = String(label || "").trim().toLowerCase();
  for (const [pattern, replacement] of OPTION_SYNONYM_EXPANSIONS) s = s.replace(pattern, replacement);
  return s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_WRITER_USER,
  password: process.env.DB_WRITER_PASSWORD,
  connectionLimit: 4,
});

const BATCH_SIZE = 2000;

async function main() {
  let cursor = { vin: "", dealerId: -1 };
  let vehiclesProcessed = 0, vehiclesWithOptions = 0, optionRowsWritten = 0;
  const bwSamples = [];

  for (;;) {
    const [rows] = await pool.query(
      `SELECT vin, dealer_id, make, model, options_json FROM dealer_inventory
       WHERE (vin, dealer_id) > (?, ?) ORDER BY vin, dealer_id LIMIT ?`,
      [cursor.vin, cursor.dealerId, BATCH_SIZE]
    );
    if (!rows.length) break;
    cursor = { vin: rows[rows.length - 1].vin, dealerId: rows[rows.length - 1].dealer_id };
    vehiclesProcessed += rows.length;

    const optionRows = [];
    for (const r of rows) {
      if (!r.options_json) continue;
      let options;
      try {
        options = JSON.parse(r.options_json);
      } catch {
        continue;
      }
      if (!Array.isArray(options) || !options.length) continue;
      vehiclesWithOptions++;
      const byKey = new Map();
      for (const o of options) {
        const label = typeof o?.name === "string" ? o.name.trim().slice(0, 160) : "";
        if (!label) continue;
        const key = normalizeOptionKey(label);
        if (!key) continue;
        const code = typeof o?.code === "string" ? o.code.trim().slice(0, 32) : null;
        if (!byKey.has(key)) byKey.set(key, { label, code });
      }
      for (const [key, { label, code }] of byKey) {
        optionRows.push([r.vin, r.dealer_id, key, label, code]);
        if (key.includes("bowers") && bwSamples.length < 10) bwSamples.push({ vin: r.vin, make: r.make, model: r.model, key, label });
      }
    }

    if (optionRows.length) {
      await pool.query(
        "INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ? ON DUPLICATE KEY UPDATE label = VALUES(label), code = VALUES(code)",
        [optionRows]
      );
      optionRowsWritten += optionRows.length;
    }

    if (vehiclesProcessed % 50000 === 0) console.log(`...${vehiclesProcessed} vehicles processed, ${optionRowsWritten} option rows written so far`);
  }

  console.log("\n=== Backfill complete ===");
  console.log(`Vehicles processed:      ${vehiclesProcessed}`);
  console.log(`Vehicles with options:   ${vehiclesWithOptions}`);
  console.log(`Option rows written:     ${optionRowsWritten}`);
  console.log(`\nSample Bowers & Wilkins hits (canonical_key contains "bowers"):`);
  if (bwSamples.length) {
    for (const s of bwSamples) console.log(`  ${s.vin}  ${s.make} ${s.model}  key="${s.key}"  label="${s.label}"`);
  } else {
    console.log("  (none found in this backfill — B&W may not be a listed option on any currently-crawled vehicle)");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
