// Evidence script (not part of npm test): what src/shared_data_lock.js (the lock the first #721 build used for the dom-index merge) actually does when
//   (1) its holder is alive but the lock is older than staleAfterMs      -> is a LIVE holder's lock taken?
//   (2) its holder is dead but the pid number is now a live process      -> how long does it stall?
//   (3) a former holder releases late, after a replacement took over     -> can the replacement's lock be deleted?
// Uses real processes and a temp directory only. staleAfterMs is shortened (2 s) instead of waiting the default 10 minutes; the rule is the same, only the number differs.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireSharedDataLock, sharedDataLockPath, releaseSharedDataLock } from '../src/shared_data_lock.js';

const LOCK = pathToFileURL(fileURLToPath(new URL('../src/shared_data_lock.js', import.meta.url))).href;
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'lockprobe-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockPath = sharedDataLockPath(cwd, 'probe');
try {
  // (1) live holder, lock older than the stale limit
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireSharedDataLock } from ${JSON.stringify(LOCK)};
    await acquireSharedDataLock({ cwd: ${JSON.stringify(cwd)}, scope: 'probe', label: 'live holder' });
    console.log('HOLDING'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => holder.stdout.on('data', (b) => String(b).includes('HOLDING') && r()));
  await sleep(2500);
  const t0 = Date.now();
  const stolen = await acquireSharedDataLock({ cwd, scope: 'probe', label: 'contender', staleAfterMs: 2000, maxWaitMs: 5000, retryDelayMs: 50 }).then(() => true, () => false);
  console.log(`(1) holder pid ${holder.pid} is ALIVE, lock ${((Date.now() - t0) / 1000 + 2.5).toFixed(1)} s old (limit 2 s): contender ${stolen ? 'TOOK THE LOCK (live holder still believes it holds it: two holders)' : 'did not take it'}`);
  holder.kill('SIGKILL'); await sleep(100); await fs.rm(lockPath, { force: true });

  // (2) dead owner, pid reused by a live process
  const squatter = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify({ pid: squatter.pid, label: 'dead merger (pid since reused)', startedAt: new Date().toISOString() }));
  const t1 = Date.now();
  const got = await acquireSharedDataLock({ cwd, scope: 'probe', label: 'contender', maxWaitMs: 4000, retryDelayMs: 50 }).then(() => true, (e) => false);
  console.log(`(2) owner is dead but its pid ${squatter.pid} is a live process: contender ${got ? 'acquired' : `gave up after ${((Date.now() - t1) / 1000).toFixed(1)} s without the lock`}; with the default limit it waits up to 10 minutes (and a contender's maxWait is 5 minutes by default, so it throws first)`);
  squatter.kill('SIGKILL'); await fs.rm(lockPath, { force: true });

  // (3) delayed release by a former holder (same pid, e.g. a process that takes the lock twice)
  const first = await acquireSharedDataLock({ cwd, scope: 'probe', label: 'first holder' });
  await fs.rm(lockPath); // the first holder's lock is taken from it (stale rule, admin, ...)
  const second = await acquireSharedDataLock({ cwd, scope: 'probe', label: 'replacement holder' });
  await first.release(); // delayed cleanup by the former holder
  const survived = await fs.stat(lockPath).then(() => true, () => false);
  console.log(`(3) former holder's delayed release with the same pid: replacement's lock ${survived ? 'survived' : 'WAS DELETED (release checks the pid only, no token)'}`);
  await second.release();
  console.log('code: reclaimIfStale() reads the lock, decides it is stale, then removes the PATH; between the read and the rm another process can reclaim and take a fresh lock, and the rm deletes that fresh one. releaseSharedDataLock() has the same read-then-rm shape.');
} finally { await fs.rm(cwd, { recursive: true, force: true }); }
process.exit(0);
