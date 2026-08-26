#!/usr/bin/env node
// One-time operational script: backfills MariaDB from a full-fidelity
// national_inventory_latest.json export (Step 2 of the JSON-file -> DB
// migration). Does NOT reimplement any write logic — imports and calls
// the exact same syncInventoryToDatabase() that enricher.js calls on every
// crawl run, so the backfill and the ongoing crawler write path can never
// silently diverge.
//
// This script runs from the local machine, not the Lightsail box. MariaDB
// is bound to 127.0.0.1-only on the box (Step 0), so DB_HOST here has to
// point at an SSH tunnel, e.g.:
//   ssh -L 3307:127.0.0.1:3306 admin@<box-ip>
// then:
//   DB_HOST=127.0.0.1 DB_PORT=3307 DB_NAME=trimscout \
//   DB_WRITER_USER=trimscout_writer DB_WRITER_PASSWORD=*** \
//   node scripts/backfill_from_json.mjs --brand=porsche \
//     --inventory=/path/to/national_inventory_latest.json \
//     --dealers=/path/to/dealers.json
//
// Credentials are read from process.env only (or a local, untracked
// .env.trimscout-db next to this script's cwd, via db.js's own loader) —
// never hardcoded here.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_MODULE_PATH = path.join(__dirname, '..', 'scrapers', 'lightsail-crawler', 'src', 'db.js');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const BRAND_PRESETS = {
  porsche: { code: 'porsche', name: 'Porsche' },
  ford: { code: 'ford', name: 'Ford' },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const brandKey = (args.brand || '').toLowerCase();
  const preset = BRAND_PRESETS[brandKey];
  if (!preset) {
    console.error('Usage: node scripts/backfill_from_json.mjs --brand=porsche|ford --inventory=<path> [--dealers=<path>]');
    process.exit(1);
  }
  if (!args.inventory) {
    console.error('Missing required --inventory=<path to national_inventory_latest.json>');
    process.exit(1);
  }

  const { upsertBrand, upsertDealers, syncInventoryToDatabase, closePool } = await import(DB_MODULE_PATH);

  if (!process.env.DB_HOST) {
    console.error('DB_HOST is not set. Set DB_HOST/DB_PORT/DB_NAME/DB_WRITER_USER/DB_WRITER_PASSWORD in the environment');
    console.error('(an SSH tunnel to the Lightsail box is required — MariaDB is bound to 127.0.0.1 there).');
    process.exit(1);
  }

  console.log(`Backfilling brand=${preset.name} from ${args.inventory}`);

  const records = JSON.parse(await fs.readFile(args.inventory, 'utf-8'));
  console.log(`Loaded ${records.length} records.`);

  const brandId = await upsertBrand(preset.code, preset.name);
  console.log(`brand_id = ${brandId}`);

  if (args.dealers) {
    const dealers = JSON.parse(await fs.readFile(args.dealers, 'utf-8'));
    await upsertDealers(brandId, dealers);
    console.log(`Upserted ${dealers.length} dealers.`);
  } else {
    console.log('No --dealers path given — assuming dealers are already populated in the DB.');
  }

  const stats = await syncInventoryToDatabase(brandId, records, { runId: null });
  console.log('Backfill complete:', JSON.stringify(stats, null, 2));

  await closePool();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
