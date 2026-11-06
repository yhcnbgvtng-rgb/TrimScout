// dom_index_delta.js: concurrent brand processes must not lose each other's dom_index entries, and overlapping VIN-dates must never be dropped silently.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadDomIndex, saveDomIndex, domPaths, DomIndexUnreadableError } from '../src/dom_store.js';
import { sharedDataLockPath } from '../src/shared_data_lock.js';
import {
  createDomDelta, checkpointDomDelta, mergeDomDelta, applyDomEntries, chooseDomRecord, recordScore,
  domDeltaDir, domConflictsDir,
} from '../src/dom_index_delta.js';

let cwd;
beforeEach(async () => { cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'domdelta-')); });
afterEach(async () => { await fsp.rm(cwd, { recursive: true, force: true }); });

const D = (n) => `2026-11-${String(n).padStart(2, '0')}`;
const rec = (over = {}) => ({ hash: 'h', price: 100, oldPrice: null, priceDiff: 0, priceChangeType: 'NEW', blobStored: true, hashUnchanged: false, ...over });
const quiet = { log: () => {} };
const readConflicts = async () => {
  const dir = domConflictsDir(cwd);
  const names = await fsp.readdir(dir).catch(() => []);
  const out = [];
  for (const n of names) for (const l of (await fsp.readFile(path.join(dir, n), 'utf8')).split('\n').filter(Boolean)) out.push(JSON.parse(l));
  return out;
};
const dataFiles = async () => (await fsp.readdir(domPaths(cwd).dataDir)).sort();

describe('record choice for overlapping VIN-dates', () => {
  const live = rec({ priceChangeType: 'UNCHANGED', hashUnchanged: true, blobStored: false });
  const sold = rec({ priceChangeType: 'SOLD', price: null, blobStored: false });
  const liveStored = rec({ priceChangeType: 'UP', blobStored: true, price: 123 });
  const noHash = rec({ hash: null, priceChangeType: 'SOLD', blobStored: false });

  it('is symmetric: the same record is kept whichever side arrives first', () => {
    const all = [live, sold, liveStored, noHash, rec({ price: 1 }), rec({ price: 2 })];
    for (const a of all) for (const b of all) {
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      assert.deepEqual(chooseDomRecord(a, b).keep, chooseDomRecord(b, a).keep);
      assert.deepEqual(chooseDomRecord(a, b).drop, chooseDomRecord(b, a).drop);
    }
  });
  it('a live listing beats SOLD, a stored page beats a hash-only record', () => {
    assert.deepEqual(chooseDomRecord(sold, live).keep, live);
    assert.deepEqual(chooseDomRecord(live, liveStored).keep, liveStored);
    assert.ok(recordScore(live) > recordScore(sold));
  });
});

describe('applyDomEntries', () => {
  it('adds new VINs and dates, ignores identical records, reports different ones as conflicts without losing either', () => {
    const idx = { A: { [D(1)]: rec({ price: 1 }) }, B: { [D(1)]: rec({ price: 2 }) } };
    const r = applyDomEntries(idx, { A: { [D(1)]: rec({ price: 1 }), [D(2)]: rec({ price: 3 }) }, B: { [D(1)]: rec({ price: 99, blobStored: false }) }, C: { [D(2)]: rec() } }, 'x');
    assert.equal(r.added, 2); assert.equal(r.same, 1); assert.equal(r.conflicts.length, 1);
    const c = r.conflicts[0];
    assert.equal(c.vin, 'B');
    assert.deepEqual([c.kept, c.dropped].map((x) => x.price).sort(), [2, 99]); // both records are in the conflict entry
    assert.deepEqual(idx.B[D(1)], c.kept);
    assert.deepEqual(Object.keys(idx).sort(), ['A', 'B', 'C']);
  });
});

