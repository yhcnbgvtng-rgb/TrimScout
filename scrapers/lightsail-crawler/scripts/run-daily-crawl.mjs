#!/usr/bin/env node
// Daily multi-state, multi-brand inventory crawl driver.
//
// Replaces the ad-hoc SSH shell loops used to run the first NJ and NY
// crawls (2026-09-14) with one persistent, committed job that cron can
// call unattended. Runs every state in src/states.js#SUPPORTED_STATES
// (NJ, NY, FL, GA, TX, SC, then VA as of 2026-09-16), up to MAX_CONCURRENT_STATES
// (2, matching the crawl box's 2 vCPUs) at a time via
// runStatesWithBoundedConcurrency() — see that function's own comment for
// how states are scheduled into the two slots, and MAX_CONCURRENT_STATES'
// comment for why 2 and not more. Each state's own pipeline, in order:
//
//   1. Regenerate dealers/<state>/<brand>.json from the OEM-locator dumps
//      (write-nj-dealer-files.mjs / write-ny-dealer-files.mjs). This is
//      NOT redundant with step 2 below — standalone.js (the actual crawl,
//      step 3) reads dealer lists from these static per-brand snapshot
//      files, which only ever get refreshed by explicitly rerunning this
//      write step. If a locator is fixed or added and nobody reruns it,
//      the crawl keeps using a stale list indefinitely. dealer-bot-report
//      does NOT read these files — it calls loadNjDealers/loadNyDealers
//      directly (see oem_locator.js), so it always sees the freshest
//      locator-dump data regardless of whether this step ran. Confirmed
//      by reading nj_policy.js/ny_policy.js/oem_locator.js/standalone.js
//      before writing this driver.
//   2. Run the bot-protection report for that state, to find out which
//      brands are even worth attempting today (dealer-bot-report.mjs
//      writes data/reports/dealer-bot-report-<state>-all-<date>.json,
//      whose `readyToCrawl` array is grouped into a per-brand list here).
//   3. Loop standalone.js once per brand that had at least one NONE/200
//      dealer in that state's report, same CRAWLER_DEALERS_FILE /
//      CRAWLER_BRAND invocation pattern as today's manual runs, each
//      brand's own dealer file at dealers/<state>/<brand-slug>.json.
//
// One brand hanging or crashing is caught and logged, never allowed to
// take down the rest of the run — see runStep()'s timeout and the
// try/catch around each brand in runState(). One STATE hanging or crashing
// is likewise isolated from any other state running concurrently in the
// other slot — see runStatesWithBoundedConcurrency()'s own try/catch.
//
// Concurrency safety for the data files every state's brand processes
// read-modify-write is handled inside those processes themselves
// (src/standalone.js, src/enricher.js), via src/shared_data_lock.js — not
// here. As of the state-sharding fix (src/inventory_shards.js), most of
// that data — inventory, snapshots, the enrichment cache — is split into
// one shard per state (data/inventory/<state>.json etc.), so two different
// states' brand processes touch different files entirely and the lock
// barely ever contends for them; only daily_changes/daily_changes_<date>
// .json is still genuinely shared across every state running today, and
// is locked by date rather than by state for that reason. This driver's
// own acquireLock()/releaseLock() below guards a different, narrower
// thing: a second whole invocation of THIS SCRIPT (e.g. cron firing while
// a manual run is still going) never starts at all. Running this driver's
// own states concurrently within one invocation is the intended,
// supported case.
//
// Everything this run did — per-step exit codes, per-brand vehicle/price
// stats pulled back out of the (now correctly per-brand-keyed, see
// daily_changes.js) daily_changes file, and durations — is written to a
// durable JSON summary under data/daily_crawl_runs/, not just scattered
// across per-brand log files. Per-state startedAt/finishedAt/durationMs in
// that summary can now overlap between states — that's expected, not a
// bug in the summary.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NJ_BRANDS_IN } from '../src/nj_policy.js';
import { SUPPORTED_STATES } from '../src/states.js';
import { easternDateStamp } from '../src/date_utils.js';
import { isProcessAlive } from '../src/pid_lock.js';
import { countRooftopsForState, countRooftopsForStates, projectedHours, MAX_PROJECTED_HOURS, P90_SECONDS_PER_ROOFTOP } from '../src/capacity.js';
import { buildBoxReport, renderBoxReportHtml, appendCapacityHistoryRow } from '../src/box_report.js';
import { seedClaims, claimNextState, heartbeatClaim, releaseClaim } from '../src/crawl_claims.js';

// CRAWLER_STEAL_ENABLED=1 turns on cross-box work-stealing (src/crawl_claims.js)
// — off by default, so every box's behavior is unchanged unless explicitly
// opted in per box. See runStatesWithBoundedConcurrency's own comment on
// claimNextStateFn for why this exists: a box that runs out of its own
// assigned states early keeps claiming more from a shared pool instead of
// sitting idle, and the SAME per-box p90 rate that sizes the static split
// (recommend-shard-split.mjs --p90) is what bounds how big a claim it's
// allowed to take on with the budget it has left.
const STEAL_ENABLED = process.env.CRAWLER_STEAL_ENABLED === '1';
const STEAL_P90_SECONDS_PER_ROOFTOP = Number(process.env.CRAWLER_STEAL_P90_SEC_PER_ROOFTOP) || P90_SECONDS_PER_ROOFTOP;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');
const REPORTS_DIR = path.join(ROOT, 'data', 'reports');
const RUNS_DIR = path.join(ROOT, 'data', 'daily_crawl_runs');
const CHANGES_DIR = path.join(ROOT, 'data', 'daily_changes');

