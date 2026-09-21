import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  acquireSharedDataLock,
  releaseSharedDataLock,
  withSharedDataLock,
  sharedDataLockPath,
  DEFAULT_STALE_AFTER_MS,
} from '../src/shared_data_lock.js';

// ---------------------------------------------------------------------
// shared_data_lock.js is what makes it safe for two states' brand
// processes (standalone.js, enricher.js) to read-modify-write the shared
// inventory/changes files concurrently once run-daily-crawl.mjs runs more
// than one state at a time. These tests cover the lock primitive itself in
// isolation; test/concurrency_race.test.js proves it actually prevents the
// real lost-update race end to end.
// ---------------------------------------------------------------------
describe('shared_data_lock', () => {
  let tmpDir;
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-shared-lock-'));
  });
  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sharedDataLockPath resolves under <cwd>/data/locks/<scope>.lock', () => {
    assert.equal(sharedDataLockPath('/some/root', 'NJ'), path.join('/some/root', 'data', 'locks', 'NJ.lock'));
    assert.equal(sharedDataLockPath('/some/root', 'daily-changes-2026-09-20'), path.join('/some/root', 'data', 'locks', 'daily-changes-2026-09-20.lock'));
  });

  it('sharedDataLockPath throws without a scope — no unscoped global lock exists anymore', () => {
    assert.throws(() => sharedDataLockPath('/some/root'), /scope/);
  });

  it('acquires a fresh lock when none exists, and release() removes it', async () => {
    const lockPath = path.join(tmpDir, 'fresh', 'shared_data.lock');
    const lock = await acquireSharedDataLock({ lockPath, pid: 111 });
    const written = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    assert.equal(written.pid, 111);
    assert.ok(written.startedAt);

    await lock.release();
    await assert.rejects(fs.access(lockPath));
  });

  it('a second acquire waits (does not immediately fail) while the first holder is alive, then succeeds once released', async () => {
    const lockPath = path.join(tmpDir, 'contended.lock');
    const first = await acquireSharedDataLock({ lockPath, pid: process.pid, label: 'first' });

    let secondAcquired = false;
    const secondPromise = acquireSharedDataLock({
      lockPath,
      pid: process.pid + 1,
      label: 'second',
      retryDelayMs: 10,
      maxWaitMs: 5000,
    }).then((lock) => {
      secondAcquired = true;
      return lock;
    });

    // Give the retry loop a couple of cycles to prove it's genuinely
    // waiting, not somehow acquiring immediately alongside the first.
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(secondAcquired, false, 'second acquire must not succeed while the first lock is still held');

    await first.release();
    const second = await secondPromise;
    assert.equal(secondAcquired, true);
    await second.release();
  });

  it('reclaims a lock left by a PID that is no longer alive', async () => {
    const lockPath = path.join(tmpDir, 'dead-pid.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    // 999999 should not correspond to a live process in this sandbox.
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));

    const lock = await acquireSharedDataLock({ lockPath, pid: process.pid, retryDelayMs: 10, maxWaitMs: 2000 });
    assert.ok(lock);
    await lock.release();
  });

  it('reclaims a lock that has outlived staleAfterMs even if its PID happens to still be alive', async () => {
    const lockPath = path.join(tmpDir, 'aged-out.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    // process.pid is definitely alive, but the timestamp is ancient.
    await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: '2000-01-01T00:00:00.000Z' }));

    const lock = await acquireSharedDataLock({
      lockPath,
      pid: process.pid + 1,
      staleAfterMs: 1000, // 1s — the fake lock above is decades old
      retryDelayMs: 10,
      maxWaitMs: 2000,
    });
    assert.ok(lock);
    await lock.release();
  });

  it('never reclaims a lock that is both alive and within staleAfterMs — real contention still waits', async () => {
    const lockPath = path.join(tmpDir, 'legit-hold.lock');
    const first = await acquireSharedDataLock({ lockPath, pid: process.pid, staleAfterMs: DEFAULT_STALE_AFTER_MS });

    await assert.rejects(
      acquireSharedDataLock({ lockPath, pid: process.pid + 1, maxWaitMs: 150, retryDelayMs: 20 }),
      /Timed out/,
    );

    await first.release();
  });

  it('throws a clear, actionable error (naming the current holder) when maxWaitMs is exceeded', async () => {
    const lockPath = path.join(tmpDir, 'timeout.lock');
    // Must be a genuinely alive pid (this test process itself) — a fake
    // pid here would make the holder look crashed and get reclaimed
    // instead of genuinely contended, which is a different test.
    const first = await acquireSharedDataLock({ lockPath, pid: process.pid, label: 'GA/Toyota' });

    await assert.rejects(
      acquireSharedDataLock({ lockPath, pid: process.pid + 1, label: 'TX/Toyota', maxWaitMs: 120, retryDelayMs: 20 }),
      (err) => {
        assert.match(err.message, /Timed out/);
        assert.match(err.message, /TX\/Toyota/);
        assert.match(err.message, new RegExp(`pid ${process.pid}\\b`));
        assert.match(err.message, /GA\/Toyota/);
        return true;
      },
    );

    await first.release();
  });

  it('releaseSharedDataLock is a no-op when there is nothing to release', async () => {
    await assert.doesNotReject(releaseSharedDataLock({ lockPath: path.join(tmpDir, 'never-created.lock'), pid: 1 }));
  });

  it('releaseSharedDataLock refuses to remove a lock that is no longer ours (a stale-reclaim already handed it to someone else)', async () => {
    const lockPath = path.join(tmpDir, 'not-mine.lock');
    await fs.writeFile(lockPath, JSON.stringify({ pid: 555, startedAt: new Date().toISOString() }));

    // Some other, unrelated pid holds it now — releasing as pid 111 (which
    // never actually held it) must leave the real holder's lock in place.
    await releaseSharedDataLock({ lockPath, pid: 111 });
    const stillThere = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    assert.equal(stillThere.pid, 555);
  });

  describe('withSharedDataLock', () => {
    it('releases the lock after fn() resolves', async () => {
      const lockPath = path.join(tmpDir, 'withlock-ok.lock');
      let ranInsideLock = false;
      await withSharedDataLock(async () => {
        ranInsideLock = true;
        await assert.rejects(
          fs.open(lockPath, 'wx').then((h) => h.close()),
          { code: 'EEXIST' },
        );
      }, { lockPath, pid: process.pid });
      assert.equal(ranInsideLock, true);
      await assert.rejects(fs.access(lockPath)); // released
    });

    it('still releases the lock when fn() throws, so one failed run never permanently blocks the file', async () => {
      const lockPath = path.join(tmpDir, 'withlock-throws.lock');
      await assert.rejects(
        withSharedDataLock(async () => {
          throw new Error('boom');
        }, { lockPath, pid: process.pid }),
        /boom/,
      );
      await assert.doesNotReject(
        withSharedDataLock(async () => 'fine', { lockPath, pid: process.pid + 1 }),
      );
    });
  });

  describe('scope-based resolution (no explicit lockPath)', () => {
    it('acquire/release via {scope, cwd} resolves to the same file sharedDataLockPath computes, and two different scopes never contend', async () => {
      const cwd = path.join(tmpDir, 'scoped-root');
      const njLock = await acquireSharedDataLock({ cwd, scope: 'NJ', pid: process.pid });
      assert.equal(njLock.lockPath, sharedDataLockPath(cwd, 'NJ'));

      // A different scope (GA) must succeed immediately, even while NJ's
      // lock is still held — this is the whole point of scoping: two
      // states' brand-runs no longer queue behind each other's lock.
      const gaLock = await acquireSharedDataLock({ cwd, scope: 'GA', pid: process.pid, maxWaitMs: 200 });
      assert.equal(gaLock.lockPath, sharedDataLockPath(cwd, 'GA'));

      await njLock.release();
      await gaLock.release();
      await assert.rejects(fs.access(njLock.lockPath));
      await assert.rejects(fs.access(gaLock.lockPath));
    });

    it('withSharedDataLock accepts {scope, cwd} the same way standalone.js/enricher.js call it', async () => {
      const cwd = path.join(tmpDir, 'scoped-root-2');
      let ran = false;
      await withSharedDataLock(async () => { ran = true; }, { cwd, scope: 'TX', pid: process.pid });
      assert.equal(ran, true);
      await assert.rejects(fs.access(sharedDataLockPath(cwd, 'TX'))); // released
    });
  });
});
