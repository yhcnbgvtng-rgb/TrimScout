#!/usr/bin/env node
// Queue-mode crawl worker (2026-10-13). Reached two ways:
//   1. automatically — run-daily-crawl.mjs main() calls queueModeMain() first when the crawl-queue flag is on (a one-block
//      hook added by the install script), so the existing 22:00 crons and run_nightly_chain.sh need no change at all;
//   2. by hand — the pilot / status commands below.
//
// Flag OFF (the default): this file is never loaded and the fixed-state driver runs exactly as before.
//
//   node scripts/run-crawl-queue.mjs --pilot=DE         # one-state pilot: real crawl of every shard of ONE state, own queue night
//   node scripts/run-crawl-queue.mjs --status           # tonight's queue as box2 sees it
//   node scripts/run-crawl-queue.mjs --seed-dry-run     # the job list this box would seed, nothing sent
//
// What a job is: one (state, brand) dealer shard, run through the SAME steps the fixed driver uses per brand — write-dealers
// (core only, once per state per box), the bot-protection report (detect-only, never bypassed), then standalone.js, split in
// 25-dealer chunks each with the 2h kill when the shard is bigger. The queue changes WHO runs a shard, never HOW.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as driver from './run-daily-crawl.mjs';
import { NJ_BRANDS_IN_CORE, NJ_BRANDS_IN_EXPANSION } from '../src/nj_policy.js';
import { readFlag } from '../src/crawlQueueFlag.js';
import { makeQueueClient, request } from '../src/crawlQueueClient.js';
import { runWorker } from '../src/crawlQueueWorker.js';
import { buildSeedJobs, nightFromEnv, fileDateOf, makeManifestWriter, shardFileName } from '../src/crawlQueueSeed.js';
import { makeVinCacheSync } from '../src/vinCacheShared.js';
import { makePressureWaiter } from '../src/crawlQueuePressure.js';
import { jobKey, easternDate } from '../src/crawlQueueCore.js';

const { ROOT, runStep, runBrandSharded, buildBrandCrawlEnv, slugify, PER_BRAND_TIMEOUT_MS, MAX_DEALERS_PER_SHARD, WRITE_DEALER_SCRIPTS } = driver;
const LOGS_DIR = path.join(ROOT, 'logs');
const RUNS_DIR = path.join(ROOT, 'data', 'daily_crawl_runs');
const SUPPORT_STEP_TIMEOUT_MS = 30 * 60 * 1000; // write-dealers / bot-report, same as the driver
const SNAPSHOT = path.join(ROOT, 'config', 'crawl_queue_timings.json');
const LOCK = path.join(RUNS_DIR, 'driver-queue.lock');

const REQUIRED_DRIVER_EXPORTS = ['ROOT', 'runStep', 'runBrandSharded', 'buildBrandCrawlEnv', 'slugify', 'PER_BRAND_TIMEOUT_MS', 'MAX_DEALERS_PER_SHARD', 'WRITE_DEALER_SCRIPTS'];
export function missingDriverExports(mod = driver) { return REQUIRED_DRIVER_EXPORTS.filter((k) => mod[k] === undefined); }

export const brandSetOf = (brand) => (NJ_BRANDS_IN_EXPANSION.includes(brand) ? 'expansion' : 'core');

/**
 * The env a job's child processes get. The driver process itself carries ONE brand set's env (the cron's), but a queue
 * worker runs both sets, so every child gets its own set explicitly: a core child must never see CRAWLER_BRAND_SET=expansion
 * (write-dealers would overwrite the pre-materialised expansion dealer files with empty arrays — the 2026-09-21 bug), and an
 * expansion child needs the page size the expansion crons set.
 */
export function jobEnv(brandSet, env = process.env) {
  return brandSet === 'expansion'
    ? { CRAWLER_BRAND_SET: 'expansion', CRAWLER_RUN_LABEL: 'expansion', CRAWLER_MAX_VEHICLES_PER_DEALER: env.CRAWL_QUEUE_EXPANSION_PAGE || '1000' }
    : { CRAWLER_BRAND_SET: 'core', CRAWLER_RUN_LABEL: 'core', CRAWLER_MAX_VEHICLES_PER_DEALER: '0' };
}

