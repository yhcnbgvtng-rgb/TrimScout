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
import { readJsonLarge } from './bigJson.js';

function requireState(state, fnName) {
  if (!state || typeof state !== 'string') {
    throw new Error(`${fnName} requires a state code (e.g. "NJ") — every shard is keyed by state now that these files are sharded.`);
  }
  return state.toUpperCase();
}

// Per-brand shards (2026-10-11). One file per (state, brand) — <ST>__<brand-slug>.json — so a brand-run only ever
// loads/merges/writes its own brand's records. The state-wide file (<ST>.json, "legacy") grew to ~400 MB for TX/FL
// and its parsed form pushed the crawl to ~3.3 GB of a 3.6 GB heap. The inventory sync reads every *.json in
// data/inventory, so per-brand files need no sync change; a brand's records are removed from the legacy file when
// its brand shard is first written (see legacyShardSplit.js) so the same VIN is never in two files.
export const BRAND_SEPARATOR = '__';

export function brandSlug(brandName) {
  const slug = String(brandName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('brandSlug requires a non-empty brand name');
  return slug;
}

// 'TX__ford.json' -> { state: 'TX', slug: 'ford' }; 'TX.json' -> { state: 'TX', slug: null }.
export function parseShardFileName(file) {
  if (!file.endsWith('.json')) return null;
  const stem = file.slice(0, -'.json'.length);
  const i = stem.indexOf(BRAND_SEPARATOR);
  if (i === -1) return { state: stem, slug: null };
  return { state: stem.slice(0, i), slug: stem.slice(i + BRAND_SEPARATOR.length) || null };
}

function shardFile(state, fnName, brand) {
  const st = requireState(state, fnName);
  return brand ? `${st}${BRAND_SEPARATOR}${brandSlug(brand)}.json` : `${st}.json`;
}

export function inventoryShardsDir(cwd = process.cwd()) {
  return path.join(path.resolve(cwd, 'data'), 'inventory');
}

// `brand` (a brand name) selects the per-brand shard; omitted = the legacy state-wide file.
export function inventoryShardPath(state, cwd = process.cwd(), brand = null) {
  return path.join(inventoryShardsDir(cwd), shardFile(state, 'inventoryShardPath', brand));
}

export function snapshotShardsDir(cwd = process.cwd()) {
  return path.join(path.resolve(cwd, 'data'), 'snapshots');
}

export function snapshotShardPath(state, cwd = process.cwd(), brand = null) {
  return path.join(snapshotShardsDir(cwd), shardFile(state, 'snapshotShardPath', brand));
}

export function cacheShardsDir(cwd = process.cwd()) {
  return path.join(path.resolve(cwd, 'data'), 'enriched_cache');
}

export function cacheShardPath(state, cwd = process.cwd(), brand = null) {
  return path.join(cacheShardsDir(cwd), shardFile(state, 'cacheShardPath', brand));
}

// Every inventory shard file on disk (legacy and per-brand), as { state, slug, file }.
export async function listInventoryShardFiles(cwd = process.cwd()) {
  let entries;
  try {
    entries = await fs.readdir(inventoryShardsDir(cwd));
  } catch {
    return [];
  }
  return entries
    .map((f) => ({ file: f, parsed: parseShardFileName(f) }))
    .filter((e) => e.parsed)
    .map((e) => ({ file: path.join(inventoryShardsDir(cwd), e.file), state: e.parsed.state, slug: e.parsed.slug }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

// Every state that currently has an inventory shard on disk — the
// enumeration every "give me everything" consumer (dashboard.js,
// export_server.js, enricher.js's CLI backfill mode) needs instead of a
// single monolithic file. Sourced from the inventory shards specifically
// (not the cache or snapshot dirs) since inventory is what every one of
// those callers actually wants a state list for.
export async function listShardedStates(cwd = process.cwd()) {
  const files = await listInventoryShardFiles(cwd);
  return [...new Set(files.map((f) => f.state))].sort();
}

// Concatenates every state's inventory shard into one array, for the few
// consumers that genuinely need a nationwide view (the CSV export, the
// legacy HTML dashboard) rather than one run's own state. A single
// unreadable/corrupt shard is skipped rather than failing the whole read —
// the same fault-tolerance the old single-file readers already had via
// their own try/catch around one file, just applied per-shard now.
export async function readAllInventoryShards(cwd = process.cwd()) {
  const files = await listInventoryShardFiles(cwd);
  const all = [];
  for (const { file } of files) {
    try {
      const records = await readJsonLarge(file);
      // A loop, not all.push(...records): spreading a six-figure array into one call overflows the argument limit.
      if (Array.isArray(records)) for (const r of records) all.push(r);
    } catch {
      // Skip: a corrupt or transiently-mid-write shard shouldn't blank out
      // every other state's data for a read-only nationwide view.
    }
  }
  return all;
}
