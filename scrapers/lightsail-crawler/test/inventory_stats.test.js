import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInventoryStats, STATS_SQL, STICKER_REFRESH_MS, STICKER_RETRY_MS } from '../src/inventoryStats.js';

const HERE_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const quiet = { log() {}, error() {} };

// A fake database keyed by statement text: rows to return, or an Error to throw. `calls` records the order.
function fakeDb(overrides = {}) {
  const calls = [];
  const rows = {
    [STATS_SQL.totals]: [{ total: '4900000', inStock: '2730000', dealers: '9000', vins: '2400000', lastSeenAt: '2026-10-27T22:00:00Z' }],
    [STATS_SQL.byMake]: [{ make: 'Ford', n: 100 }],
    [STATS_SQL.byState]: [{ state: 'TX', n: 50 }],
    [STATS_SQL.byCond]: [{ cond: 'new', n: 70 }],
    [STATS_SQL.arrivals]: [{ n: '449319' }],
    [STATS_SQL.priceDrops]: [{ n: '195171' }],
    [STATS_SQL.priceIncreases]: [{ n: '37887' }],
    [STATS_SQL.removedToday]: [{ n: '324889' }],
    [STATS_SQL.withSticker]: [{ n: '1800000' }],
    ...overrides,
  };
  const query = async (sql) => {
    calls.push(sql);
    const r = rows[sql];
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return r();
    return r;
  };
  return { query, calls, rows };
}

const settle = () => new Promise((r) => setImmediate(r));

describe('movement queries are index-bounded', () => {
  const all = Object.values(STATS_SQL);

  it('no statement has the OR over removed_at that forced a full scan', () => {
    for (const sql of all) assert.doesNotMatch(sql, /removed_at IS NULL OR removed_at/i);
  });

  it('each movement figure is bounded by removed_at (live rows IS NULL, or the last-day range)', () => {
    for (const name of ['arrivals', 'priceDrops', 'priceIncreases', 'withSticker']) assert.match(STATS_SQL[name], /removed_at IS NULL/, name);
    assert.match(STATS_SQL.removedToday, /removed_at >= DATE_SUB\(NOW\(\), INTERVAL 1 DAY\)/);
  });

  it('price figures use only (removed_at, price_diff) so idx_inv_stock_diff covers them', () => {
    for (const name of ['priceDrops', 'priceIncreases']) {
      assert.match(STATS_SQL[name], /^SELECT COUNT\(\*\) AS n FROM dealer_inventory WHERE removed_at IS NULL AND price_diff [<>] 0$/);
    }
  });

  it('only withSticker reads the unindexed column', () => {
    for (const [name, sql] of Object.entries(STATS_SQL)) assert.equal(/window_sticker_url/.test(sql), name === 'withSticker', name);
  });
});

describe('compute()', () => {
  it('builds the same payload shape the admin sheet and the sync read', async () => {
    const db = fakeDb();
    const s = createInventoryStats({ query: db.query, log: quiet });
    const out = await s.compute();
    assert.equal(out.total, 4900000);
    assert.equal(out.inStock, 2730000);
    assert.equal(out.dealers, 9000);
    assert.equal(out.vins, 2400000);
    assert.deepEqual(out.byMake, [{ make: 'Ford', n: 100 }]);
    assert.deepEqual(out.movement, { arrivals: 449319, priceDrops: 195171, priceIncreases: 37887, withSticker: null, removedToday: 324889 });
    assert.equal(out.stale, undefined);
  });

  it('never waits on the table scan: withSticker is null on the first call and filled from the background', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const db = fakeDb({ [STATS_SQL.withSticker]: () => gate.then(() => [{ n: '1800000' }]) });
    const s = createInventoryStats({ query: db.query, log: quiet });
    const first = await s.compute();
    assert.equal(first.movement.withSticker, null);
    assert.equal(s.peekSticker().running, true);
    release();
    await settle(); await settle();
    const second = await s.compute();
    assert.equal(second.movement.withSticker, 1800000);
  });

  it('runs the sticker scan through the background runner (the 120 s budget), nothing else', async () => {
    const db = fakeDb();
    const bg = [];
    const s = createInventoryStats({ query: db.query, log: quiet, runBackground: (fn) => { bg.push(true); return fn(); } });
    await s.compute();
    await settle();
    assert.equal(bg.length, 1);
    assert.equal(db.calls.filter((c) => c === STATS_SQL.withSticker).length, 1);
  });

  it('single flight and a refresh interval: the scan is not restarted while running or inside 6 h', async () => {
    let t = 0;
    const db = fakeDb();
    const s = createInventoryStats({ query: db.query, log: quiet, now: () => t });
    await s.compute(); await s.compute();
    await settle();
    await s.compute();
    t = STICKER_REFRESH_MS - 1;
    await s.compute();
    await settle();
    assert.equal(db.calls.filter((c) => c === STATS_SQL.withSticker).length, 1);
    t = STICKER_REFRESH_MS + 1;
    await s.compute();
    await settle();
    assert.equal(db.calls.filter((c) => c === STATS_SQL.withSticker).length, 2);
  });

  it('a failed sticker scan keeps the last good value and is not retried for an hour', async () => {
    let t = 0, mode = 'ok';
    const db = fakeDb({ [STATS_SQL.withSticker]: () => (mode === 'ok' ? [{ n: '5' }] : Promise.reject(new Error('Query execution was interrupted'))) });
    const s = createInventoryStats({ query: db.query, log: quiet, now: () => t });
    await s.compute(); await settle();
    assert.equal((await s.compute()).movement.withSticker, 5);
    mode = 'fail';
    t = STICKER_REFRESH_MS + 1;
    await s.compute(); await settle(); // the scan starts and fails
    const afterFail = db.calls.filter((c) => c === STATS_SQL.withSticker).length;
    assert.equal((await s.compute()).movement.withSticker, 5, 'last good value still served');
    t += STICKER_RETRY_MS - 1;
    await s.compute(); await settle();
    assert.equal(db.calls.filter((c) => c === STATS_SQL.withSticker).length, afterFail, 'no retry inside the hour');
    t += 2;
    await s.compute(); await settle();
    assert.equal(db.calls.filter((c) => c === STATS_SQL.withSticker).length, afterFail + 1);
  });

  it('a sticker scan that never succeeds does not fail the request', async () => {
    const db = fakeDb({ [STATS_SQL.withSticker]: new Error('Query execution was interrupted') });
    const s = createInventoryStats({ query: db.query, log: quiet });
    const out = await s.compute();
    await settle();
    assert.equal(out.movement.withSticker, null);
    assert.equal(out.total, 4900000);
  });
});

