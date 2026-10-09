// bigJson.js: reading and writing the crawler's big per-state JSON files without one giant string.
// The V8 string limit (~512 MB) can't be reached in a unit test, so the tests prove the property that matters instead:
// the writer never stringifies more than one element at a time, and the reader never needs the whole file as one string.
import { StringDecoder } from 'node:string_decoder';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonLarge, writeJsonLarge, STREAM_ABOVE_BYTES } from '../src/bigJson.js';
import { readAllInventoryShards, inventoryShardPath } from '../src/inventory_shards.js';

let dir;
beforeEach(async () => { dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bigjson-')); });
afterEach(async () => { mock.restoreAll(); await fsp.rm(dir, { recursive: true, force: true }); });

const rec = (i, extra = {}) => ({ vin: `VIN${String(i).padStart(6, '0')}`, dealerName: `Dealer ${i} "Quoted" {braces} [brackets], commas`, price: 10000 + i, options: ['A', 'B,C', 'D}'], ...extra });
const records = (n) => Array.from({ length: n }, (_, i) => rec(i));

// Force the streaming reader and tiny chunks so records and multi-byte characters straddle chunk boundaries.
const STREAM = { streamAboveBytes: 0, chunkBytes: 7 };

describe('writeJsonLarge', () => {
  it('writes an array that reads back identically, one compact record per line', async () => {
    const file = path.join(dir, 'TX.json');
    const data = records(50);
    await writeJsonLarge(file, data);
    assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), data);
    const lines = (await fsp.readFile(file, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 52); // "[", 50 records, "]"
    assert.ok(!lines[1].includes('  "vin"'), 'compact, not pretty-printed');
  });

  it('writes an object (the snapshot / cache / daily_changes shape) and reads it back', async () => {
    const file = path.join(dir, 'snap.json');
    const data = { A1: { price: 1 }, B2: { price: 2, nested: { deep: [1, 2, { x: '}' }] } }, C3: null };
    await writeJsonLarge(file, data);
    assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), data);
  });

  it('handles empty containers, omitted undefined values, and scalars', async () => {
    for (const [name, value, expected] of [
      ['empty-array', [], []],
      ['empty-object', {}, {}],
      ['undefined-in-object', { a: 1, b: undefined, c: 3 }, { a: 1, c: 3 }],
      ['undefined-in-array', [1, undefined, 3], [1, null, 3]],
      ['scalar', 'hello', 'hello'],
    ]) {
      const file = path.join(dir, `${name}.json`);
      await writeJsonLarge(file, value);
      assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), expected, name);
    }
  });

  it('never stringifies more than one element at a time (a whole-file stringify would blow a string limit)', async () => {
    const file = path.join(dir, 'big.json');
    const data = records(2000);
    const LIMIT = 600; // stand-in for V8's ~512 MB: one record is ~150 chars, the whole array is ~300,000
    const real = JSON.stringify.bind(JSON);
    let longest = 0;
    mock.method(JSON, 'stringify', (...args) => {
      const out = real(...args);
      if (out && out.length > LIMIT) throw new RangeError('Invalid string length');
      if (out) longest = Math.max(longest, out.length);
      return out;
    });
    // The old way: one stringify of everything — throws under the stand-in limit.
    assert.throws(() => JSON.stringify(data, null, 2), /Invalid string length/);
    // The new way: streams record by record and succeeds.
    await writeJsonLarge(file, data, { chunkChars: 4096 });
    mock.restoreAll();
    assert.ok(longest <= LIMIT);
    assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), data);
  });

  it('flushes in bounded chunks', async () => {
    const file = path.join(dir, 'chunks.json');
    const writes = [];
    const realOpen = fsp.open;
    mock.method(fsp, 'open', async (...a) => {
      const h = await realOpen(...a);
      const w = h.write.bind(h);
      h.write = async (s, ...r) => { writes.push(s.length); return w(s, ...r); };
      return h;
    });
    await writeJsonLarge(file, records(3000), { chunkChars: 8192 });
    assert.ok(writes.length > 5, 'many writes, not one');
    assert.ok(Math.max(...writes) < 8192 + 400, 'no write bigger than the buffer plus one record');
  });

  it('is atomic: the old file survives a failed write and no temp file is left behind', async () => {
    const file = path.join(dir, 'TX.json');
    await writeJsonLarge(file, [{ vin: 'OLD' }]);
    const circular = {}; circular.self = circular;
    await assert.rejects(writeJsonLarge(file, [{ vin: 'NEW1' }, circular]), /circular|Converting/i);
    assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), [{ vin: 'OLD' }]);
    assert.deepEqual((await fsp.readdir(dir)).filter((f) => f.includes('.tmp-')), []);
  });

  it('writes through a temp name that does not end in .json (the sync reads every *.json in the shard dir)', async () => {
    const file = path.join(dir, 'TX.json');
    const seen = [];
    const realRename = fsp.rename;
    mock.method(fsp, 'rename', async (from, to) => { seen.push(path.basename(from)); return realRename(from, to); });
    await writeJsonLarge(file, records(3));
    assert.equal(seen.length, 1);
    assert.ok(!seen[0].endsWith('.json'));
    assert.match(seen[0], /^TX\.json\.tmp-/);
  });
});

