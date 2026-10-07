// The real scripts/box/inventory-sync.mjs, run as a child process against a fake deals API on localhost — the
// closest thing to a staging run that doesn't touch production. The fake models the parts of the real API
// that decide whether the nightly data comes out right (an upsert stamps last_seen_at; a sweep retires rows of
// the given stores last seen before the cutoff) and can be told to misbehave: refuse batched sweeps like the
// previous API version, fail, stall past the client's deadline, or report the lock lost.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../../../scripts/box/inventory-sync.mjs', import.meta.url));
const KEY = 'test-key-123';
const vin = (i) => `1HGBH41JXMN${String(i).padStart(6, '0')}`;
const STORES = (n) => Array.from({ length: n }, (_, i) => ({ id: 101 + i, name: `Store ${101 + i} Motors Café`, host: `store${101 + i}.example.com` }));

// ---- fixtures -------------------------------------------------------------------------------------------
const tmpRoots = [];
function workdir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-e2e-')); tmpRoots.push(d); return d; }
after(() => { for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true }); });

/** Two state shards, `perStore` vehicles for each of `n` stores, in the shape the crawler writes. */
function writeShards(dir, { n = 3, perStore = 20, staleStoreIds = [] } = {}) {
  const stores = STORES(n);
  const shardDir = path.join(dir, 'inventory');
  fs.mkdirSync(shardDir, { recursive: true });
  const NJ = [], NY = [];
  let k = 0;
  for (const s of stores) for (let j = 0; j < perStore; j++, k++) {
    (s.id % 2 ? NJ : NY).push({ vin: vin(k), status: 'ACTIVE', updatedAt: staleStoreIds.includes(s.id) ? '2026-09-26T08:01:16.071Z' : new Date().toISOString(), dealerName: s.name, state: s.id % 2 ? 'NJ' : 'NY', url: `https://${s.host}/vdp/${k}`, year: 2024, make: 'Toyota', model: 'Camry', price: 30000 + k, inventoryType: 'NEW', priceHistory: [{ date: '2026-10-01', price: 30500 + k }] });
  }
  fs.writeFileSync(path.join(shardDir, 'NJ.json'), JSON.stringify(NJ));
  fs.writeFileSync(path.join(shardDir, 'NY.json'), JSON.stringify(NY));
  return { shardDir, stores, total: k };
}

