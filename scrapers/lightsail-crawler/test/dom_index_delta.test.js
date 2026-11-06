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
  domDeltaDir, domConflictsDir, DOM_DELTA_LIVE_MAX_STALE_MS,
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

const stableJson = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));
// The invariant behind "replay must lose no history": every record anyone ever wrote is either the one in the index or sits, complete, in a conflict file.
async function assertNothingLost(records) {
  const idx = await loadDomIndex(cwd);
  const seen = new Set((await readConflicts()).flatMap((c) => [stableJson(c.kept), stableJson(c.dropped)]));
  for (const { vin, date, record } of records) {
    const inIndex = idx[vin]?.[date] && stableJson(idx[vin][date]) === stableJson(record);
    assert.ok(inIndex || seen.has(stableJson(record)), `history lost: ${vin} ${date} ${stableJson(record)}`);
  }
}

describe('checkpoint atomicity', () => {
  it('a process killed in the middle of a checkpoint leaves the previous complete checkpoint, and the half-written temp file is never mistaken for a delta', async () => {
    const dir = domDeltaDir(cwd);
    const script = `
      import fs from 'node:fs/promises';
      import { createDomDelta, checkpointDomDelta } from ${JSON.stringify(DELTA)};
      const delta = createDomDelta({ cwd: process.argv[1], label: 'victim' });
      const note = (i) => delta.note({ ['V' + i]: { '2026-11-06': { hash: 'h' + i, price: i, priceChangeType: 'NEW', blobStored: true, pad: 'x'.repeat(120) } } }, 'V' + i, '2026-11-06');
      for (let i = 0; i < 100; i++) note(i);
      await checkpointDomDelta(delta);
      await fs.writeFile(process.argv[1] + '/first-checkpoint-done', '1');
      for (let i = 100; i < 900000; i++) note(i);
      await checkpointDomDelta(delta);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, cwd], { stdio: 'ignore' });
    for (let i = 0; i < 30000 && !fs.existsSync(path.join(cwd, 'first-checkpoint-done')); i++) await new Promise((r) => setTimeout(r, 1)); // first checkpoint complete
    let sawTmp = false;
    for (let i = 0; i < 30000 && !sawTmp; i++) {
      sawTmp = (await fsp.readdir(dir).catch(() => [])).some((n) => /\.tmp-/.test(n));
      if (!sawTmp) await new Promise((r) => setTimeout(r, 1));
    }
    child.kill('SIGKILL'); await new Promise((r) => child.on('exit', r));
    assert.ok(sawTmp, 'could not interrupt the second checkpoint');
    const names = await fsp.readdir(dir);
    const real = names.filter((n) => /^delta-\d+-\d+\.json$/.test(n));
    assert.equal(real.length, 1);
    const doc = JSON.parse(await fsp.readFile(path.join(dir, real[0]), 'utf8')); // complete, parseable
    assert.equal(Object.keys(doc.entries).length, 100);
    assert.ok(names.some((n) => /\.tmp-/.test(n)), 'the half-written temp file is left behind (named so it can never match a delta)');
    const d = createDomDelta({ cwd });
    const r = await mergeDomDelta(d, quiet);
    assert.equal(r.orphanFiles, 1);
    assert.equal(Object.keys(await loadDomIndex(cwd)).length, 100);
  });

  it('an unchanged delta only gets a heartbeat; if a merger claimed its file meanwhile the next checkpoint writes it again', async () => {
    const d = createDomDelta({ cwd });
    d.note({ A: { [D(6)]: rec() } }, 'A', D(6));
    assert.equal(await checkpointDomDelta(d), true);
    const old = new Date(Date.now() - 3600 * 1000); await fsp.utimes(d.path, old, old);
    assert.equal(await checkpointDomDelta(d), false);
    assert.ok(Date.now() - (await fsp.stat(d.path)).mtimeMs < 60000, 'heartbeat touched the mtime');
    await fsp.rm(d.path); // claimed and removed by someone else
    assert.equal(await checkpointDomDelta(d), true);
    assert.deepEqual(Object.keys(JSON.parse(await fsp.readFile(d.path, 'utf8')).entries), ['A']);
  });
});

describe('orphan detection and PID reuse', () => {
  const mk = async (name, entries, ageMs = 0) => {
    const dir = domDeltaDir(cwd); await fsp.mkdir(dir, { recursive: true });
    const f = path.join(dir, name); await fsp.writeFile(f, JSON.stringify({ entries }));
    if (ageMs) { const t = new Date(Date.now() - ageMs); await fsp.utimes(f, t, t); }
    return f;
  };
  it('a delta whose pid is dead is merged; a live pid with a fresh file is left to its owner; a live (reused) pid with no heartbeat for hours is merged', async () => {
    await saveDomIndex({}, cwd);
    const dead = await mk('delta-2147483000-1.json', { DEAD: { [D(6)]: rec() } });
    const liveFresh = await mk(`delta-${process.ppid}-1.json`, { FRESH: { [D(6)]: rec() } }, 60 * 1000);
    const liveStale = await mk(`delta-${process.ppid}-2.json`, { REUSED: { [D(6)]: rec() } }, DOM_DELTA_LIVE_MAX_STALE_MS + 60000);
    const d = createDomDelta({ cwd });
    d.note({ MINE: { [D(6)]: rec() } }, 'MINE', D(6));
    const r = await mergeDomDelta(d, quiet);
    assert.equal(r.orphanFiles, 2);
    assert.deepEqual(Object.keys(await loadDomIndex(cwd)).sort(), ['DEAD', 'MINE', 'REUSED']);
    assert.equal(fs.existsSync(dead), false); assert.equal(fs.existsSync(liveStale), false); assert.ok(fs.existsSync(liveFresh));
  });
  it('claim files: a dead merger\'s claim is recovered; this process\'s own and a live merger\'s fresh claim are not touched', async () => {
    await saveDomIndex({}, cwd);
    const recovered = await mk('claimed-2147483000-5-delta-1-1.json', { REC: { [D(6)]: rec() } });
    const live = await mk(`claimed-${process.ppid}-5-delta-2-2.json`, { LIVECLAIM: { [D(6)]: rec() } }, 60 * 1000);
    const d = createDomDelta({ cwd });
    d.note({ MINE: { [D(6)]: rec() } }, 'MINE', D(6));
    await mergeDomDelta(d, quiet);
    assert.deepEqual(Object.keys(await loadDomIndex(cwd)).sort(), ['MINE', 'REC']);
    assert.equal(fs.existsSync(recovered), false); assert.ok(fs.existsSync(live));
  });
  it('a delta that is claimed by a merger while its owner keeps running loses nothing: the owner still merges its in-memory delta', async () => {
    await saveDomIndex({}, cwd);
    const owner = createDomDelta({ cwd, pid: 2147483002 }); // pretend-dead pid so the other merger claims it
    owner.note({ OWN1: { [D(6)]: rec({ price: 1 }) } }, 'OWN1', D(6));
    await checkpointDomDelta(owner);
    const other = createDomDelta({ cwd });
    await mergeDomDelta(other, quiet); // claims and merges the owner's file, deletes it
    owner.note({ OWN2: { [D(6)]: rec({ price: 2 }) } }, 'OWN2', D(6)); // owner carries on and adds more
    await mergeDomDelta(owner, quiet);
    assert.deepEqual(Object.keys(await loadDomIndex(cwd)).sort(), ['OWN1', 'OWN2']);
  });
});

describe('conflict records are complete and durable', () => {
  it('each merge writes its own conflict file with both FULL records, their sources, and a reason; every line is a whole JSON record', async () => {
    const a = rec({ price: 111, blobStored: false, priceChangeType: 'UNCHANGED' });
    const b = rec({ price: 222, blobStored: false, priceChangeType: 'UNCHANGED' }); // two LIVE records, different prices, equal score
    await saveDomIndex({ SHARED: { [D(7)]: a } }, cwd);
    const d = createDomDelta({ cwd, label: 'TX/Kia' });
    d.note({ SHARED: { [D(7)]: b } }, 'SHARED', D(7));
    const r = await mergeDomDelta(d, quiet);
    const names = await fsp.readdir(domConflictsDir(cwd));
    assert.equal(names.length, 1);
    const lines = (await fsp.readFile(path.join(domConflictsDir(cwd), names[0]), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    const c = lines[0];
    assert.equal(c.reason, 'tie-canonical-arbitrary');
    assert.deepEqual([stableJson(c.kept), stableJson(c.dropped)].sort(), [stableJson(a), stableJson(b)].sort());
    assert.deepEqual([c.keptSource, c.droppedSource].sort(), ['delta:TX/Kia:' + path.basename(d.path), 'index'].sort());
    assert.match(c.mergedBy, /TX\/Kia/); assert.ok(c.at);
    assert.equal(r.conflictFile, path.join(domConflictsDir(cwd), names[0]));
  });
  it('two merges in the same process in the same millisecond never share or overwrite a conflict file', async () => {
    await saveDomIndex({ S: { [D(7)]: rec({ price: 1, blobStored: false }) } }, cwd);
    const now = Date.now();
    for (const price of [2, 3]) { const d = createDomDelta({ cwd, startedAtMs: price }); d.note({ S: { [D(7)]: rec({ price, blobStored: false }) } }, 'S', D(7)); await mergeDomDelta(d, { ...quiet, now }); }
    assert.equal((await fsp.readdir(domConflictsDir(cwd))).length, 2);
  });
});

describe('crashes at every step of a merge, then replay', () => {
  const HOOKS = { afterConflicts: 'before the index rename', afterRename: 'after the index rename, before any delta file is deleted', afterDelete1: 'after the first delta file was deleted, before the rest' };
  for (const [hook, desc] of Object.entries(HOOKS)) {
    it(`killed ${desc}: replay loses nothing`, async () => {
      // history in the index, a conflicting live-vs-SOLD and a conflicting live-vs-live overlap, two dead processes' deltas, and the victim's own delta
      const history = [];
      const base = {};
      for (let i = 0; i < 200; i++) { const r = rec({ price: i, hash: 'b' + i }); base['H' + i] = { [D(1)]: r }; history.push({ vin: 'H' + i, date: D(1), record: r }); }
      const sold = rec({ priceChangeType: 'SOLD', price: null, blobStored: false });
      const live1 = rec({ price: 500, priceChangeType: 'UNCHANGED', blobStored: false });
      const live2 = rec({ price: 600, priceChangeType: 'UNCHANGED', blobStored: false });
      base.OVER1 = { [D(6)]: sold }; base.OVER2 = { [D(6)]: live1 };
      history.push({ vin: 'OVER1', date: D(6), record: sold }, { vin: 'OVER2', date: D(6), record: live1 });
      await saveDomIndex(base, cwd);
      const indexBefore = await fsp.readFile(domPaths(cwd).indexPath);
      const dir = domDeltaDir(cwd); await fsp.mkdir(dir, { recursive: true });
      const written = [];
      const orphanRec = (n) => rec({ price: 7000 + n, hash: 'o' + n });
      for (const [pid, n] of [[2147483010, 1], [2147483011, 2]]) {
        const e = { [`ORPH${n}`]: { [D(6)]: orphanRec(n) }, OVER2: { [D(6)]: n === 1 ? live2 : live1 } };
        await fsp.writeFile(path.join(dir, `delta-${pid}-1.json`), JSON.stringify({ entries: e }));
        written.push({ vin: `ORPH${n}`, date: D(6), record: orphanRec(n) });
      }
      written.push({ vin: 'OVER2', date: D(6), record: live2 });
      const victimEntries = { VICT1: { [D(6)]: rec({ price: 42, hash: 'v1' }) }, OVER1: { [D(6)]: live1 }, OVER2: { [D(6)]: rec({ price: 700, priceChangeType: 'UNCHANGED', blobStored: false }) } };
      for (const [vin, dates] of Object.entries(victimEntries)) for (const [date, record] of Object.entries(dates)) written.push({ vin, date, record });
      const hookCode = hook === 'afterDelete1' ? "afterDelete: (n) => { if (n === 1) process.kill(process.pid, 'SIGKILL'); }" : `${hook}: () => process.kill(process.pid, 'SIGKILL')`;
      const script = `
        import { createDomDelta, checkpointDomDelta, mergeDomDelta } from ${JSON.stringify(DELTA)};
        const cwd = process.argv[1];
        const d = createDomDelta({ cwd, label: 'victim' });
        d.entries = ${JSON.stringify(victimEntries)}; d.count = 3;
        await checkpointDomDelta(d);
        await mergeDomDelta(d, { log() {}, hooks: { ${hookCode.replace('afterDelete:', 'afterDelete:')} } });
        console.log('SURVIVED');`;
      const r = await runChild(script, [cwd]);
      assert.equal(r.signal, 'SIGKILL', r.out + r.err);
      if (hook === 'afterConflicts') assert.ok(indexBefore.equals(await fsp.readFile(domPaths(cwd).indexPath)), 'index must be byte-identical when the kill came before the rename');
      // replay: the next process to finish merges whatever is left
      const d2 = createDomDelta({ cwd, label: 'replay' });
      await mergeDomDelta(d2, quiet);
      await assertNothingLost([...history, ...written]);
      const idx = await loadDomIndex(cwd);
      for (let i = 0; i < 200; i++) assert.ok(idx['H' + i][D(1)]);
      assert.ok(idx.ORPH1 && idx.ORPH2 && idx.VICT1);
      assert.equal(idx.OVER1[D(6)].priceChangeType !== 'SOLD', true, 'a live record must win over SOLD');
      const left = (await fsp.readdir(domDeltaDir(cwd))).filter((n) => /^(delta|claimed)-/.test(n));
      assert.deepEqual(left, [], 'every delta and claim file merged and removed after the replay');
    });
  }
});

describe('streaming merge equals the in-memory merge', () => {
  it('on a random index with random overlapping/conflicting/new entries, and with odd characters in values', async () => {
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const idx = {};
    for (let v = 0; v < 2500; v++) { idx['V' + v] = {}; for (let d = 1; d <= 1 + Math.floor(rnd() * 6); d++) idx['V' + v][D(d)] = rec({ price: Math.floor(rnd() * 50000), hash: 'h' + Math.floor(rnd() * 9), blobStored: rnd() < 0.5, note: 'q"} ] , \\ \u2028 ünï ✓', priceChangeType: rnd() < 0.2 ? 'SOLD' : 'UNCHANGED' }); }
    await saveDomIndex(idx, cwd);
    const delta = {};
    for (let i = 0; i < 1500; i++) { const vin = rnd() < 0.5 ? 'V' + Math.floor(rnd() * 2500) : 'N' + i; delta[vin] = delta[vin] || {}; delta[vin][D(1 + Math.floor(rnd() * 7))] = rec({ price: Math.floor(rnd() * 50000), hash: 'h' + Math.floor(rnd() * 9), blobStored: rnd() < 0.5, priceChangeType: rnd() < 0.2 ? 'SOLD' : 'UNCHANGED' }); }
    const expected = JSON.parse(JSON.stringify(idx));
    const ref = applyDomEntries(expected, delta);
    const d = createDomDelta({ cwd, label: 'rnd' }); d.entries = delta; d.count = 1;
    const r = await mergeDomDelta(d, quiet);
    assert.deepEqual(await loadDomIndex(cwd), expected);
    assert.equal(r.added, ref.added); assert.equal(r.conflicts, ref.conflicts.length);
    assert.equal(r.vinsOut, Object.keys(expected).length);
  });
  it('a missing index file starts from empty; an index with the same VIN twice, and one that is not an object, are refused untouched', async () => {
    const d = createDomDelta({ cwd }); d.note({ A: { [D(1)]: rec() } }, 'A', D(1));
    await mergeDomDelta(d, quiet);
    assert.deepEqual(Object.keys(await loadDomIndex(cwd)), ['A']);
    for (const bad of ['{"A":{"2026-11-01":{"hash":"1"}},"A":{"2026-11-01":{"hash":"2"}}}', '[1,2,3]', '']) {
      await fsp.writeFile(domPaths(cwd).indexPath, bad);
      const d2 = createDomDelta({ cwd }); d2.note({ A: { [D(2)]: rec() } }, 'A', D(2));
      await assert.rejects(mergeDomDelta(d2, { ...quiet, attempts: 1 }), DomIndexUnreadableError);
      assert.equal(await fsp.readFile(domPaths(cwd).indexPath, 'utf8'), bad);
    }
    assert.deepEqual((await fsp.readdir(domPaths(cwd).dataDir)).filter((n) => /\.tmp-/.test(n)), [], 'failed merges leave no temp file');
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