const statusOfStep = (r) => (r.spawnError ? 'error' : r.timedOut ? 'timeout' : r.exitCode === 0 ? 'ok' : 'error');

async function dealerCount(state, brand, root = ROOT) {
  const rel = path.join('dealers', state.toLowerCase(), `${slugify(brand)}.json`);
  try { const d = JSON.parse(await fs.readFile(path.join(root, rel), 'utf-8')); return { rel, count: Array.isArray(d) ? d.length : 0 }; } catch { return { rel, count: 0 }; }
}

async function statsFromDailyChanges(state, brand, date, root = ROOT) {
  try { return JSON.parse(await fs.readFile(path.join(root, 'data', 'daily_changes', `daily_changes_${date}.json`), 'utf-8'))?.states?.[state]?.brands?.[brand]?.stats || null; } catch { return null; }
}

/** Builds the function the worker calls per claimed job. Every external effect is a dep, so tests run it with fakes. */
export function makeRunJob({ date, vinCache, log = console.log, root = ROOT, deps = {} }) {
  const d = { runStep, runBrandSharded, buildBrandCrawlEnv, dealerCount, statsFromDailyChanges, writeDealerScripts: WRITE_DEALER_SCRIPTS, perBrandTimeoutMs: PER_BRAND_TIMEOUT_MS, maxDealersPerShard: MAX_DEALERS_PER_SHARD, ...deps };
  const prepared = new Map();

  // core brand set only; once per state per box per night (concurrent jobs of one state wait for the first)
  function prepareState(state, brandSet) {
    if (brandSet === 'expansion') return Promise.resolve();
    if (!prepared.has(state)) {
      prepared.set(state, (async () => {
        const script = d.writeDealerScripts[state];
        if (!script) throw new Error(`no write-dealers script registered for ${state}`);
        const r = await d.runStep('node', [path.join('scripts', script)], { cwd: root, env: jobEnv('core'), logFile: path.join(LOGS_DIR, `${state.toLowerCase()}-write-dealers-${date}.log`), timeoutMs: SUPPORT_STEP_TIMEOUT_MS });
        if (statusOfStep(r) !== 'ok') log(`[queue] ${state} write-dealers ${statusOfStep(r)} (exit ${r.exitCode}) — continuing with the dealer files already on disk`);
      })());
    }
    return prepared.get(state);
  }

  async function botReady(state, brand, brandSet) {
    const env = { ...jobEnv(brandSet), CRAWLER_RUN_DATE: date };
    const r = await d.runStep('node', ['scripts/dealer-bot-report.mjs', `--state=${state}`, `--brand=${brand}`], { cwd: root, env, logFile: path.join(LOGS_DIR, `${state.toLowerCase()}-${slugify(brand)}-bot-report-${date}.log`), timeoutMs: SUPPORT_STEP_TIMEOUT_MS });
    try {
      const file = path.join(root, 'data', 'reports', `dealer-bot-report-${state.toLowerCase()}-${brandSet}-${slugify(brand)}-${date}.json`);
      const report = JSON.parse(await fs.readFile(file, 'utf-8'));
      if (report.runLabel !== brandSet) throw new Error(`report written under runLabel ${report.runLabel}`);
      return (report.readyToCrawl || []).some((x) => x.brand === brand);
    } catch (e) {
      // Same fallback as the driver: if the report can't be read, attempt the brand rather than silently skip it.
      log(`[queue] ${state} ${brand}: bot-report unreadable (${e.message}; step ${statusOfStep(r)}) — attempting the brand`);
      return true;
    }
  }

  return async function runJob(job) {
    const { state, brand, brandSet } = job;
    const env = jobEnv(brandSet);
    const wrapped = (cmd, args, opts = {}) => d.runStep(cmd, args, { ...opts, env: { ...(opts.env || {}), ...env } });
    try {
      await prepareState(state, brandSet);
      if (!(await botReady(state, brand, brandSet))) return { ok: true, skipped: true, exit: 'skipped-bot-report', vehicles: null };
      const { rel, count } = await d.dealerCount(state, brand, root);
      if (count === 0) { log(`[queue] COVERAGE GAP ${state} ${brand}: 0 dealers in ${rel} — shard NOT crawled`); return { ok: true, skipped: true, exit: 'skipped-no-dealers' }; }

      // Shared VIN cache: merge what other boxes already looked up into the state cache #496's top-up reads, then remember
      // which VINs the shard's own cache holds so only the new ones are shared afterwards. Best-effort; never fails the job.
      let before = null;
      if (vinCache) { await vinCache.pullState(state); before = await vinCache.snapshotBrand(state, brand); }

      let status; let stats = null; let detail = '';
      if (count > d.maxDealersPerShard) {
        const r = await d.runBrandSharded(state, brand, rel, count, date, wrapped);
        status = r.status; stats = r.stats || null; detail = r.sharded ? `${r.shardsOk}/${r.shardCount} chunks ok` : '';
      } else {
        const logFile = path.join(LOGS_DIR, `${state.toLowerCase()}-${slugify(brand)}-${date}.log`);
        log(`[queue] ${state} ${brand}: starting (${count} dealer(s))`);
        const r = await wrapped('node', ['src/standalone.js'], { cwd: root, env: d.buildBrandCrawlEnv({ state, brand, dealersFile: rel, date }), logFile, timeoutMs: d.perBrandTimeoutMs });
        status = statusOfStep(r); detail = `exit ${r.exitCode}${r.signal ? `, signal ${r.signal}` : ''}`;
        stats = await d.statsFromDailyChanges(state, brand, date, root);
      }
      if (status === 'ok') {
        if (vinCache && before) { const p = await vinCache.pushNew(state, brand, before); if (p.sent || p.error) log(`[queue] ${state} ${brand}: shared ${p.sent ?? 0} new VIN lookup(s)${p.error ? ` (${p.error})` : ''}`); }
        return { ok: true, exit: 'ok', vehicles: stats?.totalActiveInventory ?? null };
      }
      // A killed-at-2h shard is not retried: the same cap would burn another 2h. Anything else gets one retry elsewhere.
      return { ok: false, retryable: status !== 'timeout', exit: status, error: `${state} ${brand}: ${status} (${detail})` };
    } catch (e) {
      return { ok: false, retryable: true, exit: 'error', error: e.message };
    }
  };
}

