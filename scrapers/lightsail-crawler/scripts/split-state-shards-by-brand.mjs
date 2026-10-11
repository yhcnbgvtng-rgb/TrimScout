#!/usr/bin/env node
// One-off: split the state-wide shards (data/inventory/<ST>.json, data/snapshots/<ST>.json) into per-brand files
// (<ST>__<brand>.json). See src/inventory_shards.js. Run it while NO crawl and NO inventory sync is running on the box
// (idle window); it holds no lock. Without --apply it only reads and reports. Records whose make maps to no known
// brand stay in the state-wide file, which the crawler keeps reading and shrinking, so nothing is ever dropped.
//
//   NODE_OPTIONS=--max-old-space-size=8192 node scripts/split-state-shards-by-brand.mjs [--apply] [--state=TX,FL]
import fs from 'node:fs/promises';
import path from 'node:path';
import { getBrand } from '../src/brands.js';
import { brandSlug, inventoryShardPath, snapshotShardPath, listInventoryShardFiles } from '../src/inventory_shards.js';
import { splitLegacyFile } from '../src/legacyShardSplit.js';

const apply = process.argv.includes('--apply');
const only = (process.argv.find((a) => a.startsWith('--state=')) || '').slice('--state='.length).split(',').filter(Boolean).map((s) => s.toUpperCase());
const cwd = process.cwd();

const slugCache = new Map();
function brandOf(rec) {
  const make = rec?.make;
  if (!make) return null;
  if (!slugCache.has(make)) {
    try { slugCache.set(make, brandSlug(getBrand(make).name)); } catch { slugCache.set(make, null); }
  }
  return slugCache.get(make);
}

const legacy = (await listInventoryShardFiles(cwd)).filter((f) => !f.slug && (!only.length || only.includes(f.state)));
console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${legacy.length} state-wide inventory file(s): ${legacy.map((f) => f.state).join(', ') || '(none)'}`);

for (const { state } of legacy) {
  for (const kind of ['inventory', 'snapshot']) {
    const legacyPath = kind === 'inventory' ? inventoryShardPath(state, cwd) : snapshotShardPath(state, cwd);
    try { await fs.stat(legacyPath); } catch { continue; }
    const targetPathOf = (slug) => (kind === 'inventory' ? inventoryShardPath(state, cwd, slug) : snapshotShardPath(state, cwd, slug));
    if (!apply) {
      // Count only: same grouping, nothing written.
      const { readJsonLarge } = await import('../src/bigJson.js');
      const data = await readJsonLarge(legacyPath);
      const recs = Array.isArray(data) ? data : Object.values(data);
      const counts = {};
      for (const r of recs) { const s = brandOf(r) || '(stays in state file)'; counts[s] = (counts[s] || 0) + 1; }
      console.log(`${state} ${kind}: ${recs.length} records -> ${JSON.stringify(counts)}`);
      continue;
    }
    const res = await splitLegacyFile(legacyPath, kind, { brandOf, targetPathOf });
    console.log(`${state} ${kind}: moved ${res.moved}, left ${res.left} in ${path.basename(legacyPath)} ${JSON.stringify(res.bySlug)}`);
  }
}
