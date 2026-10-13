// Planning + dry run: timings from past summaries, job sizing, the simulation that mirrors the live policy, and the shipped snapshot.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { entriesFromSummary, buildTimings, buildJobs, brandRates, simulateQueue, formatPlan, loadHistoryDir } from '../src/crawlQueuePlan.js';
import { parseBoxes, brandSetOf, DEFAULT_FLEET } from '../scripts/crawl-queue-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const summary = (date, brands, extra = {}) => ({ date, startedAt: `${date}T02:00:00Z`, finishedAt: `${date}T10:00:00Z`, states: { TX: { brands } }, ...extra });
const run = (ms, o = {}) => ({ status: 'ok', durationMs: ms, dealerCount: 10, ...o });

describe('history -> timings', () => {
  it('reads every brand-run of a driver summary and skips skipped brands', () => {
    const e = entriesFromSummary(summary('2026-10-10', { Ford: run(60_000), Honda: { status: 'skipped' } }), { box: 'box3' });
    assert.deepEqual(e.map((x) => [x.key, x.durationMs, x.box]), [['TX|Ford', 60_000, 'box3']]);
  });
  it('takes the median of the ok runs over the last N nights and ignores killed/failed runs', () => {
    const entries = [
      ...entriesFromSummary(summary('2026-10-08', { Ford: run(100_000) })),
      ...entriesFromSummary(summary('2026-10-09', { Ford: run(300_000) })),
      ...entriesFromSummary(summary('2026-10-10', { Ford: run(200_000) })),
      ...entriesFromSummary(summary('2026-10-11', { Ford: { status: 'timeout', durationMs: 7_200_000, dealerCount: 10 } })),
    ];
    const { timings, nonOk } = buildTimings(entries, { nights: 7 });
    assert.equal(timings['TX|Ford'].seconds, 200);
    assert.equal(nonOk['TX|Ford'], 1);
  });
  it('excludeDates drops a known-bad night', () => {
    const entries = [...entriesFromSummary(summary('2026-10-10', { Ford: run(100_000) })), ...entriesFromSummary(summary('2026-10-11', { Ford: run(900_000) }))];
    assert.equal(buildTimings(entries, { excludeDates: ['2026-10-11'] }).timings['TX|Ford'].seconds, 100);
  });
  it('a higher percentile models a slow night', () => {
    const entries = [100, 200, 300, 400].flatMap((s, i) => entriesFromSummary(summary(`2026-10-0${i + 1}`, { Ford: run(s * 1000) })));
    assert.ok(buildTimings(entries, { pct: 75 }).timings['TX|Ford'].seconds > buildTimings(entries, { pct: 50 }).timings['TX|Ford'].seconds);
  });
  it('loads <dir>/<box>/summary_*.json and queue_summary_*.json, with the box wall-clock as the baseline', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cqh-'));
    fs.mkdirSync(path.join(dir, 'box3'));
    fs.writeFileSync(path.join(dir, 'box3', 'summary_2026-10-10.json'), JSON.stringify(summary('2026-10-10', { Ford: run(60_000) })));
    fs.writeFileSync(path.join(dir, 'box3', 'queue_summary_2026-10-11.json'), JSON.stringify(summary('2026-10-11', { Ford: run(60_000) })));
    fs.writeFileSync(path.join(dir, 'box3', 'notes.txt'), 'x');
    const { entries, runs } = loadHistoryDir(dir);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].box, 'box3');
    assert.equal(runs[0].wallHours, 8);
  });
});

describe('job sizing', () => {
  const timings = { 'TX|Ford': { seconds: 3600, dealers: 100, state: 'TX', brand: 'Ford', lastBox: 'box3' }, 'NJ|Ford': { seconds: 600, dealers: 50, state: 'NJ', brand: 'Ford' } };
  it('uses history first, then dealers x the brand rate, then a default', () => {
    const jobs = buildJobs([
      { state: 'TX', brand: 'Ford', brandSet: 'expansion', dealers: 100 },
      { state: 'OH', brand: 'Ford', brandSet: 'expansion', dealers: 10 },
      { state: 'OH', brand: 'Toyota', brandSet: 'core', dealers: 0 },
    ], timings);
    const by = Object.fromEntries(jobs.map((j) => [j.jobKey, j]));
    assert.equal(by['TX|Ford'].estimated, 'history');
    assert.equal(by['OH|Ford'].estimated, 'rate');
    assert.equal(by['OH|Ford'].estSeconds, Math.round(10 * brandRates(timings).byBrand.Ford));
    assert.equal(by['OH|Toyota'].estimated, 'default');
  });
});