// ---- the fake deals API ----------------------------------------------------------------------------------
function makeFake({ stores, legacySweep = false, preexisting = [] } = {}) {
  const db = new Map(); // `${vin}|${dealerId}` -> { dealerId, lastSeen, removed }
  for (const r of preexisting) db.set(`${r.vin}|${r.dealerId}`, { dealerId: r.dealerId, lastSeen: r.lastSeen, removed: false, sourceBox: r.sourceBox ?? null });
  const f = {
    db,
    legacySweep,
    log: [], // every request, in order: { method, path, body? }
    bulkBodies: [], // the vehicle arrays received
    sweeps: [],
    lock: { acquirePolls: 0, busyFor: 0, heartbeatLostAfterBulk: null, released: 0 },
    fail: { bulk: null, sweep: null }, // (callNumber|body) => truthy to answer 500
    sweepDelay: null, // (body, attempt) => ms to stall before answering
    stats: 0,
  };
  f.active = () => [...db.entries()].filter(([, r]) => !r.removed).map(([k]) => k.split('|')[0]);
  f.server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-trimscout-api-key'] !== KEY) return send(401, { error: 'Unauthorized' });
    const url = req.url;
    const body = raw ? JSON.parse(raw) : null;
    f.log.push({ method: req.method, path: url, body: url === '/api/inventory/bulk' ? { count: body.vehicles.length } : body });
    if (url === '/api/dealerships') return send(200, { dealerships: stores.map((s) => ({ id: s.id, dealerName: s.name, state: s.id % 2 ? 'NJ' : 'NY', domains: [s.host], website: '' })) });
    if (url === '/api/ops/sync-lock/acquire') {
      f.lock.acquirePolls++;
      return f.lock.acquirePolls <= f.lock.busyFor ? send(200, { acquired: false, heldBy: 'box9-inventory-1', heldSinceMs: 5000 }) : send(200, { acquired: true });
    }
    if (url === '/api/ops/sync-lock/heartbeat') {
      const lost = f.lock.heartbeatLostAfterBulk != null && f.bulkBodies.length >= f.lock.heartbeatLostAfterBulk;
      return send(200, lost ? { renewed: false, heldBy: 'box9-inventory-1' } : { renewed: true });
    }
    if (url === '/api/ops/sync-lock/release') { f.lock.released++; return send(200, {}); }
    if (url === '/api/inventory/bulk') {
      f.bulkBodies.push(body.vehicles);
      if (f.fail.bulk && f.fail.bulk(f.bulkBodies.length)) return send(500, { error: 'Internal server error' });
      for (const v of body.vehicles) db.set(`${v.vin}|${v.dealerId}`, { dealerId: v.dealerId, lastSeen: Date.now(), removed: false, name: v.dealerName, sourceBox: v.sourceBox ?? null });
      return send(200, { upserted: body.vehicles.length, optionSetsReplaced: 0, optionSetsKept: body.vehicles.length, optionSetsUnchanged: 0, optionRowsWritten: 0, optionJunkDropped: 0, timings: { upsertMs: 10, optionsMs: 2, optionsReadMs: 1, daysMs: 3, totalMs: 16 } });
    }
    if (url === '/api/inventory/sweep') {
      f.sweeps.push(body);
      const attempt = f.sweeps.filter((s) => JSON.stringify(s.dealerIds ?? s.dealerId) === JSON.stringify(body.dealerIds ?? body.dealerId)).length;
      if (f.sweepDelay) { const ms = f.sweepDelay(body, attempt); if (ms) await new Promise((r) => setTimeout(r, ms)); }
      if (body.dealerIds && f.legacySweep) return send(400, { error: 'dealerId and seenAfter (ISO) are required' });
      if (f.fail.sweep && f.fail.sweep(body)) return send(500, { error: 'Internal server error' });
      const ids = new Set(body.dealerIds || [body.dealerId]);
      let removed = 0;
      for (const r of db.values()) {
        if (!ids.has(r.dealerId) || r.removed || !(r.lastSeen < Date.parse(body.seenAfter))) continue;
        // inventorySweep.js: AND (source_box = ? OR source_box IS NULL OR last_seen_at < foreignBefore)
        if (body.sourceBox && !(r.sourceBox === body.sourceBox || r.sourceBox == null || r.lastSeen < Date.parse(body.foreignBefore))) continue;
        r.removed = true; removed++;
      }
      return send(200, body.dealerIds ? { removed, stores: body.dealerIds.length } : { removed });
    }
    if (url === '/api/inventory/stats') { f.stats++; return send(200, { total: db.size, vins: db.size, inStock: f.active().length, dealers: stores.length, byState: [{ state: 'NJ', n: 1 }] }); }
    return send(404, { error: 'not found' });
  });
  return f;
}
const listen = (f) => new Promise((r) => f.server.listen(0, '127.0.0.1', () => { f.port = f.server.address().port; r(f); }));

// ---- running the real script -------------------------------------------------------------------------------
function runSync(f, shardDir, { args = [], env = {}, ckpt } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY, shardDir, ...args], {
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        TRIMSCOUT_DEALS_HOST: '127.0.0.1', TRIMSCOUT_DEALS_PORT: String(f.port), TRIMSCOUT_AUTH_PORT: String(f.port), TRIMSCOUT_API_KEY: KEY, TRIMSCOUT_BOX_LABEL: 'box-test',
        SYNC_CHECKPOINT_PATH: ckpt, SYNC_BATCH_ROWS: '25', SYNC_SWEEP_BATCH_STORES: '2', SYNC_PROGRESS_MS: '0', SYNC_HEARTBEAT_MS: '40', SYNC_LOCK_POLL_MS: '30', SYNC_RETRY_SCALE: '0.001', SYNC_BULK_RETRIES: '1',
        ...env,
      },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