// ---- process-level lock, the same mechanism the sync gate already honours (every driver*.lock with a live pid) --------
function acquireQueueLock() {
  try { fsSync.mkdirSync(RUNS_DIR, { recursive: true }); } catch { /* exists */ }
  try {
    const cur = JSON.parse(fsSync.readFileSync(LOCK, 'utf-8'));
    if (cur.pid && cur.pid !== process.pid) { try { process.kill(cur.pid, 0); return { acquired: false, reason: `queue worker pid ${cur.pid} is still running` }; } catch { /* stale */ } }
  } catch { /* none */ }
  fsSync.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), kind: 'crawl-queue-worker' }));
  return { acquired: true };
}
const releaseQueueLock = () => { try { if (JSON.parse(fsSync.readFileSync(LOCK, 'utf-8')).pid === process.pid) fsSync.unlinkSync(LOCK); } catch { /* gone */ } };

async function nightStart(night) {
  // First process of the night records when it began, so a later stage (the chain's second driver call) shares the same budget.
  const f = path.join(ROOT, 'data', 'crawl_queue', `night-${night}.json`);
  try { return JSON.parse(await fs.readFile(f, 'utf-8')).startedAt; } catch { /* first */ }
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify({ night, startedAt }));
  return startedAt;
}

async function localDeclared(env = process.env) {
  // What this box's own cron says it covers is always part of the job list, so switching the queue on can never drop a
  // shard the fixed crons covered: CRAWL_STATES x the brand set of the stage that is running (CRAWLER_BRAND_SET=expansion for
  // box3/box4's first stage, core otherwise). Brands of the OTHER set are not added — the old crons never ran them in that
  // stage, and the repo holds expansion dealer files for the 27 deferred backlog states that must stay out of the nightly.
  const out = [];
  const states = driver.STATES || [];
  const [brandSet, brands] = env.CRAWLER_BRAND_SET === 'expansion' ? ['expansion', NJ_BRANDS_IN_EXPANSION] : ['core', NJ_BRANDS_IN_CORE];
  for (const state of states) for (const brand of brands) {
    const { count } = await dealerCount(state, brand);
    if (count > 0) out.push({ state, brand, brandSet, dealers: count });
  }
  return out;
}

