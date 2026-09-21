// Per-state sharding for the crawler's shared, cumulative data files.
//
// Root cause this fixes: standalone.js's crawl-merge and enricher.js's
// enrichment pipeline both used to read-modify-write ONE nationwide file per
// data type (national_inventory_latest.json, snapshots/latest_snapshot.json,
// enriched_cache.json) — so a single brand-run's cost (parse + stringify)
// scaled with the WHOLE box's cumulative inventory across every state and
// brand ever crawled into that box, not with that run's own dealers. As
// coverage grew from a handful of NJ dealers to 50 states, that tax grew
// from milliseconds to minutes, paid on every single brand-run, while
// holding a lock that blocked every other concurrent brand-run on the box
// (see shared_data_lock.js). State is already the natural boundary: dealers
// are state-scoped, every dealer record carries its own `state`
// (nj_policy.js's buildDealerRecord and friends), and the driver
// (run-daily-crawl.mjs) already runs one state's whole brand loop
// sequentially and multiple states concurrently. Splitting these files by
// state makes a brand-run's cost O(that state's own inventory) instead of
// O(the box's entire history), and — as a direct consequence — two
// different states' brand-runs no longer touch the same file at all, so
// they stop contending on the shared-data lock entirely (see
// shared_data_lock.js's per-scope locking).
//
// enriched_cache.json (VIN -> NHTSA spec) is sharded the same way even
// though a VIN's spec isn't really state-scoped — the file being split is
// what matters for the read/write cost, not the cache key's semantics. The
// one real trade-off: a VIN seen for the first time in two different
// states' inventories no longer dedups its NHTSA lookup across that
// boundary (it did before, via the one shared cache). That's a cheap extra
// network call on a rare cross-state duplicate listing, not a correctness
// issue — cache MISSES were never the problem this fixes; full-file
// read/write cost was.
import fs from 'node:fs/promises';
import path from 'node:path';

function requireState(state, fnName) {
  if (!state || typeof state !== 'string') {
    throw new Error(`${fnName} requires a state code (e.g. "NJ") — every shard is keyed by state now that these files are sharded.`);
  }
  return state.toUpperCase();
}

export function inventoryShardsDir(cwd = process.cwd()) {
  return path.join(path.resolve(cwd, 'data'), 'inventory');
}

export function inventoryShardPath(state, cwd = process.cwd()) {
  return path.join(inventoryShardsDir(cwd), `${requireState(state, 'inventoryShardPath')}.json`);
}

export function snapshotShardsDir(cwd = process.cwd()) {
  return path.join(path.resolve(cwd, 'data'), 'snapshots');
}

export function snapshotShardPath(state, cwd = process.cwd()) {
  return path.join(snapshotShardsDir(cwd), `${requireState(state, 'snapshotShardPath')}.json`);
}

export function cacheShardsDir(cwd = process.cwd()) {
  return path.join(path.resolve(cwd, 'data'), 'enriched_cache');
}

export function cacheShardPath(state, cwd = process.cwd()) {
  return path.join(cacheShardsDir(cwd), `${requireState(state, 'cacheShardPath')}.json`);
}

// Every state that currently has an inventory shard on disk — the
// enumeration every "give me everything" consumer (dashboard.js,
// export_server.js, enricher.js's CLI backfill mode) needs instead of a
// single monolithic file. Sourced from the inventory shards specifically
// (not the cache or snapshot dirs) since inventory is what every one of
// those callers actually wants a state list for.
export async function listShardedStates(cwd = process.cwd()) {
  let entries;
  try {
    entries = await fs.readdir(inventoryShardsDir(cwd));
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

// Concatenates every state's inventory shard into one array, for the few
// consumers that genuinely need a nationwide view (the CSV export, the
// legacy HTML dashboard) rather than one run's own state. A single
// unreadable/corrupt shard is skipped rather than failing the whole read —
// the same fault-tolerance the old single-file readers already had via
// their own try/catch around one file, just applied per-shard now.
export async function readAllInventoryShards(cwd = process.cwd()) {
  const states = await listShardedStates(cwd);
  const all = [];
  for (const state of states) {
    try {
      const raw = await fs.readFile(inventoryShardPath(state, cwd), 'utf-8');
      const records = JSON.parse(raw);
      if (Array.isArray(records)) all.push(...records);
    } catch {
      // Skip: a corrupt or transiently-mid-write shard shouldn't blank out
      // every other state's data for a read-only nationwide view.
    }
  }
  return all;
}