const finalJson = (out) => JSON.parse(out.stdout.split('\n').reverse().find((l) => /"upserted":\d+/.test(l)).replace(/^\S+ \S+ /, ''));
const paths = (f) => f.log.map((l) => l.path);

let fakes = [];
const newFake = async (opts) => { const f = await listen(makeFake(opts)); fakes.push(f); return f; };
after(() => { for (const f of fakes) f.server.close(); });

describe('inventory-sync.mjs against a fake deals API', () => {
  it('a normal night: every vehicle upserted once in capped requests, stores swept in batches, stale rows retired, state cleaned up', async () => {
    const dir = workdir();
    const { shardDir, stores, total } = writeShards(dir, { n: 4, perStore: 20 }); // 80 vehicles
    const stale = [{ vin: vin(900), dealerId: 101, lastSeen: Date.now() - 86_400_000 }, { vin: vin(901), dealerId: 103, lastSeen: Date.now() - 86_400_000 }];
    const f = await newFake({ stores, preexisting: stale });
    const ckpt = path.join(dir, 'ckpt.json');
    const r = await runSync(f, shardDir, { ckpt });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(f.bulkBodies.map((b) => b.length), [25, 25, 25, 5]);
    assert.equal(f.bulkBodies.flat().length, total);
    assert.equal(new Set(f.bulkBodies.flat().map((v) => v.vin)).size, total, 'each vehicle exactly once');
    assert.deepEqual(f.sweeps.filter((s) => s.dealerIds).map((s) => s.dealerIds), [[101, 102], [103, 104]]);
    assert.ok(f.sweeps.some((s) => s.dealerId === 0), 'the no-store bucket is swept too');
    assert.equal(f.stats, 1);
    assert.equal(f.lock.released, 1);
    const j = finalJson(r);
    assert.equal(j.upserted, 80);
    assert.equal(j.removed, 2, 'only the two vehicles the crawl no longer lists were retired');
    assert.equal(j.sweepFailed, 0);
    assert.equal(j.sweepMode, 'batch');
    assert.equal(j.resumed, false);
    assert.equal(fs.existsSync(ckpt), false);
    const active = new Set(f.active());
    for (let i = 0; i < total; i++) assert.ok(active.has(vin(i)), `${vin(i)} was retired`);
    assert.ok(!active.has(vin(900)) && !active.has(vin(901)));
  });

  it('non-ASCII text survives the request byte for byte (dealer names with accents)', async () => {
    const dir = workdir();
    const { shardDir, stores } = writeShards(dir, { n: 2, perStore: 30 });
    const f = await newFake({ stores });
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'c.json'), env: { SYNC_BATCH_ROWS: '1000' } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(f.bulkBodies.flat().every((v) => v.dealerName.endsWith('Motors Café')));
  });

  it('against a deals API that predates batched sweeps it sweeps store by store and ends in the same state', async () => {
    const dir = workdir();
    const { shardDir, stores, total } = writeShards(dir, { n: 3, perStore: 10 });
    const f = await newFake({ stores, legacySweep: true, preexisting: [{ vin: vin(900), dealerId: 102, lastSeen: Date.now() - 86_400_000 }] });
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'c.json') });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(f.sweeps.filter((s) => s.dealerIds).length, 1, 'one probe for the batch form');
    assert.deepEqual(f.sweeps.filter((s) => s.dealerId !== undefined).map((s) => s.dealerId), [101, 102, 103, 0]);
    const j = finalJson(r);
    assert.deepEqual({ removed: j.removed, mode: j.sweepMode, upserted: j.upserted }, { removed: 1, mode: 'per-store', upserted: total });
  });

  it('waits for the lock, then proceeds', async () => {
    const dir = workdir();
    const { shardDir, stores } = writeShards(dir, { n: 2, perStore: 10 });
    const f = await newFake({ stores });
    f.lock.busyFor = 3;
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'c.json') });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal((r.stdout.match(/another box's sync is running/g) || []).length, 3);
    assert.equal(f.lock.acquirePolls, 4);
  });

  it('--dry-run reads the directory and prints the plan, takes no lock and writes nothing', async () => {
    const dir = workdir();
    const { shardDir, stores, total } = writeShards(dir, { n: 4, perStore: 20 });
    const f = await newFake({ stores });
    const r = await runSync(f, shardDir, { args: ['--dry-run'], ckpt: path.join(dir, 'c.json') });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(paths(f), ['/api/dealerships']);
    assert.match(r.stdout, new RegExp(`upsert plan: ${total} rows -> 4 requests`));
    assert.match(r.stdout, /sweep plan: 4 stores -> 2 batches of <= 2 stores/);
    assert.match(r.stdout, /nothing was sent/);
    assert.equal(fs.existsSync(path.join(dir, 'c.json')), false);
  });

  it('refuses to run without an API key', async () => {
    const dir = workdir();
    const { shardDir, stores } = writeShards(dir, { n: 1, perStore: 2 });
    const f = await newFake({ stores });
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'c.json'), env: { TRIMSCOUT_API_KEY: '' } });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /usage/);
    assert.deepEqual(f.log, []);
  });
});

