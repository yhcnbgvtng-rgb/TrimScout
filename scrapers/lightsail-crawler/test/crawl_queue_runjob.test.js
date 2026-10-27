// What a queue job actually executes, and what its child processes see. The fixed driver runs the same steps per brand; the
// queue must not change them — only who runs them. Also pins the integration seams (the driver hook and its exports).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { makeRunJob, jobEnv, missingDriverExports, brandSetOf } from '../scripts/run-crawl-queue.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const job = (state, brand, o = {}) => ({ jobKey: `${state}|${brand}`, state, brand, brandSet: brandSetOf(brand), dealers: 10, ...o });

function fixture({ ready = true, count = 10, status = 'ok', sharded = false, notReady = undefined } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rj-'));
  const calls = [];
  const deps = {
    runStep: async (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts.env, timeoutMs: opts.timeoutMs, logFile: opts.logFile });
      if (args[0] === 'scripts/dealer-bot-report.mjs') {
        const st = args[1].split('=')[1].toLowerCase(); const brand = args[2].split('=')[1];
        const label = opts.env.CRAWLER_RUN_LABEL; const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        fs.mkdirSync(path.join(root, 'data', 'reports'), { recursive: true });
        fs.writeFileSync(path.join(root, 'data', 'reports', `dealer-bot-report-${st}-${label}-${slug}-${opts.env.CRAWLER_RUN_DATE}.json`), JSON.stringify({ runLabel: label, readyToCrawl: ready ? [{ brand }] : [], ...(notReady ? { notReady } : {}) }));
        return { exitCode: 0 };
      }
      if (args[0] === 'src/standalone.js') return { exitCode: status === 'ok' ? 0 : status === 'timeout' ? null : 1, timedOut: status === 'timeout', durationMs: 5 };
      return { exitCode: 0 };
    },
    runBrandSharded: async (state, brand, rel, n, date, runStepFn) => { await runStepFn('node', ['src/standalone.js'], { env: { CRAWLER_BRAND: brand }, timeoutMs: 7_200_000 }); return { status, sharded: true, shardsOk: status === 'ok' ? 2 : 1, shardCount: 2, stats: { totalActiveInventory: 42 } }; },
    buildBrandCrawlEnv: ({ state, brand }) => ({ CRAWLER_BRAND: brand, CRAWLER_STATE: state }),
    dealerCount: async () => ({ rel: 'dealers/tx/x.json', count }),
    statsFromDailyChanges: async () => ({ totalActiveInventory: 7 }),
    writeDealerScripts: { TX: 'write-tx-dealer-files.mjs', DE: 'write-de-dealer-files.mjs' },
    perBrandTimeoutMs: 7_200_000, maxDealersPerShard: 25,
  };
  return { root, calls, deps };
}

describe('child-process environment', () => {
  it('a core job never inherits the expansion brand set, and an expansion job gets its page size', () => {
    assert.deepEqual(jobEnv('core', { CRAWL_QUEUE_EXPANSION_PAGE: '500' }), { CRAWLER_BRAND_SET: 'core', CRAWLER_RUN_LABEL: 'core', CRAWLER_MAX_VEHICLES_PER_DEALER: '0' });
    assert.deepEqual(jobEnv('expansion', {}), { CRAWLER_BRAND_SET: 'expansion', CRAWLER_RUN_LABEL: 'expansion', CRAWLER_MAX_VEHICLES_PER_DEALER: '1000' });
    assert.equal(jobEnv('expansion', { CRAWL_QUEUE_EXPANSION_PAGE: '500' }).CRAWLER_MAX_VEHICLES_PER_DEALER, '500');
  });
  it('every child of a core job gets the core env, even though the driver process is running under the expansion cron\'s env', async () => {
    const f = fixture();
    const run = makeRunJob({ date: '2026-10-14', root: f.root, log: () => {}, deps: f.deps });
    await run(job('TX', 'Toyota'));
    assert.ok(f.calls.length >= 3); // write-dealers, bot-report, standalone
    for (const c of f.calls) assert.equal(c.env.CRAWLER_BRAND_SET, 'core', `${c.args[0]} got ${c.env.CRAWLER_BRAND_SET}`);
  });
});

