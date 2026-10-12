// Brand-cache top-up from the legacy state-wide cache (#480 follow-up). Regression: only the first dealer-shard of a
// brand seeded from the legacy cache, so every later shard re-paid NHTSA for VINs the legacy cache already held.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { seedCacheFromLegacy } from '../src/enricher.js';
import { cacheShardPath } from '../src/inventory_shards.js';
import { readJsonLarge, writeJsonLarge } from '../src/bigJson.js';

const entry = (vin) => ({ nhtsa: { engineCylinders: 4 }, vin });
const cars = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ vin: `VIN${from + i}` }));
const legacyOf = (list) => Object.fromEntries(list.map((c) => [c.vin, entry(c.vin)]));

describe('seedCacheFromLegacy', () => {
  it('later dealer-shard: brand cache holds only shard 1, legacy holds shard 2 -> shard 2 VINs are seeded', async () => {
    const shard1 = cars(40), shard2 = cars(60, 100);
    const cache = legacyOf(shard1); // what shard 1 left behind
    const legacy = legacyOf([...shard1, ...shard2]);
    const r = await seedCacheFromLegacy({ cache, vehicles: shard2, readLegacy: async () => legacy });
    assert.equal(r.seeded.size, 60);
    assert.equal(r.missing, 60);
    assert.ok(shard2.every((c) => cache[c.vin].nhtsa), 'seeded into the in-memory cache so they count as cache hits');
  });

  it('does not read the legacy file when nothing (or too little) is missing', async () => {
    let reads = 0;
    const readLegacy = async () => { reads++; return {}; };
    const vehicles = cars(10);
    assert.equal((await seedCacheFromLegacy({ cache: legacyOf(vehicles), vehicles, readLegacy })).readLegacy, false);
    assert.equal((await seedCacheFromLegacy({ cache: {}, vehicles: cars(24), readLegacy })).readLegacy, false, 'below the threshold: a few lookups beat a 400 MB parse');
    assert.equal(reads, 0);
    assert.equal((await seedCacheFromLegacy({ cache: {}, vehicles: cars(25), readLegacy })).readLegacy, true);
    assert.equal(reads, 1);
  });

  it('never overwrites a usable brand-cache entry, and skips legacy entries without a lookup', async () => {
    const vehicles = cars(30);
    const cache = { VIN0: { nhtsa: { engineCylinders: 6 } } };
    const legacy = { ...legacyOf(vehicles), VIN1: { nhtsa: null } };
    const r = await seedCacheFromLegacy({ cache, vehicles, readLegacy: async () => legacy, minMissing: 1 });
    assert.equal(cache.VIN0.nhtsa.engineCylinders, 6);
    assert.equal(cache.VIN1, undefined);
    assert.equal(r.seeded.size, 28);
  });

  it('an unreadable legacy cache is reported, not fatal', async () => {
    const warn = console.warn; const lines = []; console.warn = (m) => lines.push(m);
    try {
      const r = await seedCacheFromLegacy({ cache: {}, vehicles: cars(30), readLegacy: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
      assert.equal(r.seeded.size, 0);
    } finally { console.warn = warn; }
    assert.match(lines.join(), /unreadable/);
  });
});

describe('with real shard files', () => {
  let dir;
  beforeEach(async () => { dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'legacyseed-')); await fsp.mkdir(path.join(dir, 'data', 'enriched_cache'), { recursive: true }); });
  afterEach(async () => { await fsp.rm(dir, { recursive: true, force: true }); });

  it('reads the state-wide file the enricher names as legacy', async () => {
    const legacyPath = cacheShardPath('GA', dir);
    const brandPath = cacheShardPath('GA', dir, 'Stellantis');
    assert.notEqual(legacyPath, brandPath);
    const vehicles = cars(30);
    await writeJsonLarge(legacyPath, legacyOf(vehicles));
    const cache = {};
    const r = await seedCacheFromLegacy({ cache, vehicles, readLegacy: () => readJsonLarge(legacyPath) });
    assert.equal(r.seeded.size, 30);
  });
});