describe('dying and being run again', () => {
  it('upserts: a request that keeps failing stops the run; running it again continues at the next row and never retires a live vehicle', async () => {
    const dir = workdir();
    const { shardDir, stores, total } = writeShards(dir, { n: 4, perStore: 20 });
    const f = await newFake({ stores, preexisting: [{ vin: vin(900), dealerId: 102, lastSeen: Date.now() - 86_400_000 }] });
    const ckpt = path.join(dir, 'ckpt.json');
    f.fail.bulk = (n) => n >= 3; // the 3rd request and the retry after it fail
    const first = await runSync(f, shardDir, { ckpt });
    assert.equal(first.code, 1);
    assert.match(first.stderr, /\[sync\] FAILED/);
    assert.match(first.stderr, /Running this same command again/);
    assert.ok(fs.existsSync(ckpt), 'progress was saved');
    assert.equal(JSON.parse(fs.readFileSync(ckpt, 'utf8')).upsert.rows, 50);
    assert.equal(f.lock.released, 1, 'the lock is released even when the run dies');
    const cutoff = JSON.parse(fs.readFileSync(ckpt, 'utf8')).startedAt;

    f.fail.bulk = null;
    const sentBefore = f.bulkBodies.length;
    const second = await runSync(f, shardDir, { ckpt });
    assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /resuming an earlier run/);
    assert.match(second.stdout, /skipping 50 rows already upserted/);
    const resumedVins = f.bulkBodies.slice(sentBefore).flat().map((v) => v.vin);
    assert.equal(resumedVins.length, total - 50);
    const everSent = new Set([...f.bulkBodies.slice(0, 2).flat(), ...f.bulkBodies.slice(sentBefore).flat()].map((v) => v.vin));
    assert.equal(everSent.size, total, 'between the two runs every vehicle was sent');
    assert.ok(f.sweeps.every((s) => s.seenAfter === cutoff), 'the resumed sweep uses the first run\'s cutoff');
    const j = finalJson(second);
    assert.equal(j.resumed, true);
    assert.equal(j.removed, 1);
    const active = new Set(f.active());
    for (let i = 0; i < total; i++) assert.ok(active.has(vin(i)), `${vin(i)} was retired`);
    assert.equal(fs.existsSync(ckpt), false);
  });

  it('sweep: when the API dies mid-sweep the run stops with its place saved; running it again skips every upsert and finishes the sweep', async () => {
    const dir = workdir();
    const { shardDir, stores, total } = writeShards(dir, { n: 10, perStore: 5 }); // 10 stores, swept 2 per call
    const f = await newFake({ stores, preexisting: [{ vin: vin(900), dealerId: 108, lastSeen: Date.now() - 86_400_000 }] });
    const ckpt = path.join(dir, 'ckpt.json');
    f.fail.sweep = (b) => (b.dealerIds ? b.dealerIds[0] >= 103 : b.dealerId >= 103); // healthy for the first batch, then down
    const first = await runSync(f, shardDir, { ckpt });
    assert.equal(first.code, 1);
    assert.match(first.stderr, /STOPPED: \d+ stores in a row failed to sweep/);
    const saved = JSON.parse(fs.readFileSync(ckpt, 'utf8'));
    assert.equal(saved.phase, 'sweep');
    assert.ok(saved.sweep.nextIndex >= 2 && saved.sweep.nextIndex < 10);
    assert.equal(f.lock.released, 1);
    const upsertsBefore = f.bulkBodies.length;
    const cutoff = saved.startedAt;

    f.fail.sweep = null;
    const sweepsBefore = f.sweeps.length;
    const second = await runSync(f, shardDir, { ckpt });
    assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.equal(f.bulkBodies.length, upsertsBefore, 'not one upsert request on the second run');
    assert.ok(f.sweeps.slice(sweepsBefore).every((s) => s.seenAfter === cutoff));
    const j = finalJson(second);
    assert.equal(j.sweepFailed, 0);
    assert.equal(j.removed, 1);
    assert.equal(j.skippedRows, 0, 'sweep-phase resume');
    const active = new Set(f.active());
    for (let i = 0; i < total; i++) assert.ok(active.has(vin(i)), `${vin(i)} was retired`);
    assert.ok(!active.has(vin(900)));
    assert.equal(fs.existsSync(ckpt), false);
  });

  it('--no-resume ignores the saved state and starts over', async () => {
    const dir = workdir();
    const { shardDir, stores, total } = writeShards(dir, { n: 3, perStore: 20 });
    const f = await newFake({ stores });
    const ckpt = path.join(dir, 'ckpt.json');
    f.fail.bulk = (n) => n >= 2;
    assert.equal((await runSync(f, shardDir, { ckpt })).code, 1);
    f.fail.bulk = null;
    const before = f.bulkBodies.length;
    const r = await runSync(f, shardDir, { ckpt, args: ['--no-resume'] });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(f.bulkBodies.slice(before).flat().length, total);
    assert.equal(finalJson(r).resumed, false);
  });

  it('a checkpoint written by the previous client version is ignored, not trusted', async () => {
    const dir = workdir();
    const { shardDir, stores, total } = writeShards(dir, { n: 2, perStore: 20 });
    const f = await newFake({ stores });
    const ckpt = path.join(dir, 'ckpt.json');
    fs.writeFileSync(ckpt, JSON.stringify({ fileIdentity: 'anything', lastDealerId: 101, lastVin: vin(5) }));
    const r = await runSync(f, shardDir, { ckpt });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(f.bulkBodies.flat().length, total);
  });
});

