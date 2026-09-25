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
  MAX_CONCURRENT_STATES,
  runStatesWithBoundedConcurrency,
  buildBrandCrawlEnv,
  shouldRunWriteDealersStep,
  checkProjectedRuntime,
} from '../scripts/run-daily-crawl.mjs';
import { SUPPORTED_STATES } from '../src/states.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('run-daily-crawl driver', () => {
  it('slugify matches the brand-file slugs already on disk (e.g. Mercedes-Benz -> mercedes-benz)', () => {
    assert.equal(slugify('Mercedes-Benz'), 'mercedes-benz');
    assert.equal(slugify('Toyota'), 'toyota');
    assert.equal(slugify('Volkswagen'), 'volkswagen');
  });

  it('runs every state in src/states.js (all 50, after the 34-state scale-out) with no hardcoded state list left behind', () => {
    assert.deepEqual(STATES, SUPPORTED_STATES);
    assert.deepEqual(STATES, ['NJ', 'NY', 'FL', 'GA', 'TX', 'SC', 'VA', 'NC', 'RI', 'VT', 'NH', 'MA', 'CA', 'PA', 'OK', 'IL', 'OH', 'MI', 'WA', 'AZ', 'TN', 'IN', 'MO', 'IA', 'MD', 'WI', 'CO', 'MN', 'AL', 'LA', 'KY', 'OR', 'NV', 'UT', 'CT', 'AR', 'MS', 'KS', 'NM', 'NE', 'WV', 'ID', 'HI', 'ME', 'MT', 'SD', 'ND', 'AK', 'DE', 'WY']);
    // Every state the driver loops over must have a write-dealers script
    // registered, or runState() throws instead of silently skipping it.
    for (const state of STATES) {
      assert.ok(WRITE_DEALER_SCRIPTS[state], `no write-dealers script registered for ${state}`);
    }
    assert.equal(WRITE_DEALER_SCRIPTS.FL, 'write-fl-dealer-files.mjs');
    assert.equal(WRITE_DEALER_SCRIPTS.GA, 'write-ga-dealer-files.mjs');
    assert.equal(WRITE_DEALER_SCRIPTS.TX, 'write-tx-dealer-files.mjs');
    assert.equal(WRITE_DEALER_SCRIPTS.SC, 'write-sc-dealer-files.mjs');
    assert.equal(WRITE_DEALER_SCRIPTS.VA, 'write-va-dealer-files.mjs');
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

  // ---------------------------------------------------------------------
  // buildBrandCrawlEnv: root cause this covers — run-daily-crawl.mjs
  // computes ONE canonical date once per run (todayStamp(), Eastern
  // calendar day) and used to thread it through every report/log/summary
  // filename EXCEPT the env handed to each brand's own standalone.js
  // subprocess, which instead computed its own date independently at
  // whatever wall-clock moment that particular brand's subprocess started.
  // Confirmed live 2026-09-16 on a run spanning Eastern midnight: 11 of 61
  // brand-runs (FL, TX) filed into the next day's daily_changes file
  // instead of merging into the run's actual one. Fixed by passing the
  // driver's own `date` argument (identical for every state/brand in one
  // invocation, regardless of how long earlier brands took) down as
  // CRAWLER_RUN_DATE, which standalone.js's resolveRunDate() now prefers
  // over computing its own date fresh — see test/date_utils.test.js for
  // that half of the fix.
  // ---------------------------------------------------------------------
  describe('buildBrandCrawlEnv (per-brand subprocess inherits the driver\'s one canonical run date)', () => {
    it('sets CRAWLER_RUN_DATE to the exact date passed in, not a fresh computation', () => {
      const env = buildBrandCrawlEnv({ state: 'TX', brand: 'Toyota', dealersFile: 'dealers/tx/toyota.json', date: '2026-09-15' });
      assert.equal(env.CRAWLER_RUN_DATE, '2026-09-15');
      assert.equal(env.CRAWLER_STATE, 'TX');
      assert.equal(env.CRAWLER_BRAND, 'Toyota');
      assert.equal(env.CRAWLER_DEALERS_FILE, 'dealers/tx/toyota.json');
      assert.equal(env.CRAWLER_PATCHRIGHT_FALLBACK, 'false');
    });

    it('caps the subprocess heap so 2 concurrent brand-runs can never jointly exceed the box\'s RAM', () => {
      // See enricher.js's ensureEnrichmentShape/persist-block comments for
      // the root cause this backstops: the enrichment step reads/writes the
      // entire accumulated national inventory + cache files every brand-run,
      // and that dataset only grows. MAX_CONCURRENT_STATES=2 means at most 2
      // of these subprocesses run at once — this must stay comfortably under
      // half the box's physical RAM (8GB, no swap) or a future growth spurt
      // risks the OOM-killer instead of a clean, catchable V8 heap error.
      const env = buildBrandCrawlEnv({ state: 'TX', brand: 'Toyota', dealersFile: 'dealers/tx/toyota.json', date: '2026-09-15' });
      assert.equal(env.NODE_OPTIONS, '--max-old-space-size=3584');
    });

    it('gives every brand in a state the identical CRAWLER_RUN_DATE, proving it is the driver\'s one canonical value and not recomputed per brand', () => {
      // Simulates exactly the midnight-crossing scenario: FL's first brand
      // (starts early) and its last brand (starts hours later, possibly
      // after Eastern midnight) both get the SAME date because runState()
      // calls this once per brand with the one `date` it was given, never
      // re-deriving it from the current wall clock in between.
      const date = '2026-09-15';
      const firstBrandEnv = buildBrandCrawlEnv({ state: 'FL', brand: 'Honda', dealersFile: 'dealers/fl/honda.json', date });
      const lastBrandEnv = buildBrandCrawlEnv({ state: 'FL', brand: 'Toyota', dealersFile: 'dealers/fl/toyota.json', date });
      assert.equal(firstBrandEnv.CRAWLER_RUN_DATE, lastBrandEnv.CRAWLER_RUN_DATE);
      assert.equal(firstBrandEnv.CRAWLER_RUN_DATE, '2026-09-15');
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
  // Bounded state concurrency: this driver used to run STATES fully
  // sequentially (one state's whole write-dealers -> bot-report -> brand
  // loop pipeline finished before the next started). The box has 2 vCPUs,
  // so MAX_CONCURRENT_STATES caps this at 2 states at once rather than
  // running all 5 unbounded (severe CPU contention + real OOM risk — see
  // the constant's own comment). runStateFn is injected here so these
  // tests exercise the real scheduling logic (worker pool, isolation,
  // timestamps) without spawning any real subprocesses.
  // ---------------------------------------------------------------------
  describe('runStatesWithBoundedConcurrency (bounded state parallelism)', () => {
    it('MAX_CONCURRENT_STATES defaults to 2 (box 1\'s 2 vCPUs) when CRAWLER_MAX_CONCURRENT_STATES is unset', () => {
      assert.equal(MAX_CONCURRENT_STATES, 2);
    });

    it('CRAWLER_MAX_CONCURRENT_STATES overrides the default — how box 2/3/4 (4 vCPU) use their real capacity', async () => {
      const prev = process.env.CRAWLER_MAX_CONCURRENT_STATES;
      process.env.CRAWLER_MAX_CONCURRENT_STATES = '4';
      try {
        const mod = await import(`../scripts/run-daily-crawl.mjs?t=${Date.now()}-${Math.random()}`);
        assert.equal(mod.MAX_CONCURRENT_STATES, 4);
      } finally {
        if (prev === undefined) delete process.env.CRAWLER_MAX_CONCURRENT_STATES;
        else process.env.CRAWLER_MAX_CONCURRENT_STATES = prev;
      }
    });

    it('CRAWLER_RUN_LABEL scopes LOCK_PATH to its own file, so two independent driver jobs on the same box never fight over one lock', async () => {
      const prev = process.env.CRAWLER_RUN_LABEL;
      try {
        delete process.env.CRAWLER_RUN_LABEL;
        const unlabeled = await import(`../scripts/run-daily-crawl.mjs?t=${Date.now()}-${Math.random()}`);
        assert.ok(unlabeled.LOCK_PATH.endsWith('driver.lock'));

        process.env.CRAWLER_RUN_LABEL = 'core';
        const labeled = await import(`../scripts/run-daily-crawl.mjs?t=${Date.now()}-${Math.random()}`);
        assert.ok(labeled.LOCK_PATH.endsWith('driver-core.lock'));
        assert.notEqual(labeled.LOCK_PATH, unlabeled.LOCK_PATH);
      } finally {
        if (prev === undefined) delete process.env.CRAWLER_RUN_LABEL;
        else process.env.CRAWLER_RUN_LABEL = prev;
      }
    });

    it('never runs more than maxConcurrent states at once', async () => {
      let inFlight = 0;
      let maxObservedInFlight = 0;
      const fakeRunState = async (state) => {
        inFlight++;
        maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
        await sleep(30);
        inFlight--;
        return { state, brands: {} };
      };

      await runStatesWithBoundedConcurrency(['NJ', 'NY', 'FL', 'GA', 'TX', 'SC', 'VA'], '2026-09-15', 2, fakeRunState);
      assert.equal(maxObservedInFlight, 2);
    });

    it('starts the next queued state as soon as a slot frees, not only after every slot finishes (a real worker pool, not fixed batches of 2)', async () => {
      const order = [];
      // FL is deliberately slow; NJ/NY/GA are fast. If this were "wait for
      // both slots, then start the next pair" instead of a real pool, GA
      // would only start once NJ AND NY (its whole starting batch) were
      // both done — not the moment just one of them frees a slot.
      const durations = { NJ: 10, NY: 15, FL: 200, GA: 10, TX: 10, SC: 10, VA: 10 };
      const fakeRunState = async (state) => {
        order.push(`start:${state}`);
        await sleep(durations[state]);
        order.push(`end:${state}`);
        return { state, brands: {} };
      };

      await runStatesWithBoundedConcurrency(['NJ', 'FL', 'NY', 'GA', 'TX', 'SC', 'VA'], '2026-09-15', 2, fakeRunState);

      // NJ and FL start together (the first two slots). NJ finishes long
      // before FL; the pool should immediately backfill that freed slot
      // with NY, then GA, then TX, then SC, then VA — all while FL is still
      // running — rather than waiting for FL too.
      const flIndex = order.indexOf('end:FL');
      assert.ok(order.indexOf('start:NY') < flIndex, 'NY should have started well before FL finished');
      assert.ok(order.indexOf('start:GA') < flIndex, 'GA should have started well before FL finished');
      assert.ok(order.indexOf('start:TX') < flIndex, 'TX should have started well before FL finished');
      assert.ok(order.indexOf('start:SC') < flIndex, 'SC should have started well before FL finished');
      assert.ok(order.indexOf('start:VA') < flIndex, 'VA should have started well before FL finished');
    });

    it('one state throwing outright (before it builds its own summary) does not stop a concurrently-running other state, and both get real timestamps', async () => {
      const fakeRunState = async (state) => {
        if (state === 'GA') {
          await sleep(10);
          throw new Error('dealers/ga directory could not be created');
        }
        await sleep(40);
        return { state, brands: { Toyota: { status: 'ok' } } };
      };

      const results = await runStatesWithBoundedConcurrency(['GA', 'FL'], '2026-09-15', 2, fakeRunState);

      assert.equal(results.GA.fatalError, 'dealers/ga directory could not be created');
      assert.ok(results.GA.startedAt);
      assert.ok(results.GA.finishedAt);

      // FL was running concurrently in the other slot and must have
      // completed normally, unaffected by GA's failure.
      assert.equal(results.FL.brands.Toyota.status, 'ok');
      assert.ok(results.FL.startedAt);
      assert.ok(results.FL.finishedAt);
    });

    it('records per-state startedAt/finishedAt/durationMs that can genuinely overlap between two concurrent states', async () => {
      const durations = { NJ: 60, NY: 60 };
      const fakeRunState = async (state) => {
        const startedAt = new Date().toISOString();
        await sleep(durations[state]);
        return { state, startedAt, finishedAt: new Date().toISOString(), durationMs: durations[state], brands: {} };
      };

      const results = await runStatesWithBoundedConcurrency(['NJ', 'NY'], '2026-09-15', 2, fakeRunState);

      const njStart = Date.parse(results.NJ.startedAt);
      const njEnd = Date.parse(results.NJ.finishedAt);
      const nyStart = Date.parse(results.NY.startedAt);
      const nyEnd = Date.parse(results.NY.finishedAt);

      // Genuine overlap: NY started before NJ finished (and vice versa) —
      // this is what "reflects concurrent execution sensibly" means here,
      // as opposed to a naive sequential total where one state's window
      // never touches another's.
      assert.ok(nyStart < njEnd, 'NY should have started before NJ finished (concurrent, not sequential)');
      assert.ok(njStart < nyEnd, 'NJ should have started before NY finished (concurrent, not sequential)');
    });

    it('with maxConcurrent=1, falls back to fully sequential (no overlap) — the pool degrades safely rather than assuming concurrency', async () => {
      const order = [];
      const fakeRunState = async (state) => {
        order.push(`start:${state}`);
        await sleep(10);
        order.push(`end:${state}`);
        return { state, brands: {} };
      };

      await runStatesWithBoundedConcurrency(['NJ', 'NY', 'FL'], '2026-09-15', 1, fakeRunState);
      assert.deepEqual(order, ['start:NJ', 'end:NJ', 'start:NY', 'end:NY', 'start:FL', 'end:FL']);
    });
  });

  // ---------------------------------------------------------------------
  // Real bug this guards against: box 1 (2 vCPU/8GB) ran for 40+ hours on
  // what should have been a single night's crawl (root cause: the pre-
  // sharding-fix architecture's O(whole-dataset) scaling — see
  // inventory_shards.js). The sharding fix addresses that root cause, but
  // DRIVER_BUDGET_MS is a real, deterministic guarantee independent of
  // whether that fix performs as well in production as it did in testing —
  // it caps the WHOLE run's wall-clock time, not any single state's.
  // ---------------------------------------------------------------------
  describe('runStatesWithBoundedConcurrency (driver time budget)', () => {
    it('with no budget set (the default), runs every state regardless of elapsed time — unchanged from before this existed', async () => {
      const fakeRunState = async (state) => {
        await sleep(20);
        return { state, brands: {} };
      };
      const results = await runStatesWithBoundedConcurrency(['NJ', 'NY', 'FL'], '2026-09-15', 1, fakeRunState);
      assert.ok(results.NJ && results.NY && results.FL, 'all three states should have run with no budget configured');
      assert.equal(results.NJ.status, undefined); // ran normally, not skipped
    });

    it('once the budget is exceeded, stops STARTING new states but lets an already-started one finish naturally (never kills mid-run)', async () => {
      const order = [];
      const fakeRunState = async (state) => {
        order.push(`start:${state}`);
        // FL deliberately overruns the budget while it's already running —
        // proves the budget doesn't tear down in-flight work.
        await sleep(state === 'FL' ? 80 : 10);
        order.push(`end:${state}`);
        return { state, brands: {} };
      };

      // FL (slot 2) sleeps 80ms and must be allowed to finish regardless.
      // Slot 1 churns NJ (10ms) then NY (10ms) before attempting GA at
      // ~20ms elapsed — budget=15ms means that GA attempt is past budget,
      // so GA never starts, while FL (already running) still finishes.
      const runStartedAt = Date.now();
      const results = await runStatesWithBoundedConcurrency(
        ['NJ', 'FL', 'NY', 'GA'], '2026-09-15', 2, fakeRunState,
        { budgetMs: 15, runStartedAt },
      );

      assert.ok(order.includes('end:FL'), 'FL (already running when the budget expired) should still finish');
      assert.deepEqual(results.FL.brands, {}); // FL ran for real, not skipped
      assert.equal(results.FL.status, undefined);
      assert.ok(!order.includes('start:GA'), 'GA (never started) should not start once the budget is exceeded');
      assert.equal(results.GA.status, 'skipped');
      assert.match(results.GA.reason, /time budget/);
    });

    it('a state that already started before the budget check keeps its real result shape — skipped states are clearly distinguishable from real ones', async () => {
      const fakeRunState = async (state) => {
        await sleep(state === 'NJ' ? 50 : 5);
        return { state, brands: { Toyota: { status: 'ok' } } };
      };
      const runStartedAt = Date.now();
      const results = await runStatesWithBoundedConcurrency(
        ['NJ', 'NY'], '2026-09-15', 1, fakeRunState,
        { budgetMs: 20, runStartedAt },
      );
      // NJ claimed the only slot before the budget expired and ran to completion.
      assert.equal(results.NJ.brands.Toyota.status, 'ok');
      assert.equal(results.NJ.status, undefined);
      // NY never got a slot.
      assert.equal(results.NY.status, 'skipped');
      assert.equal(results.NY.brands, undefined);
    });
  });

  // ---------------------------------------------------------------------
  // Cross-box work-stealing (src/crawl_claims.js), added 2026-09-25 after
  // real measurement showed box 1 (2 vCPU) running 4.8x slower per rooftop
  // than box 2 (4 vCPU) — a static split sized to be "fair by wall-clock
  // time" gives box 1 only a sliver of the workload, which finishes early
  // and then sits idle. claimNextStateFn/heartbeatFn/releaseClaimFn are
  // all optional and default to null (see runStatesWithBoundedConcurrency's
  // own comment) — every test above this one exercises that unchanged,
  // no-stealing path. These test the stealing path itself, with fakes
  // standing in for the real HTTP calls to the deals box.
  // ---------------------------------------------------------------------
  describe('runStatesWithBoundedConcurrency (cross-box work-stealing)', () => {
    it('with no claimNextStateFn, a worker just exits once local states run out — unchanged default behavior', async () => {
      const fakeRunState = async (state) => { await sleep(5); return { state, brands: {} }; };
      const results = await runStatesWithBoundedConcurrency(['NJ'], '2026-09-15', 4, fakeRunState);
      assert.deepEqual(Object.keys(results), ['NJ']);
    });

    it('a worker that runs out of local states claims more from the shared queue instead of exiting', async () => {
      const pool = ['FL', 'GA', 'TX'];
      const claimNextStateFn = async () => (pool.length ? pool.shift() : null);
      const fakeRunState = async (state) => { await sleep(5); return { state, brands: {} }; };

      const results = await runStatesWithBoundedConcurrency(
        ['NJ'], '2026-09-15', 1, fakeRunState, { claimNextStateFn },
      );

      // One local state plus all three stolen ones, all recorded like any other state.
      assert.deepEqual(new Set(Object.keys(results)), new Set(['NJ', 'FL', 'GA', 'TX']));
      assert.equal(results.NJ.stolen, undefined, 'a locally-assigned state is never marked stolen');
      assert.equal(results.FL.stolen, true);
      assert.equal(results.GA.stolen, true);
      assert.equal(results.TX.stolen, true);
    });

    it('a short local list still spawns up to maxConcurrent workers when stealing is enabled, not capped at the local list length', async () => {
      let concurrentClaims = 0;
      let maxConcurrentClaims = 0;
      const pool = ['FL', 'GA', 'TX', 'VA'];
      const claimNextStateFn = async () => {
        concurrentClaims++;
        maxConcurrentClaims = Math.max(maxConcurrentClaims, concurrentClaims);
        await sleep(10); // give sibling workers a chance to also be mid-claim
        concurrentClaims--;
        return pool.length ? pool.shift() : null;
      };
      const fakeRunState = async (state) => { await sleep(5); return { state, brands: {} }; };

      // Only ONE local state, but maxConcurrent=4 — without the fix, workerCount
      // would be capped at states.length (1) and this would never observe >1.
      await runStatesWithBoundedConcurrency(['NJ'], '2026-09-15', 4, fakeRunState, { claimNextStateFn });
      assert.ok(maxConcurrentClaims > 1, `expected multiple workers claiming concurrently, saw max ${maxConcurrentClaims}`);
    });

    it('stops stealing once the shared queue reports nothing claimable, without erroring', async () => {
      const claimNextStateFn = async () => null; // queue is empty from the start
      const fakeRunState = async (state) => { await sleep(5); return { state, brands: {} }; };
      const results = await runStatesWithBoundedConcurrency(
        ['NJ'], '2026-09-15', 2, fakeRunState, { claimNextStateFn },
      );
      assert.deepEqual(Object.keys(results), ['NJ']);
    });

    it('passes remaining budget (not the full budget) to claimNextStateFn, so a late steal attempt sees a shrinking window', async () => {
      const seenRemaining = [];
      const claimNextStateFn = async (remainingMs) => { seenRemaining.push(remainingMs); return null; };
      const fakeRunState = async (state) => { await sleep(30); return { state, brands: {} }; };
      const runStartedAt = Date.now();

      await runStatesWithBoundedConcurrency(
        ['NJ'], '2026-09-15', 1, fakeRunState,
        { claimNextStateFn, budgetMs: 10_000, runStartedAt },
      );

      assert.ok(seenRemaining.length >= 1);
      assert.ok(seenRemaining[0] < 10_000 && seenRemaining[0] > 9_000, `expected remaining close to but under 10000ms, got ${seenRemaining[0]}`);
    });

    it('a heartbeat fires periodically while a state is in flight, and stops once it finishes', async () => {
      const beats = [];
      const heartbeatFn = (state) => beats.push(state);
      const fakeRunState = async (state) => { await sleep(35); return { state, brands: {} }; };

      await runStatesWithBoundedConcurrency(
        ['NJ'], '2026-09-15', 1, fakeRunState,
        { heartbeatFn, heartbeatIntervalMs: 10 },
      );
      await sleep(30); // if the interval weren't cleared, more beats would still be arriving here

      const countAfterFinish = beats.length;
      await sleep(30);
      assert.equal(beats.length, countAfterFinish, 'heartbeat must stop once the state finishes, not keep firing');
      assert.ok(beats.length >= 2, `expected multiple heartbeats over a 35ms run at a 10ms interval, got ${beats.length}`);
      assert.ok(beats.every((s) => s === 'NJ'));
    });

    it('releaseClaimFn is called once per state with "done" on success and "failed" on a fatal error — for both local and stolen states', async () => {
      const released = [];
      const releaseClaimFn = async (state, status) => { released.push([state, status]); };
      const pool = ['GA'];
      const claimNextStateFn = async () => (pool.length ? pool.shift() : null);
      const fakeRunState = async (state) => {
        if (state === 'GA') throw new Error('simulated fatal error');
        return { state, brands: {} };
      };

      await runStatesWithBoundedConcurrency(
        ['NJ'], '2026-09-15', 1, fakeRunState,
        { claimNextStateFn, releaseClaimFn },
      );

      assert.deepEqual(new Set(released.map((r) => r.join(':'))), new Set(['NJ:done', 'GA:failed']));
    });

    // claimLocalStateFn — added 2026-09-25 (second pass) after a fresh spec
    // pointed out that a box's own STATES list must be a HINT, not a
    // reservation: without this, a box's local states ran unconditionally,
    // so an overloaded box's own not-yet-started states were unstealable
    // until it actually got to (or gave up on) them — the exact hoarding
    // problem this whole system exists to fix. See run-daily-crawl.mjs's
    // own comment on this option for the full story.
    it('with no claimLocalStateFn, a local state runs unconditionally — unchanged default behavior', async () => {
      const fakeRunState = async (state) => { await sleep(5); return { state, brands: { Toyota: { status: 'ok' } } }; };
      const results = await runStatesWithBoundedConcurrency(['NJ', 'NY'], '2026-09-15', 2, fakeRunState);
      assert.equal(results.NJ.brands.Toyota.status, 'ok');
      assert.equal(results.NY.brands.Toyota.status, 'ok');
    });

    it('a local state that wins its claim runs normally', async () => {
      const claimed = [];
      const claimLocalStateFn = async (state) => { claimed.push(state); return true; };
      const fakeRunState = async (state) => { await sleep(5); return { state, brands: { Toyota: { status: 'ok' } } }; };
      const results = await runStatesWithBoundedConcurrency(
        ['NJ', 'NY'], '2026-09-15', 1, fakeRunState, { claimLocalStateFn },
      );
      assert.deepEqual(claimed, ['NJ', 'NY']);
      assert.equal(results.NJ.brands.Toyota.status, 'ok');
      assert.equal(results.NY.brands.Toyota.status, 'ok');
    });

    it('a local state that LOSES its claim (a peer already has it) is skipped, not run, and the worker moves on to its next local state', async () => {
      const ran = [];
      const claimLocalStateFn = async (state) => state !== 'NJ'; // NJ is already claimed by "someone else"
      const fakeRunState = async (state) => { ran.push(state); await sleep(5); return { state, brands: {} }; };

      const results = await runStatesWithBoundedConcurrency(
        ['NJ', 'NY'], '2026-09-15', 1, fakeRunState, { claimLocalStateFn },
      );

      assert.deepEqual(ran, ['NY'], 'NJ must never actually run once its claim is lost');
      assert.equal(results.NJ.status, 'skipped');
      assert.match(results.NJ.reason, /claimed by another box/);
      assert.equal(results.NY.brands !== undefined, true);
    });

    it('a lost local claim does not block the shared queue: the worker still steals once its local list is exhausted', async () => {
      const pool = ['TX'];
      const claimLocalStateFn = async () => false; // this box's whole local list is already claimed by peers
      const claimNextStateFn = async () => (pool.length ? pool.shift() : null);
      const fakeRunState = async (state) => { await sleep(5); return { state, brands: {} }; };

      const results = await runStatesWithBoundedConcurrency(
        ['NJ'], '2026-09-15', 1, fakeRunState, { claimLocalStateFn, claimNextStateFn },
      );

      assert.equal(results.NJ.status, 'skipped');
      assert.equal(results.TX.stolen, true);
    });
  });

  // ---------------------------------------------------------------------
  // Real bug found live 2026-09-21 — caught by a pre-flight smoke test of
  // the real driver, before it ever ran on a real cron fire. Every per-
  // state write-dealers script imports NJ_BRANDS_IN and iterates it,
  // sourcing each brand's dealers from OEM locator dumps. NJ_BRANDS_IN
  // resolves to the EXPANSION brand list under CRAWLER_BRAND_SET=expansion
  // (see nj_policy.js) — but the expansion brands (Ford/Chevrolet/GMC/...)
  // never went through OEM-locator fetching; they were materialized once
  // from real dealer-contact rosters. Running write-dealers under
  // expansion would silently overwrite every one of those real,
  // materialized dealer files with an empty array, on every state, on the
  // very first cron fire — confirmed live: it happened to two real states
  // (HI on box 3, ID on box 4) before this fix existed.
  // ---------------------------------------------------------------------
  describe('shouldRunWriteDealersStep (expansion brands must never regenerate from OEM locators)', () => {
    it('runs write-dealers for the core brand set (unset, or explicitly "core")', () => {
      assert.equal(shouldRunWriteDealersStep(undefined), true);
      assert.equal(shouldRunWriteDealersStep('core'), true);
    });

    it('skips write-dealers for the expansion brand set — its dealer files are a static, pre-built dataset', () => {
      assert.equal(shouldRunWriteDealersStep('expansion'), false);
    });
  });

  // ---------------------------------------------------------------------
  // Real bug this guards against: box 1/box 3/box 4 were each assigned a
  // state list sized by dealer count or vehicle volume, not real p90
  // timing — box 1 alone projected to 28.3h before this preflight check
  // (and the rebalance it enabled) existed. checkProjectedRuntime is what
  // main() calls before ever starting a crawl, to refuse an oversized
  // shard outright instead of discovering the overrun 20 hours in.
  // ---------------------------------------------------------------------
  describe('checkProjectedRuntime (predictive preflight — refuses an oversized shard before it starts)', () => {
    let tmpDir;
    before(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-preflight-'));
      await fs.mkdir(path.join(tmpDir, 'dealers', 'tx'), { recursive: true });
      // 2000 real rooftops for one brand in one state — at the p90 rate
      // (93.2s/rooftop) and concurrency=4, that alone projects to
      // 2000*93.2/3600/4 = ~12.9h. Comfortably under 24h.
      await fs.writeFile(
        path.join(tmpDir, 'dealers', 'tx', 'ford.json'),
        JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ name: `Dealer ${i}` }))),
      );
    });
    after(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('a shard within the SLA reports withinBudget=true with the real rooftop count and projected hours', () => {
      const result = checkProjectedRuntime(['TX'], ['Ford'], 4, tmpDir);
      assert.equal(result.rooftops, 2000);
      assert.equal(result.withinBudget, true);
      assert.ok(result.projectedHours < 24, `expected under 24h, got ${result.projectedHours}`);
    });

    it('an oversized shard (low concurrency for the same real rooftop count) reports withinBudget=false', () => {
      // Same 2000 rooftops, but concurrency=1 instead of 4 — projects to
      // ~51.8h, well past 24h.
      const result = checkProjectedRuntime(['TX'], ['Ford'], 1, tmpDir);
      assert.equal(result.withinBudget, false);
      assert.ok(result.projectedHours > 24, `expected over 24h, got ${result.projectedHours}`);
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