describe('mergeDomDelta', () => {
  it('merges a delta into the current file and removes the delta file only afterwards', async () => {
    await saveDomIndex({ OLD: { [D(1)]: rec() } }, cwd);
    const d = createDomDelta({ cwd, label: 'NJ/Ford' });
    const idx = await loadDomIndex(cwd);
    idx.NEW1 = { [D(2)]: rec({ price: 5 }) }; d.note(idx, 'new1', D(2)); // lowercase vin is normalised like captureVehicleDom does
    await checkpointDomDelta(d);
    assert.ok(fs.existsSync(d.path));
    const r = await mergeDomDelta(d, { ...quiet });
    assert.equal(r.added, 1);
    assert.deepEqual(await loadDomIndex(cwd), { OLD: { [D(1)]: rec() }, NEW1: { [D(2)]: rec({ price: 5 }) } });
    assert.equal(fs.existsSync(d.path), false);
    assert.deepEqual(await dataFiles(), ['dom_index.json', 'dom_index_delta', 'locks']);
    assert.deepEqual(await fsp.readdir(domDeltaDir(cwd)), []);
    assert.equal(fs.existsSync(sharedDataLockPath(cwd, 'dom-index')), false, 'lock released');
  });

  it('merging twice (a crash between save and delete) changes nothing and logs no conflict', async () => {
    const d = createDomDelta({ cwd });
    const idx = { V: { [D(3)]: rec() } }; d.note(idx, 'V', D(3));
    await mergeDomDelta(d, quiet);
    await checkpointDomDelta(d); // pretend the delta file survived
    const before = await fsp.readFile(domPaths(cwd).indexPath);
    const r = await mergeDomDelta(d, quiet);
    assert.equal(r.added, 0); assert.equal(r.conflicts, 0);
    assert.ok(before.equals(await fsp.readFile(domPaths(cwd).indexPath)));
  });

  it('an unreadable index: merge throws, the file is untouched, the delta file is kept for the next run', async () => {
    const { dataDir, indexPath } = domPaths(cwd);
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(indexPath, '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026');
    const d = createDomDelta({ cwd });
    d.note({ V: { [D(3)]: rec() } }, 'V', D(3));
    await checkpointDomDelta(d);
    await assert.rejects(mergeDomDelta(d, quiet), DomIndexUnreadableError);
    assert.equal(await fsp.readFile(indexPath, 'utf8'), '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026');
    assert.ok(fs.existsSync(d.path));
    assert.equal(fs.existsSync(sharedDataLockPath(cwd, 'dom-index')), false, 'lock released even on failure');
  });

  it('a lock that cannot be taken in time: merge throws, index untouched, delta kept', async () => {
    await saveDomIndex({ OLD: { [D(1)]: rec() } }, cwd);
    const lock = sharedDataLockPath(cwd, 'dom-index');
    await fsp.mkdir(path.dirname(lock), { recursive: true });
    await fsp.writeFile(lock, JSON.stringify({ pid: process.pid, label: 'someone', startedAt: new Date().toISOString() }));
    const d = createDomDelta({ cwd });
    d.note({ V: { [D(3)]: rec() } }, 'V', D(3));
    await checkpointDomDelta(d);
    await assert.rejects(mergeDomDelta(d, { ...quiet, maxWaitMs: 300 }), /Timed out/);
    assert.deepEqual(await loadDomIndex(cwd), { OLD: { [D(1)]: rec() } });
    assert.ok(fs.existsSync(d.path));
  });

  it('merges the delta of a dead process (orphan) but never one that belongs to a live process; an unreadable orphan is left in place', async () => {
    await saveDomIndex({}, cwd);
    const dir = domDeltaDir(cwd); await fsp.mkdir(dir, { recursive: true });
    const dead = path.join(dir, 'delta-2147483000-1.json');
    const live = path.join(dir, `delta-${process.ppid}-1.json`); // the test runner's parent is alive
    const junk = path.join(dir, 'delta-2147483001-1.json');
    await fsp.writeFile(dead, JSON.stringify({ entries: { DEAD1: { [D(4)]: rec({ price: 7 }) } } }));
    await fsp.writeFile(live, JSON.stringify({ entries: { LIVE1: { [D(4)]: rec() } } }));
    await fsp.writeFile(junk, '{"entries":{"X":{"2026');
    const d = createDomDelta({ cwd });
    d.note({ MINE: { [D(4)]: rec() } }, 'MINE', D(4));
    const r = await mergeDomDelta(d, quiet);
    assert.equal(r.orphanFiles, 1); assert.equal(r.unreadableDeltas.length, 1);
    assert.deepEqual(Object.keys(await loadDomIndex(cwd)).sort(), ['DEAD1', 'MINE']);
    assert.equal(fs.existsSync(dead), false); assert.ok(fs.existsSync(live)); assert.ok(fs.existsSync(junk));
  });

  it('overlapping VIN-dates from two runs: one record kept, BOTH written to the conflict log', async () => {
    await saveDomIndex({ SHARED: { [D(5)]: rec({ price: 111, priceChangeType: 'SOLD', blobStored: false }) } }, cwd);
    const d = createDomDelta({ cwd, label: 'FL/Kia' });
    d.note({ SHARED: { [D(5)]: rec({ price: 222, priceChangeType: 'UP' }) } }, 'SHARED', D(5));
    const r = await mergeDomDelta(d, quiet);
    assert.equal(r.conflicts, 1);
    assert.equal((await loadDomIndex(cwd)).SHARED[D(5)].price, 222); // live beats SOLD
    const log = await readConflicts();
    assert.equal(log.length, 1);
    assert.equal(log[0].vin, 'SHARED'); assert.equal(log[0].kept.price, 222); assert.equal(log[0].dropped.price, 111);
  });
});