describe('the failure that used to kill runs', () => {
  it('a sweep response slower than the client\'s deadline is retried instead of crashing the run', async () => {
    const dir = workdir();
    const { shardDir, stores, total } = writeShards(dir, { n: 4, perStore: 5 });
    const f = await newFake({ stores });
    // The first attempt of the first sweep batch stalls past the 250ms deadline (the equivalent of fetch's
    // HeadersTimeoutError); the retry answers at once.
    f.sweepDelay = (body, attempt) => (body.dealerIds && body.dealerIds[0] === 101 && attempt === 1 ? 800 : 0);
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'c.json'), env: { SYNC_SWEEP_TIMEOUT_MS: '250' } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /attempt 1\/4 failed \(\/api\/inventory\/sweep -> no response within/);
    assert.equal(finalJson(r).sweepFailed, 0);
    assert.equal(finalJson(r).upserted, total);
  });
});

describe('never a second writer', () => {
  it('stops at the next request once the heartbeat reports the lock reclaimed by another box', async () => {
    const dir = workdir();
    const { shardDir, stores } = writeShards(dir, { n: 4, perStore: 20 });
    const f = await newFake({ stores });
    f.lock.heartbeatLostAfterBulk = 1;
    // Stall each upsert so several heartbeats (every 40ms) land after the first one.
    const orig = f.server.listeners('request')[0];
    f.server.removeAllListeners('request');
    f.server.on('request', (req, res) => { if (req.url === '/api/inventory/bulk') setTimeout(() => orig(req, res), 150); else orig(req, res); });
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'c.json') });
    assert.equal(r.code, 1);
    assert.match(r.stdout + r.stderr, /LOCK LOST: reclaimed by box9-inventory-1/);
    assert.match(r.stderr, /STOPPED: the sync lock is no longer held/);
    assert.ok(f.bulkBodies.length < 4, `kept writing after losing the lock (${f.bulkBodies.length} of 4 requests sent)`);
    assert.equal(f.sweeps.length, 0);
  });
});

