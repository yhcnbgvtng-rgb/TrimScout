// Server side of the crawl shard queue — runs inside the deals API process on box2 (a separate file so the live,
// drifted deals_api_server.js only needs ONE anchored hook line; see scripts/box/2026-10-14-crawl-queue-install.sh).
//
// Three things live here, all behind /api/ops/ and the server's normal API-key gate:
//   1. the job queue      /api/ops/crawl-queue/{seed,claim,heartbeat,complete,fail,status,history}
//   2. the shared VIN cache /api/ops/vin-cache/{pull,push}  — NHTSA lookups one box did, available to the others
//   3. sync backpressure   /api/ops/sync-pressure           — box2's own iowait/load, read by the sync clients
//
// Nothing here runs unless a crawl box calls it, which only happens with the crawl-queue flag on. The table is created
// on first use (CREATE TABLE IF NOT EXISTS) — no migration step and nothing to undo: rollback just stops calling it.
import fs from 'node:fs';
import readline from 'node:readline';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { claim, heartbeat, finish, summarize, reapExpired, DEFAULTS, JOB } from './crawlQueueCore.js';

// ---- row <-> job mapping ------------------------------------------------------------------------------------------
const COLS = [
  ['jobKey', 'job_key'], ['state', 'state'], ['brand', 'brand'], ['brandSet', 'brand_set'], ['dealers', 'dealers'], ['vehicles', 'vehicles'],
  ['estSeconds', 'est_seconds'], ['heavy', 'heavy'], ['status', 'status'], ['attempts', 'attempts'], ['maxAttempts', 'max_attempts'],
  ['claimedBy', 'claimed_by'], ['claimToken', 'claim_token'], ['claimedAt', 'claimed_at'], ['startedAt', 'started_at'], ['heartbeatAt', 'heartbeat_at'],
  ['leaseExpiresAt', 'lease_expires_at'], ['finishedAt', 'finished_at'], ['durationSeconds', 'duration_seconds'], ['exitStatus', 'exit_status'],
  ['lastError', 'last_error'], ['lastFailedBox', 'last_failed_box'], ['lastBox', 'last_box'],
];
const num = (v) => (v == null ? null : Number(v));
export function rowToJob(r) {
  const j = {};
  for (const [camel, snake] of COLS) j[camel] = r[snake] ?? null;
  for (const k of ['dealers', 'vehicles', 'estSeconds', 'attempts', 'maxAttempts', 'claimedAt', 'startedAt', 'heartbeatAt', 'leaseExpiresAt', 'finishedAt', 'durationSeconds']) j[k] = num(j[k]);
  j.heavy = Boolean(Number(j.heavy));
  return j;
}
const jobToCols = (j) => Object.fromEntries(COLS.map(([camel, snake]) => [snake, camel === 'heavy' ? (j.heavy ? 1 : 0) : j[camel] ?? null]));

