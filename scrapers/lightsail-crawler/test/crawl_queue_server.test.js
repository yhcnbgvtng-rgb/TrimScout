// Server half on box2: the ops over a real SQL-shaped store (fake pool that understands the statements we emit), the shared
// VIN cache files, the pressure sampler, and the HTTP routing. No network, no database.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeOps, memoryStore, mysqlStore, makeVinCache, makePressureSampler, parseCpuStat, handle, rowToJob, diffUpdate, SCHEMA_SQL } from '../src/crawlQueueServer.js';
import { DEFAULTS } from '../src/crawlQueueCore.js';

const job = (state, brand, est, o = {}) => ({ state, brand, brandSet: 'core', dealers: 10, estSeconds: est, heavy: false, ...o });
let tick = 1_000_000;
const clock = { now: () => tick };

// A pool that stores rows and understands exactly the statements crawlQueueServer.js builds.
function fakePool() {
  const rows = new Map(); // `${night}|${job_key}` -> row (snake_case)
  const log = [];
  const exec = async (sql, params = []) => {
    log.push(sql.replace(/\s+/g, ' ').slice(0, 60));
    if (/^CREATE TABLE/.test(sql)) return [[], undefined];
    if (/^SELECT \* FROM crawl_queue_jobs WHERE night = \? FOR UPDATE/.test(sql)) return [[...rows.values()].filter((r) => r.night === params[0]).map((r) => ({ ...r })), undefined];
    let m = /^UPDATE crawl_queue_jobs SET (.+) WHERE night = \? AND job_key = \?$/.exec(sql);
    if (m) {
      const cols = m[1].split(', ').map((c) => c.replace(' = ?', ''));
      const r = rows.get(`${params[params.length - 2]}|${params[params.length - 1]}`);
      assert.ok(r, 'update of a row that does not exist');
      cols.forEach((c, i) => { assert.ok(c in r, `unknown column ${c}`); r[c] = params[i]; });
      return [{ affectedRows: 1 }, undefined];
    }
    m = /^INSERT IGNORE INTO crawl_queue_jobs \(night, (.+)\) VALUES \?$/.exec(sql);
    if (m) {
      const cols = ['night', ...m[1].split(', ')];
      let n = 0;
      for (const vals of params[0]) { const r = Object.fromEntries(cols.map((c, i) => [c, vals[i]])); const k = `${r.night}|${r.job_key}`; if (!rows.has(k)) { rows.set(k, r); n++; } }
      return [{ affectedRows: n }, undefined];
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return [[], undefined];
    throw new Error(`fake pool does not understand: ${sql}`);
  };
  const conn = { query: exec, beginTransaction: async () => log.push('BEGIN'), commit: async () => log.push('COMMIT'), rollback: async () => log.push('ROLLBACK'), release: () => log.push('RELEASE') };
  return { query: exec, getConnection: async () => conn, rows, log };
}

describe('ops (memory store)', () => {
  const setup = () => { tick = 1_000_000; return makeOps(memoryStore(), { ...clock, newToken: (() => { let i = 0; return () => `tok${++i}`; })() }); };
  it('seed is idempotent and never resets a claimed or finished job', async () => {
    const ops = setup();
    const jobs = [job('TX', 'Ford', 100), job('NJ', 'Honda', 10)];
    assert.equal((await ops.seed({ night: '2026-10-14', jobs })).seeded, 2);
    const c = (await ops.claim({ night: '2026-10-14', box: 'box3' })).claimed;
    assert.equal(c.jobKey, 'TX|Ford');
    assert.equal((await ops.seed({ night: '2026-10-14', jobs })).seeded, 0);
    const st = await ops.status({ night: '2026-10-14' });
    assert.equal(st.counts.claimed, 1);
  });
  it('rejects bad input with a 400', async () => {
    const ops = setup();
    await assert.rejects(ops.seed({ night: 'x', jobs: [] }), (e) => e.status === 400);
    await assert.rejects(ops.seed({ night: '2026-10-14', jobs: [{ state: 'TXX', brand: 'Ford', brandSet: 'core' }] }), (e) => e.status === 400);
    await assert.rejects(ops.claim({ night: '2026-10-14' }), (e) => e.status === 400);
  });
  it('two boxes never get the same shard; a drained queue says so', async () => {
    const ops = setup();
    await ops.seed({ night: 'n-1234', jobs: [job('A', 'x', 3), job('B', 'x', 2)].map((j, i) => ({ ...j, state: ['AK', 'AL'][i] })) });
    const a = (await ops.claim({ night: 'n-1234', box: 'box3' })).claimed;
    const b = (await ops.claim({ night: 'n-1234', box: 'box4' })).claimed;
    assert.notEqual(a.jobKey, b.jobKey);
    const none = await ops.claim({ night: 'n-1234', box: 'box1' });
    assert.equal(none.claimed, null);
    assert.equal(none.counts.open, 2);
    await ops.complete({ night: 'n-1234', jobKey: a.jobKey, token: a.token, durationSeconds: 5 });
    await ops.complete({ night: 'n-1234', jobKey: b.jobKey, token: b.token, durationSeconds: 5 });
    assert.equal((await ops.claim({ night: 'n-1234', box: 'box1' })).counts.open, 0);
  });
  it('a crashed box\'s shard comes back to a different box after the lease lapses', async () => {
    const ops = setup();
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'Ford', 100)] });
    const dead = (await ops.claim({ night: 'n-1234', box: 'box3' })).claimed;
    assert.equal((await ops.claim({ night: 'n-1234', box: 'box4' })).claimed, null); // still leased
    tick += DEFAULTS.LEASE_MS + 1;
    const again = await ops.claim({ night: 'n-1234', box: 'box3' });
    assert.equal(again.claimed, null, 'the box that dropped it is not handed it straight back');
    assert.equal(again.reaped.length, 1);
    const other = (await ops.claim({ night: 'n-1234', box: 'box4' })).claimed;
    assert.equal(other.jobKey, 'AK|Ford');
    assert.equal(other.attempt, 2);
    // the dead box wakes up: its heartbeat and its completion are both refused
    assert.equal((await ops.heartbeat({ night: 'n-1234', jobKey: 'AK|Ford', token: dead.token })).renewed, false);
    assert.equal((await ops.complete({ night: 'n-1234', jobKey: 'AK|Ford', token: dead.token })).accepted, false);
  });
  it('a stalled shard that keeps heartbeating keeps its lease', async () => {
    const ops = setup();
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'Ford', 100)] });
    const c = (await ops.claim({ night: 'n-1234', box: 'box3' })).claimed;
    for (let i = 0; i < 10; i++) { tick += DEFAULTS.HEARTBEAT_MS; assert.equal((await ops.heartbeat({ night: 'n-1234', jobKey: 'AK|Ford', token: c.token })).renewed, true); }
    assert.equal((await ops.claim({ night: 'n-1234', box: 'box4' })).claimed, null);
  });
  it('fail with retryable:false (the 2h kill) is terminal; a normal failure is retried once on another box, then terminal', async () => {
    const ops = setup();
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'Ford', 100), job('AL', 'Ford', 90)] });
    const t = (await ops.claim({ night: 'n-1234', box: 'box3' })).claimed;
    assert.equal((await ops.fail({ night: 'n-1234', jobKey: t.jobKey, token: t.token, retryable: false, exit: 'timeout' })).status, 'failed');
    const e1 = (await ops.claim({ night: 'n-1234', box: 'box3' })).claimed;
    assert.equal((await ops.fail({ night: 'n-1234', jobKey: e1.jobKey, token: e1.token, error: 'crash' })).status, 'queued');
    assert.equal((await ops.claim({ night: 'n-1234', box: 'box3' })).claimed, null);
    const e2 = (await ops.claim({ night: 'n-1234', box: 'box4' })).claimed;
    assert.equal((await ops.fail({ night: 'n-1234', jobKey: e2.jobKey, token: e2.token, error: 'crash again' })).status, 'failed');
    const st = await ops.status({ night: 'n-1234' });
    assert.equal(st.failed.length, 2);
  });
  it('records the vehicle count and duration on completion', async () => {
    const ops = setup();
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'Ford', 100)] });
    const c = (await ops.claim({ night: 'n-1234', box: 'box3' })).claimed;
    await ops.complete({ night: 'n-1234', jobKey: c.jobKey, token: c.token, durationSeconds: 61, vehicles: 345, exit: 'ok' });
    const st = await ops.status({ night: 'n-1234' });
    assert.equal(st.byBox.box3.done, 1);
    assert.equal(st.byBox.box3.busySeconds, 61);
  });
});

