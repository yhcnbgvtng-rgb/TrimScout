// The off-by-default flag, and the sync glue: with the flag off everything is a pass-through; with it on the sync uploads only
// the shards the manifest vouches for, exits 0 when there is nothing, and backs off while box2 is busy.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFlag, flagPath } from '../src/crawlQueueFlag.js';
import { chooseShards, selectShards, queueApi, manifestPath, foreignGraceHours } from '../src/syncManifest.js';
import { makePressureWaiter, withBackpressure } from '../src/crawlQueuePressure.js';
import { manifestFile, makeManifestWriter, shardFileName, nightFromEnv, fileDateOf, buildSeedJobs } from '../src/crawlQueueSeed.js';
import { queueNight } from '../src/crawlQueueCore.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cqf-'));
const writeFlag = (dir, obj) => { fs.mkdirSync(path.dirname(flagPath(dir)), { recursive: true }); fs.writeFileSync(flagPath(dir), typeof obj === 'string' ? obj : JSON.stringify(obj)); };

describe('flag: OFF unless a file says otherwise', () => {
  it('missing, unreadable, malformed, or enabled:false => off', () => {
    const d = tmp();
    assert.equal(readFlag(d, {}).enabled, false);
    writeFlag(d, '{not json');
    assert.equal(readFlag(d, {}).enabled, false);
    writeFlag(d, { enabled: false, box: 'box3' });
    assert.equal(readFlag(d, {}).enabled, false);
    writeFlag(d, { enabled: 'true', box: 'box3' }); // a string is not the boolean true
    assert.equal(readFlag(d, {}).enabled, false);
  });
  it('on only with enabled:true and a box name', () => {
    const d = tmp();
    writeFlag(d, { enabled: true, box: 'box3', slots: 4, brandSets: ['core', 'expansion'], maxHeavy: 2, excludeStates: ['ny', 'OH'] });
    assert.deepEqual(readFlag(d, {}), { enabled: true, box: 'box3', role: 'worker', slots: 4, brandSets: ['core', 'expansion'], maxHeavy: 2, excludeStates: ['NY', 'OH'], source: 'flag-file' });
    writeFlag(d, { enabled: true });
    assert.equal(readFlag(d, {}).enabled, false, 'no box label => refuses');
  });
  it('box2 is a host: it never crawls', () => {
    const d = tmp();
    writeFlag(d, { enabled: true, box: 'box2', role: 'host' });
    assert.equal(readFlag(d, {}).role, 'host');
  });
  it('CRAWL_QUEUE=0 forces off even with the file on (emergency off without touching files); =1 forces on', () => {
    const d = tmp();
    writeFlag(d, { enabled: true, box: 'box3' });
    assert.equal(readFlag(d, { CRAWL_QUEUE: '0' }).enabled, false);
    assert.equal(readFlag(tmp(), { CRAWL_QUEUE: '1', TRIMSCOUT_BOX_LABEL: 'box4' }).enabled, true);
  });
  it('clamps slots to something sane', () => {
    const d = tmp();
    writeFlag(d, { enabled: true, box: 'box3', slots: 99 });
    assert.equal(readFlag(d, {}).slots, 8);
  });
});