// Every state this driver runs, in order — see src/states.js for the
// single source of truth. Adding a state here (plus its write-dealers
// script entry in WRITE_DEALER_SCRIPTS below) is the only change needed
// to have the nightly driver pick it up; nothing else in this file should
// special-case a particular state.
//
// CRAWL_STATES (optional, comma-separated, e.g. "OH,MI,WA") scopes this to
// a subset — added 2026-09-20 so multiple boxes can share this exact
// codebase/states.js (one source of truth for what the crawler CAN cover)
// while each box's own crontab sets CRAWL_STATES to just the slice IT is
// responsible for, via env var rather than a per-box branch or config
// file that could drift. Order still follows SUPPORTED_STATES, not the
// env var's own order, since that order is what the work-stealing pool
// schedules against (see MAX_CONCURRENT_STATES' comment below). Unset
// (the default, and what every single-box run before this used) keeps
// the original "run everything" behavior. A typo'd/unsupported code in
// CRAWL_STATES fails loudly rather than silently crawling nothing for it.
const crawlStatesEnv = (process.env.CRAWL_STATES || '').trim();
if (crawlStatesEnv) {
  const requested = crawlStatesEnv.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknown = requested.filter((s) => !SUPPORTED_STATES.includes(s));
  if (unknown.length) {
    throw new Error(`CRAWL_STATES has unsupported state(s): ${unknown.join(', ')}. Must be a subset of ${SUPPORTED_STATES.join(', ')}.`);
  }
}
export const STATES = crawlStatesEnv
  ? SUPPORTED_STATES.filter((s) => crawlStatesEnv.split(',').map((x) => x.trim().toUpperCase()).includes(s))
  : SUPPORTED_STATES;

// One entry per state in STATES — the write-dealers step's script name.
export const WRITE_DEALER_SCRIPTS = {
  NJ: 'write-nj-dealer-files.mjs',
  NY: 'write-ny-dealer-files.mjs',
  FL: 'write-fl-dealer-files.mjs',
  GA: 'write-ga-dealer-files.mjs',
  TX: 'write-tx-dealer-files.mjs',
  SC: 'write-sc-dealer-files.mjs',
  VA: 'write-va-dealer-files.mjs',
  NC: 'write-nc-dealer-files.mjs',
  RI: 'write-ri-dealer-files.mjs',
  VT: 'write-vt-dealer-files.mjs',
  NH: 'write-nh-dealer-files.mjs',
  MA: 'write-ma-dealer-files.mjs',
  CA: 'write-ca-dealer-files.mjs',
  PA: 'write-pa-dealer-files.mjs',
  OK: 'write-ok-dealer-files.mjs',
  IL: 'write-il-dealer-files.mjs',
  OH: 'write-oh-dealer-files.mjs',
  MI: 'write-mi-dealer-files.mjs',
  WA: 'write-wa-dealer-files.mjs',
  AZ: 'write-az-dealer-files.mjs',
  TN: 'write-tn-dealer-files.mjs',
  IN: 'write-in-dealer-files.mjs',
  MO: 'write-mo-dealer-files.mjs',
  IA: 'write-ia-dealer-files.mjs',
  MD: 'write-md-dealer-files.mjs',
  WI: 'write-wi-dealer-files.mjs',
  CO: 'write-co-dealer-files.mjs',
  MN: 'write-mn-dealer-files.mjs',
  AL: 'write-al-dealer-files.mjs',
  LA: 'write-la-dealer-files.mjs',
  KY: 'write-ky-dealer-files.mjs',
  OR: 'write-or-dealer-files.mjs',
  NV: 'write-nv-dealer-files.mjs',
  UT: 'write-ut-dealer-files.mjs',
  CT: 'write-ct-dealer-files.mjs',
  AR: 'write-ar-dealer-files.mjs',
  MS: 'write-ms-dealer-files.mjs',
  KS: 'write-ks-dealer-files.mjs',
  NM: 'write-nm-dealer-files.mjs',
  NE: 'write-ne-dealer-files.mjs',
  WV: 'write-wv-dealer-files.mjs',
  ID: 'write-id-dealer-files.mjs',
  HI: 'write-hi-dealer-files.mjs',
  ME: 'write-me-dealer-files.mjs',
  MT: 'write-mt-dealer-files.mjs',
  SD: 'write-sd-dealer-files.mjs',
  ND: 'write-nd-dealer-files.mjs',
  AK: 'write-ak-dealer-files.mjs',
  DE: 'write-de-dealer-files.mjs',
  WY: 'write-wy-dealer-files.mjs',
};

// Logs accumulate one file per (state, brand, day) forever otherwise —
// today's manual runs already show this pattern taking hold. Anything
// under logs/ older than this many days is deleted at the start of every
// run. Structured summaries in data/daily_crawl_runs/ are small JSON and
// kept indefinitely — they're the durable record; the *.log files are
// just the raw console output behind them.
export const LOG_RETENTION_DAYS = 30;

// Hard cap per brand so one hung dealer site can't stall the whole night.
// Generous on purpose: a single brand crawling ~200 dealers (bot-report's
// own numbers) still comfortably fits inside this.
export const PER_BRAND_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const SUPPORT_STEP_TIMEOUT_MS = 30 * 60 * 1000; // write-dealers / bot-report

// How many states' full pipelines (write-dealers -> bot-report -> per-brand
// crawl loop) run at once. Confirmed this session via `nproc`/`free -h`
// against the actual Lightsail box: 2 vCPUs, 7.6GB RAM. A single brand's
// crawl process has been observed spiking to ~1.3-1.4GB RSS on a heavier
// brand (e.g. TX Toyota, GA Toyota), and Patchright/Chromium rendering is
// CPU-bound — so this is deliberately capped at the vCPU count, not raised
// further just because more states exist. Five states' worth of that peak
// at once (~6.5GB) would already be pushing the box's usable RAM before
// Node/OS overhead, on top of severe CPU contention with only 2 cores.
//
// That box was box 1 (2 vCPU/8GB) — the original crawler box. Box 2/3/4
// are xlarge_3_0 (4 vCPU/16GB), double the cores and RAM, but inherited
// this same constant unchanged: they've been leaving real concurrency
// headroom unused. CRAWLER_MAX_CONCURRENT_STATES lets each box's own
// crontab set this to match its actual hardware (default 2, so box 1 and
// any box that never sets it keep today's exact behavior) instead of a
// single hardcoded constant applying uniformly regardless of vCPU count.
export const MAX_CONCURRENT_STATES = Number(process.env.CRAWLER_MAX_CONCURRENT_STATES) || 2;

