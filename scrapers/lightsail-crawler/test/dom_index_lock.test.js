// The dom-index merge lock is a kernel flock held by the merge worker process (dom_index_delta.js). Real processes only. The deterministic scenario that broke the
// token-file protocol (scripts/dom-index-lock-takeover-demo.mjs: a contender renames a live holder's lock aside, a third process takes the empty path, the displaced
// holder commits over it) is replayed here against the flock: nobody can take the lock from a live holder, so two mergers can never commit at once.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { saveDomIndex, loadDomIndex, domPaths } from '../src/dom_store.js';
import { domMergeLockPath, flockPrefix, domDeltaDir } from '../src/dom_index_delta.js';

const DELTA = new URL('../src/dom_index_delta.js', import.meta.url).href;
let cwd, pauseDir, kids;
beforeEach(async () => { cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'domflock-')); pauseDir = path.join(cwd, 'pause'); fs.mkdirSync(pauseDir); kids = []; });
// NEVER signal a pid that is not a plain child pid: kill(0, sig) signals the caller's whole process group (the npm/tsx runner and every parallel test file with it) and
// kill(-n, sig) a group; an empty or half-written pid file parses to 0. This is what froze whole CI runs in state T for 40+ minutes.
const signal = (pid, sig) => { if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) throw new Error(`refusing to send ${sig} to pid ${pid}`); process.kill(pid, sig); };
afterEach(async () => {
  for (const k of kids) { try { signal(k.pid, 'SIGCONT'); k.kill('SIGKILL'); } catch { /* gone */ } }
  for (const f of fs.existsSync(pauseDir) ? fs.readdirSync(pauseDir).filter((n) => n.endsWith('.reached')) : []) { try { signal(readPid(path.join(pauseDir, f)), 'SIGKILL'); } catch { /* gone */ } }
  await Promise.all(kids.map((k) => new Promise((r) => (k.exitCode !== null || k.signalCode ? r() : k.on('exit', r)))));
  await fsp.rm(cwd, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (file, ms = 20000) => { for (let i = 0; i < ms && !fs.existsSync(file); i++) await sleep(1); assert.ok(fs.existsSync(file), `timed out waiting for ${path.basename(file)}`); };
const go = (point) => fs.writeFileSync(path.join(pauseDir, `${point}.go`), '1');
// The worker (pauseAt in dom_index_delta.js) publishes its pid with fs.writeFile, which makes the file EXISTS-but-EMPTY for a moment before the pid is written. Reading in that
// window gave Number('') === 0, and kill(0, 'SIGSTOP') then stopped the whole process group: the CI runner, tsx and every parallel test file (all in state T, 40+ min). So wait for a real pid.
const readPid = (file) => { try { const t = fs.readFileSync(file, 'utf8').trim(); return /^\d+$/.test(t) && Number(t) > 1 ? Number(t) : null; } catch { return null; } };
const awaitPid = async (file, ms = 20000) => { for (let i = 0; i < ms; i++) { const pid = readPid(file); if (pid) return pid; await sleep(1); } assert.fail(`${path.basename(file)} never held a valid pid`); };
const reachedPid = (point) => awaitPid(path.join(pauseDir, `${point}.reached`));
const rec = (id) => ({ hash: `h${id}`, price: 100, oldPrice: null, priceDiff: 0, priceChangeType: 'NEW', blobStored: true, hashUnchanged: false });

// One "crawler process": writes a delta with the record REC<id> and merges it. env DOM_INDEX_MERGE_PAUSE_DIR (set only for the one we want to freeze) pauses ITS worker.
const MERGER = `
  import { createDomDelta, mergeDomDelta } from ${JSON.stringify(DELTA)};
  import fs from 'node:fs';
  const [cwd, id, maxWait, barrier, launcherJson] = process.argv.slice(1);
  while (barrier !== '-' && !fs.existsSync(barrier)) await new Promise((r) => setTimeout(r, 1));
  const d = createDomDelta({ cwd, label: 'merger-' + id });
  d.note({ ['REC' + id]: { '2026-11-06': { hash: 'h' + id, price: 100, priceChangeType: 'NEW', blobStored: true } } }, 'REC' + id, '2026-11-06');
  try { const r = await mergeDomDelta(d, { cwd, log() {}, maxWaitMs: Number(maxWait), launcher: launcherJson === '-' ? {} : JSON.parse(launcherJson) }); console.log(JSON.stringify({ ok: true, r })); }
  catch (e) { console.log(JSON.stringify({ ok: false, msg: e.message })); }`;
const merger = (id, { maxWait = 15000, pause = false, barrier = '-', launcher } = {}) => {
  const c = spawn(process.execPath, ['--input-type=module', '-e', MERGER, cwd, id, String(maxWait), barrier, launcher ? JSON.stringify(launcher) : '-'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(pause ? { DOM_INDEX_MERGE_PAUSE_DIR: pauseDir, DOM_INDEX_MERGE_PAUSE_POINTS: 'beforeCommit' } : {}) },
  });
  c.out = ''; c.err = ''; c.stdout.on('data', (b) => { c.out += b; }); c.stderr.on('data', (b) => { c.err += b; });
  c.done = new Promise((r) => c.on('exit', (code, signal) => r({ code, signal }))); kids.push(c);
  c.result = async () => { await c.done; const line = c.out.trim().split('\n').filter(Boolean).pop(); return line ? JSON.parse(line) : { ok: false, msg: `no output: ${c.err.slice(-200)}` }; };
  return c;
};
const seed = () => saveDomIndex({ BASE: { '2026-11-01': rec('BASE') } }, cwd);
const indexBytes = () => fsp.readFile(domPaths(cwd).indexPath);
const holdsKeys = async (...keys) => { const idx = await loadDomIndex(cwd); for (const k of keys) assert.ok(idx[k], `${k} missing from the index`); return idx; };
const tmpFiles = async () => (await fsp.readdir(domPaths(cwd).dataDir)).filter((n) => /\.tmp-/.test(n));

describe('the takeover scenario that broke the token protocol, against the flock', () => {
  it('holder frozen after streaming and before the index rename; a stale-lock contender and a third contender cannot get in; nobody commits twice; nothing is lost', async () => {
    await seed();
    const before = await indexBytes();
    fs.mkdirSync(path.dirname(domMergeLockPath(cwd)), { recursive: true });
    fs.writeFileSync(domMergeLockPath(cwd), ''); const old = new Date(Date.now() - 30 * 864e5); fs.utimesSync(domMergeLockPath(cwd), old, old); // an artificially old lock file
    const H = merger('H', { pause: true });                              // the live holder
    await waitFor(path.join(pauseDir, 'beforeCommit.reached'));            // its worker holds the flock, merge streamed + verified + conflicts durable, about to rename
    const C1 = merger('C1', { maxWait: 1500 });                            // plays the stale-lock contender
    const C3 = merger('C3', { maxWait: 1500 });                            // plays the third contender
    const r1 = await C1.result(); const r3 = await C3.result();
    assert.equal(r1.ok, false); assert.match(r1.msg, /Timed out.*merge lock/);
    assert.equal(r3.ok, false); assert.match(r3.msg, /Timed out.*merge lock/);
    assert.ok(before.equals(await indexBytes()), 'nobody may have committed while the holder is inside its section');
    assert.equal((await tmpFiles()).length, 1, 'only the holder\'s merge temp file exists');
    go('beforeCommit');                                                    // the holder resumes and commits
    const rH = await H.result(); assert.equal(rH.ok, true, JSON.stringify(rH));
    // the two contenders try again (their deltas are still on disk, or they write them again) and go through one after the other
    const C1b = merger('C1', { maxWait: 20000 }); const r1b = await C1b.result();
    const C3b = merger('C3', { maxWait: 20000 }); const r3b = await C3b.result();
    assert.equal(r1b.ok, true, JSON.stringify(r1b)); assert.equal(r3b.ok, true, JSON.stringify(r3b));
    await holdsKeys('BASE', 'RECH', 'RECC1', 'RECC3');
    // critical sections are disjoint in time
    const spans = [rH.r, r1b.r, r3b.r].map((x) => [x.lockedAtMs, x.doneAtMs]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], `merge sections overlap: ${JSON.stringify(spans)}`);
    assert.deepEqual(await tmpFiles(), []);
    assert.deepEqual(fs.readdirSync(domDeltaDir(cwd)).filter((n) => /^(delta|claimed)-/.test(n)), []);
  });

  it('a holder stopped with SIGSTOP right before its rename keeps the lock (no age, no identity judgement can move it); contenders time out; after SIGCONT it commits', async () => {
    await seed();
    const H = merger('H', { pause: true });
    await waitFor(path.join(pauseDir, 'beforeCommit.reached'));
    const worker = await reachedPid('beforeCommit');
    signal(worker, 'SIGSTOP');
    const r = await merger('C3', { maxWait: 1500 }).result();
    assert.equal(r.ok, false); assert.match(r.msg, /Timed out/);
    signal(worker, 'SIGCONT'); go('beforeCommit');
    assert.equal((await H.result()).ok, true);
    await holdsKeys('BASE', 'RECH');
  });

  it('the holder\'s worker is killed (SIGKILL) at the same point: the kernel frees the lock at once, the index is untouched, and the next merger also merges the dead one\'s delta', async () => {
    await seed();
    const before = await indexBytes();
    const H = merger('H', { pause: true });
    await waitFor(path.join(pauseDir, 'beforeCommit.reached'));
    signal(await reachedPid('beforeCommit'), 'SIGKILL');
    const rH = await H.result();                                   // its crawler process sees the worker die and gives up; its delta file stays on disk
    assert.equal(rH.ok, false); assert.match(rH.msg, /ended without a result/);
    assert.ok(before.equals(await indexBytes()));
    const t0 = Date.now();
    const rC = await merger('C3', { maxWait: 5000 }).result();      // lock free immediately; H's crawler is gone, so its delta is an orphan
    assert.equal(rC.ok, true, JSON.stringify(rC)); assert.ok(Date.now() - t0 < 4000);
    assert.equal(rC.r.orphanFiles, 1);
    await holdsKeys('BASE', 'RECH', 'RECC3');
  });

  it('the CRAWLER (parent) is killed while its worker holds the lock: the worker finishes the merge by itself and releases the lock', async () => {
    await seed();
    const H = merger('H', { pause: true });
    await waitFor(path.join(pauseDir, 'beforeCommit.reached'));
    const worker = await reachedPid('beforeCommit');
    H.kill('SIGKILL'); await H.done;
    go('beforeCommit');
    for (let i = 0; i < 5000 && (() => { try { process.kill(worker, 0); return true; } catch { return false; } })(); i++) await sleep(5);
    await holdsKeys('BASE', 'RECH');
    assert.deepEqual(fs.readdirSync(domDeltaDir(cwd)).filter((n) => /^(delta|claimed)-/.test(n)), []);
    assert.equal((await merger('C3', { maxWait: 5000 }).result()).ok, true);
  });
});

describe('simultaneous mergers', () => {
  it('8 real processes merging at the same instant: all succeed, every record is in the index, critical sections never overlap, no leftovers', async () => {
    await seed();
    const barrier = path.join(cwd, 'go');
    const procs = Array.from({ length: 8 }, (_, i) => merger(`P${i}`, { barrier, maxWait: 60000 }));
    await sleep(400); fs.writeFileSync(barrier, '1');
    const rs = [];
    for (const p of procs) rs.push(await p.result());
    rs.forEach((r) => assert.equal(r.ok, true, JSON.stringify(r)));
    await holdsKeys('BASE', ...Array.from({ length: 8 }, (_, i) => `RECP${i}`));
    const spans = rs.map((x) => [x.r.lockedAtMs, x.r.doneAtMs]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], `merge sections overlap: ${JSON.stringify(spans)}`);
    assert.deepEqual(await tmpFiles(), []);
  });

  it('the lock file is never removed or replaced by merges (same inode before and after)', async () => {
    await seed();
    assert.equal((await merger('A').result()).ok, true);
    const ino = fs.statSync(domMergeLockPath(cwd)).ino;
    assert.equal((await merger('B').result()).ok, true);
    assert.equal(fs.statSync(domMergeLockPath(cwd)).ino, ino);
  });
});