export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS crawl_queue_jobs (
  night VARCHAR(32) NOT NULL,
  job_key VARCHAR(64) NOT NULL,
  state CHAR(2) NOT NULL,
  brand VARCHAR(40) NOT NULL,
  brand_set VARCHAR(16) NOT NULL,
  dealers INT NOT NULL DEFAULT 0,
  vehicles INT NULL,
  est_seconds INT NOT NULL DEFAULT 0,
  heavy TINYINT NOT NULL DEFAULT 0,
  status VARCHAR(12) NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 2,
  claimed_by VARCHAR(64) NULL,
  claim_token VARCHAR(64) NULL,
  claimed_at BIGINT NULL,
  started_at BIGINT NULL,
  heartbeat_at BIGINT NULL,
  lease_expires_at BIGINT NULL,
  finished_at BIGINT NULL,
  duration_seconds INT NULL,
  exit_status VARCHAR(24) NULL,
  last_error VARCHAR(500) NULL,
  last_failed_box VARCHAR(64) NULL,
  last_box VARCHAR(16) NULL,
  PRIMARY KEY (night, job_key),
  INDEX idx_cqj_status (night, status, est_seconds)
)`;

/** UPDATE built from the columns that changed between two versions of a job; null when nothing changed. */
export function diffUpdate(night, before, after) {
  const a = jobToCols(before); const b = jobToCols(after);
  const changed = Object.keys(b).filter((c) => c !== 'job_key' && a[c] !== b[c]);
  if (!changed.length) return null;
  return { sql: `UPDATE crawl_queue_jobs SET ${changed.map((c) => `${c} = ?`).join(', ')} WHERE night = ? AND job_key = ?`, params: [...changed.map((c) => b[c]), night, after.jobKey] };
}

// ---- stores: the same interface over MariaDB and over memory (tests) ----------------------------------------------
/** Runs fn(tx) in a transaction holding the night's rows locked; tx = { load(), save(before, after), insert(jobs) }. */
export function mysqlStore(pool) {
  let ready = false;
  return {
    async ensure() { if (!ready) { await pool.query(SCHEMA_SQL); ready = true; } },
    async withNight(night, fn) {
      await this.ensure();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query('SELECT * FROM crawl_queue_jobs WHERE night = ? FOR UPDATE', [night]);
        const tx = {
          jobs: rows.map(rowToJob),
          async save(before, after) {
            const byKey = new Map(before.map((j) => [j.jobKey, j]));
            for (const j of after) { const prev = byKey.get(j.jobKey); const u = prev ? diffUpdate(night, prev, j) : null; if (u) await conn.query(u.sql, u.params); }
          },
          async insert(jobs) {
            if (!jobs.length) return 0;
            const cols = COLS.map(([, s]) => s);
            const [res] = await conn.query(`INSERT IGNORE INTO crawl_queue_jobs (night, ${cols.join(', ')}) VALUES ?`, [jobs.map((j) => { const c = jobToCols(j); return [night, ...cols.map((k) => c[k])]; })]);
            return res.affectedRows ?? 0;
          },
        };
        const out = await fn(tx);
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally {
        conn.release();
      }
    },
    async history(nights = 14) {
      await this.ensure();
      const [rows] = await pool.query(`SELECT job_key, duration_seconds, claimed_by, night FROM crawl_queue_jobs WHERE status = 'done' AND duration_seconds IS NOT NULL AND night >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? DAY), '%Y-%m-%d') ORDER BY night`, [nights]);
      return rows;
    },
  };
}

export function memoryStore() {
  const nights = new Map();
  return {
    nights,
    async withNight(night, fn) {
      const list = nights.get(night) || [];
      const tx = {
        jobs: list.map((j) => ({ ...j })),
        async save(before, after) { nights.set(night, after.map((j) => ({ ...j }))); },
        async insert(jobs) { const have = new Set(list.map((j) => j.jobKey)); const add = jobs.filter((j) => !have.has(j.jobKey)); nights.set(night, [...list, ...add.map((j) => ({ ...j }))]); return add.length; },
      };
      return fn(tx);
    },
    async history() { return []; },
  };
}

// ---- operations (store-agnostic, so tests exercise the real logic) -------------------------------------------------
const NIGHT_RE = /^[A-Za-z0-9-]{4,32}$/;
const STR = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

export function makeOps(store, { now = () => Date.now(), newToken = () => randomBytes(8).toString('hex'), leaseMs = DEFAULTS.LEASE_MS, maxAttempts = DEFAULTS.MAX_ATTEMPTS } = {}) {
  const need = (cond, msg) => { if (!cond) { const e = new Error(msg); e.status = 400; throw e; } };
  return {
    /** Idempotent: a job that already exists (claimed, done, anything) is never touched — safe from every box, every stage. */
    async seed({ night, jobs }) {
      need(NIGHT_RE.test(night || ''), 'night is required');
      need(Array.isArray(jobs) && jobs.length > 0 && jobs.length <= 5000, 'jobs[] is required (max 5000)');
      const clean = jobs.map((j) => {
        need(/^[A-Za-z]{2}$/.test(j.state || '') && STR(j.brand, 40) && /^(core|expansion)$/.test(j.brandSet || ''), `bad job ${JSON.stringify(j).slice(0, 80)}`);
        return { jobKey: `${j.state.toUpperCase()}|${j.brand}`, state: j.state.toUpperCase(), brand: j.brand.slice(0, 40), brandSet: j.brandSet, dealers: Math.max(0, Math.round(Number(j.dealers) || 0)), vehicles: j.vehicles == null ? null : Math.round(Number(j.vehicles)), estSeconds: Math.max(1, Math.round(Number(j.estSeconds) || 1)), heavy: Boolean(j.heavy), status: JOB.QUEUED, attempts: 0, maxAttempts, claimedBy: null, claimToken: null, claimedAt: null, startedAt: null, heartbeatAt: null, leaseExpiresAt: null, finishedAt: null, durationSeconds: null, exitStatus: null, lastError: null, lastFailedBox: null, lastBox: STR(j.lastBox, 16) };
      });
      return store.withNight(night, async (tx) => { const seeded = await tx.insert(clean); return { seeded, total: tx.jobs.length + seeded }; });
    },
    async claim({ night, box, brandSets = null, allowHeavy = true, skipKeys = [] }) {
      need(NIGHT_RE.test(night || '') && STR(box, 64), 'night and box are required');
      return store.withNight(night, async (tx) => {
        const r = claim(tx.jobs, { box, brandSets, allowHeavy: allowHeavy !== false, skipKeys: Array.isArray(skipKeys) ? skipKeys.slice(0, 2000) : [] }, now(), { leaseMs, newToken });
        await tx.save(tx.jobs, r.jobs);
        const counts = summarize(r.jobs);
        return { claimed: r.claimed ? { jobKey: r.claimed.jobKey, state: r.claimed.state, brand: r.claimed.brand, brandSet: r.claimed.brandSet, dealers: r.claimed.dealers, estSeconds: r.claimed.estSeconds, heavy: r.claimed.heavy, attempt: r.claimed.attempts, token: r.claimed.claimToken, leaseMs } : null, reaped: r.reaped, counts };
      });
    },
    async heartbeat({ night, jobKey, token }) {
      need(NIGHT_RE.test(night || '') && STR(jobKey, 64) && STR(token, 64), 'night, jobKey, token required');
      return store.withNight(night, async (tx) => { const r = heartbeat(tx.jobs, { jobKey, token }, now(), { leaseMs }); if (r.renewed) await tx.save(tx.jobs, r.jobs); return { renewed: r.renewed, reason: r.reason || null }; });
    },
    async complete({ night, jobKey, token, durationSeconds, exit, vehicles }) {
      need(NIGHT_RE.test(night || '') && STR(jobKey, 64) && STR(token, 64), 'night, jobKey, token required');
      return store.withNight(night, async (tx) => {
        const r = finish(tx.jobs, { jobKey, token, ok: true, durationSeconds: durationSeconds == null ? null : Math.round(Number(durationSeconds)), exit: STR(exit, 24) }, now());
        if (r.accepted) {
          const jobs = vehicles == null ? r.jobs : r.jobs.map((j) => (j.jobKey === jobKey ? { ...j, vehicles: Math.round(Number(vehicles)) } : j));
          await tx.save(tx.jobs, jobs);
        }
        return { accepted: r.accepted, reason: r.reason || null };
      });
    },
    async fail({ night, jobKey, token, error, retryable = true, durationSeconds, exit }) {
      need(NIGHT_RE.test(night || '') && STR(jobKey, 64) && STR(token, 64), 'night, jobKey, token required');
      return store.withNight(night, async (tx) => {
        const r = finish(tx.jobs, { jobKey, token, ok: false, retryable: retryable !== false, error: STR(error, 500), durationSeconds: durationSeconds == null ? null : Math.round(Number(durationSeconds)), exit: STR(exit, 24) }, now());
        if (r.accepted) await tx.save(tx.jobs, r.jobs);
        return { accepted: r.accepted, reason: r.reason || null, status: r.status || null };
      });
    },
    async status({ night }) {
      need(NIGHT_RE.test(night || ''), 'night is required');
      return store.withNight(night, async (tx) => {
        const reaped = reapExpired(tx.jobs, now());
        if (reaped.reaped.length) await tx.save(tx.jobs, reaped.jobs);
        const jobs = reaped.jobs;
        const byBox = {};
        for (const j of jobs) {
          const b = j.claimedBy || j.lastFailedBox;
          if (!b) continue;
          const s = (byBox[b] ||= { claimed: 0, done: 0, failed: 0, busySeconds: 0 });
          if (j.status === JOB.CLAIMED) s.claimed++; if (j.status === JOB.DONE) { s.done++; s.busySeconds += j.durationSeconds || 0; } if (j.status === JOB.FAILED) s.failed++;
        }
        return { night, counts: summarize(jobs), byBox, failed: jobs.filter((j) => j.status === JOB.FAILED).map((j) => ({ jobKey: j.jobKey, attempts: j.attempts, error: j.lastError })), running: jobs.filter((j) => j.status === JOB.CLAIMED).map((j) => ({ jobKey: j.jobKey, box: j.claimedBy, startedAt: j.startedAt, estSeconds: j.estSeconds, heartbeatAgeS: Math.round((now() - j.heartbeatAt) / 1000) })) };
      });
    },
    async history() {
      const rows = await store.history(14);
      const by = {};
      for (const r of rows) (by[r.job_key] ||= []).push({ night: r.night, seconds: Number(r.duration_seconds), box: r.claimed_by });
      return { timings: by };
    },
  };
}

// ---- shared VIN cache: append-only NDJSON per state, on box2's disk (not in MariaDB: the point is less database I/O) --
const STATE_RE = /^[A-Z]{2}$/;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
export const CACHE_PULL_MAX_BYTES = 8 * 1024 * 1024;
export const CACHE_ENTRY_MAX_BYTES = 20 * 1024;

export function makeVinCache(dir = process.env.CRAWL_QUEUE_CACHE_DIR || path.join(os.homedir(), 'crawl-queue', 'vin-cache'), { maxLoadedStates = 4 } = {}) {
  const file = (state) => path.join(dir, `${state}.ndjson`);
  let pullBusy = Promise.resolve(); // one download at a time: this is exactly the disk box2 must not be hammered on
  const appendLocks = new Map();
  // VINs already in a state's file, so a box that re-sends entries it merely pulled earlier cannot grow the file (first
  // writer wins). Loaded lazily by scanning the file's VIN column (no JSON parse) and kept for the few most recent states.
  const known = new Map();
  async function knownVins(state) {
    if (known.has(state)) { const v = known.get(state); known.delete(state); known.set(state, v); return v; }
    const set = new Set();
    try {
      const rl = readline.createInterface({ input: fs.createReadStream(file(state)), crlfDelay: Infinity });
      for await (const line of rl) if (line.length > 19 && line[0] === '[') set.add(line.slice(2, 19));
    } catch { /* no file yet */ }
    known.set(state, set);
    while (known.size > maxLoadedStates) known.delete(known.keys().next().value);
    return set;
  }
  return {
    dir,
    async push({ state, entries }) {
      if (!STATE_RE.test(state || '')) { const e = new Error('state must be a 2-letter code'); e.status = 400; throw e; }
      if (!entries || typeof entries !== 'object') { const e = new Error('entries{} required'); e.status = 400; throw e; }
      const prev = appendLocks.get(state) || Promise.resolve();
      const job = prev.then(async () => {
        const have = await knownVins(state);
        let lines = ''; let n = 0; let skipped = 0; let duplicate = 0; const added = [];
        for (const [vin, entry] of Object.entries(entries)) {
          const s = JSON.stringify(entry);
          if (!VIN_RE.test(vin) || !entry || !entry.nhtsa || s.length > CACHE_ENTRY_MAX_BYTES) { skipped++; continue; }
          if (have.has(vin)) { duplicate++; continue; }
          lines += `${JSON.stringify([vin, entry])}\n`; n++; added.push(vin);
        }
        if (lines) {
          await fsp.mkdir(dir, { recursive: true });
          await fsp.appendFile(file(state), lines);
          for (const v of added) have.add(v);
        }
        return { appended: n, skipped, duplicate };
      });
      appendLocks.set(state, job.catch(() => {}));
      return job;
    },
    /** Bytes [from, from+max) of the state's file, cut at a line boundary. Returns { body, nextOffset, eof, size }. */
    async pull({ state, from = 0, max = CACHE_PULL_MAX_BYTES }) {
      if (!STATE_RE.test(state || '')) { const e = new Error('state must be a 2-letter code'); e.status = 400; throw e; }
      const run = async () => {
        let st;
        try { st = await fsp.stat(file(state)); } catch { return { body: '', nextOffset: 0, eof: true, size: 0 }; }
        const start = Math.max(0, Math.min(Number(from) || 0, st.size));
        if (start >= st.size) return { body: '', nextOffset: st.size, eof: true, size: st.size };
        const len = Math.min(max, st.size - start);
        const fh = await fsp.open(file(state), 'r');
        try {
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, start);
          let text = buf.toString('utf-8');
          if (start + len < st.size) { const cut = text.lastIndexOf('\n'); if (cut === -1) { const e = new Error('line larger than the pull window'); e.status = 500; throw e; } text = text.slice(0, cut + 1); }
          const bytes = Buffer.byteLength(text);
          return { body: text, nextOffset: start + bytes, eof: start + bytes >= st.size, size: st.size };
        } finally { await fh.close(); }
      };
      const p = pullBusy.then(run, run);
      pullBusy = p.catch(() => {});
      return p;
    },
  };
}

// ---- sync backpressure: box2's own iowait and load ----------------------------------------------------------------
export function parseCpuStat(text) {
  const line = String(text).split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return null;
  const f = line.trim().split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = f;
  return { idle: idle + iowait, iowait, total: user + nice + system + idle + iowait + irq + softirq + steal };
}

export function makePressureSampler({ readStat = () => fs.readFileSync('/proc/stat', 'utf-8'), loadavg = () => os.loadavg(), cpus = () => os.cpus().length, intervalMs = 5000, windowSamples = 6, thresholds = { pauseIowaitPct: Number(process.env.CRAWL_QUEUE_PAUSE_IOWAIT_PCT) || 30, resumeIowaitPct: Number(process.env.CRAWL_QUEUE_RESUME_IOWAIT_PCT) || 18, pauseLoadPerCpu: Number(process.env.CRAWL_QUEUE_PAUSE_LOAD_PER_CPU) || 3 }, now = () => Date.now() } = {}) {
  let prev = null; const samples = []; let timer = null; let paused = false;
  const sample = () => {
    let cur = null;
    try { cur = parseCpuStat(readStat()); } catch { /* not linux / unreadable: fail open */ }
    if (cur && prev) {
      const dt = cur.total - prev.total;
      if (dt > 0) { samples.push((100 * (cur.iowait - prev.iowait)) / dt); if (samples.length > windowSamples) samples.shift(); }
    }
    if (cur) prev = cur;
  };
  const read = () => {
    const iowaitPct = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    const load1 = loadavg()[0] || 0; const c = Math.max(1, cpus());
    // Hysteresis: once paused, stay paused until iowait falls below the (lower) resume line, so clients don't flap.
    if (!paused && (iowaitPct >= thresholds.pauseIowaitPct || load1 / c >= thresholds.pauseLoadPerCpu)) paused = true;
    else if (paused && iowaitPct < thresholds.resumeIowaitPct && load1 / c < thresholds.pauseLoadPerCpu) paused = false;
    return { iowaitPct: Math.round(iowaitPct * 10) / 10, load1: Math.round(load1 * 100) / 100, cpus: c, samples: samples.length, ok: !paused, thresholds, sampledAt: now() };
  };
  return { sample, read, start() { if (!timer) { sample(); timer = setInterval(sample, intervalMs); timer.unref?.(); } }, stop() { clearInterval(timer); timer = null; } };
}

// ---- HTTP glue -------------------------------------------------------------------------------------------------------
let singleton = null;
function services(getPool) {
  if (!singleton) singleton = { ops: makeOps(mysqlStore(getPool())), cache: makeVinCache(), pressure: makePressureSampler() };
  singleton.pressure.start();
  return singleton;
}
export function _resetForTests() { singleton = null; }

/**
 * Called from deals_api_server.js for any /api/ops/crawl-queue/*, /api/ops/vin-cache/* or /api/ops/sync-pressure request.
 * `h` = { pathname, url, getPool, readBody, sendJson } — the server's own helpers, so auth/body-size rules stay theirs.
 */
export async function handle(req, res, h, svc = null) {
  const s = svc || services(h.getPool);
  const { pathname } = h;
  const fail = (e) => h.sendJson(res, e.status || 500, { error: e.status ? e.message : 'Internal server error' });
  try {
    if (req.method === 'GET' && pathname === '/api/ops/sync-pressure') return h.sendJson(res, 200, s.pressure.read());
    if (req.method === 'GET' && pathname === '/api/ops/crawl-queue/status') return h.sendJson(res, 200, await s.ops.status({ night: h.url.searchParams.get('night') }));
    if (req.method === 'GET' && pathname === '/api/ops/crawl-queue/history') return h.sendJson(res, 200, await s.ops.history());
    if (req.method === 'GET' && pathname === '/api/ops/vin-cache/pull') {
      const q = h.url.searchParams;
      const r = await s.cache.pull({ state: (q.get('state') || '').toUpperCase(), from: Number(q.get('from') || 0) });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Next-Offset': String(r.nextOffset), 'X-Eof': r.eof ? '1' : '0', 'X-Size': String(r.size) });
      return res.end(r.body);
    }
    if (req.method !== 'POST') return h.sendJson(res, 404, { error: 'not found' });
    const body = await h.readBody(req, 8_000_000);
    const m = { '/api/ops/crawl-queue/seed': 'seed', '/api/ops/crawl-queue/claim': 'claim', '/api/ops/crawl-queue/heartbeat': 'heartbeat', '/api/ops/crawl-queue/complete': 'complete', '/api/ops/crawl-queue/fail': 'fail' }[pathname];
    if (m) return h.sendJson(res, 200, await s.ops[m](body || {}));
    if (pathname === '/api/ops/vin-cache/push') return h.sendJson(res, 200, await s.cache.push({ state: String((body && body.state) || '').toUpperCase(), entries: body && body.entries }));
    return h.sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    if (!e.status) console.error(`${new Date().toISOString()} ${pathname} -> 500:`, e.stack || e.message);
    return fail(e);
  }
}
