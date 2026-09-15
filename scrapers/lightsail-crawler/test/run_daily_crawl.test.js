import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  slugify,
  pruneOldLogs,
  runStep,
  computeGrandTotals,
  acquireLock,
  releaseLock,
  LOG_RETENTION_DAYS,
  STATES,
  WRITE_DEALER_SCRIPTS,
} from '../scripts/run-daily-crawl.mjs';
import { SUPPORTED_STATES } from '../src/states.js';

describe('run-daily-crawl driver', () => {
  it('slugify matches the brand-file slugs already on disk (e.g. Mercedes-Benz -> mercedes-benz)', () => {
    assert.equal(slugify('Mercedes-Benz'), 'mercedes-benz');
    assert.equal(slugify('Toyota'), 'toyota');
    assert.equal(slugify('Volkswagen'), 'volkswagen');
  });

  it('runs every state in src/states.js (NJ, NY, FL, GA, then TX) with no hardcoded state list left behind', () => {
    assert.deepEqual(STATES, SUPPORTED_STATES);
    assert.deepEqual(STATES, ['NJ', 'NY', 'FL', 'GA', 'TX']);
    // Every state the driver loops over must have a write-dealers script
    // registered, or runState() throws instead of silently skipping it.
    for (const state of STATES) {
      assert.ok(WRITE_DEALER_SCRIPTS[state], `no write-dealers script registered for ${state}`);
    }
    assert.equal(WRITE_DEALER_SCRIPTS.FL, 'write-fl-dealer-files.mjs');
    assert.equal(WRITE_DEALER_SCRIPTS.GA, 'write-ga-dealer-files.mjs');
    assert.equal(WRITE_DEALER_SCRIPTS.TX, 'write-tx-dealer-files.mjs');
  });

  describe('pruneOldLogs (log retention)', () => {
    let tmpDir;
    before(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-log-retention-'));
    });
    after(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('deletes only *.log files older than the retention window, leaving recent ones and non-log files alone', async () => {
      const now = Date.now();
      const oldLog = path.join(tmpDir, 'nj-toyota-2026-01-01.log');
      const recentLog = path.join(tmpDir, 'nj-toyota-2026-09-14.log');
      const nonLog = path.join(tmpDir, 'notes.txt');

      await fs.writeFile(oldLog, 'old');
      await fs.writeFile(recentLog, 'recent');
      await fs.writeFile(nonLog, 'not a log');

      // Back-date the "old" log beyond the retention window.
      const oldTime = (now - (LOG_RETENTION_DAYS + 5) * 24 * 60 * 60 * 1000) / 1000;
      await fs.utimes(oldLog, oldTime, oldTime);

      const result = await pruneOldLogs({ logsDir: tmpDir, retentionDays: LOG_RETENTION_DAYS, now });
      assert.equal(result.removed, 1);

      const remaining = await fs.readdir(tmpDir);
      assert.ok(!remaining.includes('nj-toyota-2026-01-01.log'));
      assert.ok(remaining.includes('nj-toyota-2026-09-14.log'));
      assert.ok(remaining.includes('notes.txt')); // never touches non-.log files
    });

    it('is a no-op (not an error) when the logs directory does not exist yet', async () => {
      const result = await pruneOldLogs({ logsDir: path.join(tmpDir, 'does-not-exist'), retentionDays: 30 });
      assert.equal(result.removed, 0);
    });
  });

  describe('runStep (one brand/support-step subprocess)', () => {
    let tmpDir;
    before(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-runstep-'));
    });
    after(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('captures a successful exit code and streams stdout+stderr into the log file', async () => {
      const logFile = path.join(tmpDir, 'ok.log');
      const result = await runStep(
        process.execPath,
        ['-e', 'console.log("hello stdout"); console.error("hello stderr");'],
        { cwd: tmpDir, logFile },
      );
      assert.equal(result.exitCode, 0);
      assert.equal(result.timedOut, false);
      const logged = await fs.readFile(logFile, 'utf-8');
      assert.match(logged, /hello stdout/);
      assert.match(logged, /hello stderr/);
    });

    it('captures a non-zero exit code without throwing (one bad brand must not kill the driver)', async () => {
      const logFile = path.join(tmpDir, 'fail.log');
      const result = await runStep(process.execPath, ['-e', 'process.exit(7)'], { cwd: tmpDir, logFile });
      assert.equal(result.exitCode, 7);
      assert.equal(result.timedOut, false);
    });

    it('kills a hanging process once timeoutMs elapses and reports timedOut instead of hanging the driver forever', async () => {
      const logFile = path.join(tmpDir, 'hang.log');
      const result = await runStep(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 60000)'], // would hang for a minute otherwise
        { cwd: tmpDir, logFile, timeoutMs: 200 },
      );
      assert.equal(result.timedOut, true);
      assert.notEqual(result.exitCode, 0);
    });
  });

  describe('computeGrandTotals', () => {
    it('sums stats across ok brands and counts ok/failed/skipped separately, ignoring skipped stats', () => {
      const states = {
        NJ: {
          brands: {
            Toyota: { status: 'ok', stats: { totalActiveInventory: 100, totalNewArrivals: 5, totalPriceDrops: 2, totalPriceIncreases: 1, totalSoldOrRemoved: 3, skippedForBotProtection: 1 } },
            Honda: { status: 'timeout', stats: null },
            Kia: { status: 'skipped', reason: 'no dealers' },
          },
        },
        NY: {
          brands: {
            Toyota: { status: 'ok', stats: { totalActiveInventory: 200, totalNewArrivals: 10, totalPriceDrops: 4, totalPriceIncreases: 2, totalSoldOrRemoved: 6, skippedForBotProtection: 2 } },
          },
        },
      };
      const totals = computeGrandTotals(states);
      assert.equal(totals.totalActiveInventory, 300);
      assert.equal(totals.totalNewArrivals, 15);
      assert.equal(totals.brandsOk, 2);
      assert.equal(totals.brandsFailed, 1);
      assert.equal(totals.brandsSkipped, 1);
    });
  });

  // ---------------------------------------------------------------------
  // Overlap guard: root cause this fixes — the installed cron fired at its
  // scheduled time while a manually-started run of this same driver was
  // still mid-crawl, and with no guard both processes ran concurrently
  // against the same shared files (national_inventory_latest.json,
  // data/daily_changes/, bot-report outputs) until a human noticed and
  // killed the duplicate.
  // ---------------------------------------------------------------------
  describe('acquireLock / releaseLock (overlap guard)', () => {
    let tmpDir;
    before(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-lock-'));
    });
    after(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('acquires a fresh lock when none exists', async () => {
      const lockPath = path.join(tmpDir, 'fresh', 'driver.lock');
      const result = await acquireLock({ lockPath, pid: 111 });
      assert.equal(result.acquired, true);
      assert.equal(result.reclaimedStale, false);
      const written = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
      assert.equal(written.pid, 111);
      assert.ok(written.startedAt);
    });

    it('refuses to acquire while a lock held by a still-alive PID exists (the overlapping-cron scenario)', async () => {
      const lockPath = path.join(tmpDir, 'held.lock');
      // process.pid (this test process) is guaranteed to be alive.
      const first = await acquireLock({ lockPath, pid: process.pid });
      assert.equal(first.acquired, true);

      const second = await acquireLock({ lockPath, pid: process.pid + 1 });
      assert.equal(second.acquired, false);
      assert.equal(second.existingPid, process.pid);
      assert.match(second.reason, /still active/);

      await releaseLock({ lockPath });
    });

    it('reclaims a stale lock left by a PID that is no longer running', async () => {
      const lockPath = path.join(tmpDir, 'stale.lock');
      // PID 999999 should not correspond to a live process in this sandbox.
      await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: '2020-01-01T00:00:00.000Z' }));

      const result = await acquireLock({ lockPath, pid: process.pid });
      assert.equal(result.acquired, true);
      assert.equal(result.reclaimedStale, true);
    });

    it('releaseLock is a no-op (never throws) when there is nothing to release', async () => {
      const lockPath = path.join(tmpDir, 'never-created.lock');
      await assert.doesNotReject(releaseLock({ lockPath }));
    });

    it('releaseLock actually removes the lock file so a later run can acquire it', async () => {
      const lockPath = path.join(tmpDir, 'roundtrip.lock');
      await acquireLock({ lockPath, pid: process.pid });
      await releaseLock({ lockPath });
      await assert.rejects(fs.access(lockPath));

      const again = await acquireLock({ lockPath, pid: process.pid });
      assert.equal(again.acquired, true);
      await releaseLock({ lockPath });
    });
  });
});
