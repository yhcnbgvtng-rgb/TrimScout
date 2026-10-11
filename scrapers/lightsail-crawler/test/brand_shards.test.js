// Per-brand shards: file naming, listing/reading, moving records out of the legacy state-wide file, and the two
// layouts (legacy <ST>.json, per-brand <ST>__<brand>.json) living side by side.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  brandSlug, parseShardFileName, inventoryShardPath, snapshotShardPath, cacheShardPath,
  listInventoryShardFiles, listShardedStates, readAllInventoryShards,
} from '../src/inventory_shards.js';
import { readLegacyInScope, stripLegacyInScope, splitLegacyFile } from '../src/legacyShardSplit.js';
import { readJsonLarge, writeJsonLarge } from '../src/bigJson.js';

let dir;
beforeEach(async () => { dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'brandshard-')); await fsp.mkdir(path.join(dir, 'data', 'inventory'), { recursive: true }); });
afterEach(async () => { await fsp.rm(dir, { recursive: true, force: true }); });

const rec = (vin, dealer, make = 'Ford') => ({ vin, dealerName: dealer, configDealerName: dealer, make });

describe('shard paths', () => {
  it('brand names become stable slugs; no brand = the legacy state-wide file', () => {
    assert.equal(brandSlug('Mercedes-Benz'), 'mercedes-benz');
    assert.equal(brandSlug('Land Rover'), 'land-rover');
    assert.equal(brandSlug('land-rover'), 'land-rover', 'slugging a slug is a no-op');
    assert.throws(() => brandSlug(''));
    assert.equal(path.basename(inventoryShardPath('tx', dir)), 'TX.json');
    assert.equal(path.basename(inventoryShardPath('tx', dir, 'Ford')), 'TX__ford.json');
    assert.equal(path.basename(snapshotShardPath('fl', dir, 'Mercedes-Benz')), 'FL__mercedes-benz.json');
    assert.equal(path.basename(cacheShardPath('fl', dir, 'Toyota')), 'FL__toyota.json');
  });

  it('parseShardFileName reads both layouts and ignores everything else', () => {
    assert.deepEqual(parseShardFileName('TX.json'), { state: 'TX', slug: null });
    assert.deepEqual(parseShardFileName('TX__land-rover.json'), { state: 'TX', slug: 'land-rover' });
    assert.equal(parseShardFileName('TX.json.tmp-12-34'), null);
    assert.equal(parseShardFileName('notes.txt'), null);
  });
});

describe('listing and reading both layouts', () => {
  it('lists legacy and per-brand files, states de-duplicated, temp files skipped', async () => {
    const inv = path.join(dir, 'data', 'inventory');
    await writeJsonLarge(path.join(inv, 'NJ.json'), [rec('A1', 'D1', 'Honda')]);
    await writeJsonLarge(path.join(inv, 'TX__ford.json'), [rec('B1', 'D2')]);
    await writeJsonLarge(path.join(inv, 'TX__toyota.json'), [rec('C1', 'D3', 'Toyota')]);
    await fsp.writeFile(path.join(inv, 'TX__kia.json.tmp-9-9'), '[');
    const files = await listInventoryShardFiles(dir);
    assert.deepEqual(files.map((f) => [f.state, f.slug]), [['NJ', null], ['TX', 'ford'], ['TX', 'toyota']]);
    assert.deepEqual(await listShardedStates(dir), ['NJ', 'TX']);
    const all = await readAllInventoryShards(dir);
    assert.deepEqual(all.map((r) => r.vin).sort(), ['A1', 'B1', 'C1']);
  });

  it('one corrupt brand shard does not blank the others', async () => {
    const inv = path.join(dir, 'data', 'inventory');
    await writeJsonLarge(path.join(inv, 'TX__ford.json'), [rec('B1', 'D2')]);
    await fsp.writeFile(path.join(inv, 'TX__kia.json'), '[{"vin":');
    assert.deepEqual((await readAllInventoryShards(dir)).map((r) => r.vin), ['B1']);
  });
});