describe('mysqlStore: the SQL we emit round-trips through a table', () => {
  it('seed -> claim -> heartbeat -> complete leaves the right row, in one transaction per call', async () => {
    tick = 5_000_000;
    const pool = fakePool();
    const ops = makeOps(mysqlStore(pool), { ...clock, newToken: () => 'tokA' });
    await ops.seed({ night: '2026-10-14', jobs: [job('TX', 'Ford', 100, { heavy: true, dealers: 188 })] });
    const c = (await ops.claim({ night: '2026-10-14', box: 'box3' })).claimed;
    assert.equal(c.heavy, true);
    tick += 60_000;
    await ops.heartbeat({ night: '2026-10-14', jobKey: 'TX|Ford', token: 'tokA' });
    await ops.complete({ night: '2026-10-14', jobKey: 'TX|Ford', token: 'tokA', durationSeconds: 120, vehicles: 9 });
    const row = pool.rows.get('2026-10-14|TX|Ford');
    assert.equal(row.status, 'done');
    assert.equal(row.attempts, 1);
    assert.equal(row.duration_seconds, 120);
    assert.equal(row.vehicles, 9);
    assert.equal(row.heavy, 1);
    assert.equal(row.dealers, 188);
    assert.equal(rowToJob(row).heavy, true);
    assert.equal(pool.log.filter((l) => l === 'BEGIN').length, pool.log.filter((l) => l === 'COMMIT').length);
    assert.ok(pool.log.includes('RELEASE'));
  });
  it('rolls back and releases the connection when an operation throws', async () => {
    const pool = fakePool();
    const store = mysqlStore(pool);
    await assert.rejects(store.withNight('n-1234', async () => { throw new Error('boom'); }), /boom/);
    assert.ok(pool.log.includes('ROLLBACK') && pool.log.includes('RELEASE'));
  });
  it('the update only touches columns that changed, and the schema declares every column we write', () => {
    const before = { jobKey: 'A|x', status: 'queued', attempts: 0, heavy: false };
    const after = { ...before, status: 'claimed', attempts: 1 };
    const u = diffUpdate('n', before, after);
    assert.match(u.sql, /SET status = \?, attempts = \? WHERE night = \? AND job_key = \?/);
    assert.equal(diffUpdate('n', before, { ...before }), null);
    for (const c of ['job_key', 'est_seconds', 'lease_expires_at', 'claim_token', 'last_failed_box', 'brand_set', 'heavy']) assert.match(SCHEMA_SQL, new RegExp(`\\b${c}\\b`));
  });
});

