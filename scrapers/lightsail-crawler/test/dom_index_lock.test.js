// The dom-index merge lock (dom_index_delta.js), with real processes: it must not be stolen from a live holder because of age or pid reuse, must be taken at once
// from a dead holder or a reused pid, must give exclusive access under simultaneous acquisition, and must never let a former holder delete a replacement's lock.
// Contrast: scripts/dom-index-lock-probe.mjs shows src/shared_data_lock.js doing the opposite of each of these.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { saveDomIndex, domPaths } from '../src/dom_store.js';
import {
  acquireDomIndexLock, domMergeLockPath, DomLockLostError, breakDomLock, processIdentity, createDomDelta, checkpointDomDelta, mergeDomDelta,
} from '../src/dom_index_delta.js';

const DELTA = new URL('../src/dom_index_delta.js', import.meta.url).href;
let cwd, kids;
beforeEach(async () => { cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'domlock-')); kids = []; });
afterEach(async () => {
  for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } }
  await Promise.all(kids.map((k) => new Promise((r) => (k.exitCode !== null || k.signalCode ? r() : k.on('exit', r)))));
  await fsp.rm(cwd, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (file, ms = 20000) => { for (let i = 0; i < ms && !fs.existsSync(file); i++) await sleep(1); assert.ok(fs.existsSync(file), `timed out waiting for ${path.basename(file)}`); };
const touch = (name, text = '1') => fs.writeFileSync(path.join(cwd, name), text);
const start = (script, args = []) => {
  const c = spawn(process.execPath, ['--input-type=module', '-e', script, cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  c.out = ''; c.err = ''; c.stdout.on('data', (b) => { c.out += b; }); c.stderr.on('data', (b) => { c.err += b; });
  c.done = new Promise((r) => c.on('exit', (code, signal) => r({ code, signal }))); kids.push(c); return c;
};
const sleeper = () => { const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); kids.push(c); return c; };
const lockDoc = () => JSON.parse(fs.readFileSync(domMergeLockPath(cwd), 'utf8'));
const writeLock = (doc) => { fs.mkdirSync(path.dirname(domMergeLockPath(cwd)), { recursive: true }); fs.writeFileSync(domMergeLockPath(cwd), JSON.stringify({ v: 1, token: 'f'.repeat(32), label: 'planted', startedAt: new Date().toISOString(), ...doc })); };
const lockDir = () => fs.readdirSync(path.dirname(domMergeLockPath(cwd))).sort();

const HOLDER = `
  import fs from 'node:fs';
  import { acquireDomIndexLock } from ${JSON.stringify(DELTA)};
  const [cwd, mode] = process.argv.slice(1);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lock = await acquireDomIndexLock({ cwd, label: 'holder-' + mode, maxWaitMs: 5000 });
  if (mode === 'old') { // an artificially old lock: startedAt 30 days ago and an mtime to match, same token and inode
    const d = JSON.parse(fs.readFileSync(lock.path, 'utf8')); d.startedAt = new Date(Date.now() - 30 * 864e5).toISOString(); fs.writeFileSync(lock.path, JSON.stringify(d));
    const t = new Date(Date.now() - 30 * 864e5); fs.utimesSync(lock.path, t, t);
  }
  fs.writeFileSync(cwd + '/holder-ready', lock.token);
  if (mode === 'die') process.kill(process.pid, 'SIGKILL');
  while (!fs.existsSync(cwd + '/release')) await sleep(5);
  let verdict = 'held';
  try { await lock.assertHeld(); } catch (e) { verdict = e.name; }
  const r = await lock.release();
  console.log(JSON.stringify({ verdict, release: r }));`;
const CONTENDER = `
  import { acquireDomIndexLock } from ${JSON.stringify(DELTA)};
  const [cwd, maxWait] = process.argv.slice(1);
  try { const l = await acquireDomIndexLock({ cwd, label: 'contender', maxWaitMs: Number(maxWait), retryDelayMs: 20 }); await l.release(); console.log('ACQUIRED'); } catch (e) { console.log('TIMEOUT ' + e.message); }`;

describe('a live holder keeps the lock, whatever its age', () => {
  it('holder alive with a 30-day-old lock: three real contenders and this process all fail to take it; the holder still holds it and releases normally', async () => {
    const holder = start(HOLDER, ['old']);
    await waitFor(path.join(cwd, 'holder-ready'));
    const token = fs.readFileSync(path.join(cwd, 'holder-ready'), 'utf8');
    assert.ok(Date.now() - fs.statSync(domMergeLockPath(cwd)).mtimeMs > 29 * 864e5);
    assert.ok(Date.now() - Date.parse(lockDoc().startedAt) > 29 * 864e5);
    const contenders = [start(CONTENDER, ['1200']), start(CONTENDER, ['1200']), start(CONTENDER, ['1200'])];
    await assert.rejects(acquireDomIndexLock({ cwd, label: 'test process', maxWaitMs: 1200, retryDelayMs: 20 }), (e) => /Timed out/.test(e.message) && /alive/.test(e.message) && /whatever its age/.test(e.message));
    for (const c of contenders) { await c.done; assert.match(c.out, /^TIMEOUT .*alive/m, c.out + c.err); }
    assert.equal(lockDoc().token, token, 'the live holder\'s lock must be untouched');
    touch('release');
    assert.deepEqual(await holder.done, { code: 0, signal: null }, holder.err);
    assert.deepEqual(JSON.parse(holder.out.trim()), { verdict: 'held', release: { released: true } });
    assert.deepEqual(lockDir(), []);
    const l = await acquireDomIndexLock({ cwd, maxWaitMs: 500 });
    assert.equal((await l.release()).released, true); // free again
  });

  it('a holder that really holds it for longer than any limit (no merge-finishes-in-time assumption): the lock is waited for, then taken once it is released', async () => {
    const holder = start(HOLDER, ['old']);
    await waitFor(path.join(cwd, 'holder-ready'));
    const t0 = Date.now();
    const waiter = acquireDomIndexLock({ cwd, label: 'waiter', maxWaitMs: 20000, retryDelayMs: 10 });
    await sleep(1500);
    touch('release'); await holder.done;
    const lock = await waiter;
    assert.ok(Date.now() - t0 >= 1400, 'the waiter must have waited for the holder, not taken the lock');
    assert.equal(lockDoc().token, lock.token);
    await lock.release();
  });
});

describe('a dead holder or a reused pid is replaced at once, by identity', () => {
  it('holder killed (SIGKILL) while holding: the next acquire takes over immediately, the old file is gone, no leftovers', async () => {
    const holder = start(HOLDER, ['die']);
    assert.equal((await holder.done).signal, 'SIGKILL');
    assert.ok(fs.existsSync(domMergeLockPath(cwd)), 'the dead holder left its lock behind');
    const t0 = Date.now();
    const lock = await acquireDomIndexLock({ cwd, label: 'next', maxWaitMs: 3000 });
    assert.ok(Date.now() - t0 < 2000, 'takeover must not wait for any age limit');
    assert.notEqual(lock.token, fs.readFileSync(path.join(cwd, 'holder-ready'), 'utf8'));
    assert.equal(lockDoc().token, lock.token);
    await lock.release();
    assert.deepEqual(lockDir(), []);
  });

  it('pid reuse: the lock names a pid that is now another live process (different start identity) -> taken at once; a different boot identity -> taken at once', async () => {
    const sq = sleeper(); const id = processIdentity(sq.pid);
    writeLock({ pid: sq.pid, start: '0badc0ffee', boot: id.boot });
    let lock = await acquireDomIndexLock({ cwd, maxWaitMs: 1500 }); assert.equal(lockDoc().token, lock.token); await lock.release();
    writeLock({ pid: sq.pid, start: id.start, boot: '0123456789abcdef' });
    lock = await acquireDomIndexLock({ cwd, maxWaitMs: 1500 }); assert.equal(lockDoc().token, lock.token); await lock.release();
  });

  it('the SAME live process (matching start and boot identity) is never replaced, and an UNCERTAIN holder (identity not recorded / unreadable file) is waited for and named, not broken', async () => {
    const sq = sleeper(); const id = processIdentity(sq.pid);
    writeLock({ pid: sq.pid, start: id.start, boot: id.boot, startedAt: new Date(Date.now() - 365 * 864e5).toISOString() });
    await assert.rejects(acquireDomIndexLock({ cwd, maxWaitMs: 600, retryDelayMs: 20 }), /owner is alive/);
    writeLock({ pid: sq.pid, start: 'x', boot: 'x' });
    await assert.rejects(acquireDomIndexLock({ cwd, maxWaitMs: 600, retryDelayMs: 20 }), /owner is uncertain/);
    fs.writeFileSync(domMergeLockPath(cwd), 'not json at all');
    await assert.rejects(acquireDomIndexLock({ cwd, maxWaitMs: 600, retryDelayMs: 20 }), /owner is uncertain.*not valid JSON/);
    assert.equal(fs.readFileSync(domMergeLockPath(cwd), 'utf8'), 'not json at all', 'never touched');
  });
});

describe('simultaneous acquisition', () => {
  const SECTION = `
    import fs from 'node:fs';
    import { withDomIndexLock } from ${JSON.stringify(DELTA)};
    const [cwd, id] = process.argv.slice(1);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    while (!fs.existsSync(cwd + '/go')) await sleep(1);                   // barrier: everyone starts together
    await withDomIndexLock(async () => {
      try { fs.writeFileSync(cwd + '/in-section', id, { flag: 'wx' }); } catch { fs.appendFileSync(cwd + '/violations', id + '\\n'); }   // someone else is inside
      const n = fs.existsSync(cwd + '/counter') ? Number(fs.readFileSync(cwd + '/counter', 'utf8')) : 0;
      await sleep(15);                                                    // widen the read-modify-write window
      fs.writeFileSync(cwd + '/counter', String(n + 1));
      try { fs.unlinkSync(cwd + '/in-section'); } catch {}
    }, { cwd, label: 'section-' + id, maxWaitMs: 60000, retryDelayMs: 5 });
    console.log('DONE');`;
  for (const stale of [false, true]) {
    it(`8 real processes at once${stale ? ', all racing to break the same dead holder\'s lock' : ''}: never two inside, no update lost, no leftovers`, async () => {
      if (stale) { const h = start(HOLDER, ['die']); await h.done; assert.ok(fs.existsSync(domMergeLockPath(cwd))); }
      const procs = Array.from({ length: 8 }, (_, i) => start(SECTION, [String(i)]));
      await sleep(200); touch('go');
      for (const p of procs) { const r = await p.done; assert.equal(r.code, 0, p.err); assert.match(p.out, /DONE/); }
      assert.equal(fs.existsSync(path.join(cwd, 'violations')), false, 'two processes were inside the critical section at once');
      assert.equal(fs.readFileSync(path.join(cwd, 'counter'), 'utf8'), '8', 'a read-modify-write was lost');
      assert.deepEqual(lockDir(), []);
    });
  }
  it('breakDomLock that moves a different lock aside by mistake puts it straight back; a matching token is deleted', async () => {
    const sq = sleeper(); const id = processIdentity(sq.pid);
    writeLock({ pid: sq.pid, start: id.start, boot: id.boot, token: 'b'.repeat(32) }); // a live holder's lock...
    assert.equal(await breakDomLock(domMergeLockPath(cwd), { token: 'a'.repeat(32) }, 'me'), false); // ...while we meant to break lock "a"
    assert.equal(lockDoc().token, 'b'.repeat(32)); assert.deepEqual(lockDir(), ['dom-index.merge.lock']);
    assert.equal(await breakDomLock(domMergeLockPath(cwd), { token: 'b'.repeat(32) }, 'me'), true);
    assert.deepEqual(lockDir(), []);
  });
});

describe('delayed cleanup by a former owner', () => {
  it('A\'s lock is taken from it outside the protocol and B holds a new one; A\'s late assertHeld fails and A\'s late release deletes nothing of B\'s', async () => {
    const A = start(HOLDER, ['live']);
    await waitFor(path.join(cwd, 'holder-ready'));
    const tokenA = fs.readFileSync(path.join(cwd, 'holder-ready'), 'utf8');
    fs.rmSync(domMergeLockPath(cwd)); // whatever removed it (operator, other code): A's lock is gone
    const B = await acquireDomIndexLock({ cwd, label: 'B', maxWaitMs: 2000 });
    assert.notEqual(B.token, tokenA);
    touch('release'); // A wakes up and cleans up late
    assert.deepEqual(await A.done, { code: 0, signal: null }, A.err);
    assert.deepEqual(JSON.parse(A.out.trim()), { verdict: 'DomLockLostError', release: { released: false, reason: 'lock belongs to someone else; left untouched' } });
    assert.equal(lockDoc().token, B.token, 'B\'s lock must survive A\'s late cleanup');
    await B.assertHeld();
    assert.equal((await B.release()).released, true);
    assert.deepEqual(lockDir(), []);
  });

  it('a merge whose lock was taken before the commit abandons it: index byte-identical, delta kept, the other holder\'s lock untouched', async () => {
    await saveDomIndex({ OLD: { '2026-11-01': { hash: 'h', price: 1, priceChangeType: 'NEW', blobStored: true } } }, cwd);
    const before = await fsp.readFile(domPaths(cwd).indexPath);
    const sq = sleeper(); const id = processIdentity(sq.pid);
    const d = createDomDelta({ cwd, label: 'victim' });
    d.note({ NEWVIN: { '2026-11-06': { hash: 'n', price: 2, priceChangeType: 'NEW', blobStored: true } } }, 'NEWVIN', '2026-11-06');
    await checkpointDomDelta(d);
    const hooks = { beforeCommit: () => { fs.rmSync(domMergeLockPath(cwd)); writeLock({ pid: sq.pid, start: id.start, boot: id.boot, token: 'c'.repeat(32), label: 'new holder' }); } };
    await assert.rejects(mergeDomDelta(d, { log() {}, hooks }), DomLockLostError);
    assert.ok(before.equals(await fsp.readFile(domPaths(cwd).indexPath)));
    assert.ok(fs.existsSync(d.path), 'delta must stay on disk');
    assert.equal(lockDoc().token, 'c'.repeat(32), 'the new holder\'s lock is not deleted by the abandoned merge');
    assert.deepEqual((await fsp.readdir(domPaths(cwd).dataDir)).filter((n) => /\.tmp-/.test(n)), [], 'temp file removed');
  });
});