describe('a job runs the same steps as the fixed driver, in the same order', () => {
  it('core: write-dealers (once per state) -> bot-report for the brand -> standalone with the 2h kill', async () => {
    const f = fixture();
    const run = makeRunJob({ date: '2026-10-14', root: f.root, log: () => {}, deps: f.deps });
    const r = await run(job('TX', 'Toyota'));
    assert.deepEqual(f.calls.map((c) => c.args[0]), ['scripts/write-tx-dealer-files.mjs', 'scripts/dealer-bot-report.mjs', 'src/standalone.js']);
    assert.equal(f.calls[2].timeoutMs, 7_200_000);
    assert.equal(f.calls[2].env.CRAWLER_DEALERS_FILE, undefined); // passed via buildBrandCrawlEnv; fixture's fake only sets BRAND/STATE
    assert.equal(f.calls[2].env.CRAWLER_BRAND, 'Toyota');
    assert.deepEqual({ ok: r.ok, vehicles: r.vehicles }, { ok: true, vehicles: 7 });
    await run(job('TX', 'Honda')); // second brand of the same state on this box: no second write-dealers
    assert.equal(f.calls.filter((c) => c.args[0].startsWith('scripts/write-')).length, 1);
  });
  it('expansion: write-dealers is skipped (the files are pre-materialised; rewriting them emptied them once)', async () => {
    const f = fixture();
    const run = makeRunJob({ date: '2026-10-14', root: f.root, log: () => {}, deps: f.deps });
    await run(job('TX', 'Ford'));
    assert.deepEqual(f.calls.map((c) => c.args[0]), ['scripts/dealer-bot-report.mjs', 'src/standalone.js']);
    assert.equal(f.calls[1].env.CRAWLER_BRAND_SET, 'expansion');
    assert.equal(f.calls[1].env.CRAWLER_MAX_VEHICLES_PER_DEALER, '1000');
  });
  it('a shard with more than 25 dealers is split in chunks by the driver\'s own runBrandSharded, with the job env on every chunk', async () => {
    const f = fixture({ count: 60 });
    const run = makeRunJob({ date: '2026-10-14', root: f.root, log: () => {}, deps: f.deps });
    const r = await run(job('TX', 'Ford'));
    assert.equal(r.ok, true);
    assert.equal(r.vehicles, 42);
    const chunkCall = f.calls.find((c) => c.args[0] === 'src/standalone.js');
    assert.equal(chunkCall.env.CRAWLER_BRAND_SET, 'expansion');
    assert.equal(chunkCall.timeoutMs, 7_200_000);
  });
  it('a brand the bot-protection report does not clear is skipped, not crawled (nothing is bypassed)', async () => {
    const f = fixture({ ready: false });
    const run = makeRunJob({ date: '2026-10-14', root: f.root, log: () => {}, deps: f.deps });
    const r = await run(job('TX', 'Ford'));
    assert.deepEqual({ ok: r.ok, skipped: r.skipped }, { ok: true, skipped: true });
    assert.equal(f.calls.some((c) => c.args[0] === 'src/standalone.js'), false);
  });
  it('an unreadable report falls back to attempting the brand, like the driver', async () => {
    const f = fixture();
    const orig = f.deps.runStep;
    f.deps.runStep = async (cmd, args, opts) => (args[0] === 'scripts/dealer-bot-report.mjs' ? { exitCode: 1 } : orig(cmd, args, opts));
    const run = makeRunJob({ date: '2026-10-14', root: f.root, log: () => {}, deps: f.deps });
    assert.equal((await run(job('TX', 'Ford'))).ok, true);
  });
  it('a bot-report skip is logged with every store\'s answer (it used to be silent: OK Mazda vanished with no log line)', async () => {
    const lines = [];
    const f = fixture({ ready: false, notReady: [
      { brand: 'Mazda', dealerName: 'NELSON MAZDA', classification: 'HTTP_429', httpStatus: 429 },
      { brand: 'Mazda', dealerName: 'BOB MOORE MAZDA', classification: 'HTTP_5XX', httpStatus: 503 },
      { brand: 'Toyota', dealerName: 'Other', classification: 'HTTP_403', httpStatus: 403 },
    ] });
    const run = makeRunJob({ date: '2026-10-14', root: f.root, log: (m) => lines.push(m), deps: f.deps });
    const r = await run(job('TX', 'Mazda')); // the fixture only knows TX/DE write-dealers scripts; the logic is state-independent
    assert.equal(r.exit, 'skipped-bot-report');
    const line = lines.find((l) => /SKIPPED TONIGHT/.test(l));
    assert.ok(line, `no skip line in ${JSON.stringify(lines)}`);
    assert.match(line, /TX Mazda/);
    assert.match(line, /NELSON MAZDA: HTTP_429 429/);
    assert.match(line, /BOB MOORE MAZDA: HTTP_5XX 503/);
    assert.doesNotMatch(line, /Other/, 'only this brand\'s stores');
  });

  it('no dealers on disk: skipped as a coverage gap, not failed', async () => {
    const f = fixture({ count: 0 });
    const run = makeRunJob({ date: '2026-10-14', root: f.root, log: () => {}, deps: f.deps });
    assert.equal((await run(job('TX', 'Ford'))).skipped, true);
  });
  it('a crawl killed at the 2h cap is NOT retryable; any other failure is', async () => {
    const t = await makeRunJob({ date: 'd', root: fixture().root, log: () => {}, deps: fixture({ status: 'timeout' }).deps })(job('TX', 'Ford'));
    assert.deepEqual({ ok: t.ok, retryable: t.retryable, exit: t.exit }, { ok: false, retryable: false, exit: 'timeout' });
    const e = await makeRunJob({ date: 'd', root: fixture().root, log: () => {}, deps: fixture({ status: 'error' }).deps })(job('TX', 'Ford'));
    assert.deepEqual({ ok: e.ok, retryable: e.retryable }, { ok: false, retryable: true });
  });
  it('an exception anywhere is a retryable failure, not an unhandled rejection', async () => {
    const f = fixture();
    f.deps.dealerCount = async () => { throw new Error('disk gone'); };
    const r = await makeRunJob({ date: 'd', root: f.root, log: () => {}, deps: f.deps })(job('TX', 'Ford'));
    assert.deepEqual({ ok: r.ok, retryable: r.retryable, error: r.error }, { ok: false, retryable: true, error: 'disk gone' });
  });
});