describe('sync shard selection', () => {
  const setup = (flag) => { const d = tmp(); process.env.CRAWLER_DIR = d; if (flag) writeFlag(d, flag); return d; };
  const exits = []; const logs = [];
  const opts = (now) => ({ env: {}, log: (m) => logs.push(m), exit: (c) => exits.push(c), now });
  beforeEach(() => { exits.length = 0; logs.length = 0; });
  const NOW = Date.parse('2026-10-14T08:00:00-04:00');
  const NIGHT = queueNight(NOW);
  const shards = (dir, names, mtime) => names.map((n) => { const f = path.join(dir, 'inv', n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '[]'); fs.utimesSync(f, mtime / 1000, mtime / 1000); return f; });

  it('flag off: every file, untouched, nothing logged, no exit (today\'s behaviour)', () => {
    const d = setup(null);
    const files = shards(d, ['TX.json', 'TX__ford.json'], NOW);
    assert.deepEqual(selectShards(files, opts(NOW)), files);
    assert.deepEqual(exits, []);
    assert.deepEqual(logs, []);
  });
  it('flag on: only the shards the manifest lists; old leftovers in the directory are left alone', () => {
    const d = setup({ enabled: true, box: 'box3' });
    const files = shards(d, ['TX__ford.json', 'TX__honda.json', 'OLD__toyota.json'], NOW);
    fs.mkdirSync(path.dirname(manifestPath(d, NIGHT)), { recursive: true });
    fs.writeFileSync(manifestPath(d, NIGHT), JSON.stringify({ night: NIGHT, shards: [{ file: 'TX__ford.json', startedAt: NOW - 3600_000 }, { file: 'TX__honda.json', startedAt: NOW - 3600_000 }] }));
    const picked = selectShards(files, opts(NOW));
    assert.deepEqual(picked.map((f) => path.basename(f)).sort(), ['TX__ford.json', 'TX__honda.json']);
  });
  it('flag on, no manifest: exits 0 with nothing to sync (never syncs "whatever is in the directory")', () => {
    const d = setup({ enabled: true, box: 'box3' });
    const files = shards(d, ['TX__ford.json'], NOW);
    assert.deepEqual(selectShards(files, opts(NOW)), []);
    assert.deepEqual(exits, [0]);
  });
  it('flag on, host box: exits 0', () => {
    setup({ enabled: true, box: 'box2', role: 'host' });
    assert.deepEqual(selectShards([], opts(NOW)), []);
    assert.deepEqual(exits, [0]);
  });
  it('a shard older than the job that supposedly wrote it is dropped', () => {
    const r = chooseShards(['/inv/TX__ford.json'], { shards: [{ file: 'TX__ford.json', startedAt: 10_000_000 }] }, { statMtimeMs: () => 1_000_000 });
    assert.deepEqual(r.files, []);
    assert.match(r.dropped[0].reason, /older than the job/);
  });
  it('a manifest entry whose file is missing is reported, not fatal', () => {
    const r = chooseShards(['/inv/A.json'], { shards: [{ file: 'B.json' }] });
    assert.equal(r.dropped[0].reason, 'file is not in the inventory directory');
  });
  it('the sync client and the worker agree on the manifest file name', () => {
    assert.equal(manifestPath('/c', '2026-10-14'), manifestFile('/c', '2026-10-14'));
  });
  it('flag off: queueApi returns the very same function (no wrapper in the way)', () => {
    setup(null);
    const f = async () => 1;
    assert.equal(queueApi(f, { env: {} }), f);
  });
});

describe('foreign-row grace follows the queue night', () => {
  const N0 = Date.parse('2026-10-14T22:00:00-04:00');
  it('protects other boxes\' rows from tonight only: grace = time since the night began + 1h', () => {
    assert.equal(foreignGraceHours(N0, N0 + 5 * 3600_000), 6);
    assert.equal(foreignGraceHours(N0, N0 + 14.2 * 3600_000), 16);
  });
  it('has a floor, and falls back to 20h when the night start is unknown', () => {
    assert.equal(foreignGraceHours(N0, N0), 2);
    assert.equal(foreignGraceHours(NaN), 20);
  });
});

describe('backpressure', () => {
  const mk = (seq, sleeps = []) => {
    let i = 0; let t = 0;
    return makePressureWaiter({ fetchPressure: async () => { const r = seq[Math.min(i++, seq.length - 1)]; if (r instanceof Error) throw r; return r; }, sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t, pollMs: 100, maxWaitMs: 1000, log: () => {} });
  };
  it('goes straight through when box2 is fine', async () => {
    const s = []; const r = await mk([{ ok: true, iowaitPct: 3 }], s)(); assert.equal(s.length, 0); assert.equal(r.waitedMs, 0);
  });
  it('waits while box2 is over the line and resumes when it settles', async () => {
    const s = []; const r = await mk([{ ok: false, iowaitPct: 50 }, { ok: false, iowaitPct: 44 }, { ok: true, iowaitPct: 9 }], s)(); assert.equal(s.length, 2); assert.equal(r.waitedMs, 200);
  });
  it('gives up waiting after maxWaitMs rather than stalling a sync forever', async () => {
    const r = await mk([{ ok: false, iowaitPct: 99 }])(); assert.equal(r.gaveUp, true); assert.ok(r.waitedMs >= 1000);
  });
  it('fails OPEN if the endpoint is missing (older server) or broken', async () => {
    const r = await mk([new Error('404')])(); assert.equal(r.failedOpen, true);
  });
  it('only the heavy write calls wait; reads and lock calls pass straight through', async () => {
    const waits = []; const calls = [];
    const api = withBackpressure(async (p) => { calls.push(p); return 'ok'; }, async (what) => { waits.push(what); });
    await api('/api/inventory/bulk', {}); await api('/api/inventory/sweep', {}); await api('/api/ops/sync-lock/acquire', {}); await api('/api/dealerships');
    assert.deepEqual(waits, ['bulk', 'sweep']);
    assert.equal(calls.length, 4);
  });
});

