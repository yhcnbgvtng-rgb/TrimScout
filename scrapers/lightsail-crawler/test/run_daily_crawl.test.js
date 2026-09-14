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
  LOG_RETENTION_DAYS,
} from '../scripts/run-daily-crawl.mjs';

describe('run-daily-crawl driver', () => {
  it('slugify matches the brand-file slugs already on disk (e.g. Mercedes-Benz -> mercedes-benz)', () => {
    assert.equal(slugify('Mercedes-Benz'), 'mercedes-benz');
    assert.equal(slugify('Toyota'), 'toyota');
    assert.equal(slugify('Volkswagen'), 'volkswagen');
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
});