function runChild(script, args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (b) => { out += b; }); c.stderr.on('data', (b) => { err += b; });
    c.on('exit', (code, signal) => resolve({ code, signal, out, err }));
  });
}
const STORE = new URL('../src/dom_store.js', import.meta.url).href;
const DELTA = new URL('../src/dom_index_delta.js', import.meta.url).href;
// A stand-in for one brand run: load the index at start, wait for the others to have loaded too (so every copy is stale, as in a real concurrent run),
// write its own VINs plus a few shared ones, checkpoint, then either merge (new) or save the whole copy (old behaviour).
const CHILD = `
import fs from 'node:fs/promises';
import { loadDomIndex, saveDomIndex } from ${JSON.stringify(STORE)};
import { createDomDelta, checkpointDomDelta, mergeDomDelta } from ${JSON.stringify(DELTA)};
const [cwd, id, n, mode] = process.argv.slice(1);
const date = '2026-11-06';
const idx = await loadDomIndex(cwd);
await fs.writeFile(cwd + '/ready-' + id, '1');
for (;;) { const names = await fs.readdir(cwd); if (names.filter((x) => x.startsWith('ready-')).length >= Number(n)) break; await new Promise((r) => setTimeout(r, 5)); }
const delta = createDomDelta({ cwd, label: 'child' + id });
const put = (vin, rec) => { idx[vin] = idx[vin] || {}; idx[vin][date] = rec; delta.note(idx, vin, date); };
for (let i = 0; i < 300; i++) put('P' + id + 'V' + i, { hash: 'h' + id + i, price: i, priceChangeType: 'NEW', blobStored: true });
for (let i = 0; i < 20; i++) put('SHARED' + i, { hash: 'x' + id, price: 1000 + Number(id), priceChangeType: 'NEW', blobStored: true }); // same VIN and date from every process, different records
for (let i = 0; i < 20; i++) put('SAME' + i, { hash: 'same', price: 5, priceChangeType: 'NEW', blobStored: true });   // identical everywhere
if (mode === 'new') { await checkpointDomDelta(delta); await mergeDomDelta(delta, { log: () => {} }); }
else { for (let k = 0; k < 20; k++) await saveDomIndex(idx, cwd); }
`;