describe('shared VIN cache around a job', () => {
  it('pulls before, pushes the new lookups after a successful crawl, and never fails the job', async () => {
    const f = fixture(); const order = [];
    const vinCache = { pullState: async (s) => order.push(`pull ${s}`), snapshotBrand: async () => { order.push('snapshot'); return new Set(['A']); }, pushNew: async (s, b, before) => { order.push(`push ${s} ${b} ${before.size}`); return { sent: 3 }; } };
    const run = makeRunJob({ date: 'd', root: f.root, log: () => {}, deps: f.deps, vinCache });
    assert.equal((await run(job('TX', 'Ford'))).ok, true);
    assert.deepEqual(order, ['pull TX', 'snapshot', 'push TX Ford 1']);
  });
  it('does not push after a failed crawl', async () => {
    const f = fixture({ status: 'error' }); let pushed = false;
    const vinCache = { pullState: async () => {}, snapshotBrand: async () => new Set(), pushNew: async () => { pushed = true; return {}; } };
    await makeRunJob({ date: 'd', root: f.root, log: () => {}, deps: f.deps, vinCache })(job('TX', 'Ford'));
    assert.equal(pushed, false);
  });
});

describe('integration seams', () => {
  it('the repo driver already carries exactly the text the box patcher inserts, and it sits before the lock and the fixed-state crawl', async () => {
    const { patchText } = await import('../../../scripts/box/2026-10-14-crawl-queue-patch.mjs');
    const anchors = JSON.parse(fs.readFileSync(path.join(ROOT, '..', '..', 'scripts', 'box', '2026-10-14-crawl-queue-anchors.json'), 'utf-8')).filter((x) => x.file === 'driver');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'run-daily-crawl.mjs'), 'utf-8');
    assert.equal(patchText(src, anchors, 'check').results[0].status, 'ALREADY-APPLIED');
    const hook = src.indexOf('crawl-queue (flag-gated');
    assert.ok(hook > src.indexOf('export async function main()') && hook < src.indexOf('await acquireLock()'));
    assert.ok(hook < src.indexOf('await fs.mkdir(LOGS_DIR', hook));
  });
  it('with the flag on for a host, the real driver main() exits at once without taking a lock, creating logs or loading the worker', () => {
    const out = execFileSync('node', ['-e', "import('./scripts/run-daily-crawl.mjs').then((m) => m.main()).then((r) => console.log('RESULT ' + JSON.stringify(r)))"], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, CRAWL_QUEUE: '1', CRAWL_QUEUE_ROLE: 'host', TRIMSCOUT_BOX_LABEL: 'box2' } });
    assert.match(out, /box2 hosts it: this box does not crawl/);
    assert.match(out, /RESULT {"skipped":true,"reason":"queue host"}/);
  });
  it('the driver exports everything the queue worker needs (a drifted box missing one refuses to run, loudly)', () => {
    assert.deepEqual(missingDriverExports(), []);
    assert.deepEqual(missingDriverExports({ ROOT: 1 }).sort(), ['MAX_DEALERS_PER_SHARD', 'PER_BRAND_TIMEOUT_MS', 'WRITE_DEALER_SCRIPTS', 'buildBrandCrawlEnv', 'runBrandSharded', 'runStep', 'slugify']);
  });
  it('flag off: queueModeMain returns null without touching the lock, the network or the disk', async () => {
    const { queueModeMain } = await import('../scripts/run-crawl-queue.mjs');
    assert.equal(await queueModeMain({ env: { CRAWLER_DIR: '/nonexistent' }, flagOverride: { enabled: false } }), null);
  });
  it('flag on for a host: it says so and does not crawl', async () => {
    const { queueModeMain } = await import('../scripts/run-crawl-queue.mjs');
    const r = await queueModeMain({ flagOverride: { enabled: true, box: 'box2', role: 'host' } });
    assert.deepEqual(r, { skipped: true, reason: 'queue host' });
  });
});