describe('sync-lock-probe.mjs (the deploy gate\'s lock check)', () => {
  const PROBE = fileURLToPath(new URL('../../../scripts/box/sync-lock-probe.mjs', import.meta.url));
  const probe = (port, env = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [PROBE], { env: { PATH: process.env.PATH, TRIMSCOUT_DEALS_HOST: '127.0.0.1', TRIMSCOUT_DEALS_PORT: String(port), TRIMSCOUT_API_KEY: KEY, ...env } });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });

  it('a free lock: acquires with a throwaway owner that asks for heartbeat handling, releases at once, exits 0', async () => {
    const f = await newFake({ stores: [] });
    const r = await probe(f.port);
    assert.deepEqual({ code: r.code, out: r.out }, { code: 0, out: 'FREE' });
    assert.deepEqual(f.log.map((l) => l.path), ['/api/ops/sync-lock/acquire', '/api/ops/sync-lock/release']);
    assert.match(f.log[0].body.owner, /^lock-probe-\d+$/);
    assert.equal(f.log[0].body.heartbeat, true);
    assert.equal(f.log[1].body.owner, f.log[0].body.owner);
  });

  it('a held lock: reports who holds it, exits 1, and changes nothing (no release)', async () => {
    const f = await newFake({ stores: [] });
    f.lock.busyFor = 99;
    const r = await probe(f.port);
    assert.equal(r.code, 1);
    assert.match(r.out, /HELD by box9-inventory-1 for 5s/);
    assert.deepEqual(f.log.map((l) => l.path), ['/api/ops/sync-lock/acquire']);
  });

  it('an unreachable or unauthorized deals API is "could not tell", never "free"', async () => {
    const f = await newFake({ stores: [] });
    const wrongKey = await probe(f.port, { TRIMSCOUT_API_KEY: 'nope' });
    assert.equal(wrongKey.code, 2);
    assert.match(wrongKey.err, /could not tell/);
    const closed = http.createServer(); await new Promise((r) => closed.listen(0, '127.0.0.1', r)); const p = closed.address().port; await new Promise((r) => closed.close(r));
    assert.equal((await probe(p)).code, 2);
    assert.equal((await probe(f.port, { TRIMSCOUT_API_KEY: '' })).code, 2);
  });
});