describe('shared VIN cache', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
  const E = (n) => ({ nhtsa: { Make: 'FORD', n } });
  const V = (i) => `1FT${String(i).padStart(14, '0')}`.slice(0, 17).replace(/[IOQ]/g, '1');
  it('appends new entries and drops VINs the server already has (first writer wins), even after a restart', async () => {
    const d = dir();
    const c = makeVinCache(d);
    assert.deepEqual(await c.push({ state: 'TX', entries: { [V(1)]: E(1), [V(2)]: E(2) } }), { appended: 2, skipped: 0, duplicate: 0 });
    assert.deepEqual(await c.push({ state: 'TX', entries: { [V(2)]: E(99), [V(3)]: E(3) } }), { appended: 1, skipped: 0, duplicate: 1 });
    const restarted = makeVinCache(d);
    assert.equal((await restarted.push({ state: 'TX', entries: { [V(1)]: E(7) } })).duplicate, 1);
    const lines = fs.readFileSync(path.join(d, 'TX.ndjson'), 'utf-8').trim().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines.find((l) => l.includes(V(2))))[1].nhtsa.n, 2);
  });
  it('refuses malformed VINs, entries without an NHTSA decode, and oversized entries', async () => {
    const c = makeVinCache(dir());
    const r = await c.push({ state: 'TX', entries: { BADVIN: E(1), [V(5)]: { nope: 1 }, [V(6)]: { nhtsa: { blob: 'x'.repeat(30_000) } } } });
    assert.deepEqual(r, { appended: 0, skipped: 3, duplicate: 0 });
    await assert.rejects(c.push({ state: 'tx1', entries: {} }), (e) => e.status === 400);
  });
  it('pulls in windows cut at line boundaries, with an offset to continue from', async () => {
    const c = makeVinCache(dir());
    const entries = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [V(100 + i), E(i)]));
    await c.push({ state: 'OH', entries });
    const seen = new Set();
    let from = 0; let eof = false; let rounds = 0;
    while (!eof && rounds++ < 50) {
      const r = await c.pull({ state: 'OH', from, max: 300 });
      for (const line of r.body.split('\n').filter(Boolean)) seen.add(JSON.parse(line)[0]);
      assert.ok(r.body === '' || r.body.endsWith('\n'));
      from = r.nextOffset; eof = r.eof;
    }
    assert.equal(seen.size, 30);
    assert.equal((await c.pull({ state: 'OH', from, max: 300 })).body, '');
    assert.deepEqual(await c.pull({ state: 'ZZ', from: 0 }), { body: '', nextOffset: 0, eof: true, size: 0 });
  });
});

