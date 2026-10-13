// HTTP client for the crawl queue endpoints on box2 (crawlQueueServer.js). Same host/port/key convention as
// crawl_claims.js, kept self-contained because it is copied to boxes without the rest of the repo.
import http from 'node:http';
import os from 'node:os';

const DEALS_HOST = process.env.TRIMSCOUT_DEALS_HOST || '52.202.234.65';
const DEALS_PORT = Number(process.env.TRIMSCOUT_DEALS_PORT || '3004');
const KEY = () => process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;

export class QueueApiError extends Error {
  constructor(message, status = null, retryable = true) { super(message); this.name = 'QueueApiError'; this.status = status; this.retryable = retryable; }
}

/** One JSON request with a hard deadline. Resolves parsed JSON; rejects QueueApiError (retryable for 5xx/network). */
export function request({ method = 'POST', path, body = null, timeoutMs = 20_000, host = DEALS_HOST, port = DEALS_PORT, raw = false, req = http.request }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = req({ host, port, path, method, agent: false, headers: { 'X-Trimscout-Api-Key': KEY() || '', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (raw && res.statusCode < 300) return resolve({ text, headers: res.headers });
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        if (res.statusCode >= 300) return reject(new QueueApiError(`${path} -> ${res.statusCode} ${(json && json.error) || text.slice(0, 120)}`, res.statusCode, res.statusCode >= 500 || res.statusCode === 429 || res.statusCode === 408));
        resolve(json);
      });
    });
    const timer = setTimeout(() => r.destroy(new QueueApiError(`${path} timed out after ${timeoutMs}ms`, null, true)), timeoutMs);
    r.on('error', (e) => { clearTimeout(timer); reject(e instanceof QueueApiError ? e : new QueueApiError(`${path} -> ${e.code || e.message}`, null, true)); });
    r.on('close', () => clearTimeout(timer));
    if (payload) r.write(payload);
    r.end();
  });
}

const P = '/api/ops/crawl-queue';
export const makeQueueClient = (box, send = request) => ({
  box,
  seed: ({ night, jobs }) => send({ path: `${P}/seed`, body: { night, jobs }, timeoutMs: 60_000 }),
  claim: ({ night, brandSets, allowHeavy, skipKeys }) => send({ path: `${P}/claim`, body: { night, box, brandSets, allowHeavy, skipKeys } }),
  heartbeat: ({ night, jobKey, token }) => send({ path: `${P}/heartbeat`, body: { night, jobKey, token } }),
  complete: ({ night, jobKey, token, durationSeconds, exit, vehicles }) => send({ path: `${P}/complete`, body: { night, jobKey, token, durationSeconds, exit, vehicles } }),
  fail: ({ night, jobKey, token, error, retryable, durationSeconds, exit }) => send({ path: `${P}/fail`, body: { night, jobKey, token, error, retryable, durationSeconds, exit } }),
  status: ({ night }) => send({ method: 'GET', path: `${P}/status?night=${encodeURIComponent(night)}` }),
  history: () => send({ method: 'GET', path: `${P}/history` }),
});

export const defaultOwner = () => `${os.hostname()}-${process.pid}`;
