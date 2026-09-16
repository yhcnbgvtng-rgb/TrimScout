import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { mergeInventorySnapshot } from '../src/inventory_merge.js';
import { withSharedDataLock, sharedDataLockPath } from '../src/shared_data_lock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'simulate_state_write.mjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// This is the single most important test in this whole change.
//
// The bug this proves fixed: run-daily-crawl.mjs used to run one state's
// entire brand loop to completion before starting the next, so no two
// brand processes' read-modify-write of data/snapshots/latest_snapshot.json
// (or the other shared files) ever overlapped. Once the driver runs
// MAX_CONCURRENT_STATES states at once, two brand processes CAN read the
// same file, each compute their own individually-correct update, and then
// write back — whichever write lands second silently discards everything
// the first one added. Both halves below use the real production
// mergeInventorySnapshot() and shared_data_lock.js, not a reimplementation,
// against a real file on disk with a real forced interleaving window (an
// injected sleep between the read and the write) — not a hope that two
// Promise.all branches happen to interleave.
// ---------------------------------------------------------------------
describe('concurrency race: two states writing the shared inventory snapshot at once', () => {
  let tmpDir;
  let snapshotPath;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-race-'));
    await fs.mkdir(path.join(tmpDir, 'data', 'snapshots'), { recursive: true });
    snapshotPath = path.join(tmpDir, 'data', 'snapshots', 'latest_snapshot.json');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Mirrors standalone.js's own locked section exactly: read the shared
  // snapshot fresh, (simulate the real gap where crawling/enrichment would
  // happen) wait, merge this run's own dealer's vehicle in via the real
  // production merge function, write back. `useLock` toggles only whether
  // that whole sequence is wrapped in withSharedDataLock — everything else
  // about the two cases is identical, so a difference in outcome can only
  // come from the lock.
  async function simulateStateRun({ vin, dealerName, delayMs, useLock, lockOpts }) {
    async function doWork() {
      let previousSnapshot = {};
      try {
        previousSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
      } catch {
        previousSnapshot = {};
      }

      await sleep(delayMs); // the forced interleaving window

      const { updatedSnapshot } = mergeInventorySnapshot({
        previousSnapshot,
        currentInventory: new Map([[vin, { vin, configDealerName: dealerName, price: 10000 }]]),
        dealers: [{ name: dealerName }],
        failedDealerNames: new Set(),
        todayDate: '2026-09-15',
        todayIso: '2026-09-15T00:00:00.000Z',
        toPriceChangeType: (t) => t,
      });

      await fs.writeFile(snapshotPath, JSON.stringify(updatedSnapshot, null, 2));
    }

    if (useLock) {
      await withSharedDataLock(doWork, lockOpts);
    } else {
      await doWork();
    }
  }

  it('CONTROL (no lock): proves this scenario genuinely provokes a lost update, not a coincidence', async () => {
    await fs.writeFile(snapshotPath, JSON.stringify({}));

    // Longer delay for NJ, shorter for GA — GA's read (of the still-empty
    // file), sleep, and write all complete while NJ is still sleeping
    // between its own read and write, so NJ's eventual write is based on
    // a previousSnapshot that predates GA's write and clobbers it.
    await Promise.all([
      simulateStateRun({ vin: 'NJ_TOYOTA_1', dealerName: 'NJ Toyota', delayMs: 80, useLock: false }),
      simulateStateRun({ vin: 'GA_TOYOTA_1', dealerName: 'GA Toyota', delayMs: 10, useLock: false }),
    ]);

    const final = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    const hasBoth = Boolean(final.NJ_TOYOTA_1) && Boolean(final.GA_TOYOTA_1);
    // This assertion is the whole point of the control: without the lock,
    // GA's contribution really is lost. If this ever starts failing (i.e.
    // both start showing up unlocked), the interleaving below has stopped
    // being a genuine race and the real test that follows would no longer
    // be proving anything — so this must keep failing^Wpassing as "lost".
    assert.equal(hasBoth, false, 'expected the unlocked run to lose one state\'s update (that is the bug being fixed)');
    // And specifically: NJ (the slower writer) wins, GA is the one erased —
    // the exact "whichever write lands last wins" shape described in the
    // task, not merely "something is different."
    assert.equal(Boolean(final.NJ_TOYOTA_1), true);
    assert.equal(Boolean(final.GA_TOYOTA_1), false);
  });

  it('FIX (with the lock): the same interleaving preserves BOTH states\' updates', async () => {
    await fs.writeFile(snapshotPath, JSON.stringify({}));
    const lockPath = path.join(tmpDir, 'data', 'shared_data.lock');

    // pid intentionally uses the real process.pid for every simulated
    // "state" here — they genuinely are the same OS process in this
    // in-process test, and the stale-reclaim check does a real
    // process.kill(pid, 0) liveness probe. A made-up pid number would very
    // likely not correspond to any live process on the test machine, so
    // a waiting contender's stale check would wrongly conclude the real,
    // still-running holder had crashed and reclaim its lock mid-hold —
    // corrupting this exact test, not the production code (which always
    // passes its own real process.pid). The real-child-process describe
    // block below exercises genuinely distinct OS pids for real.
    await Promise.all([
      simulateStateRun({
        vin: 'NJ_TOYOTA_2', dealerName: 'NJ Toyota', delayMs: 80, useLock: true,
        lockOpts: { lockPath, pid: process.pid, label: 'NJ/Toyota', retryDelayMs: 15, maxWaitMs: 5000 },
      }),
      simulateStateRun({
        vin: 'GA_TOYOTA_2', dealerName: 'GA Toyota', delayMs: 10, useLock: true,
        lockOpts: { lockPath, pid: process.pid, label: 'GA/Toyota', retryDelayMs: 15, maxWaitMs: 5000 },
      }),
    ]);

    const final = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    assert.equal(final.NJ_TOYOTA_2.status, 'ACTIVE');
    assert.equal(final.GA_TOYOTA_2.status, 'ACTIVE');
    assert.equal(final.NJ_TOYOTA_2.configDealerName, 'NJ Toyota');
    assert.equal(final.GA_TOYOTA_2.configDealerName, 'GA Toyota');
  });

  it('three states in a row, each still running its own "brand loop" with brief internal delays, all survive together (closer to the real multi-brand-per-state shape)', async () => {
    await fs.writeFile(snapshotPath, JSON.stringify({}));
    const lockPath = path.join(tmpDir, 'data', 'shared_data.lock');
    const states = [
      { vin: 'FL_1', dealerName: 'FL Dealer', delayMs: 60 },
      { vin: 'GA_1', dealerName: 'GA Dealer', delayMs: 15 },
      { vin: 'TX_1', dealerName: 'TX Dealer', delayMs: 40 },
    ];
    // Real process.pid for all three — see the comment on the previous
    // test for why a fabricated pid would wrongly trigger a stale-reclaim
    // of a still-running (same real-process) holder.
    await Promise.all(states.map((s) => simulateStateRun({
      vin: s.vin,
      dealerName: s.dealerName,
      delayMs: s.delayMs,
      useLock: true,
      lockOpts: { lockPath, pid: process.pid, label: s.dealerName, retryDelayMs: 10, maxWaitMs: 5000 },
    })));

    const final = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    for (const s of states) {
      assert.equal(final[s.vin]?.status, 'ACTIVE', `${s.vin} should have survived all three concurrent writers`);
    }
  });
});

