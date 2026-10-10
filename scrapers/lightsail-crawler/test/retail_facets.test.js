// The buyer dropdown / facet counts leave wholesale lots out, exactly like the buyer search results do (inventoryListQuery retailOnly=1).
// Pure subtraction tests, then the REAL handlers (extracted from deals_api_server.js like deals_bulk_handler.test.js does) against a fake pool.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { adjustFacetLists, adjustMakeList, WHOLESALE_DEALERS_PER_QUERY } from '../src/retailFacets.js';

const W = [
  { make: 'Mercedes-Benz', state: 'FL', model: 'GLC', trim: 'GLC 300', n: 40 },
  { make: 'Mercedes-Benz', state: 'FL', model: 'C-Class', trim: 'C 300', n: 25 },
  { make: 'Mercedes-Benz', state: 'CA', model: 'GLC', trim: 'GLC 300', n: 10 },
  { make: 'Ford', state: 'FL', model: 'F-150', trim: 'XLT', n: 3 },
];
const LISTS = {
  states: [{ state: 'FL', n: 500 }, { state: 'CA', n: 300 }, { state: 'NJ', n: 100 }],
  makes: [{ make: 'Ford', n: 400 }, { make: 'Mercedes-Benz', n: 120 }],
  models: [{ model: 'GLC', n: 70 }, { model: 'C-Class', n: 25 }, { model: 'E-Class', n: 30 }],
  trims: [{ trim: 'GLC 300', n: 50 }, { trim: 'GLC 43', n: 20 }],
};

describe('adjustFacetLists — the same scoping the queries use', () => {
  it('states are scoped by make only: with make=Mercedes-Benz FL loses 65, CA 10; NJ is untouched', () => {
    const r = adjustFacetLists(LISTS, W, { make: 'Mercedes-Benz' });
    assert.deepEqual(r.states, [{ state: 'FL', n: 435 }, { state: 'CA', n: 290 }, { state: 'NJ', n: 100 }]);
  });
  it('without a make every wholesale car counts in its state', () => {
    const r = adjustFacetLists(LISTS, W, {});
    assert.deepEqual(r.states.map((s) => [s.state, s.n]), [['FL', 500 - 68], ['CA', 290], ['NJ', 100]].sort((a, b) => b[1] - a[1]));
  });
  it('makes are scoped by state only', () => {
    assert.deepEqual(adjustFacetLists(LISTS, W, { state: 'FL' }).makes, [{ make: 'Ford', n: 397 }, { make: 'Mercedes-Benz', n: 55 }]);
    assert.deepEqual(adjustFacetLists(LISTS, W, {}).makes, [{ make: 'Ford', n: 397 }, { make: 'Mercedes-Benz', n: 45 }]);
  });
  it('models need a make; scoped by make (+state); trims need make AND model', () => {
    assert.deepEqual(adjustFacetLists(LISTS, W, { make: 'Mercedes-Benz' }).models, [{ model: 'GLC', n: 20 }, { model: 'E-Class', n: 30 }, { model: 'C-Class', n: 0 }].filter((m) => m.n > 0).sort((a, b) => b.n - a.n));
    assert.deepEqual(adjustFacetLists(LISTS, W, { make: 'Mercedes-Benz', state: 'CA' }).models.find((m) => m.model === 'GLC').n, 60);
    assert.deepEqual(adjustFacetLists(LISTS, W, { make: 'Mercedes-Benz', model: 'GLC' }).trims, [{ trim: 'GLC 43', n: 20 }, { trim: 'GLC 300', n: 0 }].filter((t) => t.n > 0));
    assert.equal(adjustFacetLists(LISTS, W, { model: 'GLC' }).trims, LISTS.trims, 'a model without a make is not scoped (the query does not run)');
  });
  it('an option that falls to zero or below is dropped from its dropdown, and order stays by count', () => {
    const r = adjustFacetLists({ ...LISTS, makes: [{ make: 'Mercedes-Benz', n: 80 }, { make: 'Ford', n: 400 }] }, W, {});
    assert.deepEqual(r.makes, [{ make: 'Ford', n: 397 }, { make: 'Mercedes-Benz', n: 5 }]);
    const gone = adjustFacetLists({ ...LISTS, makes: [{ make: 'Mercedes-Benz', n: 75 }, { make: 'Ford', n: 2 }] }, W, {});
    assert.deepEqual(gone.makes, [{ make: 'Mercedes-Benz', n: 0 }].filter((m) => m.n > 0), 'Ford 2 - 3 < 0 and Mercedes 75 - 75 = 0: both gone');
  });
  it('no wholesale cars (or a bad value) changes nothing', () => {
    assert.deepEqual(adjustFacetLists(LISTS, [], { make: 'Ford' }), LISTS);
    assert.deepEqual(adjustFacetLists(LISTS, null, { make: 'Ford' }), LISTS);
  });
  it('wholesale rows with a missing make / state are ignored for the lists that need them', () => {
    const r = adjustFacetLists(LISTS, [{ make: null, state: 'FL', model: null, trim: null, n: 99 }], {});
    assert.deepEqual(r.states.find((s) => s.state === 'FL'), { state: 'FL', n: 401 });
    assert.deepEqual(r.makes, LISTS.makes);
  });
  it('makes (all states): subtracts every wholesale car of the make', () => {
    assert.deepEqual(adjustMakeList([{ make: 'Ford', n: 400 }, { make: 'Mercedes-Benz', n: 120 }], W), [{ make: 'Ford', n: 397 }, { make: 'Mercedes-Benz', n: 45 }].sort((a, b) => b.n - a.n));
  });
});