describe('one failed query does not wipe the stats', () => {
  it('serves the last good value for the failed part and names it in `stale`', async () => {
    const db = fakeDb();
    const s = createInventoryStats({ query: db.query, log: quiet });
    const good = await s.compute();
    db.rows[STATS_SQL.arrivals] = new Error('Query execution was interrupted (max_statement_time exceeded)');
    db.rows[STATS_SQL.totals] = [{ total: '4900100', inStock: '2730100', dealers: '9000', vins: '2400000', lastSeenAt: 'later' }];
    const out = await s.compute();
    assert.equal(out.movement.arrivals, good.movement.arrivals, 'last good arrivals');
    assert.equal(out.total, 4900100, 'the parts that worked are fresh');
    assert.deepEqual(out.stale, ['arrivals']);
  });

  it('every part can fail at once after one good run and the payload is still complete', async () => {
    const db = fakeDb();
    const s = createInventoryStats({ query: db.query, log: quiet });
    const good = await s.compute();
    for (const k of ['totals', 'byMake', 'byState', 'byCond', 'arrivals', 'priceDrops', 'priceIncreases', 'removedToday']) db.rows[STATS_SQL[k]] = new Error('boom');
    const out = await s.compute();
    const { stale, ...rest } = out;
    rest.movement = { ...rest.movement, withSticker: null }; // the background scan may have landed in between; it is not one of the eight parts
    assert.deepEqual(rest, { ...good, movement: { ...good.movement, withSticker: null } });
    assert.equal(stale.length, 8);
  });

  it('with no good value yet (cold) a failing part fails the request, as before', async () => {
    const db = fakeDb({ [STATS_SQL.priceDrops]: new Error('boom') });
    const s = createInventoryStats({ query: db.query, log: quiet });
    await assert.rejects(s.compute(), /boom/);
  });

  it('a part that failed once recovers on the next call', async () => {
    const db = fakeDb();
    const s = createInventoryStats({ query: db.query, log: quiet });
    await s.compute();
    db.rows[STATS_SQL.byState] = new Error('boom');
    assert.deepEqual((await s.compute()).stale, ['byState']);
    db.rows[STATS_SQL.byState] = [{ state: 'CA', n: 9 }];
    const out = await s.compute();
    assert.equal(out.stale, undefined);
    assert.deepEqual(out.byState, [{ state: 'CA', n: 9 }]);
  });
});

describe('the box patch', () => {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const PATCHES = path.join(ROOT, 'docs/box-patches');
  const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
  const hasPatch = spawnSync('patch', ['--version']).status === 0;

  it('applies with zero fuzz on top of the box2 file as it is after #607 (snapshot + the losers patch), and still parses', { skip: !hasPatch }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-split-'));
    const file = path.join(dir, 'deals_api_server.js');
    fs.copyFileSync(path.join(ROOT, 'docs/box-snapshots/2026-10-27-box2/deals_api_server.js'), file);
    for (const p of ['2026-10-29-one-per-vin-losers', '2026-10-28-stats-movement-split']) {
      const r = spawnSync('patch', ['-F0', '--no-backup-if-mismatch', file, path.join(PATCHES, p, 'deals_api_server.js.patch')], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
    }
    assert.equal(md5(file), '31d527ba8e277ff58e39f73ad1d00295', 'the md5 STEPS.md tells the installer to expect');
    assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
    const out = fs.readFileSync(file, 'utf8');
    assert.match(out, /import \{ createInventoryStats \} from "\.\/inventoryStats\.js";/);
    assert.match(out, /statsCached\("stats", \(\) => inventoryStats\.compute\(\)\)/);
    assert.doesNotMatch(out, /async function computeInventoryStats/);
    assert.doesNotMatch(out, /removed_at IS NULL OR removed_at >= DATE_SUB\(NOW\(\), INTERVAL 1 DAY\)/);
  });

  it('STEPS.md pins the md5 of the module it tells the installer to copy', () => {
    const steps = fs.readFileSync(path.join(PATCHES, '2026-10-28-stats-movement-split/STEPS.md'), 'utf8');
    assert.ok(steps.includes(md5(path.join(HERE_SRC, 'inventoryStats.js'))), 'inventoryStats.js md5 in STEPS.md is stale');
    assert.ok(steps.includes('31d527ba8e277ff58e39f73ad1d00295'));
    assert.ok(steps.includes('6e35309faa02b5d8c24f6f66101055f3'), 'the BASE md5 (box2 after #607)');
  });
});
