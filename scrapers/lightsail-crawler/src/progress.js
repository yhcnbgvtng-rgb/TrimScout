// Persisted live-run status. The crawl writes this after every dealer so a
// browser refresh of the progress page does not lose the current counters.
// JSON is the source of truth on disk; the HTTP servers only read it.

import fs from 'node:fs/promises';
import path from 'node:path';

export const PROGRESS_PORT = Number(process.env.CRAWLER_PROGRESS_PORT) || 3001;
export const PROGRESS_FILENAME = 'run_progress.json';

export function progressPath(cwd = process.cwd()) {
  return path.resolve(cwd, 'data', PROGRESS_FILENAME);
}

export function emptyProgress(overrides = {}) {
  return {
    status: 'idle',
    currentBrand: null,
    currentDealer: null,
    dealersDone: 0,
    dealersTotal: 0,
    vehiclesSeen: 0,
    priceDrops: 0,
    newArrivals: 0,
    skippedForBotProtection: 0,
    lastError: null,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    eta: null,
    notes: null,
    ...overrides,
  };
}

export function computeEta({ startedAt, dealersDone, dealersTotal, now = Date.now() } = {}) {
  if (!startedAt || !dealersDone || !dealersTotal || dealersDone >= dealersTotal) return null;
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs) || startedMs <= 0) return null;
  const elapsed = now - startedMs;
  if (elapsed <= 0) return null;
  const perDealer = elapsed / dealersDone;
  const remaining = (dealersTotal - dealersDone) * perDealer;
  return new Date(now + remaining).toISOString();
}

export async function readProgress(cwd = process.cwd()) {
  try {
    const raw = await fs.readFile(progressPath(cwd), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...emptyProgress(), ...parsed };
  } catch {
    return emptyProgress();
  }
}

export async function writeProgress(partial, cwd = process.cwd()) {
  const dir = path.dirname(progressPath(cwd));
  await fs.mkdir(dir, { recursive: true });
  const prev = await readProgress(cwd);
  const next = {
    ...prev,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  next.eta = computeEta(next);
  const tmp = `${progressPath(cwd)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, progressPath(cwd));
  return next;
}

function esc(value) {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderProgressHtml(state) {
  const s = { ...emptyProgress(), ...state };
  const pct = s.dealersTotal > 0 ? Math.min(100, Math.round((s.dealersDone / s.dealersTotal) * 100)) : 0;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="5">
  <title>NJ Crawler Progress</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0b0f19; color: #f8fafc; padding: 24px; }
    h1 { font-size: 22px; margin-bottom: 6px; }
    .sub { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .card { background: #131d31; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; }
    .label { color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .value { font-size: 26px; font-weight: 800; margin-top: 6px; word-break: break-word; }
    .value.small { font-size: 16px; }
    .ok { color: #10b981; }
    .warn { color: #fbbf24; }
    .bad { color: #f43f5e; }
    .info { color: #38bdf8; }
    .bar { height: 10px; background: #1e293b; border-radius: 99px; overflow: hidden; margin: 18px 0; }
    .bar > span { display: block; height: 100%; background: #10b981; width: ${pct}%; }
    a { color: #38bdf8; }
    code { background: #0b0f19; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>NJ dealer crawler — live progress</h1>
  <p class="sub">Persisted to <code>data/run_progress.json</code> · JSON at <a href="/progress.json">/progress.json</a> · auto-refresh 5s</p>
  <div class="bar"><span></span></div>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value small ${s.status === 'running' ? 'info' : s.status === 'failed' ? 'bad' : 'ok'}">${esc(s.status)}</div></div>
    <div class="card"><div class="label">Current brand</div><div class="value small">${esc(s.currentBrand)}</div></div>
    <div class="card"><div class="label">Current dealer</div><div class="value small">${esc(s.currentDealer)}</div></div>
    <div class="card"><div class="label">Dealers done / total</div><div class="value">${esc(s.dealersDone)}/${esc(s.dealersTotal)}</div></div>
    <div class="card"><div class="label">Vehicles seen</div><div class="value info">${esc(s.vehiclesSeen)}</div></div>
    <div class="card"><div class="label">Price drops</div><div class="value bad">${esc(s.priceDrops)}</div></div>
    <div class="card"><div class="label">New arrivals</div><div class="value info">${esc(s.newArrivals)}</div></div>
    <div class="card"><div class="label">Skipped (bot protection)</div><div class="value warn">${esc(s.skippedForBotProtection)}</div></div>
    <div class="card"><div class="label">Started</div><div class="value small">${esc(s.startedAt)}</div></div>
    <div class="card"><div class="label">ETA</div><div class="value small">${esc(s.eta)}</div></div>
    <div class="card"><div class="label">Last error</div><div class="value small bad">${esc(s.lastError)}</div></div>
  </div>
</body>
</html>`;
}

export async function handleProgressRequest(req, res, cwd = process.cwd()) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const state = await readProgress(cwd);
  if (url.pathname === '/progress.json' || url.pathname === '/status.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(state, null, 2));
    return true;
  }
  if (url.pathname === '/' || url.pathname === '/progress') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(renderProgressHtml(state));
    return true;
  }
  return false;
}
