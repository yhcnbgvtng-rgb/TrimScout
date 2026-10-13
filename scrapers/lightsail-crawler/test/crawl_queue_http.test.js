// Client <-> server over real HTTP on localhost: the paths, methods, headers and JSON shapes the two halves agree on, which
// the unit tests (each half against fakes) cannot show. The server is the real crawlQueueServer.handle behind a key check like
// the deals API's, with an in-memory job store.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handle, makeOps, memoryStore, makeVinCache, makePressureSampler } from '../src/crawlQueueServer.js';
import { runWorker } from '../src/crawlQueueWorker.js';
import { makeVinCacheSync } from '../src/vinCacheShared.js';
import { makePressureWaiter } from '../src/crawlQueuePressure.js';

let server; let port; let client; let mod; let svc;
const KEY = 'test-key';

before(async () => {
  svc = { ops: makeOps(memoryStore()), cache: makeVinCache(fs.mkdtempSync(path.join(os.tmpdir(), 'cqh-'))), pressure: makePressureSampler({ readStat: () => { throw new Error('x'); } }) };
  server = http.createServer(async (req, res) => {
    if (req.headers['x-trimscout-api-key'] !== KEY) { res.writeHead(401); return res.end('{"error":"Unauthorized"}'); }
    const url = new URL(req.url, 'http://x');
    const readBody = (r) => new Promise((resolve) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => resolve(d ? JSON.parse(d) : {})); });
    await handle(req, res, { pathname: url.pathname, url, getPool: () => null, readBody, sendJson: (r, s, o) => { r.writeHead(s, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); } }, svc);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  process.env.TRIMSCOUT_DEALS_HOST = '127.0.0.1'; process.env.TRIMSCOUT_DEALS_PORT = String(port); process.env.TRIMSCOUT_API_KEY = KEY;
  mod = await import(`../src/crawlQueueClient.js?port=${port}`);
  client = mod.makeQueueClient('box3');
});
after(() => server.close());

describe('client over HTTP', () => {
  it('seed -> claim -> heartbeat -> complete -> status, as a worker would drive it', async () => {
    const jobs = [{ state: 'TX', brand: 'Ford', brandSet: 'expansion', dealers: 188, estSeconds: 7600, heavy: true }, { state: 'DE', brand: 'Toyota', brandSet: 'core', dealers: 4, estSeconds: 200, heavy: false }];
    assert.equal((await client.seed({ night: '2026-10-14', jobs })).seeded, 2);
    const c = await client.claim({ night: '2026-10-14', brandSets: ['core', 'expansion'], allowHeavy: true });
    assert.equal(c.claimed.jobKey, 'TX|Ford');
    assert.equal((await client.heartbeat({ night: '2026-10-14', jobKey: 'TX|Ford', token: c.claimed.token })).renewed, true);
    assert.equal((await client.complete({ night: '2026-10-14', jobKey: 'TX|Ford', token: c.claimed.token, durationSeconds: 5000, exit: 'ok', vehicles: 120 })).accepted, true);
    const st = await client.status({ night: '2026-10-14' });
    assert.deepEqual({ done: st.counts.done, queued: st.counts.queued }, { done: 1, queued: 1 });
  });
  it('a wrong key is refused and surfaces as a non-retryable error; a missing route is a 404', async () => {
    const saved = process.env.TRIMSCOUT_API_KEY;
    process.env.TRIMSCOUT_API_KEY = 'nope';
    await assert.rejects(client.status({ night: '2026-10-14' }), (e) => e.status === 401 && e.retryable === false);
    process.env.TRIMSCOUT_API_KEY = saved;
    await assert.rejects(mod.request({ method: 'GET', path: '/api/ops/crawl-queue/nope' }), (e) => e.status === 404);
  });
  it('a worker drains a queue through the real client, with the real routes', async () => {
    await client.seed({ night: '2026-10-15', jobs: ['AK', 'AL', 'AR'].map((s, i) => ({ state: s, brand: 'Honda', brandSet: 'core', dealers: 1, estSeconds: 10 - i })) });
    const ran = [];
    await runWorker({ client, flag: { slots: 2, brandSets: null, maxHeavy: 1 }, night: '2026-10-15', log: () => {}, pollMs: 1, standbyMs: 3, runJob: async (j) => { ran.push(j.jobKey); return { ok: true }; } });
    assert.equal(ran.length, 3);
    assert.equal((await client.status({ night: '2026-10-15' })).counts.done, 3);
  });
  it('the shared VIN cache round-trips through the wire, including the offset headers', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cqhc-'));
    const sync = makeVinCacheSync({ cwd, request: mod.request, log: () => {} });
    const V = (i) => `1FT${String(i).padStart(14, '0')}`;
    await mod.request({ path: '/api/ops/vin-cache/push', body: { state: 'TX', entries: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [V(i), { nhtsa: { Make: 'FORD', i } }])) } });
    const r = await sync.pullState('TX');
    assert.deepEqual({ entries: r.entries, merged: r.merged, eof: r.eof }, { entries: 5, merged: 5, eof: true });
  });
  it('the pressure waiter reads the live endpoint and passes straight through when box2 is fine', async () => {
    const wait = makePressureWaiter({ fetchPressure: () => mod.request({ method: 'GET', path: '/api/ops/sync-pressure' }), log: () => {} });
    const r = await wait('bulk');
    assert.equal(r.pressure.ok, true);
    assert.equal(r.waitedMs < 1000, true);
  });
  it('an unreachable server is a retryable error, not a hang', async () => {
    await assert.rejects(mod.request({ method: 'GET', path: '/x', port: 1, timeoutMs: 2000 }), (e) => e.retryable === true);
  });
});