// Hard wall-clock ceiling on the WHOLE run (every state, not any single
// one) — unset by default, preserving the original "run until done"
// behavior everywhere this isn't explicitly configured. Added 2026-09-21
// after box 1 (2 vCPU/8GB, the box's own smaller hardware) ran for 40+
// hours on what should have been a single night's crawl — the state-
// sharding fix (see inventory_shards.js) addresses the root cause of that
// specific blowup, but a hard budget is a real guarantee, not a hope that
// a fix works as well in practice as it did in testing. Once elapsed time
// since this run started passes CRAWLER_DRIVER_BUDGET_HOURS, the worker
// pool (runStatesWithBoundedConcurrency below) simply stops STARTING new
// states — it never kills a state that's already running, which would
// risk tearing a mid-write brand-run; every already-fixed safety net at
// finer grain (DEALER_TIMEOUT_MS, PER_BRAND_TIMEOUT_MS) already bounds how
// long any one already-started state can run past the deadline. Any state
// that never got a slot is recorded in the summary as skipped, not
// silently dropped, so a human (or tomorrow's own run) can see exactly
// what didn't get covered.
export const DRIVER_BUDGET_MS = process.env.CRAWLER_DRIVER_BUDGET_HOURS
  ? Number(process.env.CRAWLER_DRIVER_BUDGET_HOURS) * 60 * 60 * 1000
  : null;

// PID-file lock so a second invocation of this driver (e.g. cron firing
// again while a manual run, or the previous day's run, is still going)
// refuses to start instead of running concurrently against the same
// shared data files (national_inventory_latest.json, daily_changes/,
// bot-report outputs) — see acquireLock() below for the actual guard.
//
// CRAWLER_RUN_LABEL scopes this to a named lock file instead of the one
// shared default — added when a box runs more than one genuinely
// independent driver invocation (e.g. box 3/box 4 each run their main
// expansion-brand crawl at 11pm AND a small separate core-brand slice at
// 4am, on different states/brand sets). Without this, those two
// invocations would fight over the SAME lock file and the driver would
// wrongly treat the second one as "the previous run still going" and
// refuse to start it — they're unrelated jobs, not the same job
// double-firing. Unset (the default) keeps the single shared lock file
// every box already used before this existed.
export const LOCK_PATH = path.join(RUNS_DIR, process.env.CRAWLER_RUN_LABEL ? `driver-${process.env.CRAWLER_RUN_LABEL}.lock` : 'driver.lock');