// ---- the real handlers -------------------------------------------------------------------------------------
const SRC = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');
const extractFunction = (name) => {
  const start = SRC.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `could not find "async function ${name}(" in deals_api_server.js — update this test if it was renamed`);
  const end = SRC.indexOf('\n}\n', start);
  return SRC.slice(start, end + 3);
};

function load({ retailOnly = true, failWholesale = false } = {}) {
  const calls = { wholesaleDealerQueries: 0, wholesaleBucketQueries: 0, sql: [] };
  const wholesaleDealers = [11, 12, 13];
  const byDealer = { 11: [W[0], W[1]], 12: [W[2]], 13: [W[3]] };
  const pool = {
    async query(sql, args = []) {
      calls.sql.push(sql);
      const s = sql.replace(/^SET STATEMENT max_statement_time=\d+ FOR /, '');
      if (/^SELECT dealer_id FROM dealer_inventory WHERE removed_at IS NULL AND cond = 'wholesale' GROUP BY dealer_id$/.test(s)) {
        calls.wholesaleDealerQueries++;
        if (failWholesale) throw new Error('boom');
        return [wholesaleDealers.map((d) => ({ dealer_id: d }))];
      }
      if (/dealer_id IN \(\?\) AND cond = 'wholesale' GROUP BY make, state, model, trim$/.test(s)) {
        calls.wholesaleBucketQueries++;
        assert.match(s, /FORCE INDEX \(idx_inv_by_dealer_covering\)/);
        assert.ok(args[0].length <= WHOLESALE_DEALERS_PER_QUERY);
        return [args[0].flatMap((d) => byDealer[d] || [])];
      }
      if (/^SELECT state, COUNT/.test(s)) return [LISTS.states];
      if (/^SELECT make, COUNT/.test(s)) return [LISTS.makes];
      if (/^SELECT model, COUNT/.test(s)) return [LISTS.models];
      if (/^SELECT trim, COUNT/.test(s)) return [LISTS.trims];
      throw new Error(`fake pool does not know: ${s.slice(0, 90)}`);
    },
  };
  const out = { json: null };
  const cache = new Map();
  const ctx = {
    getPool: () => pool, ensureInventoryTable: async () => {},
    sendJson: (res, status, obj) => { out.json = JSON.parse(JSON.stringify(obj)); },
    withPoolTimeout: (p) => p, statementSeconds: () => 20, waitMs: () => 1000,
    stableCached: async (key, fn) => { if (!cache.has(key)) cache.set(key, await fn()); return cache.get(key); },
    adjustFacetLists, adjustMakeList, WHOLESALE_DEALERS_PER_QUERY, RETAIL_ONLY_FACETS: retailOnly, console, Date, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(['wholesaleBuckets', 'handleInventoryMakes', 'handleInventoryFacets'].map(extractFunction).join('\n') +
    `\nconst wholesaleBucketsOrNull = async (pool) => { if (!RETAIL_ONLY_FACETS) return null; try { return await wholesaleBuckets(pool); } catch (err) { console.error(String(err.message)); return null; } };`, ctx);
  return { ctx, out, calls, facets: (q) => ctx.handleInventoryFacets({}, {}, new URLSearchParams(q)), makes: () => ctx.handleInventoryMakes({}, {}) };
}

describe('handleInventoryFacets / handleInventoryMakes — the real handlers', () => {
  it('facets: the wholesale cars are subtracted and the result matches the pure function', async () => {
    const h = load();
    await h.facets({ make: 'Mercedes-Benz', state: 'FL' });
    // no model asked for, so the handler does not query trims: that list is empty before and after
    assert.deepEqual(h.out.json, adjustFacetLists({ ...LISTS, trims: [] }, W, { state: 'FL', make: 'Mercedes-Benz' }));
    assert.equal(h.out.json.states.find((s) => s.state === 'FL').n, 500 - 65);
  });
  it('makes: Mercedes-Benz shows its retail count', async () => {
    const h = load();
    await h.makes();
    assert.equal(h.out.json.makes.find((m) => m.make === 'Mercedes-Benz').n, 120 - 75);
  });
  it('the wholesale aggregate is read in small batches of dealers, once, and reused across requests', async () => {
    const h = load();
    await h.facets({ make: 'Ford' }); await h.facets({ make: 'Mercedes-Benz' }); await h.makes();
    assert.equal(h.calls.wholesaleDealerQueries, 1);
    assert.equal(h.calls.wholesaleBucketQueries, Math.ceil(3 / WHOLESALE_DEALERS_PER_QUERY));
  });
  it('RETAIL_ONLY_FACETS off: nothing is read or subtracted (the old counts)', async () => {
    const h = load({ retailOnly: false });
    await h.facets({ make: 'Mercedes-Benz' });
    assert.deepEqual(h.out.json, { ...LISTS, trims: [] });
    assert.equal(h.calls.wholesaleDealerQueries, 0);
  });
  it('if the wholesale aggregate cannot be read, the dropdowns still load with the unadjusted counts', async () => {
    const h = load({ failWholesale: true });
    await h.facets({ make: 'Ford' });
    assert.deepEqual(h.out.json, { ...LISTS, trims: [] });
  });
  it('with make AND model the trim list is subtracted too', async () => {
    const h = load();
    await h.facets({ make: 'Mercedes-Benz', model: 'GLC' });
    assert.deepEqual(h.out.json.trims, [{ trim: 'GLC 43', n: 20 }]);
  });
});

describe('the option / colour catalog and the source-level guards', () => {
  it('the nightly catalog rebuild leaves wholesale out of both aggregates (options and colours)', () => {
    const rebuild = SRC.slice(SRC.indexOf('async function rebuildCatalogFacets('), SRC.indexOf('async function handleInventoryCatalogOptions('));
    assert.equal((rebuild.match(/cond <> 'wholesale'/g) || []).length, 2);
    assert.match(rebuild, /i\.make = \?\$\{RETAIL_ONLY_FACETS \? " AND \(i\.cond IS NULL OR i\.cond <> 'wholesale'\)" : ""\}/);
  });
  it('the live fallback (before the first facet build) filters wholesale for both of its queries', () => {
    const fn = extractFunction('handleInventoryCatalogOptions');
    assert.match(fn, /if \(RETAIL_ONLY_FACETS\) where\.push\("\(i\.cond IS NULL OR i\.cond <> 'wholesale'\)"\);/);
    assert.equal((fn.match(/\$\{whereSql\}/g) || []).length >= 2, true);
  });
  it('the base facet queries were not given a cond predicate (it would force a row lookup per counted row and blow the 20 s cap)', () => {
    const f = extractFunction('handleInventoryFacets');
    assert.ok(!/\bcond\s*(=|<>|IS\b|IN\b)/i.test(f), 'no cond predicate in the index-only GROUP BYs');
  });
  it('the wholesale aggregate is NOT a bare cond-grouped scan: dealer ids first, then dealers in batches by the (removed_at, dealer_id, cond) prefix', () => {
    const fn = extractFunction('wholesaleBuckets');
    assert.match(fn, /GROUP BY dealer_id/);
    assert.match(fn, /dealer_id IN \(\?\) AND cond = 'wholesale' GROUP BY make, state, model, trim/);
    assert.match(fn, /FORCE INDEX \(idx_inv_by_dealer_covering\)/);
  });
});