describe('moving a run\'s records out of the legacy file', () => {
  const scope = new Set(['Ford One', 'Ford Two']);
  const legacyInv = () => [rec('F1', 'Ford One'), rec('F2', 'Ford Two'), rec('T1', 'Toyota One', 'Toyota'), { vin: 'O1', dealerName: 'Ford One', configDealerName: 'Ford Two' }];

  it('readLegacyInScope picks by config dealer name first, for arrays and snapshots, and changes nothing on disk', async () => {
    const f = path.join(dir, 'legacy.json');
    await writeJsonLarge(f, legacyInv());
    assert.deepEqual((await readLegacyInScope(f, scope, 'inventory')).map((r) => r.vin), ['F1', 'F2', 'O1']);
    await writeJsonLarge(f, Object.fromEntries(legacyInv().map((r) => [r.vin, r])));
    assert.deepEqual(Object.keys(await readLegacyInScope(f, scope, 'snapshot')).sort(), ['F1', 'F2', 'O1']);
    assert.equal(Object.keys(await readJsonLarge(f)).length, 4);
  });

  it('a missing legacy file reads as empty and strips as zero', async () => {
    const f = path.join(dir, 'nope.json');
    assert.deepEqual(await readLegacyInScope(f, scope, 'inventory'), []);
    assert.deepEqual(await readLegacyInScope(f, scope, 'snapshot'), {});
    assert.equal(await stripLegacyInScope(f, scope, 'inventory'), 0);
  });

  it('stripLegacyInScope keeps other brands, and removes the file once nothing is left', async () => {
    const f = path.join(dir, 'legacy.json');
    await writeJsonLarge(f, legacyInv());
    assert.equal(await stripLegacyInScope(f, scope, 'inventory'), 3);
    assert.deepEqual((await readJsonLarge(f)).map((r) => r.vin), ['T1']);
    assert.equal(await stripLegacyInScope(f, scope, 'inventory'), 0, 'second call is a no-op');
    assert.equal(await stripLegacyInScope(f, new Set(['Toyota One']), 'inventory'), 1);
    await assert.rejects(fsp.stat(f), { code: 'ENOENT' });
  });

  it('splitLegacyFile writes one file per brand, leaves unknown-brand records behind, and never overwrites a newer brand record', async () => {
    const f = path.join(dir, 'data', 'inventory', 'TX.json');
    const stale = { ...rec('F1', 'Ford One'), price: 1 };
    await writeJsonLarge(f, [stale, rec('T1', 'Toyota One', 'Toyota'), rec('Z1', 'Mystery', 'Zzz')]);
    const target = (slug) => inventoryShardPath('TX', dir, slug);
    await writeJsonLarge(target('ford'), [{ ...rec('F1', 'Ford One'), price: 2 }]); // a brand-run already wrote F1
    const brandOf = (r) => ({ Ford: 'ford', Toyota: 'toyota' })[r.make] || null;
    const res = await splitLegacyFile(f, 'inventory', { brandOf, targetPathOf: target });
    assert.equal(res.left, 1);
    assert.deepEqual((await readJsonLarge(target('ford'))).map((r) => [r.vin, r.price]), [['F1', 2]]);
    assert.deepEqual((await readJsonLarge(target('toyota'))).map((r) => r.vin), ['T1']);
    assert.deepEqual((await readJsonLarge(f)).map((r) => r.vin), ['Z1']);
  });

  it('splitLegacyFile on a snapshot object, and the legacy file is removed when everything moved', async () => {
    const f = path.join(dir, 'snap.json');
    await writeJsonLarge(f, { F1: rec('F1', 'Ford One') });
    const out = path.join(dir, 'snap-ford.json');
    const res = await splitLegacyFile(f, 'snapshot', { brandOf: () => 'ford', targetPathOf: () => out });
    assert.deepEqual(res, { moved: 1, left: 0, bySlug: { ford: 1 } });
    assert.deepEqual(Object.keys(await readJsonLarge(out)), ['F1']);
    await assert.rejects(fsp.stat(f), { code: 'ENOENT' });
  });
});