describe('concurrent processes (real child processes)', () => {
  const N = 6;
  const launch = (mode) => Promise.all(Array.from({ length: N }, (_, i) => runChild(CHILD, [cwd, String(i), String(N), mode])));
  const seed = async () => saveDomIndex({ HISTORY1: { '2026-11-01': rec({ price: 9 }) }, HISTORY2: { '2026-11-01': rec({ price: 8 }), '2026-11-02': rec({ price: 8 }) } }, cwd);
  const cleanup = async () => { for (const n of await fsp.readdir(cwd)) if (n.startsWith('ready-')) await fsp.rm(path.join(cwd, n)); };

  it('CONTROL (the old behaviour): every process saving its own stale full copy loses other processes\' entries', async () => {
    await seed();
    const results = await launch('old');
    results.forEach((r) => assert.equal(r.code, 0, r.err));
    const idx = await loadDomIndex(cwd);
    const have = Object.keys(idx).filter((v) => /^P\d+V/.test(v)).length;
    assert.ok(have < N * 300, `expected lost entries with whole-copy saves, found all ${have}`);
  });

  it('delta + merge: no process loses anything; history, shared and identical VINs all end up correct; conflicts are logged with both records', async () => {
    await cleanup(); await fsp.rm(domPaths(cwd).indexPath, { force: true });
    await seed();
    const results = await launch('new');
    results.forEach((r) => assert.equal(r.code, 0, r.err));
    const idx = await loadDomIndex(cwd);
    for (let id = 0; id < N; id++) for (let i = 0; i < 300; i++) assert.ok(idx[`P${id}V${i}`]?.['2026-11-06'], `lost P${id}V${i}`);
    assert.equal(idx.HISTORY1['2026-11-01'].price, 9); assert.equal(idx.HISTORY2['2026-11-02'].price, 8);
    for (let i = 0; i < 20; i++) { assert.equal(idx[`SAME${i}`]['2026-11-06'].price, 5); assert.ok(idx[`SHARED${i}`]['2026-11-06']); }
    // each SHARED VIN-date was written by N processes with different records: N-1 get dropped, and every dropped one is in the log
    const log = await readConflicts();
    for (let i = 0; i < 20; i++) {
      const prices = new Set([idx[`SHARED${i}`]['2026-11-06'].price, ...log.filter((c) => c.vin === `SHARED${i}`).flatMap((c) => [c.kept.price, c.dropped.price])]);
      assert.equal(prices.size, N, `SHARED${i}: every writer's record must be in the index or the conflict log`);
    }
    assert.equal(log.filter((c) => c.vin.startsWith('SAME')).length, 0);
    assert.deepEqual((await dataFiles()).filter((n) => n.includes('tmp') || n.startsWith('ready-') === false && n.startsWith('dom_index.json.')), []);
    assert.equal((await fsp.readdir(domDeltaDir(cwd))).length, 0, 'all delta files merged and removed');
  });

  it('a process killed after its last checkpoint and before merging loses nothing: the next merge picks its delta up', async () => {
    await cleanup(); await fsp.rm(domPaths(cwd).indexPath, { force: true });
    await seed();
    const script = `
      import { createDomDelta, checkpointDomDelta } from ${JSON.stringify(DELTA)};
      const delta = createDomDelta({ cwd: process.argv[1], label: 'victim' });
      for (let i = 0; i < 50; i++) { delta.note({ ['K' + i]: { '2026-11-06': { hash: 'k', price: i, priceChangeType: 'NEW', blobStored: true } } }, 'K' + i, '2026-11-06'); }
      await checkpointDomDelta(delta); console.log('checkpointed'); process.kill(process.pid, 'SIGKILL');`;
    const r = await runChild(script, [cwd]);
    assert.equal(r.signal, 'SIGKILL'); assert.match(r.out, /checkpointed/);
    assert.equal((await loadDomIndex(cwd)).K0, undefined);
    const d = createDomDelta({ cwd });
    d.note({ NEXT: { '2026-11-06': rec() } }, 'NEXT', '2026-11-06');
    const m = await mergeDomDelta(d, quiet);
    assert.equal(m.orphanFiles, 1);
    const idx = await loadDomIndex(cwd);
    for (let i = 0; i < 50; i++) assert.equal(idx['K' + i]['2026-11-06'].price, i);
  });
});

describe('standalone.js wiring', () => {
  const src = fs.readFileSync(new URL('../src/standalone.js', import.meta.url), 'utf8');
  it('no longer saves the whole index, records its writes in a delta, merges at the end', () => {
    assert.doesNotMatch(src, /saveDomIndex\(/);
    assert.match(src, /domDelta\.note\(domIndex, vehicle\.vin, todayDate\)/);
    assert.match(src, /domDelta\.note\(domIndex, soldRecord\.vin, todayDate\)/);
    assert.match(src, /checkpointDomDelta\(domDelta\)/);
    assert.match(src, /await mergeDomDelta\(domDelta\)/);
    assert.match(src, /domIndex = null;/);
    assert.doesNotMatch(src.slice(src.indexOf('domIndex = null;')), /\bdomIndex\b(?!\s*=\s*null)/, 'domIndex must not be used after it is released');
  });
});