/** Returns null when the flag is off (caller continues with the fixed-state crawl); otherwise the night's summary. */
export async function queueModeMain({ env = process.env, flagOverride = null, states = null, nightOverride = null } = {}) {
  const flag = flagOverride || readFlag(ROOT, env);
  if (!flag.enabled) return null;
  if (flag.role === 'host') { console.log(`[queue] ${flag.box} hosts the crawl queue and does not crawl — exiting`); return { skipped: true, reason: 'queue host' }; }
  const missing = missingDriverExports();
  if (missing.length) throw new Error(`crawl queue is ON but scripts/run-daily-crawl.mjs on this box lacks: ${missing.join(', ')} — refusing to crawl. Turn the flag off (crawl-queue-install.sh rollback) or update the driver.`);
  const lock = acquireQueueLock();
  if (!lock.acquired) { console.log(`[queue] not starting: ${lock.reason}`); return { skipped: true, reason: lock.reason }; }
  try {
    const night = nightOverride || nightFromEnv(env);
    const date = fileDateOf(night);
    await fs.mkdir(LOGS_DIR, { recursive: true });
    const client = makeQueueClient(flag.box);
    const startedAt = await nightStart(night);
    const budgetMs = (Number(env.CRAWLER_DRIVER_BUDGET_HOURS) || 23) * 3600_000;

    let snapshot = { universe: {}, timings: {} };
    try { snapshot = JSON.parse(await fs.readFile(SNAPSHOT, 'utf-8')); } catch { console.log('[queue] no timing snapshot found; sizing jobs from dealer counts only'); }
    const history = await client.history().catch(() => null);
    const heavy = (s, b) => (driver.heapMbFor && driver.DEFAULT_HEAP_MB ? driver.heapMbFor(s, b) > driver.DEFAULT_HEAP_MB : false);
    const jobs = buildSeedJobs({ snapshot, history, local: await localDeclared(env), states, exclude: flag.excludeStates || [], heavy, brandSetOf });
    const seeded = await client.seed({ night, jobs });
    console.log(`[queue] ${flag.box}: night ${night} — ${jobs.length} shard(s) offered, ${seeded.seeded} new in the queue; ${flag.slots} slot(s)`);

    const waitForPressure = makePressureWaiter({ log: (m) => console.log(m) });
    const vinCache = makeVinCacheSyncSafe({ waitForPressure });
    const manifest = makeManifestWriter(ROOT, night, flag.box);
    const runJob = makeRunJob({ date, vinCache });
    const summary = { date, night, box: flag.box, startedAt: new Date().toISOString(), maxConcurrentStates: flag.slots, states: {} };
    const results = await runWorker({
      client, flag, night, runJob, deadlineMs: Math.max(0, budgetMs - (Date.now() - startedAt)),
      onFinished: async (job, res) => {
        const sv = (summary.states[job.state] ||= { state: job.state, brands: {} });
        sv.brands[job.brand] = { status: res.skipped ? 'skipped' : 'ok', dealerCount: job.dealers, durationMs: res.durationSeconds * 1000, stats: res.vehicles != null ? { totalActiveInventory: res.vehicles } : null };
        if (!res.skipped) await manifest.add({ jobKey: jobKey(job.state, job.brand), file: shardFileName(job.state, job.brand), startedAt: res.startedAt, finishedAt: Date.now(), durationSeconds: res.durationSeconds, vehicles: res.vehicles ?? null });
      },
    });
    await manifest.done();
    summary.finishedAt = new Date().toISOString();
    summary.results = results;
    await fs.mkdir(RUNS_DIR, { recursive: true });
    // The chain's second driver call (box3/box4 "core" stage) re-enters here after the first drained the queue; it must add to the
    // night's summary, not overwrite the timings the first stage recorded.
    const sumFile = path.join(RUNS_DIR, `queue_summary_${night}.json`);
    try {
      const prev = JSON.parse(await fs.readFile(sumFile, 'utf-8'));
      for (const [st, sv] of Object.entries(prev.states || {})) summary.states[st] = { ...sv, ...(summary.states[st] || {}), brands: { ...(sv.brands || {}), ...((summary.states[st] || {}).brands || {}) } };
      summary.startedAt = prev.startedAt || summary.startedAt;
      summary.results = [...(prev.results || []), ...results];
    } catch { /* first stage of the night */ }
    await fs.writeFile(sumFile, JSON.stringify(summary, null, 2));
    const by = results.reduce((a, r) => ({ ...a, [r.outcome]: (a[r.outcome] || 0) + 1 }), {});
    console.log(`[queue] ${flag.box}: night ${night} finished on this box — ${JSON.stringify(by)}; manifest ${manifest.file}`);
    return summary;
  } finally {
    releaseQueueLock();
  }
}