// Calendar-date bucketing (report/log/summary filenames) uses the Eastern
// calendar date, not UTC — see src/date_utils.js. A run that starts late
// evening Eastern (already past midnight UTC) or early morning Eastern
// (not yet past midnight UTC, depending on DST) must still file under the
// same Eastern business day cron intended, not whichever UTC date happens
// to be current at process start.
function todayStamp() {
  return easternDateStamp();
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Deletes logs/*.log files older than LOG_RETENTION_DAYS. Returns how many
// were removed so the run summary can show retention actually happened.
export async function pruneOldLogs({ logsDir = LOGS_DIR, retentionDays = LOG_RETENTION_DAYS, now = Date.now() } = {}) {
  let entries = [];
  try {
    entries = await fs.readdir(logsDir);
  } catch {
    return { removed: 0, checked: 0 };
  }
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  let checked = 0;
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    checked++;
    const full = path.join(logsDir, name);
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs < cutoff) {
        await fs.unlink(full);
        removed++;
      }
    } catch {
      // Raced with something else removing it, or a permissions issue —
      // not worth failing the whole run over a log-cleanup miss.
    }
  }
  return { removed, checked };
}

// Overlap guard: refuses to let a second invocation of this driver start
// while a previous one is still running. Root cause this fixes: the
// installed cron fired at its scheduled time while a manually-started run
// of this same script was still mid-crawl, and with no guard both
// processes ran concurrently against the same shared files
// (national_inventory_latest.json, data/daily_changes/, bot-report
// outputs) until a human noticed and killed the duplicate.
//
// A plain PID file, not flock: this driver is invoked as `node
// scripts/run-daily-crawl.mjs` directly from cron (see README), so a
// Node-side check here needs no crontab change and no wrapping shell
// command. If the lock file's PID is no longer alive (a crash or kill -9
// that skipped cleanup), it's treated as stale and silently reclaimed —
// this only ever blocks a run when another run is genuinely still active.
export async function acquireLock({ lockPath = LOCK_PATH, pid = process.pid } = {}) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
  } catch {
    existing = null;
  }
  if (existing && typeof existing.pid === 'number' && existing.pid !== pid && isProcessAlive(existing.pid)) {
    return {
      acquired: false,
      reason: `another run (pid ${existing.pid}, started ${existing.startedAt}) is still active`,
      existingPid: existing.pid,
    };
  }
  await fs.writeFile(lockPath, JSON.stringify({ pid, startedAt: new Date().toISOString() }));
  return { acquired: true, reclaimedStale: Boolean(existing) };
}

// Releases the lock. Safe to call even if the lock was never acquired (or
// was already removed) — never throws, so it's safe to put in a `finally`.
export async function releaseLock({ lockPath = LOCK_PATH } = {}) {
  await fs.rm(lockPath, { force: true });
}

// Runs one child process to completion (or until timeoutMs elapses, at
// which point it's SIGKILLed), streaming stdout+stderr into logFile the
// same way today's manual `>> file.log 2>&1` runs did. Never throws —
// failure is reported in the returned result so the caller can keep going.
export async function runStep(cmd, args, { cwd, env = {}, logFile, timeoutMs = 0 } = {}) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  const logStream = (await import('node:fs')).createWriteStream(logFile, { flags: 'w' });

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (spawnErr) {
      logStream.end(`[driver] spawn failed: ${spawnErr.message}\n`);
      resolve({
        cmd: `${cmd} ${args.join(' ')}`,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        exitCode: null,
        signal: null,
        timedOut: false,
        spawnError: spawnErr.message,
        logFile,
      });
      return;
    }

    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      logStream.end(`\n[driver] process error: ${err.message}\n`);
      resolve({
        cmd: `${cmd} ${args.join(' ')}`,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        exitCode: null,
        signal: null,
        timedOut,
        spawnError: err.message,
        logFile,
      });
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      logStream.end(timedOut ? `\n[driver] killed after exceeding ${timeoutMs}ms timeout\n` : '\n');
      resolve({
        cmd: `${cmd} ${args.join(' ')}`,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        exitCode: code,
        signal,
        timedOut,
        logFile,
      });
    });
  });
}

function statusOf(result) {
  if (result.spawnError) return 'error';
  if (result.timedOut) return 'timeout';
  if (result.exitCode === 0) return 'ok';
  return 'error';
}

async function readReadyBrandsForState(state, date) {
  const reportPath = path.join(REPORTS_DIR, `dealer-bot-report-${state.toLowerCase()}-all-${date}.json`);
  const raw = await fs.readFile(reportPath, 'utf-8');
  const report = JSON.parse(raw);
  const brands = [...new Set((report.readyToCrawl || []).map((r) => r.brand))];
  return { reportPath, brands };
}

async function readBrandStatsFromDailyChanges(state, brand, date) {
  try {
    const doc = JSON.parse(await fs.readFile(path.join(CHANGES_DIR, `daily_changes_${date}.json`), 'utf-8'));
    return doc?.states?.[state]?.brands?.[brand]?.stats || null;
  } catch {
    return null;
  }
}

async function dealerCountFor(state, brand) {
  const slug = slugify(brand);
  const rel = path.join('dealers', state.toLowerCase(), `${slug}.json`);
  try {
    const dealers = JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf-8'));
    return { rel, count: Array.isArray(dealers) ? dealers.length : 0 };
  } catch {
    return { rel, count: 0 };
  }
}

// Env for one brand's standalone.js subprocess. CRAWLER_RUN_DATE carries
// this run's single canonical date (computed once in main() via
// todayStamp(), the same value for every state and every brand this
// invocation touches) down to the subprocess explicitly — see
// resolveRunDate() in src/date_utils.js for the bug this fixes: without
// it, standalone.js computed its own Eastern date fresh at whatever
// wall-clock moment that particular brand's subprocess happened to start,
// which could disagree with the driver's date (and with sibling brands'
// dates) for any run spanning Eastern midnight, splitting one business
// day's daily_changes ledger across two dated files. Pulled out as its
// own function so the exact env passed to every brand subprocess is
// covered by a fast unit test without spawning a real subprocess.
export function buildBrandCrawlEnv({ state, brand, dealersFile, date }) {
  return {
    CRAWLER_DEALERS_FILE: dealersFile,
    CRAWLER_BRAND: brand,
    CRAWLER_STATE: state,
    CRAWLER_PATCHRIGHT_FALLBACK: 'false',
    CRAWLER_RUN_DATE: date,
    // Safety margin on top of the enricher.js memory fix (see its
    // ensureEnrichmentShape/persist-block comments): that fix removes the
    // *unnecessary* duplicate copies of the accumulated inventory/cache
    // files, but reading + writing the real dataset once per brand-run is
    // still real and only grows as more states are added. Measured live
    // against the actual ~153k-vehicle/350MB production files after the
    // fix: peak RSS 3,055MB for a single scoped brand-run with default
    // Node heap (no crash) — so 3072 would have left almost no margin.
    // 3584 leaves ~500MB of headroom over that measured floor. Re-measure
    // before adding more states: MAX_CONCURRENT_STATES=2 means 2 of these
    // can run at once, and if both happen to hit their enrichment peak
    // simultaneously that's up to ~7GB combined on this 8GB/no-swap box —
    // little left for the OS/MariaDB/Chromium. If the dataset grows
    // enough to make that a real risk, drop MAX_CONCURRENT_STATES to 1
    // before raising this further.
    NODE_OPTIONS: '--max-old-space-size=3584',
  };
}

// Extracted as its own function (rather than an inline env check) so this
// exact decision is unit-testable — see this function's own callsite
// comment in runState() for the real bug this guards against.
export function shouldRunWriteDealersStep(brandSet = process.env.CRAWLER_BRAND_SET) {
  return brandSet !== 'expansion';
}

async function runState(state, date) {
  // startedAt/finishedAt are wall-clock, not "time actually spent running"
  // — with MAX_CONCURRENT_STATES > 1, two states' windows can (and are
  // meant to) overlap. That overlap is the whole point of this change, so
  // it's recorded plainly rather than hidden behind a single sequential
  // total that would no longer mean what it used to.
  const stateSummary = { state, startedAt: new Date().toISOString(), finishedAt: null, durationMs: null, writeDealers: null, botReport: null, readyBrands: null, brands: {} };

  // Real bug found live 2026-09-21, pre-flight-checked before it ever hit
  // production: every per-state write-dealers script (write-<state>-
  // dealer-files.mjs -> <state>_policy.js's writeXxxDealerFiles) imports
  // NJ_BRANDS_IN directly and iterates it to decide which brands to
  // (re)write — sourcing each brand's dealers from loadNjDealers(), which
  // reads OEM locator dumps (see oem_locator.js). NJ_BRANDS_IN now resolves
  // to the EXPANSION list under CRAWLER_BRAND_SET=expansion (see
  // nj_policy.js) — but the expansion brands never went through OEM-
  // locator fetching; they were materialized once from real dealer-
  // contact rosters (scripts/materialize-expansion-dealer-files.mjs).
  // Running this step under expansion would have iterated Ford/Chevrolet/
  // etc., found zero locator rows for each, and silently overwritten every
  // one of those 9,451 real materialized dealers with an empty array — on
  // literally every state, on the very first cron fire. Confirmed live on
  // a real box before this fix: HI and ID's expansion dealer files were
  // already clobbered to `[]` by an earlier manual driver invocation.
  // Expansion brands' dealer files are a static, pre-built dataset (no
  // periodic locator refresh built for them yet), so this step is simply
  // skipped for that brand set rather than taught to no-op per brand —
  // there's nothing for it to legitimately do there.
  if (!shouldRunWriteDealersStep()) {
    stateSummary.writeDealers = { status: 'skipped', reason: 'CRAWLER_BRAND_SET=expansion — dealer files are pre-materialized, never regenerated from OEM locators' };
  } else {
    const writeScript = WRITE_DEALER_SCRIPTS[state];
    if (!writeScript) throw new Error(`No write-dealers script registered for state "${state}" — add one to WRITE_DEALER_SCRIPTS.`);
    stateSummary.writeDealers = await runStep(
      'node',
      [path.join('scripts', writeScript)],
      {
        cwd: ROOT,
        logFile: path.join(LOGS_DIR, `${state.toLowerCase()}-write-dealers-${date}.log`),
        timeoutMs: SUPPORT_STEP_TIMEOUT_MS,
      },
    );
    stateSummary.writeDealers.status = statusOf(stateSummary.writeDealers);
    if (stateSummary.writeDealers.status !== 'ok') {
      console.error(`[driver] ${state} write-dealers step ${stateSummary.writeDealers.status} (exit ${stateSummary.writeDealers.exitCode}) — continuing with whatever dealers/${state.toLowerCase()}/*.json already exists on disk.`);
    }
  }

  stateSummary.botReport = await runStep(
    'node',
    ['scripts/dealer-bot-report.mjs', `--state=${state}`],
    {
      cwd: ROOT,
      // CRAWLER_RUN_DATE: same fix, same reason as buildBrandCrawlEnv()
      // below — with states now able to run concurrently, this step for a
      // state near the back of the scheduling pool can start hours after
      // `date` was computed. Without this, dealer-bot-report.mjs could
      // independently compute a later date and write its report under a
      // filename readReadyBrandsForState() (which looks it up by `date`)
      // would never find.
      env: { CRAWLER_RUN_DATE: date },
      logFile: path.join(LOGS_DIR, `${state.toLowerCase()}-bot-report-${date}.log`),
      timeoutMs: SUPPORT_STEP_TIMEOUT_MS,
    },
  );
  stateSummary.botReport.status = statusOf(stateSummary.botReport);

  // brandsToRun === null means "couldn't determine, fall back to every
  // in-scope brand" (defensive — better to over-attempt than silently
  // skip a whole state because the report step had a bad day). An
  // empty array from a successfully-read report is respected as-is: if
  // bot-report genuinely found zero ready brands, no brand is crawled.
  let brandsToRun = null;
  try {
    const { reportPath, brands } = await readReadyBrandsForState(state, date);
    stateSummary.readyBrands = brands;
    stateSummary.botReportPath = reportPath;
    brandsToRun = brands;
  } catch (err) {
    stateSummary.botReportReadError = err.message;
    brandsToRun = NJ_BRANDS_IN;
    console.error(`[driver] ${state}: couldn't read bot-report output (${err.message}) — falling back to attempting every in-scope brand.`);
  }

  const orderedBrands = NJ_BRANDS_IN.filter((b) => brandsToRun.includes(b));

  for (const brand of orderedBrands) {
    const { rel: dealersFile, count: dealerCount } = await dealerCountFor(state, brand);
    if (dealerCount === 0) {
      stateSummary.brands[brand] = { status: 'skipped', reason: `no dealers in ${dealersFile}` };
      continue;
    }

    const slug = slugify(brand);
    const logFile = path.join(LOGS_DIR, `${state.toLowerCase()}-${slug}-${date}.log`);
    console.log(`[driver] ${state} ${brand}: starting (${dealerCount} dealer(s), CRAWLER_DEALERS_FILE=${dealersFile})`);

    let result;
    try {
      result = await runStep('node', ['src/standalone.js'], {
        cwd: ROOT,
        env: buildBrandCrawlEnv({ state, brand, dealersFile, date }),
        logFile,
        timeoutMs: PER_BRAND_TIMEOUT_MS,
      });
    } catch (err) {
      // runStep is designed to never throw, but one more safety net so a
      // genuinely unexpected exception here still can't take out the rest
      // of this state's brand loop.
      result = {
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 0,
        exitCode: null,
        signal: null,
        timedOut: false,
        spawnError: err.message,
        logFile,
      };
    }

    result.status = statusOf(result);
    result.dealerCount = dealerCount;
    result.stats = await readBrandStatsFromDailyChanges(state, brand, date);

    console.log(`[driver] ${state} ${brand}: ${result.status} (exit ${result.exitCode}, ${Math.round(result.durationMs / 1000)}s)${result.stats ? ` — ${result.stats.totalActiveInventory} active, ${result.stats.totalPriceDrops} drops, ${result.stats.totalSoldOrRemoved} sold` : ''}`);

    stateSummary.brands[brand] = result;
  }

  stateSummary.finishedAt = new Date().toISOString();
  stateSummary.durationMs = Date.parse(stateSummary.finishedAt) - Date.parse(stateSummary.startedAt);
  return stateSummary;
}

export function computeGrandTotals(states) {
  const totals = {
    totalActiveInventory: 0,
    totalNewArrivals: 0,
    totalPriceDrops: 0,
    totalPriceIncreases: 0,
    totalSoldOrRemoved: 0,
    skippedForBotProtection: 0,
  };
  let brandsOk = 0;
  let brandsFailed = 0;
  let brandsSkipped = 0;
  for (const stateSummary of Object.values(states)) {
    for (const brandResult of Object.values(stateSummary.brands)) {
      if (brandResult.status === 'skipped') {
        brandsSkipped++;
        continue;
      }
      if (brandResult.status === 'ok') brandsOk++;
      else brandsFailed++;
      if (brandResult.stats) {
        for (const key of Object.keys(totals)) {
          totals[key] += brandResult.stats[key] || 0;
        }
      }
    }
  }
  return { ...totals, brandsOk, brandsFailed, brandsSkipped };
}

// Runs every state's full pipeline (write-dealers -> bot-report -> per-
// brand crawl loop, all inside runState()) with at most `maxConcurrent`
// states in flight at once — a small worker pool, not a fixed pairing.
//
// Why a pool instead of pre-computed pairs: states aren't equal size (see
// the MAX_CONCURRENT_STATES comment's numbers — FL and TX each dwarf NJ/
// NY/GA), and any fixed pairing baked into code would need updating by
// hand every time a state's real duration drifts or a new state is added,
// with no guarantee whoever edits it re-derives a good pairing. A pool
// gets the same result mechanically: `states` is processed in order, and
// the moment either slot frees up (a state finishes, however long or
// short it actually took that day), it immediately pulls the next not-yet-
// started state off the front of the list. With the current STATES order
// (NJ, NY, FL, GA, TX) and this driver's own historical per-state
// durations, that lands on essentially the same makespan as manually
// solving the 2-bin-packing problem for these five states (see the task
// notes: naive halving would suggest ~5h40m; the achieved schedule comes
// out within a couple minutes of that, because the long-running states
// (FL, TX) each claim a slot immediately and the short ones (NJ, NY, GA)
// backfill around them) — without hardcoding a single day's numbers into
// the scheduler itself.
//
// Each state's own runState() call keeps its existing try/catch around
// the whole per-brand loop; the try/catch here is a second, outer safety
// net so a state failing before runState() even builds its own
// stateSummary (e.g. an unregistered write-dealers script throwing
// immediately) still can't take down whichever other state is running
// concurrently in the other slot, and still gets recorded with real
// start/end timestamps like every other state.
// `runStateFn` defaults to the real runState() and exists as a seam for
// tests: runState() itself spawns real subprocesses (write-dealers script,
// bot-report, standalone.js per brand), so exercising the *scheduling*
// behavior here (bounded concurrency, per-state isolation, timestamps) in
// a fast unit test needs a fake that resolves/rejects on a controlled
// schedule instead — see test/run_daily_crawl.test.js.
export async function runStatesWithBoundedConcurrency(
  states,
  date,
  maxConcurrent = MAX_CONCURRENT_STATES,
  runStateFn = runState,
  {
    budgetMs = DRIVER_BUDGET_MS,
    runStartedAt = Date.now(),
    // Cross-box work-stealing (src/crawl_claims.js) — all three optional and
    // no-op by default, so every existing caller/test (fixed-length local
    // `states` only) is unaffected. When claimNextStateFn is given, a worker
    // that runs out of LOCAL states doesn't just exit: it asks the shared
    // claim queue for another state that fits in whatever budget is left,
    // and keeps going — see docs/CAPACITY_SLA.md for why a box running out
    // of local work early (not just one that's overloaded) is the case this
    // exists for.
    claimNextStateFn = null,
    // Called periodically (heartbeatIntervalMs) while ANY state — local or
    // stolen — is in flight, local ones included: a locally-assigned state
    // is seeded as pre-claimed by this same box (see main()), and without a
    // heartbeat it would look exactly as stale to a peer as an abandoned
    // stolen claim after a long-running state (TX alone took ~11.85h one
    // night — confirmed live 2026-09-25) outlives CRAWL_CLAIM_STALE_MS.
    heartbeatFn = null,
    heartbeatIntervalMs = 5 * 60 * 1000,
    // Called once per state (local or stolen) after it finishes, success or
    // failure — marks the shared claim 'done' (or released back to
    // 'unclaimed' on failure, so a peer can retry it tonight) and is the
    // observability trail (who ran what) the fleet-summary reads.
    releaseClaimFn = null,
  } = {},
) {
  const results = {};
  const queue = [...states];
  let nextIndex = 0;
  let budgetExceeded = false;

  async function worker() {
    for (;;) {
      // See DRIVER_BUDGET_MS's comment: only gates STARTING a new state,
      // never kills one already in flight. Checked before claiming the
      // next index so a state that hasn't started yet is left untouched
      // (and reported as skipped below) rather than started and abandoned.
      const remainingMs = budgetMs !== null ? budgetMs - (Date.now() - runStartedAt) : null;
      if (remainingMs !== null && remainingMs <= 0) {
        budgetExceeded = true;
        return;
      }

      let state;
      let stolen = false;
      if (nextIndex < queue.length) {
        state = queue[nextIndex++];
      } else if (claimNextStateFn) {
        const claimed = await claimNextStateFn(remainingMs).catch(() => null);
        if (!claimed) return; // nothing left to steal (or nothing that fits) — this worker is done
        state = claimed;
        stolen = true;
        queue.push(state);
        nextIndex++;
      } else {
        return;
      }

      const startedAt = new Date().toISOString();
      console.log(`[driver] ==== ${state}: starting (${startedAt})${stolen ? ' [stolen from shared queue]' : ''} ====`);
      const heartbeat = heartbeatFn ? setInterval(() => heartbeatFn(state), heartbeatIntervalMs) : null;
      try {
        results[state] = await runStateFn(state, date);
      } catch (err) {
        // A whole state blowing up (e.g. can't create dealers/<state>/ dir)
        // must not stop a concurrently-running other state.
        console.error(`[driver] ${state}: fatal error — ${err.stack || err.message}`);
        results[state] = { state, fatalError: err.message };
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
      const finishedAt = new Date().toISOString();
      // runState() already sets these on success; only fill them in here
      // if the fatal-error branch above skipped straight past runState's
      // own bookkeeping.
      if (!results[state].startedAt) results[state].startedAt = startedAt;
      if (!results[state].finishedAt) {
        results[state].finishedAt = finishedAt;
        results[state].durationMs = Date.parse(finishedAt) - Date.parse(results[state].startedAt);
      }
      if (stolen) results[state].stolen = true;
      console.log(`[driver] ==== ${state}: done (${finishedAt}, ${Math.round(results[state].durationMs / 1000)}s) ====`);
      if (releaseClaimFn) await releaseClaimFn(state, results[state].fatalError ? 'failed' : 'done').catch(() => {});
    }
  }

  // Capped to states.length only when stealing is off — a box with a short
  // local list but a real concurrency budget (box 1: as few as 3 local
  // states at 4x) must still spawn enough workers to ALSO pull from the
  // shared queue once its own list runs out, not sit at 3 workers all night.
  const workerCount = claimNextStateFn ? Math.max(1, maxConcurrent) : Math.max(1, Math.min(maxConcurrent, states.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Any state that never got a slot before the budget ran out is recorded
  // explicitly, not silently missing from the summary.
  if (budgetExceeded) {
    for (const state of states) {
      if (!results[state]) {
        results[state] = { state, status: 'skipped', reason: `driver time budget (${budgetMs}ms) exceeded before this state could start` };
        console.log(`[driver] ==== ${state}: skipped — time budget exceeded ====`);
      }
    }
  }

  return results;
}

// Predictive preflight check — refuses to even START a run whose real
// rooftop count, at the measured p90 rate, projects past MAX_PROJECTED_
// HOURS (default 24h — the hard SLA). This is deliberately separate from
// DRIVER_BUDGET_MS (which reacts to elapsed wall-clock time once a run is
// already under way): that guard stops STARTING new states once time runs
// out, but a shard that's simply too big to begin with would still limp
// through most of its states before hitting that ceiling, burning a whole
// night's compute for a run that was never going to finish anyway. This
// check catches that before a single dealer is crawled. brands is the
// resolved in-scope brand list for this run (NJ_BRANDS_IN already reflects
// CRAWLER_BRAND_SET — see nj_policy.js) so the same states list is sized
// correctly whether this is a core or expansion invocation.
export function checkProjectedRuntime(states, brands, maxConcurrent, cwd = process.cwd()) {
  const rooftops = countRooftopsForStates(states, brands, cwd);
  const hours = projectedHours(rooftops, maxConcurrent);
  const withinBudget = hours <= MAX_PROJECTED_HOURS;
  return { rooftops, projectedHours: hours, withinBudget };
}

// Written after EVERY run, success or not (a budget-abort or a fatal
// mid-run error still produces a report from whatever `summary` reached
// at that point — see main()'s try/catch/finally below) — an ops report
// that only exists on a clean night is worse than useless, since the
// nights you actually need it are the ones that didn't go cleanly.
// `runLabel` names the report directory (falls back to the brand set) so
// box 3/box 4's two independent daily jobs (11pm expansion, 4am core
// side-job) never overwrite each other's report.
async function writeBoxReport(summary, date) {
  try {
    const runLabel = process.env.CRAWLER_RUN_LABEL || process.env.CRAWLER_BRAND_SET || 'core';
    const report = await buildBoxReport(summary, {
      brandSet: process.env.CRAWLER_BRAND_SET || 'core',
      runLabel: process.env.CRAWLER_RUN_LABEL || null,
      concurrency: MAX_CONCURRENT_STATES,
      budgetHours: process.env.CRAWLER_DRIVER_BUDGET_HOURS ? Number(process.env.CRAWLER_DRIVER_BUDGET_HOURS) : null,
    });
    const dir = path.join(ROOT, 'data', 'runs', date, runLabel);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'box-report.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(dir, 'box-report.html'), renderBoxReportHtml(report));
    await appendCapacityHistoryRow(report, path.join(ROOT, 'docs', 'capacity_history.csv'));
    console.log(`[driver] box report written to ${dir}/box-report.json (SLA ${report.schedule.slaOk ? 'OK' : 'BREACH'}, ${report.schedule.wallClockHours}h)`);
    return report;
  } catch (err) {
    // A reporting failure must never mask the real crawl result — log and
    // move on, same principle as every other non-fatal error in this file.
    console.error('[driver] box report generation failed (non-fatal):', err.stack || err.message);
    return null;
  }
}

export async function main() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  await fs.mkdir(RUNS_DIR, { recursive: true });

  // Overlap guard — see acquireLock()'s comment. A refused start is
  // logged and exits cleanly (not an error): cron firing into an already-
  // running job is an expected occasional occurrence, not a failure.
  const lock = await acquireLock();
  if (!lock.acquired) {
    console.log(`[driver] skipping this run: ${lock.reason}`);
    return { skipped: true, reason: lock.reason };
  }
  if (lock.reclaimedStale) {
    console.log('[driver] reclaimed a stale lock file left by a run that is no longer alive.');
  }

  try {
    const date = todayStamp();
    const startedAt = new Date().toISOString();
    const pruneResult = await pruneOldLogs();
    console.log(`[driver] log retention: removed ${pruneResult.removed} of ${pruneResult.checked} log file(s) older than ${LOG_RETENTION_DAYS} days.`);

    const summary = {
      date,
      startedAt,
      maxConcurrentStates: MAX_CONCURRENT_STATES,
      logRetention: { days: LOG_RETENTION_DAYS, ...pruneResult },
      states: {},
    };

    // Predictive preflight — see checkProjectedRuntime()'s own comment.
    // Refuses to start at all if this shard's real rooftop count, at the
    // measured p90 rate, projects past the 24h hard SLA — catching an
    // oversized shard before a single dealer is crawled, rather than
    // discovering it 20 hours in. Release the overlap lock first so this
    // refusal doesn't block tonight's retry or a corrected redeploy.
    const capacityCheck = checkProjectedRuntime(STATES, NJ_BRANDS_IN, MAX_CONCURRENT_STATES);
    summary.capacityCheck = capacityCheck;
    if (!capacityCheck.withinBudget) {
      console.error(
        `[driver] REFUSING TO START: ${STATES.length} state(s) / ${capacityCheck.rooftops} rooftops project to `
        + `${capacityCheck.projectedHours.toFixed(1)}h at ${MAX_CONCURRENT_STATES}x concurrency (p90 rate `
        + `${P90_SECONDS_PER_ROOFTOP}s/rooftop) — over the ${MAX_PROJECTED_HOURS}h hard SLA. Shrink this box's `
        + `CRAWL_STATES (see scripts/recommend-shard-split.mjs) or raise CRAWLER_MAX_PROJECTED_HOURS if this is intentional.`,
      );
      summary.finishedAt = new Date().toISOString();
      await writeBoxReport(summary, date);
      await releaseLock();
      return { skipped: true, reason: 'projected runtime exceeds MAX_PROJECTED_HOURS', capacityCheck };
    }
    console.log(
      `[driver] capacity preflight: ${STATES.length} state(s) / ${capacityCheck.rooftops} rooftops, `
      + `projected ${capacityCheck.projectedHours.toFixed(1)}h at ${MAX_CONCURRENT_STATES}x concurrency (within ${MAX_PROJECTED_HOURS}h SLA).`,
    );

    // The report must be written even if the crawl itself blows up
    // unexpectedly (anything not already caught by runState()'s own
    // per-state try/catch) — an ops report that only exists on a clean
    // night defeats the point. This inner try/catch writes whatever
    // `summary` reached (states may be empty or partial) before
    // re-throwing, so the outer fatal-error behavior (non-zero exit,
    // visible to cron) is unchanged.
    // Cross-box work-stealing (src/crawl_claims.js) — seeded once per run,
    // opt-in via CRAWLER_STEAL_ENABLED=1. Seeding is idempotent (INSERT
    // IGNORE server-side), so it's safe even if multiple boxes' runs start
    // close together and both try to seed the same night's queue. This
    // box's OWN assigned states are seeded as already claimed by it (never
    // stealable while it's still working through them); every other
    // SUPPORTED_STATES entry seeds as plain unclaimed, available to any box
    // that finishes its own list first.
    const brandSet = process.env.CRAWLER_BRAND_SET || 'core';
    let stealOptions = {};
    if (STEAL_ENABLED) {
      const rooftopCounts = {};
      for (const state of SUPPORTED_STATES) rooftopCounts[state] = countRooftopsForState(state, NJ_BRANDS_IN);
      await seedClaims({ runDate: date, brandSet, rooftopCounts, owned: STATES }).catch((err) => {
        console.error(`[driver] crawl-claims seed failed (stealing disabled for this run): ${err.message}`);
      });
      stealOptions = {
        claimNextStateFn: async (remainingMs) => {
          if (remainingMs === null) return claimNextState({ runDate: date, brandSet });
          const maxRooftops = Math.floor(remainingMs / 1000 / STEAL_P90_SECONDS_PER_ROOFTOP);
          if (maxRooftops <= 0) return null;
          return claimNextState({ runDate: date, brandSet, maxRooftops });
        },
        heartbeatFn: (state) => heartbeatClaim({ runDate: date, brandSet, state }),
        releaseClaimFn: (state, status) => releaseClaim({ runDate: date, brandSet, state, status }),
      };
    }

    try {
      // Up to MAX_CONCURRENT_STATES states' full pipelines run at once —
      // see runStatesWithBoundedConcurrency()'s own comment for how
      // states are scheduled into the available slots, and
      // MAX_CONCURRENT_STATES' for why that number is 2 and not higher
      // on this box. With CRAWLER_STEAL_ENABLED=1, workers that exhaust
      // this box's own STATES list keep going against the shared claim
      // queue instead of returning — see stealOptions above.
      summary.states = await runStatesWithBoundedConcurrency(STATES, date, MAX_CONCURRENT_STATES, runState, stealOptions);

      summary.finishedAt = new Date().toISOString();
      summary.durationMs = Date.parse(summary.finishedAt) - Date.parse(summary.startedAt);
      summary.grandTotals = computeGrandTotals(summary.states);

      const summaryPath = path.join(RUNS_DIR, `summary_${date}.json`);
      await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
      await fs.writeFile(path.join(RUNS_DIR, 'latest.json'), JSON.stringify(summary, null, 2));

      console.log(`[driver] summary written to ${summaryPath}`);
      console.log(`[driver] grand totals: ${JSON.stringify(summary.grandTotals)}`);

      summary.boxReport = await writeBoxReport(summary, date);
      return summary;
    } catch (err) {
      summary.finishedAt = summary.finishedAt || new Date().toISOString();
      summary.fatalError = err.message;
      await writeBoxReport(summary, date);
      throw err;
    }
  } finally {
    await releaseLock();
  }
}

// Only run when invoked directly (`node scripts/run-daily-crawl.mjs`), not
// when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      // The one thing that should make cron's own run visibly fail: this
      // driver itself throwing outside of the per-state/per-brand
      // try/catch above (e.g. failing to write the summary file at all).
      console.error('[driver] fatal:', err.stack || err.message);
      process.exit(1);
    });
}
