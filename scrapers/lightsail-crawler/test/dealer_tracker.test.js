// src/dealerTracker.js + scripts/dealer-tracker-summary.mjs: what is recorded for each way a dealer attempt can end, that nulls stay null, that concurrent
// processes never interleave a record, that a crash leaves an attempt visibly incomplete, and that NOTHING the tracker does can reach the crawl.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDealerTracker, noopTracker, classify, scrubMessage, pruneOld, DEFAULT_RETAIN_DAYS, MAX_CONSECUTIVE_WRITE_FAILURES } from '../src/dealerTracker.js';
import { summarize, render, readRecords, pickFiles, boxLabel } from '../scripts/dealer-tracker-summary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const trackerSrc = path.resolve(here, '../src/dealerTracker.js');
const summaryCli = path.resolve(here, '../scripts/dealer-tracker-summary.mjs');
const DEALER = { id: 'acme-ford', name: 'Acme Ford', city: 'Trenton', state: 'NJ', domain: 'AcmeFord.com' };

let cwd; let errs;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dealertracker-')); errs = []; });
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

const mk = (o = {}) => createDealerTracker({ cwd, state: 'NJ', brand: 'Ford', dealerTotal: 3, runDate: '2026-11-08', box: 'box5', stderr: (m) => errs.push(m), installExitHandler: false, ...o });
const read = (t) => fs.readFileSync(t.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ends = (t) => read(t).filter((r) => r.ev === 'end');

describe('record content', () => {
    it('a complete crawl: identity, timing, url counters, vins, memory split, null where unknowable', () => {
        let clock = 1_000_000;
        const t = mk({ now: () => clock });
        t.begin(DEALER, { retry: false, index: 0 });
        clock += 1500; t.discovered(5);
        for (let i = 0; i < 5; i++) t.urlStart();
        t.pageSkipped('HTTP_404'); // one error page
        for (let i = 0; i < 4; i++) t.vehicle();
        clock += 8500;
        t.end(() => ({ timedOut: false, heapStopped: false, wall: null, browserFallback: false, countedAsFailedStore: false }));
        const [begin, end] = read(t).filter((r) => r.ev === 'begin' || r.ev === 'end');
        assert.equal(begin.ev, 'begin'); assert.equal(begin.attempt, end.attempt);
        assert.deepEqual([end.box, end.state, end.brand, end.retry, end.index, end.total], ['box5', 'NJ', 'Ford', false, 0, 3]);
        assert.deepEqual(end.dealer, { id: 'acme-ford', key: 'acmeford.com', name: 'Acme Ford', city: 'Trenton', state: 'NJ', domain: 'acmeford.com' });
        assert.equal(end.durationMs, 10000); assert.equal(end.msToDiscovery, 1500);
        assert.deepEqual(end.urls, { discovered: 5, attempted: 5, succeeded: 4, blocked: 0, skippedVdp: 1, errored: 0 });
        assert.equal(end.vins, 4);
        assert.equal(end.status, 'complete'); assert.equal(end.reason, null);
        assert.deepEqual(end.degraded, ['vdp_skipped']);
        assert.equal(end.browserFallback, false); assert.equal(end.countedAsFailedStore, false);
        assert.equal(end.heapStop, null); assert.equal(end.errors.exception, 0);
        // memory: process-wide numbers, dealerAttributable is null by design, the estimate is labelled approximate
        assert.equal(end.mem.process.scope, 'process');
        for (const k of ['rssMbStart', 'rssMbEnd', 'heapUsedMbStart', 'heapUsedMbEnd', 'heapLimitMb']) assert.equal(typeof end.mem.process[k], 'number', k);
        assert.equal(end.mem.dealerAttributable, null);
        assert.equal(end.mem.dealerEstimate.exact, false);
        assert.equal(typeof end.mem.dealerEstimate.heapUsedDeltaMb, 'number');
        assert.equal(read(t)[0].ev, 'run_start');
    });

    it('unobserved metrics are null, not zero: nothing discovered, no discovery time, unknown fallback/failed-store', () => {
        const t = mk();
        t.begin(DEALER, {});
        t.end(() => ({ timedOut: false, heapStopped: false }));
        const e = ends(t)[0];
        assert.equal(e.urls.discovered, null); assert.equal(e.msToDiscovery, null);
        assert.equal(e.browserFallback, null); assert.equal(e.countedAsFailedStore, null);
        assert.equal(e.blocking.probeClass, null); assert.equal(e.errors.errorName, null);
    });

    it('probe skip: nothing was requested, discovery unknown, reason and class recorded', () => {
        const t = mk();
        t.begin(DEALER, {});
        t.endProbeSkip(() => ({ classification: 'CLOUDFLARE_CHALLENGE', httpStatus: 403, url: 'https://x.example/secret?token=1' }));
        const e = ends(t)[0];
        assert.deepEqual([e.status, e.reason, e.blocking.probeClass, e.blocking.probeHttpStatus, e.urls.discovered, e.urls.attempted, e.countedAsFailedStore], ['skipped', 'probe_skip', 'CLOUDFLARE_CHALLENGE', 403, null, 0, true]);
        assert.ok(!JSON.stringify(e).includes('secret'), 'the probe URL must not be recorded');
    });

    it('no inventory URLs: an empty sitemap is discovered=0, a failed discovery is discovered=null', () => {
        const t = mk();
        t.begin(DEALER, {}); t.noUrls(() => ({ outcome: 'empty' })); t.end(() => ({}));
        t.begin(DEALER, { retry: true }); t.noUrls(() => ({ outcome: 'failed' })); t.end(() => ({}));
        const [a, b] = ends(t);
        assert.deepEqual([a.status, a.reason, a.urls.discovered, a.discoveryOutcome], ['skipped', 'no_inventory_urls', 0, 'empty']);
        assert.deepEqual([b.status, b.reason, b.urls.discovered, b.retry], ['skipped', 'discovery_failed', null, true]);
        assert.notEqual(a.attempt, b.attempt, 'a retry is its own attempt');
    });

    it('blocking: sitemap wall = skipped; wall mid-crawl = partial; every page blocked = failed; some pages blocked = complete + degraded', () => {
        const t = mk();
        t.begin(DEALER, {}); t.end(() => ({ wall: { cls: 'CLOUDFLARE_CHALLENGE', status: 403, url: 'https://x/y' } }));
        t.begin(DEALER, {}); t.discovered(100); for (let i = 0; i < 40; i++) t.urlStart(); for (let i = 0; i < 30; i++) t.vehicle(); t.end(() => ({ wall: { cls: 'HTTP_429', status: 429 } }));
        t.begin(DEALER, {}); t.discovered(3); for (let i = 0; i < 3; i++) { t.urlStart(); t.pageBlocked('AKAMAI_BLOCK'); } t.end(() => ({}));
        t.begin(DEALER, {}); t.discovered(4); for (let i = 0; i < 4; i++) t.urlStart(); t.pageBlocked('AKAMAI_BLOCK'); for (let i = 0; i < 3; i++) t.vehicle(); t.end(() => ({}));
        const [w1, w2, b1, b2] = ends(t);
        assert.deepEqual([w1.status, w1.reason, w1.blocking.wall], ['skipped', 'wall_sitemap', { cls: 'CLOUDFLARE_CHALLENGE', status: 403 }]);
        assert.ok(!JSON.stringify(w1).includes('https://x'), 'wall URL not recorded');
        assert.deepEqual([w2.status, w2.reason, w2.vins, w2.urls.attempted, w2.urls.discovered], ['partial', 'wall_mid_crawl', 30, 40, 100]);
        assert.deepEqual([b1.status, b1.reason, b1.blocking.blockClass], ['failed', 'all_pages_blocked', 'AKAMAI_BLOCK']);
        assert.deepEqual([b2.status, b2.reason, b2.degraded, b2.urls.succeeded], ['complete', null, ['pages_blocked'], 3]);
    });

    it('heap stop and timeout are partial, with the guard snapshot', () => {
        const t = mk();
        t.begin(DEALER, {}); t.discovered(2400); for (let i = 0; i < 900; i++) t.urlStart(); for (let i = 0; i < 880; i++) t.vehicle();
        t.end(() => ({ heapStopped: true, heapSnapshot: () => ({ usedMb: 3101, limitMb: 3632, stopAtMb: 3078, ratio: 0.85 }) }));
        t.begin(DEALER, {}); t.discovered(50); for (let i = 0; i < 10; i++) { t.urlStart(); t.vehicle(); } t.end(() => ({ timedOut: true }));
        t.begin(DEALER, {}); t.discovered(50); t.end(() => ({ timedOut: true }));
        const [h, to, to2] = ends(t);
        assert.deepEqual([h.status, h.reason, h.heapStop], ['partial', 'heap_stop', { usedMb: 3101, limitMb: 3632, stopAtMb: 3078 }]);
        assert.deepEqual([to.status, to.reason], ['partial', 'timeout_1h']);
        assert.deepEqual([to2.status, to2.reason], ['skipped', 'timeout_before_extract']);
    });

    it('an exception is recorded as failed with a scrubbed, clipped message and no stack', () => {
        const t = mk();
        t.begin(DEALER, {}); t.discovered(10); t.urlStart();
        const err = new TypeError('boom reading https://acme.example/a?b=1 at /home/ubuntu/nj-scraper/src/x.js ' + 'z'.repeat(400));
        t.error(err);
        t.end(() => ({}));
        const e = ends(t)[0];
        assert.deepEqual([e.status, e.reason, e.errors.exception, e.errors.errorName], ['failed', 'exception', 1, 'TypeError']);
        assert.ok(e.errors.errorMessage.length <= 160);
        assert.ok(!/https?:\/\//.test(e.errors.errorMessage) && !e.errors.errorMessage.includes('/home/ubuntu'));
        assert.ok(!JSON.stringify(e).includes('stack'));
    });

    it('url errors are counted and reduce `succeeded`; stopped early with no known cause is flagged', () => {
        const t = mk();
        t.begin(DEALER, {}); t.discovered(10); for (let i = 0; i < 6; i++) t.urlStart(); t.urlError(); t.urlError(); for (let i = 0; i < 4; i++) t.vehicle(); t.end(() => ({}));
        const e = ends(t)[0];
        assert.deepEqual([e.urls.attempted, e.urls.errored, e.urls.succeeded, e.status, e.reason, e.degraded], [6, 2, 4, 'partial', 'stopped_early_unknown', ['url_errors']]);
    });

    it('no vehicles from fetched pages is failed/no_vehicles_extracted', () => {
        assert.deepEqual(classify({ err: null, discovered: 5, attempted: 5, vins: 0, blocked: 0, skippedVdp: 0 }, {}, null), ['failed', 'no_vehicles_extracted']);
        assert.deepEqual(classify({ err: null, discovered: 5, attempted: 5, vins: 0, blocked: 0, skippedVdp: 5 }, {}, null), ['failed', 'all_pages_skipped_vdp']);
    });

    it('memory sampling is throttled and tracks peaks as process-wide samples', () => {
        let clock = 0; const t = mk({ now: () => clock });
        t.begin(DEALER, {}); t.discovered(3);
        for (let i = 0; i < 3; i++) { clock += 2500; t.urlStart(); }
        t.end(() => ({}));
        const e = ends(t)[0];
        assert.equal(typeof e.mem.process.peakRssMbSampled, 'number'); assert.equal(typeof e.mem.process.peakHeapUsedMbSampled, 'number');
        assert.ok(e.mem.process.peakRssMbSampled >= e.mem.process.rssMbStart);
    });

    it('records hold no page bodies, headers, env values or credentials', () => {
        const secret = 'sk-live-SUPERSECRET';
        const t = mk({ env: { CRAWLER_CONCURRENCY: '6', DB_PASSWORD: secret, API_KEY: secret } });
        t.begin({ ...DEALER, contactEmail: 'owner@acme.example' }, {}); t.discovered(1); t.urlStart(); t.vehicle(); t.end(() => ({}));
        const all = fs.readFileSync(t.file, 'utf8');
        assert.ok(!all.includes(secret)); assert.ok(!all.includes('owner@acme.example')); assert.ok(!/<html|Set-Cookie/i.test(all));
        assert.equal(read(t)[0].config.pageWorkers, 6);
    });

    it('run_end closes the run; an attempt still open then is closed as incomplete, not complete', () => {
        const t = mk();
        t.begin(DEALER, {}); t.runEnd();
        const recs = read(t);
        assert.equal(recs.at(-1).ev, 'run_end');
        assert.deepEqual(recs.filter((r) => r.ev === 'end').map((r) => [r.status, r.reason]), [['incomplete', 'loop_finished_with_open_attempt']]);
    });
});

describe('failure isolation: the tracker can never reach the crawl', () => {
    const callEverything = (t) => {
        t.begin(DEALER, { retry: false, index: 0 }); t.discovered(3); t.urlStart(); t.pageBlocked('X'); t.pageSkipped('Y'); t.urlError(); t.vehicle(); t.error(new Error('e'));
        t.end(() => ({ heapStopped: true, heapSnapshot: () => { throw new Error('snapshot'); } })); t.noUrls(() => { throw new Error('x'); }); t.endProbeSkip(() => { throw new Error('y'); }); t.runEnd();
    };

    it('append failures: never throws, one stderr line, stops after repeated failures, a later success resets the counter', () => {
        let calls = 0;
        const t = mk({ appendLine: () => { calls++; throw new Error('ENOSPC: no space left on device'); } });
        assert.doesNotThrow(() => { for (let i = 0; i < 5; i++) callEverything(t); });
        assert.equal(calls, 1 + MAX_CONSECUTIVE_WRITE_FAILURES - 1 + 0 || calls, 'bounded attempts');
        assert.ok(calls <= MAX_CONSECUTIVE_WRITE_FAILURES, `kept writing after ${calls} failures`);
        assert.equal(errs.filter((m) => /write failed/.test(m)).length, 1, 'reported once, not per record');
        assert.equal(t.stats().disabled, true);
    });

    it('a transient failure does not disable the tracker', () => {
        let n = 0;
        const real = (f, l) => fs.appendFileSync(f, l);
        const t = mk({ appendLine: (f, l) => { if (++n === 2) throw new Error('EIO'); real(f, l); } });
        t.begin(DEALER, {}); t.end(() => ({})); t.begin(DEALER, {}); t.end(() => ({}));
        assert.equal(t.stats().disabled, false);
        assert.ok(t.stats().written >= 3);
    });

    it('unwritable data dir at start-up returns a no-op tracker, not an exception', () => {
        const blocker = path.join(cwd, 'data'); fs.writeFileSync(blocker, 'a file where the directory should be');
        let t; assert.doesNotThrow(() => { t = mk(); });
        assert.equal(t.enabled, false);
        assert.doesNotThrow(() => callEverything(t));
        assert.ok(errs.some((m) => /disabled at start-up/.test(m)));
    });

    it('a throwing context getter still writes the end record (marked) and does not throw', () => {
        const t = mk();
        t.begin(DEALER, {}); t.discovered(1); t.urlStart(); t.vehicle();
        assert.doesNotThrow(() => t.end(() => { throw new ReferenceError('x is not defined'); }));
        const e = ends(t)[0];
        assert.equal(e.note, 'context_unavailable'); assert.equal(e.vins, 1);
    });

    it('hooks called with no open attempt, with garbage, or after a failure are harmless', () => {
        const t = mk();
        assert.doesNotThrow(() => { t.urlStart(); t.vehicle(); t.end(() => ({})); t.error(null); t.pageBlocked(undefined); t.begin(null, null); t.begin(undefined, { retry: 1 }); t.discovered(NaN); t.end(() => null); });
    });

    it('env switch off: no file, no directory, every hook a no-op', () => {
        const t = mk({ env: { CRAWLER_DEALER_TRACKER: 'off' } });
        assert.equal(t.enabled, false); callEverything(t);
        assert.equal(fs.existsSync(path.join(cwd, 'data')), false);
    });

    it('nothing is printed to stdout and no hook returns a value the crawl could use', () => {
        const out = []; const orig = process.stdout.write;
        process.stdout.write = (c, ...r) => { out.push(String(c)); return true; };
        let rets;
        try { const t = mk(); rets = [t.begin(DEALER, {}), t.discovered(1), t.urlStart(), t.vehicle(), t.end(() => ({}))]; callEverything(t); } finally { process.stdout.write = orig; }
        assert.deepEqual(out, []); assert.ok(rets.every((r) => r === undefined));
    });

    it('size cap: stops writing at the per-day-file limit instead of filling the disk', () => {
        const t = mk({ env: { CRAWLER_DEALER_TRACKER_MAX_FILE_MB: '0.0001' }, statSize: () => 0 });
        for (let i = 0; i < 400; i++) { t.begin(DEALER, {}); t.end(() => ({})); }
        assert.equal(t.stats().disabled, true);
        assert.ok(fs.statSync(t.file).size < 400 * 900, 'file kept growing');
        assert.ok(errs.some((m) => /reached/.test(m)));
    });

    it('noopTracker exposes every hook', () => {
        const t = noopTracker(); assert.doesNotThrow(() => callEverything(t));
    });
});

describe('retention', () => {
    it('removes only crawl-YYYY-MM-DD.jsonl older than the window, in the tracker directory only', () => {
        const dir = path.join(cwd, 'data', 'dealer_tracker'); fs.mkdirSync(dir, { recursive: true });
        const keep = ['crawl-2026-11-08.jsonl', 'crawl-2026-10-30.jsonl', 'notes.txt', 'crawl-2026-01-01.jsonl.bak', 'crawl-old.jsonl'];
        const drop = ['crawl-2026-10-01.jsonl', 'crawl-2025-12-31.jsonl'];
        for (const f of [...keep, ...drop]) fs.writeFileSync(path.join(dir, f), '{}\n');
        const other = path.join(cwd, 'data', 'crawl-2020-01-01.jsonl'); fs.writeFileSync(other, 'x');
        mk();
        assert.deepEqual(fs.readdirSync(dir).filter((f) => !f.endsWith('2026-11-08.jsonl') || true).sort(), [...keep, 'crawl-2026-11-08.jsonl'].filter((v, i, a) => a.indexOf(v) === i).sort());
        assert.ok(fs.existsSync(other), 'files outside the tracker directory are never touched');
        assert.equal(DEFAULT_RETAIN_DAYS, 14);
        assert.equal(pruneOld(dir, '2026-11-08', 14), 0);
    });
});

describe('concurrent writers and crashes (real processes)', () => {
    const child = (body, env = {}) => spawn(process.execPath, ['--input-type=module', '-e', `import { createDealerTracker } from ${JSON.stringify('file://' + trackerSrc)};\n${body}`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const done = (p) => new Promise((res) => { let e = ''; p.stderr.on('data', (d) => { e += d; }); p.on('exit', (code, sig) => res({ code, sig, stderr: e })); });

    it('8 processes appending to one day file: every line parses, none lost, none interleaved', async () => {
        const body = `
          const t = createDealerTracker({ cwd: process.env.CWD, state: 'S' + process.pid, brand: 'B', dealerTotal: 300, runDate: '2026-11-08', box: 'box5' });
          for (let i = 0; i < 300; i++) { t.begin({ id: 'd' + i, name: 'Dealer ' + i + ' ' + 'x'.repeat(100), domain: 'd' + i + '.example' }, { index: i }); t.discovered(10); for (let k = 0; k < 10; k++) { t.urlStart(); t.vehicle(); } t.end(() => ({})); }
          t.runEnd();`;
        const procs = Array.from({ length: 8 }, () => child(body, { CWD: cwd }));
        const res = await Promise.all(procs.map(done));
        for (const r of res) assert.deepEqual([r.code, r.stderr], [0, '']);
        const file = path.join(cwd, 'data', 'dealer_tracker', 'crawl-2026-11-08.jsonl');
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
        const recs = lines.map((l) => JSON.parse(l)); // throws on any torn line
        assert.equal(recs.length, 8 * (1 + 300 * 2 + 1));
        assert.equal(new Set(recs.filter((r) => r.ev === 'end').map((r) => r.attempt)).size, 8 * 300);
        assert.ok(recs.filter((r) => r.ev === 'end').every((r) => r.status === 'complete' && r.vins === 10));
    });

    it('SIGKILL mid-attempt: begin record only, the summary lists it as interrupted, never as a success', async () => {
        const body = `
          const t = createDealerTracker({ cwd: process.env.CWD, state: 'TX', brand: 'Infiniti', dealerTotal: 2, runDate: '2026-11-08', box: 'box5' });
          t.begin({ id: 'a', name: 'Finished' }, {}); t.discovered(1); t.urlStart(); t.vehicle(); t.end(() => ({}));
          t.begin({ id: 'big-one', name: 'Infiniti of Big Store' }, {}); t.discovered(3295); t.urlStart();
          process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`;
        const p = child(body, { CWD: cwd });
        await new Promise((res) => p.stdout.once('data', res));
        p.kill('SIGKILL'); await done(p);
        const file = path.join(cwd, 'data', 'dealer_tracker', 'crawl-2026-11-08.jsonl');
        const { records } = await readRecords([file]);
        const s = summarize(records);
        assert.equal(s.attempts, 1); assert.equal(s.interrupted.length, 1); assert.equal(s.interrupted[0].dealer, 'big-one');
        assert.equal(s.runsWithoutRunEnd, 1);
        assert.match(render(s), /Interrupted attempts.*: 1/);
    });

    it('process.exit / uncaught exception mid-attempt: the exit handler writes an incomplete record', async () => {
        const body = `
          const t = createDealerTracker({ cwd: process.env.CWD, state: 'FL', brand: 'Kia', runDate: '2026-11-08', box: 'box5' });
          t.begin({ id: 'x', name: 'X' }, {}); t.discovered(5); t.urlStart();
          throw new Error('uncaught in the crawl');`;
        const r = await done(child(body, { CWD: cwd }));
        assert.equal(r.code, 1);
        const e = fs.readFileSync(path.join(cwd, 'data', 'dealer_tracker', 'crawl-2026-11-08.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.ev === 'end');
        assert.deepEqual(e.map((x) => [x.status, x.reason]), [['incomplete', 'process_exit']]);
        assert.match(e[0].note, /exit code 1/);
    });

    it('tracker failures do not change the process exit code or add unhandled errors', async () => {
        const body = `
          const t = createDealerTracker({ cwd: process.env.CWD, runDate: '2026-11-08', appendLine: () => { throw new Error('disk gone'); } });
          for (let i = 0; i < 50; i++) { t.begin({ id: 'd' }, {}); t.urlStart(); t.end(() => ({})); }
          t.runEnd(); process.exitCode = 0;`;
        const r = await done(child(body, { CWD: cwd }));
        assert.equal(r.code, 0);
        assert.doesNotMatch(r.stderr, /Unhandled|TypeError|at .*\.js:\d+/);
    });
});

describe('overhead', () => {
    it('hooks cost microseconds per URL, far below one HTTP request', () => {
        const t = mk();
        t.begin(DEALER, {}); t.discovered(100000);
        const N = 100000;
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < N; i++) { t.urlStart(); if (i % 7 === 0) t.pageBlocked('X'); t.vehicle(); }
        const perUrlUs = Number(process.hrtime.bigint() - t0) / 1000 / N;
        assert.ok(perUrlUs < 20, `per-URL hook cost ${perUrlUs.toFixed(2)} us`);
        t.end(() => ({}));
    });
});

describe('summary command', () => {
    const rec = (o) => ({ v: 1, run: 'r1', box: 'box5', state: 'TX', brand: 'Infiniti', pid: 1, retry: false, urls: { discovered: 10, attempted: 10, blocked: 0 }, vins: 8, mem: { process: { peakRssMbSampled: 900 }, dealerEstimate: { heapUsedDeltaMb: 120 } }, ...o });
    const fixture = [
        { v: 1, ev: 'run_start', run: 'r1', box: 'box5', state: 'TX', brand: 'Infiniti' },
        rec({ ev: 'begin', attempt: 'a1', dealer: { id: 'slow', name: 'Slow Store' }, t: '2026-11-08T02:00:00Z' }),
        rec({ ev: 'end', attempt: 'a1', dealer: { id: 'slow', name: 'Slow Store' }, durationMs: 3_900_000, status: 'partial', reason: 'heap_stop', countedAsFailedStore: true, heapStop: { usedMb: 3100, limitMb: 3632, stopAtMb: 3078 }, mem: { process: { peakRssMbSampled: 3300, peakHeapUsedMbSampled: 3100 }, dealerEstimate: { heapUsedDeltaMb: 2100 } } }),
        rec({ ev: 'begin', attempt: 'a2', dealer: { id: 'fast', name: 'Fast Store' } }),
        rec({ ev: 'end', attempt: 'a2', dealer: { id: 'fast', name: 'Fast Store' }, durationMs: 60_000, status: 'complete', reason: null, countedAsFailedStore: false }),
        rec({ ev: 'begin', attempt: 'a3', dealer: { id: 'walled', name: 'Walled' }, state: 'FL' }),
        rec({ ev: 'end', attempt: 'a3', dealer: { id: 'walled', name: 'Walled' }, state: 'FL', durationMs: 5000, status: 'skipped', reason: 'probe_skip', countedAsFailedStore: true, vins: 0, urls: { discovered: null, attempted: 0, blocked: 0 } }),
        rec({ ev: 'begin', attempt: 'a4', dealer: { id: 'crashed', name: 'Crashed Store' }, pid: 77, t: '2026-11-08T03:00:00Z' }),
        rec({ ev: 'begin', attempt: 'b1', box: 'box1', dealer: { id: 'other-box', name: 'Other' } }),
        rec({ ev: 'end', attempt: 'b1', box: 'box1', dealer: { id: 'other-box', name: 'Other' }, durationMs: 1, status: 'complete', reason: null }),
    ];

    it('slowest dealers, reasons, interrupted attempts, per-state rates; box filter isolates box5', () => {
        const s = summarize(fixture, { box: 'box5' });
        assert.equal(s.attempts, 3);
        assert.deepEqual(s.byStatus, { partial: 1, complete: 1, skipped: 1 });
        assert.deepEqual(s.byReason, { heap_stop: 1, probe_skip: 1 });
        assert.equal(s.slowest[0].dealer, 'slow'); assert.equal(s.slowest[0].heapDeltaMb, 2100);
        assert.deepEqual(s.interrupted.map((i) => i.dealer), ['crashed']);
        assert.equal(s.heapStops.length, 1);
        assert.deepEqual(s.byState.map((r) => [r.key, r.notComplete, r.attempts]), [['FL', 1, 1], ['TX', 1, 2]]);
        assert.equal(s.countedAsFailedStore, 2);
        const text = render(s, { box: 'box5' });
        for (const needle of ['Slow Store', 'heap_stop', 'probe_skip', 'Interrupted attempts', 'by state', '1h05m']) assert.ok(text.includes(needle), needle);
        assert.equal(summarize(fixture).attempts, 4);
    });

    it('CLI: reads the newest day file, tolerates malformed lines, --json and filters work, and it writes nothing', () => {
        const dir = path.join(cwd, 'data', 'dealer_tracker'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'crawl-2026-11-07.jsonl'), '{"ev":"end","attempt":"old","status":"complete","box":"box5"}\n');
        fs.writeFileSync(path.join(dir, 'crawl-2026-11-08.jsonl'), fixture.map((r) => JSON.stringify(r)).join('\n') + '\n{not json\n\n');
        const before = fs.readdirSync(dir).map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
        const r = spawnSync(process.execPath, [summaryCli, '--box', 'box5', '--top', '5'], { cwd, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /crawl-2026-11-08\.jsonl/); assert.match(r.stdout, /1 malformed/); assert.match(r.stdout, /Slow Store/); assert.doesNotMatch(r.stdout, /crawl-2026-11-07/);
        const j = JSON.parse(spawnSync(process.execPath, [summaryCli, '--json', '--state', 'tx', '--date', '2026-11-08'], { cwd, encoding: 'utf8' }).stdout);
        assert.equal(j.malformed, 1); assert.ok(j.attempts >= 2);
        assert.deepEqual(fs.readdirSync(dir).map((f) => fs.statSync(path.join(dir, f)).mtimeMs), before);
        assert.equal(spawnSync(process.execPath, [summaryCli, '--dir', path.join(cwd, 'nope')], { encoding: 'utf8' }).status, 1);
        assert.deepEqual(pickFiles({ dir, days: 2 }).map((f) => path.basename(f)), ['crawl-2026-11-07.jsonl', 'crawl-2026-11-08.jsonl']);
    });

    it('hostnames recorded on the boxes are shown and filtered as box1..box5', () => {
        const recs = fixture.map((r) => (r.box === 'box5' ? { ...r, box: 'ip-172-26-13-207' } : r.box === 'box1' ? { ...r, box: 'ip-172-26-5-232' } : r));
        assert.equal(boxLabel('ip-172-26-13-207'), 'box5'); assert.equal(boxLabel('somewhere'), 'somewhere');
        assert.equal(summarize(recs, { box: 'box5' }).attempts, 3);
        assert.deepEqual(summarize(recs).byBox.map((b) => b.key).sort(), ['box1', 'box5']);
    });

    it('scrubMessage removes URLs and absolute paths', () => {
        assert.equal(scrubMessage('GET https://a.example/x?y=1 failed in /srv/app/src/a.js'), 'GET <url> failed in <path>');
    });
});