function makeVinCacheSyncSafe({ waitForPressure }) {
  try { return makeVinCacheSync({ cwd: ROOT, request, waitForPressure: () => waitForPressure('vin-cache') }); } catch (e) { console.log(`[queue] shared VIN cache off (${e.message})`); return null; }
}

// ---- CLI ---------------------------------------------------------------------------------------------------------------
async function cli() {
  const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  const box = arg('box') || process.env.TRIMSCOUT_BOX_LABEL || os.hostname();
  if (process.argv.includes('--status')) {
    const night = nightFromEnv(process.env);
    console.log(JSON.stringify(await makeQueueClient(box).status({ night }), null, 1));
    return;
  }
  const pilot = arg('pilot');
  if (pilot) {
    const st = pilot.toUpperCase();
    if (!/^[A-Z]{2}$/.test(st)) throw new Error('--pilot=<2-letter state>');
    const night = `${easternDate()}-pilot`; // the calendar date, not the nightly's cron-anchored one: an afternoon pilot must not file under last night's date
    process.env.CRAWL_QUEUE_NIGHT = night;
    const slots = Number(arg('slots')) || 2;
    console.log(`[pilot] real crawl of every ${st} shard through the queue, night ${night}, box ${box}, ${slots} slot(s). Sync NOT started — see the install script's pilot instructions.`);
    const out = await queueModeMain({ flagOverride: { enabled: true, box, role: 'worker', slots, brandSets: null, maxHeavy: 1 }, states: [st], nightOverride: night });
    console.log(JSON.stringify(out && { night: out.night, results: out.results }, null, 1));
    return;
  }
  if (process.argv.includes('--seed-dry-run')) {
    const snapshot = JSON.parse(await fs.readFile(SNAPSHOT, 'utf-8'));
    const jobs = buildSeedJobs({ snapshot, local: await localDeclared(), brandSetOf, heavy: () => false });
    console.log(`${jobs.length} shards, ${(jobs.reduce((a, j) => a + j.estSeconds, 0) / 3600).toFixed(1)}h of single-slot work`);
    return;
  }
  console.error('usage: run-crawl-queue.mjs --pilot=<ST> [--box=boxN] [--slots=2] | --status | --seed-dry-run');
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  cli().then(() => process.exit(0)).catch((e) => { console.error('[queue] fatal:', e.stack || e.message); process.exit(1); });
}
