// Root cause fixed 2026-09-30: box4's sync checked only driver.lock and missed its separate
// core crawl's driver-core.lock entirely, syncing against a not-yet-finished crawl. These cover
// the exact scenarios the fix requires: a live crawl (by lock OR by bare process) blocks the
// sync; a genuinely idle box does not.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCrawlGate } from '../src/syncCrawlGate.js';

describe('evaluateCrawlGate', () => {
  it('lock clear (no entries) + crawl process alive: sync does not start', () => {
    const { busy, reason } = evaluateCrawlGate({
      lockEntries: [],
      crawlProcessPid: 27873,
      isPidAlive: (pid) => pid === 27873,
    });
    assert.equal(busy, true);
    assert.match(reason, /27873/);
  });

  it('lock clear + no crawl process: sync may start', () => {
    const { busy, reason } = evaluateCrawlGate({
      lockEntries: [],
      crawlProcessPid: null,
      isPidAlive: () => false,
    });
    assert.equal(busy, false);
    assert.equal(reason, null);
  });

  it("today's actual bug, generalized: driver.lock clear but driver-core.lock's pid is alive", () => {
    const { busy, reason } = evaluateCrawlGate({
      lockEntries: [
        { name: 'driver-core.lock', pid: 27873 },
      ],
      crawlProcessPid: null,
      isPidAlive: (pid) => pid === 27873,
    });
    assert.equal(busy, true);
    assert.match(reason, /driver-core\.lock/);
    assert.match(reason, /27873/);
  });

  it('a stale lock (pid no longer alive) does not block the sync', () => {
    const { busy } = evaluateCrawlGate({
      lockEntries: [{ name: 'driver.lock', pid: 11111 }],
      crawlProcessPid: null,
      isPidAlive: () => false,
    });
    assert.equal(busy, false);
  });

  it('multiple lock files: only the one with a live pid blocks, others are ignored', () => {
    const { busy, reason } = evaluateCrawlGate({
      lockEntries: [
        { name: 'driver.lock', pid: 1 },
        { name: 'driver-core.lock', pid: 2 },
      ],
      crawlProcessPid: null,
      isPidAlive: (pid) => pid === 2,
    });
    assert.equal(busy, true);
    assert.match(reason, /driver-core\.lock/);
  });

  it('a lock file with no recorded pid (corrupt/empty) is skipped, not treated as busy', () => {
    const { busy } = evaluateCrawlGate({
      lockEntries: [{ name: 'driver.lock', pid: null }],
      crawlProcessPid: null,
      isPidAlive: () => true,
    });
    assert.equal(busy, false);
  });

  it('both a live lock and a live bare process: reports the lock first', () => {
    const { busy, reason } = evaluateCrawlGate({
      lockEntries: [{ name: 'driver.lock', pid: 5 }],
      crawlProcessPid: 6,
      isPidAlive: () => true,
    });
    assert.equal(busy, true);
    assert.match(reason, /driver\.lock/);
  });
});