describe('pressure sampler', () => {
  const stat = (iowait, idle) => `cpu  100 0 100 ${idle} ${iowait} 0 0 0\ncpu0 1 1 1 1 1 0 0 0\n`;
  it('parses /proc/stat', () => { assert.deepEqual(parseCpuStat(stat(50, 300)), { idle: 350, iowait: 50, total: 550 }); });
  it('pauses above the pause line and stays paused until below the lower resume line', () => {
    let io = 0; let idle = 0; let user = 0;
    const s = makePressureSampler({ readStat: () => `cpu  ${user} 0 0 ${idle} ${io} 0 0 0\n`, loadavg: () => [1, 1, 1], cpus: () => 4, windowSamples: 1 });
    const step = (dIow, dIdle) => { io += dIow; idle += dIdle; s.sample(); return s.read(); };
    step(0, 0); // baseline
    assert.equal(step(5, 95).ok, true);   // 5%
    assert.equal(step(45, 55).ok, false); // 45% -> pause
    assert.equal(step(25, 75).ok, false); // 25%: below pause line but above resume line -> still paused (no flapping)
    assert.equal(step(10, 90).ok, true);  // 10% -> resume
  });
  it('pauses on sustained load per cpu even with no iowait, and reports its thresholds', () => {
    const s = makePressureSampler({ readStat: () => stat(0, 100), loadavg: () => [20, 0, 0], cpus: () => 4 });
    const r = s.read();
    assert.equal(r.ok, false);
    assert.ok(r.thresholds.pauseIowaitPct > r.thresholds.resumeIowaitPct);
  });
  it('fails open when /proc/stat is unreadable (not linux)', () => {
    const s = makePressureSampler({ readStat: () => { throw new Error('ENOENT'); }, loadavg: () => [0, 0, 0], cpus: () => 4 });
    s.sample();
    assert.equal(s.read().ok, true);
  });
});

describe('HTTP routing', () => {
  function call(svc, method, pathname, body, qs = '') {
    return new Promise((resolve) => {
      const res = { writeHead(s, h) { this.status = s; this.headers = h; }, end(t) { resolve({ status: this.status, body: t, headers: this.headers }); } };
      const h = { pathname, url: new URL(`http://x${pathname}${qs}`), readBody: async () => body, sendJson: (r, s, o) => { r.writeHead(s, {}); r.end(JSON.stringify(o)); } };
      handle({ method }, res, h, svc);
    });
  }
  const svc = () => ({ ops: makeOps(memoryStore(), { ...clock }), cache: makeVinCache(fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'))), pressure: makePressureSampler({ readStat: () => { throw new Error('x'); } }) });
  it('routes queue calls, the cache and pressure; unknown paths are 404; bad input is a 400, not a 500', async () => {
    const s = svc();
    assert.equal((await call(s, 'POST', '/api/ops/crawl-queue/seed', { night: '2026-10-14', jobs: [job('TX', 'Ford', 5)] })).status, 200);
    const claimed = JSON.parse((await call(s, 'POST', '/api/ops/crawl-queue/claim', { night: '2026-10-14', box: 'box3' })).body);
    assert.equal(claimed.claimed.jobKey, 'TX|Ford');
    assert.equal(JSON.parse((await call(s, 'GET', '/api/ops/crawl-queue/status', null, '?night=2026-10-14')).body).counts.claimed, 1);
    assert.equal(JSON.parse((await call(s, 'GET', '/api/ops/sync-pressure')).body).ok, true);
    assert.equal((await call(s, 'POST', '/api/ops/crawl-queue/seed', { night: 'bad', jobs: [] })).status, 400);
    assert.equal((await call(s, 'POST', '/api/ops/crawl-queue/nope', {})).status, 404);
    assert.equal((await call(s, 'GET', '/api/ops/crawl-queue/nope')).status, 404);
    const push = await call(s, 'POST', '/api/ops/vin-cache/push', { state: 'tx', entries: { '1FTFW1E50NFA00001': { nhtsa: { a: 1 } } } });
    assert.equal(JSON.parse(push.body).appended, 1);
    const pull = await call(s, 'GET', '/api/ops/vin-cache/pull', null, '?state=TX&from=0');
    assert.equal(pull.headers['X-Eof'], '1');
    assert.match(pull.body, /1FTFW1E50NFA00001/);
  });
});
