// The sync client's transport. The point of replacing fetch() with node:http is the deadline: fetch aborts any
// response that takes more than 300s to START, and a bulk upsert or sweep on a loaded deals box can exceed that
// (box1 2026-10-01, box4 2026-09-28/29 died on it). These run the real transport against a real local server.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  ApiError, isRetryableStatus, timeoutKindFor, DEFAULT_TIMEOUTS_MS, requestJson, createApi, withRetry,
} from '../../../scripts/box/syncHttp.js';

const servers = [];
async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return server.address().port;
}
after(() => { for (const s of servers) s.close(); });

const readAll = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });

describe('status + path classification', () => {
  it('retries only the failures resending can fix', () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504]) assert.equal(isRetryableStatus(s), true, String(s));
    for (const s of [400, 401, 403, 404, 409, 413, 422]) assert.equal(isRetryableStatus(s), false, String(s));
  });

  it('gives each kind of call its own deadline; the two heavy calls get far longer than fetch\'s 300s', () => {
    assert.equal(timeoutKindFor('/api/ops/sync-lock/heartbeat'), 'lock');
    assert.equal(timeoutKindFor('/api/inventory/bulk'), 'bulk');
    assert.equal(timeoutKindFor('/api/inventory/sweep'), 'sweep');
    assert.equal(timeoutKindFor('/api/inventory/stats'), 'stats');
    assert.equal(timeoutKindFor('/api/dealerships'), 'directory');
    assert.equal(timeoutKindFor('/something/else'), 'other');
    assert.ok(DEFAULT_TIMEOUTS_MS.bulk > 300_000 && DEFAULT_TIMEOUTS_MS.sweep > 300_000);
    assert.ok(DEFAULT_TIMEOUTS_MS.lock <= 30_000, 'lock calls stay snappy so a stuck one cannot hide a lost lock');
  });
});

