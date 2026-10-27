import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onePerVinModeOf, onePerVinPredicate, planVinLosers, loserBuckets } from '../src/onePerVin.js';
import { inventoryListQuery } from '../src/inventoryListQuery.js';

const row = (dealerId, lastSeenAt, price, extra = {}) => ({ vin: '1FTFW1E50NFA00001', dealerId, lastSeenAt, price, make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT', ...extra });

describe('planVinLosers — one listing per VIN', () => {
  it('same VIN at two stores: the store that saw it most recently wins', () => {
    const losers = planVinLosers([row(1, '2026-10-26 22:00:00', 40000), row(2, '2026-10-27 02:00:00', 45000)]);
    assert.deepEqual(losers.map((l) => l.dealerId), [1]);
  });
  it('tie on last seen: lowest price wins, then lowest dealer id', () => {
    const t = '2026-10-27 02:00:00';
    assert.deepEqual(planVinLosers([row(1, t, 45000), row(2, t, 41000)]).map((l) => l.dealerId), [1]);
    assert.deepEqual(planVinLosers([row(5, t, 41000), row(3, t, 41000)]).map((l) => l.dealerId), [5]);
    assert.deepEqual(planVinLosers([row(1, t, null), row(2, t, 90000)]).map((l) => l.dealerId), [1], 'a missing price ranks last');
  });
  it('latest mode keeps tied stores (the web app breaks the tie by distance)', () => {
    const t = '2026-10-27 02:00:00';
    assert.deepEqual(planVinLosers([row(1, t, 45000), row(2, t, 41000), row(3, '2026-10-20 00:00:00', 1)], { mode: 'latest' }).map((l) => l.dealerId), [3]);
  });
  it('a single store has no loser', () => {
    assert.deepEqual(planVinLosers([row(1, '2026-10-27 02:00:00', 1)]), []);
  });
});

describe('loserBuckets', () => {
  it('counts per make/state/model/trim and can be limited to a store set', () => {
    const losers = [{ dealerId: 1, make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT' }, { dealerId: 2, make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT' }];
    assert.equal(loserBuckets(losers)[0].n, 2);
    assert.equal(loserBuckets(losers, new Set([2]))[0].n, 1);
  });
});

describe('onePerVin in inventoryListQuery', () => {
  it('modes parse', () => {
    assert.equal(onePerVinModeOf('1'), '1');
    assert.equal(onePerVinModeOf('LATEST'), 'latest');
    assert.equal(onePerVinModeOf('yes'), null);
  });
  it('is absent unless asked: admin and dealer queries are unchanged', () => {
    assert.doesNotMatch(inventoryListQuery(new URLSearchParams({ inStock: '1', make: 'Ford' })).sql, /NOT EXISTS/);
  });
  it('adds a primary-key-prefix NOT EXISTS to the page and the count, keeping the index hint, with args aligned', () => {
    const q = inventoryListQuery(new URLSearchParams({ inStock: '1', make: 'Ford', retailOnly: '1', seenWithinDays: '7', onePerVin: '1', countCap: '1000' }));
    assert.match(q.sql, /NOT EXISTS \(SELECT 1 FROM dealer_inventory j WHERE j\.vin = i\.vin/);
    assert.match(q.countSql, /FORCE INDEX \(idx_inv_stock_make_dealer\)/);
    assert.match(q.cappedCountSql, /NOT EXISTS/);
    assert.equal(q.sql.split('?').length - 1, q.args.length);
    assert.deepEqual(q.args, ['Ford', 7, 7]);
  });
  it('is ignored when not in stock', () => {
    assert.doesNotMatch(inventoryListQuery(new URLSearchParams({ make: 'Ford', onePerVin: '1' })).sql, /NOT EXISTS/);
  });
  it('latest mode only removes strictly fresher rows', () => {
    const { sql } = inventoryListQuery(new URLSearchParams({ inStock: '1', onePerVin: 'latest' }));
    assert.doesNotMatch(sql, /j\.dealer_id < i\.dealer_id/);
  });
  it('predicate without options still balances placeholders', () => {
    const p = onePerVinPredicate({ mode: '1' });
    assert.equal(p.sql.split('?').length - 1, p.args.length);
  });
});

import { facetsOnePerVin } from '../src/onePerVinServer.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LISTS = () => ({ states: [{ state: 'NJ', n: 10 }, { state: 'FL', n: 5 }], makes: [{ make: 'Ford', n: 15 }], models: [], trims: [] });
// Two VINs held by two stores each: dealer 2 beats 1 (fresher), dealer 3 beats 4 (cheaper tie).
const DB = [
  { vin: '1FTFW1E50NFA00001', dealer_id: 1, last_seen_at: '2026-10-26 22:00:00', price: 1, make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT' },
  { vin: '1FTFW1E50NFA00001', dealer_id: 2, last_seen_at: '2026-10-27 02:00:00', price: 2, make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT' },
  { vin: '1FTFW1E50NFA00002', dealer_id: 3, last_seen_at: '2026-10-27 02:00:00', price: 5, make: 'Ford', state: 'FL', model: 'F-150', trim: 'XLT' },
  { vin: '1FTFW1E50NFA00002', dealer_id: 4, last_seen_at: '2026-10-27 02:00:00', price: 9, make: 'Ford', state: 'FL', model: 'F-150', trim: 'XLT' },
];
const deps = (fail = false) => {
  const cache = new Map();
  return {
    pool: { async query(sql, args) {
      if (fail) throw new Error('boom');
      const s = sql.replace(/^SET STATEMENT max_statement_time=\d+ FOR /, '');
      if (/GROUP BY vin HAVING/.test(s)) return [args[0] === '1' ? [{ vin: '1FTFW1E50NFA00001' }, { vin: '1FTFW1E50NFA00002' }] : []];
      return [DB];
    } },
    stableCached: async (k, fn) => { if (!cache.has(k)) cache.set(k, await fn()); return cache.get(k); },
    withPoolTimeout: (p) => p, statementSeconds: () => 20, waitMs: () => 1000, retailOnlyFacets: true,
  };
};

describe('facetsOnePerVin', () => {
  it('subtracts one count per losing store row', async () => {
    const r = await facetsOnePerVin(deps(), LISTS(), {}, { days: 7 });
    assert.equal(r.applied, true);
    assert.equal(r.lists.states.find((s) => s.state === 'NJ').n, 9);
    assert.equal(r.lists.states.find((s) => s.state === 'FL').n, 4);
    assert.equal(r.lists.makes[0].n, 13);
  });
  it('only counts the contact set\'s losing stores', async () => {
    const r = await facetsOnePerVin(deps(), LISTS(), {}, { days: 7, dealerIds: new Set([4]) });
    assert.equal(r.lists.makes[0].n, 14);
  });
  it('a failed read leaves the counts unadjusted and says so', async () => {
    const r = await facetsOnePerVin(deps(true), LISTS(), {}, { days: 7 });
    assert.equal(r.applied, false);
    assert.deepEqual(r.lists, LISTS());
  });
});

describe('the box patch for deals_api_server.js', () => {
  it('applies cleanly to the repo file and the result still parses', { skip: spawnSync('patch', ['--version']).status !== 0 }, () => {
    const src = path.join(HERE, '../src/deals_api_server.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opv-'));
    const file = path.join(dir, 'deals_api_server.js');
    fs.copyFileSync(src, file);
    const patchFile = path.join(HERE, '../../../docs/box-patches/2026-10-28-one-per-vin/deals_api_server.js.patch');
    const r = spawnSync('patch', ['-F0', '--no-backup-if-mismatch', file, patchFile], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = fs.readFileSync(file, 'utf8');
    assert.match(out, /facetsOnePerVin/);
    assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
  });
});