describe('manifest writer and seeding', () => {
  it('records finished shards atomically, replacing a re-run of the same job', async () => {
    const d = tmp();
    const w = makeManifestWriter(d, '2026-10-14', 'box3');
    await w.add({ jobKey: 'TX|Ford', file: shardFileName('TX', 'Ford'), startedAt: 1 });
    await w.add({ jobKey: 'TX|Mercedes-Benz', file: shardFileName('TX', 'Mercedes-Benz'), startedAt: 2 });
    await w.add({ jobKey: 'TX|Ford', file: shardFileName('TX', 'Ford'), startedAt: 3 });
    const m = JSON.parse(fs.readFileSync(manifestFile(d, '2026-10-14'), 'utf-8'));
    assert.deepEqual(m.shards.map((s) => [s.file, s.startedAt]), [['TX__mercedes-benz.json', 2], ['TX__ford.json', 3]]);
    assert.deepEqual(fs.readdirSync(path.dirname(manifestFile(d, 'x'))).filter((f) => f.includes('.tmp')), []);
  });
  it('the pilot night override keeps its own queue and manifest, and file dates use its first 10 characters', () => {
    assert.equal(nightFromEnv({ CRAWL_QUEUE_NIGHT: '2026-10-14-pilot' }), '2026-10-14-pilot');
    assert.equal(fileDateOf('2026-10-14-pilot'), '2026-10-14');
    assert.equal(nightFromEnv({ CRAWL_QUEUE_NIGHT: 'rm -rf /' }, Date.parse('2026-10-14T23:00:00-04:00')), '2026-10-14');
  });
  it('seeds the committed universe, adds what the box itself covers, prefers queue history once it has 2+ samples, and can be limited to one state', () => {
    const snapshot = { universe: { 'TX|Ford': { state: 'TX', brand: 'Ford', dealers: 100 }, 'DE|Toyota': { state: 'DE', brand: 'Toyota', dealers: 4 } }, timings: { 'TX|Ford': { seconds: 3600, dealers: 100, state: 'TX', brand: 'Ford' }, 'DE|Toyota': { seconds: 200, dealers: 4, state: 'DE', brand: 'Toyota' } } };
    const bset = (b) => (b === 'Ford' ? 'expansion' : 'core');
    const jobs = buildSeedJobs({ snapshot, local: [{ state: 'OH', brand: 'Honda', brandSet: 'core', dealers: 8 }], history: { timings: { 'TX|Ford': [{ seconds: 1000 }, { seconds: 2000 }, { seconds: 3000 }], 'DE|Toyota': [{ seconds: 9999 }] } }, brandSetOf: bset, heavy: (s, b) => s === 'TX' && b === 'Ford' });
    const by = Object.fromEntries(jobs.map((j) => [`${j.state}|${j.brand}`, j]));
    assert.equal(jobs.length, 3);
    assert.equal(by['TX|Ford'].estSeconds, 2000); // queue history median, not the snapshot's 3600
    assert.equal(by['DE|Toyota'].estSeconds, 200); // one sample is not enough to override
    assert.equal(by['TX|Ford'].heavy, true);
    assert.equal(by['OH|Honda'].brandSet, 'core');
    assert.deepEqual(buildSeedJobs({ snapshot, states: ['DE'], brandSetOf: bset }).map((j) => j.state), ['DE']);
  });
});