describe('simulation mirrors the live policy', () => {
  const J = (k, s, o = {}) => ({ jobKey: k, estSeconds: s, brandSet: 'core', heavy: false, lastBox: null, ...o });
  it('every free slot takes the longest remaining job, so the biggest start at t=0 on different slots', () => {
    const p = simulateQueue([J('a|x', 100), J('b|x', 90), J('c|x', 10), J('d|x', 10)], [{ name: 'box3', slots: 2 }]);
    const starts = p.boxes[0].jobs.filter((j) => j.startS === 0).map((j) => j.jobKey).sort();
    assert.deepEqual(starts, ['a|x', 'b|x']);
    assert.equal(p.makespanS, 110); // c and d queue behind the shorter of the two big ones: 90 + 10 + 10
  });
  it('balances an unequal fleet: more slots finish more work, and nobody sits idle while jobs remain', () => {
    const jobs = Array.from({ length: 60 }, (_, i) => J(`s${i}|x`, 100));
    const p = simulateQueue(jobs, [{ name: 'big', slots: 4 }, { name: 'small', slots: 2 }]);
    const by = Object.fromEntries(p.boxes.map((b) => [b.name, b.jobs.length]));
    assert.deepEqual(by, { big: 40, small: 20 });
    assert.equal(p.makespanS, 1000); // both boxes finish together
  });
  it('a slower box takes proportionally less', () => {
    const jobs = Array.from({ length: 30 }, (_, i) => J(`s${i}|x`, 100));
    const p = simulateQueue(jobs, [{ name: 'fast', slots: 2 }, { name: 'slow', slots: 2, speed: 2 }]);
    const by = Object.fromEntries(p.boxes.map((b) => [b.name, b.jobs.length]));
    assert.ok(by.fast > by.slow);
  });
  it('respects brand-set limits and reports what nobody can run', () => {
    const p = simulateQueue([J('a|Ford', 100, { brandSet: 'expansion' }), J('b|Toyota', 50)], [{ name: 'box1', slots: 1, brandSets: ['core'] }]);
    assert.equal(p.boxes[0].jobs.length, 1);
    assert.deepEqual(p.unassignable.map((j) => j.jobKey), ['a|Ford']);
  });
  it('limits concurrent heavy jobs per box', () => {
    const jobs = [J('a|x', 100, { heavy: true }), J('b|x', 100, { heavy: true }), J('c|x', 100, { heavy: true })];
    const p = simulateQueue(jobs, [{ name: 'b', slots: 3, heavySlots: 1 }]);
    assert.equal(p.makespanS, 300);
  });
  it('flags a shard that would change box versus its last box', () => {
    const p = simulateQueue([J('a|x', 10, { lastBox: 'box1' })], [{ name: 'box3', slots: 1 }]);
    assert.equal(p.boxes[0].jobs[0].moved, true);
  });
});

describe('dry-run output', () => {
  it('prints the expected finish per box and the fleet makespan', () => {
    const jobs = [{ jobKey: 'a|x', estSeconds: 7200, estimated: 'history' }, { jobKey: 'b|x', estSeconds: 3600, estimated: 'history' }];
    const plan = simulateQueue(jobs.map((j) => ({ ...j, brandSet: 'core', heavy: false })), [{ name: 'box3', slots: 1 }, { name: 'box4', slots: 1 }]);
    const out = formatPlan(plan, { jobs, baseline: [{ box: 'box3', wallHours: 7.3 }], nights: ['2026-10-12', '2026-10-06'] });
    assert.match(out, /box3\s+1\s+1\s+2\.0h\s+2\.0h/);
    assert.match(out, /fleet finish \(makespan\): 2\.0h/);
    assert.match(out, /last week, fixed-state crons.*box3 7\.3h/);
  });
  it('parses the fleet spec', () => {
    assert.deepEqual(parseBoxes('box1:2:core,box3:4,box4:4:core+expansion:1.5'), [
      { name: 'box1', slots: 2, brandSets: ['core'], speed: 1 }, { name: 'box3', slots: 4, brandSets: null, speed: 1 }, { name: 'box4', slots: 4, brandSets: ['core', 'expansion'], speed: 1.5 }]);
  });
  it('knows which brands are expansion', () => {
    assert.equal(brandSetOf('Ford'), 'expansion');
    assert.equal(brandSetOf('Toyota'), 'core');
  });
});

describe('the shipped timings snapshot', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'crawl_queue_timings.json'), 'utf-8'));
  it('covers every shard of last week with a timing and a dealer count', () => {
    assert.ok(Object.keys(snap.universe).length > 800);
    for (const [k, u] of Object.entries(snap.universe)) assert.ok(snap.timings[k], `no timing for ${k}`);
    assert.ok(snap.dates.length >= 5);
  });
  it('the dry-run CLI runs against it, offline, and prints a finish time for each box of the default fleet', () => {
    const out = execFileSync('node', ['scripts/crawl-queue-plan.mjs'], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, TRIMSCOUT_API_KEY: '' } });
    for (const b of DEFAULT_FLEET.split(',').map((x) => x.split(':')[0])) assert.match(out, new RegExp(`^${b}\\s`, 'm'));
    assert.match(out, /fleet finish \(makespan\): \d+\.\dh/);
    assert.doesNotMatch(out, /UNASSIGNABLE/);
  });
});