describe('readJsonLarge', () => {
  it('uses the plain parse for small files and matches JSON.parse exactly', async () => {
    const file = path.join(dir, 'small.json');
    const data = { a: [1, 2, 3], b: 'x' };
    await fsp.writeFile(file, JSON.stringify(data, null, 2));
    assert.deepEqual(await readJsonLarge(file), data);
    assert.ok(STREAM_ABOVE_BYTES >= 1024 * 1024);
  });

  it('streams a compact array with records split across tiny chunks', async () => {
    const file = path.join(dir, 'a.json');
    const data = records(120);
    await writeJsonLarge(file, data);
    assert.deepEqual(await readJsonLarge(file, STREAM), data);
  });

  it('streams an OLD pretty-printed file (the existing files on the boxes) the same way', async () => {
    const file = path.join(dir, 'old.json');
    const data = records(60);
    await fsp.writeFile(file, JSON.stringify(data, null, 2));
    assert.deepEqual(await readJsonLarge(file, STREAM), data);
    const obj = { x: { y: [1, { z: 'a,b' }] }, w: 2 };
    await fsp.writeFile(file, JSON.stringify(obj, null, 4));
    assert.deepEqual(await readJsonLarge(file, STREAM), obj);
  });

  it('streams objects, including nested structures and keys/values containing JSON punctuation', async () => {
    const file = path.join(dir, 'o.json');
    const data = { 'k,1': { a: '}{][,"', n: [[1], [2, [3]]] }, 'k:2': 'v', k3: { e: {} }, k4: [] };
    await writeJsonLarge(file, data);
    assert.deepEqual(await readJsonLarge(file, STREAM), data);
  });

  it('keeps multi-byte characters intact when they straddle a chunk boundary', async () => {
    const file = path.join(dir, 'u.json');
    const data = [{ n: 'Café — “quoted” ™ 日本語 🚗' }, { n: 'Zürich ñ é ü' }];
    await writeJsonLarge(file, data);
    for (const chunkBytes of [1, 2, 3, 5, 11]) {
      assert.deepEqual(await readJsonLarge(file, { streamAboveBytes: 0, chunkBytes }), data, `chunk ${chunkBytes}`);
    }
  });

  it('handles empty containers, a leading BOM, and a __proto__ key without polluting the prototype', async () => {
    const file = path.join(dir, 'e.json');
    await fsp.writeFile(file, '[]'); assert.deepEqual(await readJsonLarge(file, STREAM), []);
    await fsp.writeFile(file, '{}'); assert.deepEqual(await readJsonLarge(file, STREAM), {});
    await fsp.writeFile(file, '﻿[1,2]'); assert.deepEqual(await readJsonLarge(file, STREAM), [1, 2]);
    await fsp.writeFile(file, '{"__proto__":{"polluted":true},"ok":1}');
    const o = await readJsonLarge(file, STREAM);
    assert.equal(({}).polluted, undefined);
    assert.equal(o.ok, 1);
  });

  it('throws on a truncated file (a killed writer) instead of returning partial data', async () => {
    const file = path.join(dir, 't.json');
    const full = JSON.stringify(records(20), null, 2);
    await fsp.writeFile(file, full.slice(0, full.length - 40));
    await assert.rejects(readJsonLarge(file, STREAM), /truncated|unterminated|JSON/i);
    await assert.rejects(readJsonLarge(path.join(dir, 'missing.json'), STREAM), /ENOENT/);
    await fsp.writeFile(file, '');
    await assert.rejects(readJsonLarge(file, STREAM), /empty|end of JSON/i); // an empty file is a zero-byte truncation: still an error
  });

  it('streams without ever reading the whole file into one string', async () => {
    const file = path.join(dir, 'nostring.json');
    await writeJsonLarge(file, records(500));
    mock.method(fsp, 'readFile', async () => { throw new Error('readFile must not be used on the streaming path'); });
    assert.equal((await readJsonLarge(file, { streamAboveBytes: 0, chunkBytes: 64 })).length, 500);
  });
});

describe('the new layout stays readable by the existing consumers', () => {
  it("inventory-sync's own streamTopLevelObjects reads the compact layout (so the sync needs no change)", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../../../scripts/box/inventory-sync.mjs'), 'utf8');
    const m = src.match(/function\* streamTopLevelObjects\(filePath\) \{[\s\S]*?\n\}\n/);
    assert.ok(m, 'could not find streamTopLevelObjects in scripts/box/inventory-sync.mjs');
    // The extracted function runs outside the module, so hand it the same bindings the module imports.
    const streamTopLevelObjects = new Function('fs', 'StringDecoder', `${m[0]}; return streamTopLevelObjects;`)(fs, StringDecoder);
    const file = path.join(dir, 'TX.json');
    const data = records(300);
    await writeJsonLarge(file, data);
    assert.deepEqual([...streamTopLevelObjects(file)], data);
    // ...and still reads an old pretty-printed shard
    await fsp.writeFile(file, JSON.stringify(data, null, 2));
    assert.deepEqual([...streamTopLevelObjects(file)], data);
  });

  it('readAllInventoryShards reads shards in either layout and skips a corrupt one', async () => {
    const cwd = dir;
    await fsp.mkdir(path.join(cwd, 'data', 'inventory'), { recursive: true });
    await writeJsonLarge(inventoryShardPath('TX', cwd), records(5));
    await fsp.writeFile(inventoryShardPath('FL', cwd), JSON.stringify(records(3), null, 2));
    await fsp.writeFile(inventoryShardPath('OH', cwd), '[{"vin":"CUT');
    const all = await readAllInventoryShards(cwd);
    assert.equal(all.length, 8);
  });

  it('readAllInventoryShards does not spread a huge shard into one function call', async () => {
    const cwd = dir;
    await fsp.mkdir(path.join(cwd, 'data', 'inventory'), { recursive: true });
    await writeJsonLarge(inventoryShardPath('TX', cwd), Array.from({ length: 300000 }, (_, i) => i));
    assert.equal((await readAllInventoryShards(cwd)).length, 300000);
  });
});