// ---------------------------------------------------------------------
// Same race, proven again across REAL, separate OS processes (not just
// concurrent async functions inside one Node process) — spawned the same
// way run-daily-crawl.mjs's runStep() actually spawns each brand's real
// standalone.js. node:test itself only gives true concurrency at the
// async/event-loop level within one process; this closes the gap by
// exercising the real atomic-file-create lock primitive against genuine
// concurrent processes, which is the actual production scenario (two
// separate `node src/standalone.js` invocations).
// ---------------------------------------------------------------------
describe('concurrency race: real concurrent child processes (not just concurrent promises)', () => {
  let tmpDir;
  let dataDir;
  let snapshotPath;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-race-proc-'));
    dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(path.join(dataDir, 'snapshots'), { recursive: true });
    snapshotPath = path.join(dataDir, 'snapshots', 'latest_snapshot.json');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function runFixture({ vin, dealer, delayMs, noLock = false }) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        FIXTURE,
        `--data-dir=${dataDir}`,
        `--vin=${vin}`,
        `--dealer=${dealer}`,
        `--delay-ms=${delayMs}`,
        ...(noLock ? ['--no-lock=true'] : []),
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`fixture exited ${code}: ${stderr}`));
      });
      child.on('error', reject);
    });
  }

  it('CONTROL: two real unlocked child processes racing the same file lose an update, just like the in-process control above', async () => {
    await fs.writeFile(snapshotPath, JSON.stringify({}));
    await Promise.all([
      runFixture({ vin: 'PROC_NJ_1', dealer: 'NJ Dealer', delayMs: 300, noLock: true }),
      runFixture({ vin: 'PROC_GA_1', dealer: 'GA Dealer', delayMs: 30, noLock: true }),
    ]);
    const final = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    const hasBoth = Boolean(final.PROC_NJ_1) && Boolean(final.PROC_GA_1);
    assert.equal(hasBoth, false, 'expected two real unlocked processes to reproduce the lost-update race too');
  });

  it('FIX: two real concurrent child processes, each acquiring the real shared-data lock, both survive', async () => {
    await fs.writeFile(snapshotPath, JSON.stringify({}));
    await Promise.all([
      runFixture({ vin: 'PROC_NJ_2', dealer: 'NJ Dealer', delayMs: 300 }),
      runFixture({ vin: 'PROC_GA_2', dealer: 'GA Dealer', delayMs: 30 }),
    ]);
    const final = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    assert.equal(final.PROC_NJ_2.status, 'ACTIVE');
    assert.equal(final.PROC_GA_2.status, 'ACTIVE');

    // And no stray lock file left behind — both processes released cleanly.
    await assert.rejects(fs.access(sharedDataLockPath(tmpDir)));
  });

  it('FIX: a crashed lock holder does not permanently block a later real process', async () => {
    await fs.writeFile(snapshotPath, JSON.stringify({}));
    const lockPath = sharedDataLockPath(tmpDir);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    // Simulate a process that acquired the lock and then died without
    // releasing it (kill -9 mid-critical-section) — a PID that is
    // guaranteed not to be alive in this sandbox.
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));

    await runFixture({ vin: 'PROC_RECOVERY_1', dealer: 'Recovery Dealer', delayMs: 10 });
    const final = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    assert.equal(final.PROC_RECOVERY_1.status, 'ACTIVE');
  });
});