describe('both launchers take the same kernel lock', () => {
  const hasFlock = flockPrefix('/tmp/x', 1)?.[0] === 'flock';
  it('python3 fcntl launcher: merges work, and a holder started by flock(1) (when present) excludes a contender using the python launcher', async () => {
    await seed();
    const py = { flockBin: '/nonexistent/flock' };
    assert.equal((await merger('PY1', { launcher: py }).result()).ok, true);
    if (!hasFlock) return;
    const prefix = flockPrefix(domMergeLockPath(cwd), 5);
    const holder = spawn(prefix[0], [...prefix.slice(1), 'sleep', '30'], { stdio: 'ignore' }); kids.push(holder);
    await sleep(500);
    const r = await merger('PY2', { launcher: py, maxWait: 1200 }).result();
    assert.equal(r.ok, false); assert.match(r.msg, /Timed out/);
    holder.kill('SIGKILL'); await new Promise((x) => holder.on('exit', x));
    assert.equal((await merger('PY3', { launcher: py, maxWait: 5000 }).result()).ok, true);
    await holdsKeys('BASE', 'RECPY1', 'RECPY3');
  });
});

describe('the pause scaffolding can never hand a test a bad pid (regression: CI hung 40+ min with every process in state T)', () => {
  it('reachedPid waits through the window where .reached exists but is still empty or half-written', async () => {
    const f = path.join(pauseDir, 'beforeCommit.reached');
    fs.writeFileSync(f, '');                                              // what a reader sees between the worker's open(O_TRUNC) and its write
    setTimeout(() => fs.writeFileSync(f, String(process.pid)), 60);
    assert.equal(readPid(f), null);
    assert.equal(await reachedPid('beforeCommit'), process.pid);
    for (const bad of ['', ' ', '0', '-5', '1', 'abc', '12x']) { fs.writeFileSync(f, bad); assert.equal(readPid(f), null, JSON.stringify(bad)); }
  });
  it('the signalling helper refuses pid 0, negative pids, NaN, null, 1 and its own pid (each would hit a whole group or the runner)', () => {
    for (const bad of [0, -1, -12345, NaN, null, undefined, 1, process.pid, 1.5]) assert.throws(() => signal(bad, 'SIGCONT'), /refusing to send/);
  });
});
