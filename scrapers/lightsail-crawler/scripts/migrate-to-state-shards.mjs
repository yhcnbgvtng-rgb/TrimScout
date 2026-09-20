#!/usr/bin/env node
// One-time migration for the state-sharding fix (see inventory_shards.js,
// shared_data_lock.js, standalone.js, enricher.js): splits the box's
// existing monolithic, nationwide files into per-state shards so
// standalone.js/enricher.js's new sharded read/write paths have something
// to read on their very first run after deploy, instead of starting from
// empty and re-deriving "sold" for every vehicle that already exists.
//
// Splits:
//   data/national_inventory_latest.json (or inventory_latest.json as a
//     fallback, same as dashboard.js's old read order) -> data/inventory/<STATE>.json,
//     grouped by each record's own `.state` field.
//   data/snapshots/latest_snapshot.json -> data/snapshots/<STATE>.json,
//     same grouping (this file is VIN -> record, not an array).
//   data/enriched_cache.json -> data/enriched_cache/<STATE>.json. Cache
//     entries don't carry their own state (they're VIN -> NHTSA spec, and
//     NHTSA specs aren't state-scoped), so state is looked up via the VIN
//     from the inventory file above. A cached VIN that's no longer in
//     current inventory (sold and aged out already, or the cache is just
//     ahead of a not-yet-migrated inventory run) has no discoverable state
//     — those land in data/enriched_cache/_UNMATCHED.json rather than being
//     dropped; enricher.js's CLI backfill mode never reads that file, so
//     the only real cost is those specific VINs being re-fetched from
//     NHTSA on their next run instead of hitting cache. Not correctness-
//     affecting either way.
//
// Never deletes the originals: each is renamed with a .pre-shard-backup
// suffix once the write succeeds, so the migration can be undone by hand
// (move the .pre-shard-backup file back, delete the new shard
// directories) if something looks wrong.
//
// Usage (run from scrapers/lightsail-crawler/, against the box's real
// data/ directory):
//   node scripts/migrate-to-state-shards.mjs
//   node scripts/migrate-to-state-shards.mjs --write
//
// Dry-run by default (prints what would be written, changes nothing on
// disk). Pass --write to actually create the shards and rename the
// originals.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inventoryShardsDir,
  inventoryShardPath,
  snapshotShardsDir,
  snapshotShardPath,
  cacheShardsDir,
  cacheShardPath,
} from '../src/inventory_shards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

const WRITE = process.argv.includes('--write');

function stateOf(record) {
  const s = String(record?.state || record?.configState || '').trim().toUpperCase();
  return s || 'UNKNOWN';
}

async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  } catch {
    return null;
  }
}

async function backupOriginal(p) {
  const backupPath = `${p}.pre-shard-backup`;
  if (WRITE) {
    await fs.rename(p, backupPath);
  }
  console.log(`  ${WRITE ? 'renamed' : '(dry-run) would rename'} ${p} -> ${backupPath}`);
}

async function migrateInventory() {
  const primaryPath = path.join(DATA_DIR, 'national_inventory_latest.json');
  const fallbackPath = path.join(DATA_DIR, 'inventory_latest.json');
  let records = await readJson(primaryPath);
  let sourcePath = primaryPath;
  if (!Array.isArray(records)) {
    records = await readJson(fallbackPath);
    sourcePath = fallbackPath;
  }
  if (!Array.isArray(records)) {
    console.log('No national_inventory_latest.json / inventory_latest.json found — nothing to migrate for inventory.');
    return { vinToState: new Map(), migrated: false };
  }

  const byState = new Map();
  const vinToState = new Map();
  for (const record of records) {
    const state = stateOf(record);
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(record);
    if (record?.vin) vinToState.set(record.vin, state);
  }

  console.log(`Inventory: ${records.length} record(s) from ${sourcePath} -> ${byState.size} state shard(s):`);
  for (const [state, recs] of byState) {
    console.log(`  ${state}: ${recs.length} record(s)`);
    if (WRITE) {
      await fs.mkdir(inventoryShardsDir(ROOT), { recursive: true });
      await fs.writeFile(inventoryShardPath(state, ROOT), JSON.stringify(recs, null, 2));
    }
  }

  await backupOriginal(sourcePath);
  // The fallback file is a byte-identical duplicate the old dashboard.js
  // read as a fallback (see that file's own migration) — no longer read by
  // anything post-migration, so it's backed up too rather than left behind
  // stale and misleading.
  if (sourcePath === primaryPath) {
    const fallbackExists = await readJson(fallbackPath);
    if (Array.isArray(fallbackExists)) await backupOriginal(fallbackPath);
  }

  return { vinToState, migrated: true };
}

async function migrateSnapshot() {
  const snapshotPath = path.join(DATA_DIR, 'snapshots', 'latest_snapshot.json');
  const snapshot = await readJson(snapshotPath);
  if (!snapshot || typeof snapshot !== 'object') {
    console.log('No snapshots/latest_snapshot.json found — nothing to migrate for the snapshot.');
    return;
  }

  const byState = new Map();
  for (const [vin, record] of Object.entries(snapshot)) {
    const state = stateOf(record);
    if (!byState.has(state)) byState.set(state, {});
    byState.get(state)[vin] = record;
  }

  console.log(`Snapshot: ${Object.keys(snapshot).length} VIN(s) -> ${byState.size} state shard(s):`);
  for (const [state, recs] of byState) {
    console.log(`  ${state}: ${Object.keys(recs).length} VIN(s)`);
    if (WRITE) {
      await fs.mkdir(snapshotShardsDir(ROOT), { recursive: true });
      await fs.writeFile(snapshotShardPath(state, ROOT), JSON.stringify(recs, null, 2));
    }
  }

  await backupOriginal(snapshotPath);
}

async function migrateCache(vinToState) {
  const cachePath = path.join(DATA_DIR, 'enriched_cache.json');
  const cache = await readJson(cachePath);
  if (!cache || typeof cache !== 'object') {
    console.log('No enriched_cache.json found — nothing to migrate for the cache.');
    return;
  }

  const byState = new Map();
  let unmatched = 0;
  for (const [vin, entry] of Object.entries(cache)) {
    const state = vinToState.get(vin) || '_UNMATCHED';
    if (state === '_UNMATCHED') unmatched++;
    if (!byState.has(state)) byState.set(state, {});
    byState.get(state)[vin] = entry;
  }

  console.log(`Cache: ${Object.keys(cache).length} VIN(s) -> ${byState.size} shard(s) (${unmatched} unmatched, no state discoverable from inventory):`);
  for (const [state, entries] of byState) {
    console.log(`  ${state}: ${Object.keys(entries).length} VIN(s)`);
    if (WRITE) {
      await fs.mkdir(cacheShardsDir(ROOT), { recursive: true });
      const targetPath = state === '_UNMATCHED'
        ? path.join(cacheShardsDir(ROOT), '_UNMATCHED.json')
        : cacheShardPath(state, ROOT);
      await fs.writeFile(targetPath, JSON.stringify(entries, null, 2));
    }
  }

  await backupOriginal(cachePath);
}

console.log(`${WRITE ? 'WRITE MODE' : 'DRY RUN'} — migrating ${DATA_DIR} to per-state shards\n`);
const { vinToState } = await migrateInventory();
console.log('');
await migrateSnapshot();
console.log('');
await migrateCache(vinToState);
console.log(`\n${WRITE ? 'Migration complete.' : 'Dry run complete — pass --write to actually migrate.'}`);