describe('requestJson', () => {
  it('POSTs an object as JSON with the API key and resolves the parsed body', async () => {
    let seen;
    const port = await serve(async (req, res) => {
      seen = { method: req.method, url: req.url, key: req.headers['x-trimscout-api-key'], type: req.headers['content-type'], body: (await readAll(req)).toString() };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ upserted: 3 }));
    });
    const api = createApi({ host: '127.0.0.1', key: 'k-123' });
    assert.deepEqual(await api(port, '/api/inventory/sweep', { dealerId: 7 }), { upserted: 3 });
    assert.deepEqual(seen, { method: 'POST', url: '/api/inventory/sweep', key: 'k-123', type: 'application/json', body: '{"dealerId":7}' });
  });

  it('sends an already-serialized string body as-is, with an exact Content-Length (multi-byte safe)', async () => {
    let seen;
    const port = await serve(async (req, res) => {
      const body = await readAll(req);
      seen = { length: Number(req.headers['content-length']), actual: body.length, text: body.toString('utf8') };
      res.writeHead(200); res.end('{}');
    });
    const body = '{"vehicles":[{"dealerName":"Café Motors — 100% ™"}]}';
    await createApi({ host: '127.0.0.1', key: 'k' })(port, '/api/inventory/bulk', body);
    assert.equal(seen.text, body);
    assert.equal(seen.length, Buffer.byteLength(body));
    assert.equal(seen.actual, Buffer.byteLength(body));
  });

  it('uses GET when there is no body', async () => {
    let method;
    const port = await serve((req, res) => { method = req.method; res.writeHead(200); res.end('{"dealerships":[]}'); });
    assert.deepEqual(await createApi({ host: '127.0.0.1', key: 'k' })(port, '/api/dealerships'), { dealerships: [] });
    assert.equal(method, 'GET');
  });

  it('a 4xx (other than 408/425/429) is not retryable and carries the server\'s message', async () => {
    const port = await serve((req, res) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"dealerId and seenAfter (ISO) are required"}'); });
    await assert.rejects(createApi({ host: '127.0.0.1', key: 'k' })(port, '/api/inventory/sweep', { x: 1 }), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 400);
      assert.equal(err.retryable, false);
      assert.match(err.message, /\/api\/inventory\/sweep -> 400 dealerId and seenAfter/);
      return true;
    });
  });

  it('a 5xx is retryable', async () => {
    const port = await serve((req, res) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Internal server error"}'); });
    await assert.rejects(createApi({ host: '127.0.0.1', key: 'k' })(port, '/api/inventory/bulk', '{}'), (err) => err.status === 500 && err.retryable === true);
  });

  it('an empty or non-JSON success body resolves null instead of throwing', async () => {
    const port = await serve((req, res) => { res.writeHead(204); res.end(); });
    assert.equal(await createApi({ host: '127.0.0.1', key: 'k' })(port, '/api/ops/sync-lock/release', { owner: 'x' }), null);
  });

  it('gives up on a response that takes longer than its deadline — with a retryable timeout', async () => {
    const port = await serve((req, res) => { setTimeout(() => { res.writeHead(200); res.end('{}'); }, 400); });
    const started = Date.now();
    await assert.rejects(createApi({ host: '127.0.0.1', key: 'k', timeouts: { sweep: 100 } })(port, '/api/inventory/sweep', { a: 1 }), (err) => {
      assert.equal(err.code, 'ETIMEDOUT');
      assert.equal(err.retryable, true);
      assert.match(err.message, /no response within/);
      return true;
    });
    assert.ok(Date.now() - started < 350, 'the deadline fires at the deadline, not when the server finally answers');
  });

  it('a response slower than a fetch-style default but inside our deadline simply succeeds', async () => {
    const port = await serve((req, res) => { setTimeout(() => { res.writeHead(200); res.end('{"removed":5}'); }, 150); });
    assert.deepEqual(await createApi({ host: '127.0.0.1', key: 'k', timeouts: { sweep: 2000 } })(port, '/api/inventory/sweep', { a: 1 }), { removed: 5 });
  });

  it('a refused connection and a socket reset are both retryable network errors', async () => {
    const dead = http.createServer(); await new Promise((r) => dead.listen(0, '127.0.0.1', r)); const deadPort = dead.address().port; await new Promise((r) => dead.close(r));
    await assert.rejects(createApi({ host: '127.0.0.1', key: 'k' })(deadPort, '/api/inventory/stats'), (err) => err.retryable === true && err.code === 'ECONNREFUSED');
    const port = await serve((req) => { req.socket.destroy(); });
    await assert.rejects(createApi({ host: '127.0.0.1', key: 'k' })(port, '/api/inventory/bulk', '{}'), (err) => err.retryable === true);
  });

  it('requestJson rejects once even if both the timeout and an error fire', async () => {
    const port = await serve((req) => { setTimeout(() => req.socket.destroy(), 30); });
    await assert.rejects(requestJson({ host: '127.0.0.1', port, path: '/x', method: 'GET', timeoutMs: 40 }), ApiError);
  });
});

describe('withRetry', () => {
  const retryable = () => new ApiError('boom', { status: 503, retryable: true });
  const waits = () => { const w = []; return { w, sleep: async (ms) => { w.push(ms); } }; };

  it('retries a retryable failure with growing spacing, capped, and reports each retry', async () => {
    const { w, sleep } = waits();
    const seen = [];
    let n = 0;
    const out = await withRetry(async () => { if (++n < 5) throw retryable(); return 'ok'; }, { retries: 6, delayMs: 5000, factor: 2, maxDelayMs: 30_000, sleep, onRetry: (i) => seen.push(i.attempt) });
    assert.equal(out, 'ok');
    assert.deepEqual(w, [5000, 10_000, 20_000, 30_000]);
    assert.deepEqual(seen, [1, 2, 3, 4]);
  });

  it('gives up after `retries` re-attempts and throws the last error', async () => {
    const { w, sleep } = waits();
    let n = 0;
    await assert.rejects(withRetry(async () => { n++; throw retryable(); }, { retries: 2, delayMs: 1, sleep }), /boom/);
    assert.equal(n, 3);
    assert.equal(w.length, 2);
  });

  it('does not retry a non-retryable ApiError or a programming error', async () => {
    const { w, sleep } = waits();
    let n = 0;
    await assert.rejects(withRetry(async () => { n++; throw new ApiError('bad request', { status: 400, retryable: false }); }, { retries: 5, sleep }), /bad request/);
    await assert.rejects(withRetry(async () => { n++; throw new TypeError('x is not a function'); }, { retries: 5, sleep }), TypeError);
    assert.equal(n, 2);
    assert.deepEqual(w, []);
  });
});
