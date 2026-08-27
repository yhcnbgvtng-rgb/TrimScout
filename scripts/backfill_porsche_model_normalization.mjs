#!/usr/bin/env node
// One-time operational script: applies modelNormalizer.js's Porsche
// model/trim/body_style cleanup to every existing Porsche row in the live
// `trimscout` MariaDB database, and writes back only the rows whose
// values actually change.
//
// Deliberately Porsche-only (WHERE brand_id = <porsche's id, resolved by
// code not hardcoded>) — never touches Ford or Chevrolet rows. Deliberately
// UPDATE-only: never INSERTs or DELETEs, so vehicle count is invariant and
// no VIN can be created or dropped by running this. Only the model, trim,
// and body_style columns are ever written — every other column (price,
// mileage, url, ...) is left completely alone.
//
// Reuses db.js's own connection setup via its exported getPool() (per
// db.js: "Credentials come from `.env.trimscout-db`... loaded off
// process.cwd()") — same pattern as scripts/backfill_from_json.mjs. Run
// this from wherever a `.env.trimscout-db` (or equivalent DB_HOST/etc. env
// vars) resolves to the live DB — e.g. from the crawler deployment
// directory on the box itself, or from the local machine over an SSH
// tunnel:
//   ssh -L 3307:127.0.0.1:3306 admin@<box-ip>
// then:
//   DB_HOST=127.0.0.1 DB_PORT=3307 DB_NAME=trimscout \
//   DB_WRITER_USER=trimscout_writer DB_WRITER_PASSWORD=*** \
//   node scripts/backfill_porsche_model_normalization.mjs [--dry-run]
//
// --dry-run prints the diff for every row that would change without
// writing anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolves against two known layouts: this repo (scripts/ sibling to
// scrapers/lightsail-crawler/src/), and a bare crawler deployment
// directory on the box itself (this script copied in next to src/ —
// matches how the other one-off scripts in src/, e.g.
// backfill_core_fields.mjs, are actually run there). First existing path
// wins; each candidate is resolved from this file's own real directory
// (via realpathSync) so a symlinked/scp'd copy of this file still finds
// its sibling modules correctly.
function resolveModule(...candidateSuffixes) {
  const realDir = fs.realpathSync(__dirname);
  for (const suffix of candidateSuffixes) {
    const candidate = path.join(realDir, ...suffix);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not resolve module — tried: ${candidateSuffixes.map((s) => path.join(realDir, ...s)).join(', ')}`);
}

const DB_MODULE_PATH = resolveModule(
  ['..', 'scrapers', 'lightsail-crawler', 'src', 'db.js'],
  ['src', 'db.js'],
);
const NORMALIZER_MODULE_PATH = resolveModule(
  ['..', 'scrapers', 'lightsail-crawler', 'src', 'modelNormalizer.js'],
  ['src', 'modelNormalizer.js'],
);

const DRY_RUN = process.argv.includes('--dry-run');

function fieldsEqual(a, b) {
  // Treat null/undefined/'' as the same "empty" value for comparison
  // purposes (the DB stores NULL, the normalizer may produce '' -> null).
  const norm = (v) => (v === undefined || v === null || v === '' ? null : v);
  return norm(a) === norm(b);
}

async function main() {
  // Importing db.js is what actually loads .env.trimscout-db (as a side
  // effect, off process.cwd() — same pattern as scripts/backfill_from_json.mjs),
  // so the DB_HOST check has to happen AFTER this import, not before.
  const { getPool, closePool } = await import(DB_MODULE_PATH);
  const { normalizePorscheFields } = await import(NORMALIZER_MODULE_PATH);

  if (!process.env.DB_HOST) {
    console.error('DB_HOST is not set. Set DB_HOST/DB_PORT/DB_NAME/DB_WRITER_USER/DB_WRITER_PASSWORD in the');
    console.error('environment (directly, or via a .env.trimscout-db in this process\'s cwd — same loader');
    console.error('db.js itself uses) before running this script.');
    process.exit(1);
  }

  const pool = getPool();

  const [brandRows] = await pool.query("SELECT id FROM brands WHERE code = 'porsche' LIMIT 1");
  if (!brandRows.length) {
    console.error("No brand row found with code='porsche' — nothing to backfill.");
    process.exit(1);
  }
  const porscheBrandId = brandRows[0].id;
  console.log(`Porsche brand_id = ${porscheBrandId}`);

  const [beforeCount] = await pool.query('SELECT COUNT(*) AS cnt FROM vehicles WHERE brand_id = ?', [porscheBrandId]);
  console.log(`Porsche vehicle count BEFORE backfill: ${beforeCount[0].cnt}`);

  const [rows] = await pool.query(
    'SELECT vin, model, trim, body_style FROM vehicles WHERE brand_id = ?',
    [porscheBrandId]
  );
  console.log(`Loaded ${rows.length} Porsche vehicle rows.`);

  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  const sampleChanges = [];

  for (const row of rows) {
    let normalized;
    try {
      normalized = normalizePorscheFields({ model: row.model, trim: row.trim, bodyStyle: row.body_style });
    } catch (err) {
      errors++;
      console.error(`Normalizer threw for VIN ${row.vin}:`, err.message);
      continue;
    }

    const modelChanged = !fieldsEqual(row.model, normalized.model);
    const trimChanged = !fieldsEqual(row.trim, normalized.trim);
    const bodyStyleChanged = !fieldsEqual(row.body_style, normalized.bodyStyle);

    if (!modelChanged && !trimChanged && !bodyStyleChanged) {
      unchanged++;
      continue;
    }

    changed++;
    if (sampleChanges.length < 30) {
      sampleChanges.push({
        vin: row.vin,
        before: { model: row.model, trim: row.trim, body_style: row.body_style },
        after: { model: normalized.model, trim: normalized.trim, body_style: normalized.bodyStyle },
      });
    }

    if (!DRY_RUN) {
      await pool.query(
        'UPDATE vehicles SET model = ?, trim = ?, body_style = ? WHERE vin = ? AND brand_id = ?',
        [normalized.model, normalized.trim, normalized.bodyStyle, row.vin, porscheBrandId]
      );
    }
  }

  console.log('\n--- Sample changes (up to 30) ---');
  for (const c of sampleChanges) {
    console.log(`${c.vin}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'} ${changed} row(s). ${unchanged} row(s) already clean (no-op, skipped). ${errors} error(s).`);

  const [afterCount] = await pool.query('SELECT COUNT(*) AS cnt FROM vehicles WHERE brand_id = ?', [porscheBrandId]);
  console.log(`Porsche vehicle count AFTER backfill: ${afterCount[0].cnt} (should be identical to BEFORE — UPDATE-only script)`);

  await closePool();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