describe('the 2026-10-07 failures: stale shard records and cross-box sweeps', () => {
  it('stale records are not uploaded (so never re-stamped as seen) and their store is not swept; fresh stores are', async () => {
    const dir = workdir();
    const { shardDir, stores } = writeShards(dir, { n: 2, perStore: 20, staleStoreIds: [102] }); // store 102: 20 ACTIVE records last refreshed 11 days ago
    const live102 = { vin: vin(800), dealerId: 102, lastSeen: Date.now() - 3_600_000, sourceBox: 'box-other' }; // a live car another box wrote an hour ago
    const f = await newFake({ stores, preexisting: [live102] });
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'ckpt.json') });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const uploaded = f.bulkBodies.flat();
    assert.equal(uploaded.length, 20, 'only the 20 fresh records');
    assert.ok(uploaded.every((v) => v.dealerId === 101), 'nothing from the stale store went up');
    assert.ok(!f.sweeps.some((s) => (s.dealerIds || [s.dealerId]).includes(102)), 'a store with no fresh upload is not swept');
    assert.ok(f.active().includes(vin(800)), 'the other box\'s live car at that store was left alone');
    assert.match(r.stdout, /skipped 20 ACTIVE record\(s\) the crawl has not refreshed/);
  });

  it('a sweep never retires a row another box wrote recently, but does retire this box\'s own stale rows and foreign rows nobody has seen for days', async () => {
    const dir = workdir();
    const { shardDir, stores } = writeShards(dir, { n: 1, perStore: 10 }); // store 101 gets 10 fresh rows from box-test
    const H = 3_600_000;
    const pre = [
      { vin: vin(810), dealerId: 101, lastSeen: Date.now() - 5 * H, sourceBox: 'box-other' },   // another box wrote it 5h ago -> protected (the Brownsville case)
      { vin: vin(811), dealerId: 101, lastSeen: Date.now() - 5 * H, sourceBox: 'box-test' },    // this box's own row, unlisted now -> retired
      { vin: vin(812), dealerId: 101, lastSeen: Date.now() - 72 * H, sourceBox: 'box-other' },  // foreign but unseen for 3 days -> retired (how zombies age out)
      { vin: vin(813), dealerId: 101, lastSeen: Date.now() - 5 * H, sourceBox: null },           // pre-tracking row, nobody recorded the writer -> retired as before
    ];
    const f = await newFake({ stores, preexisting: pre });
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'ckpt.json') });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const active = new Set(f.active());
    assert.ok(active.has(vin(810)), 'the other box\'s recent row survives');
    assert.ok(!active.has(vin(811)) && !active.has(vin(812)) && !active.has(vin(813)));
    for (const sw of f.sweeps) { assert.equal(sw.sourceBox, 'box-test'); assert.ok(Date.parse(sw.foreignBefore) < Date.parse(sw.seenAfter)); }
    assert.ok(f.sweeps.length > 0);
  });

  it('a truncated shard is skipped whole (nothing uploaded, its stores not swept), the other shards still sync, and the run exits 3', async () => {
    const dir = workdir();
    const { shardDir, stores } = writeShards(dir, { n: 2, perStore: 10 });
    const ny = fs.readFileSync(path.join(shardDir, 'NY.json'), 'utf8');
    fs.writeFileSync(path.join(shardDir, 'NY.json'), ny.slice(0, ny.length - 40)); // cut off mid-record, like a failed merge
    const f = await newFake({ stores, preexisting: [{ vin: vin(820), dealerId: 102, lastSeen: Date.now() - 24 * 3_600_000, sourceBox: 'box-test' }] });
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'ckpt.json') });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /SKIPPING NY\.json/);
    const uploaded = f.bulkBodies.flat();
    assert.equal(uploaded.length, 10);
    assert.ok(uploaded.every((v) => v.dealerId === 101), 'only the intact NJ shard');
    assert.ok(!f.sweeps.some((s) => (s.dealerIds || [s.dealerId]).includes(102)), 'the truncated shard\'s store is not swept');
    assert.ok(f.active().includes(vin(820)), 'so its existing rows are not retired on the strength of a broken file');
  });

  it('a shard over the size limit still uploads its fresh records but none of its stores are swept', async () => {
    const dir = workdir();
    const { shardDir, stores } = writeShards(dir, { n: 2, perStore: 10 });
    const f = await newFake({ stores, preexisting: [{ vin: vin(830), dealerId: 101, lastSeen: Date.now() - 24 * 3_600_000, sourceBox: 'box-test' }] });
    const r = await runSync(f, shardDir, { ckpt: path.join(dir, 'ckpt.json'), env: { SYNC_SHARD_MAX_MB: '0.0001' } }); // every shard is "over the limit"
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /over the \d+MB limit/);
    assert.equal(f.bulkBodies.flat().length, 20, 'fresh records are still uploaded');
    assert.ok(!f.sweeps.some((s) => s.dealerIds), 'no store sweep at all');
    assert.ok(f.active().includes(vin(830)), 'so nothing was retired on the strength of an unreliable file');
  });
});
