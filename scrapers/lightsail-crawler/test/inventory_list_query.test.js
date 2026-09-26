// inventoryListQuery() has broken in production six times across two days
// (2026-09-22 x5, 2026-09-25 x1) — always the same shape: a filter
// combination the hand-tuned index hints didn't cover, found live during
// an outage. It is a pure function (URLSearchParams in, {sql, args,
// orderBy} out), so every one of those combinations can be pinned down
// here without a live database, instead of relying on the next person to
// rediscover the same trap by hitting a slow query in production.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryListQuery } from '../src/inventoryListQuery.js';

function query(pairs) {
  return inventoryListQuery(new URLSearchParams(pairs));
}

describe('inventoryListQuery — no filters', () => {
  it('has no WHERE clause and no index hint, and sorts by dealer name by default', () => {
    const { sql, args, orderBy } = query({});
    assert.match(sql, /^FROM dealer_inventory i {2}LEFT JOIN dealership_contacts d ON d\.id = i\.dealer_id\s*$/);
    assert.deepEqual(args, []);
    assert.equal(orderBy, 'i.dealer_name ASC, i.vin ASC');
  });
});

describe('inventoryListQuery — state= (the 2026-09-25 regression)', () => {
  it('filters on i.state directly — not a JOIN into dealership_contacts', () => {
    const { sql, args } = query({ state: 'nj' });
    assert.match(sql, /WHERE i\.state = \?/);
    assert.deepEqual(args, ['NJ'], 'uppercases the state code');
  });

  it('forces idx_inv_stock_state when inStock=1 is also set — the admin sheet\'s default view', () => {
    const { sql } = query({ state: 'NJ', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_state\)/);
    assert.match(sql, /WHERE i\.state = \? AND i\.removed_at IS NULL/);
  });

  it('forces idx_inv_state_dealer when inStock is not set (the "all, incl. removed" view)', () => {
    const { sql } = query({ state: 'TX' });
    assert.match(sql, /FORCE INDEX \(idx_inv_state_dealer\)/);
    assert.doesNotMatch(sql, /idx_inv_stock_state/);
  });

  it('never uses the retired dealership_contacts STRAIGHT_JOIN plan', () => {
    for (const params of [{ state: 'NJ' }, { state: 'NJ', inStock: '1' }, { state: 'NJ', make: 'Toyota' }]) {
      const { sql } = query(params);
      assert.doesNotMatch(sql, /STRAIGHT_JOIN/, JSON.stringify(params));
      assert.doesNotMatch(sql, /FROM dealership_contacts/, JSON.stringify(params));
    }
  });

  it('drops the state index hint when dealerId= is also set — one store is already maximally selective', () => {
    const { sql, args } = query({ state: 'NJ', dealerId: '4521', inStock: '1' });
    assert.doesNotMatch(sql, /idx_inv_stock_state|idx_inv_state_dealer/);
    assert.match(sql, /WHERE i\.dealer_id = \? AND i\.state = \? AND i\.removed_at IS NULL/);
    assert.deepEqual(args, [4521, 'NJ']);
  });
});

describe('inventoryListQuery — make= (2026-09-22 fix, must not regress)', () => {
  it('forces idx_inv_stock_make_dealer when inStock=1 is set — a covering index, no filesort (2026-09-25 fix of a 2026-09-22 gap: 10.8s for make=Toyota with the plain idx_inv_stock_make once the buyer /search page sent it real default-sort traffic)', () => {
    const { sql, args } = query({ make: 'Porsche', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_dealer\)/);
    assert.deepEqual(args, ['Porsche']);
  });

  it('forces idx_inv_make_dealer when inStock is not set — 18-20s -> fast live fix', () => {
    const { sql } = query({ make: 'Toyota' });
    assert.match(sql, /FORCE INDEX \(idx_inv_make_dealer\)/);
  });

  it('keeps applying the make hint even with dealerId= set — unchanged 2026-09-22 behavior, not touched by the state fix', () => {
    const { sql } = query({ make: 'Ford', dealerId: '99', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_dealer\)/);
  });
});

describe('inventoryListQuery — state= and make= together', () => {
  it("state's hint wins when both are present — state was the one confirmed broken", () => {
    const { sql, args } = query({ state: 'NJ', make: 'Toyota', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_state\)/);
    assert.doesNotMatch(sql, /idx_inv_stock_make|idx_inv_make_dealer/);
    assert.match(sql, /WHERE i\.state = \? AND i\.make = \? AND i\.removed_at IS NULL/);
    assert.deepEqual(args, ['NJ', 'Toyota']);
  });
});

describe('inventoryListQuery — other filters never disqualify the state/make hints (the trim=/possibleDemo= gap)', () => {
  it('state= + trim= still gets the state index hint', () => {
    const { sql } = query({ state: 'NJ', trim: 'Lariat', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_state\)/);
    assert.match(sql, /i\.trim = \?/);
  });

  it('state= + possibleDemo=1 still gets the state index hint', () => {
    const { sql } = query({ state: 'NJ', possibleDemo: '1', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_state\)/);
    assert.match(sql, /i\.cond = 'new' AND i\.mileage > 500/);
  });

  it('make= + q= still gets the make index hint (unchanged, pre-existing behavior)', () => {
    const { sql } = query({ make: 'Honda', q: 'accord', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_dealer\)/);
  });
});

describe('inventoryListQuery — sort', () => {
  it('accepts an explicit sort key and direction', () => {
    const { orderBy } = query({ sort: 'price:desc' });
    assert.equal(orderBy, 'i.price DESC, i.vin ASC');
  });

  it('falls back to dealer:asc for an unknown sort key', () => {
    const { orderBy } = query({ sort: 'bogus:desc' });
    assert.equal(orderBy, 'i.dealer_name DESC, i.vin ASC');
  });
});

// Buyer search (PR 1 of the /search feature) additions: odometerMax, minPriceChanges, optionCodes.
describe('inventoryListQuery — odometerMax', () => {
  it('filters on i.mileage <= the given value', () => {
    const { sql, args } = query({ odometerMax: '30000' });
    assert.match(sql, /WHERE i\.mileage <= \?/);
    assert.deepEqual(args, [30000]);
  });

  it('combines with other filters via AND, in declaration order', () => {
    const { sql, args } = query({ make: 'Toyota', odometerMax: '25000', inStock: '1' });
    assert.match(sql, /WHERE i\.make = \? AND i\.removed_at IS NULL AND i\.mileage <= \?/);
    assert.deepEqual(args, ['Toyota', 25000]);
  });
});

describe('inventoryListQuery — minPriceChanges', () => {
  it('filters on the denormalized price_change_count column, not a live aggregate', () => {
    const { sql, args } = query({ minPriceChanges: '2' });
    assert.match(sql, /WHERE i\.price_change_count >= \?/);
    assert.deepEqual(args, [2]);
  });
});

describe('inventoryListQuery — optionCodes (must-have ALL, real set containment)', () => {
  it('builds a HAVING COUNT(DISTINCT code) = N containment check against dealer_inventory_options', () => {
    const { sql, args } = query({ optionCodes: 'PANO,AWD' });
    assert.match(
      sql,
      /WHERE i\.vin IN \(SELECT vin FROM dealer_inventory_options WHERE dealer_id = i\.dealer_id AND code IN \(\?,\?\) GROUP BY vin HAVING COUNT\(DISTINCT code\) = \?\)/
    );
    assert.deepEqual(args, ['PANO', 'AWD', 2]);
  });

  it('trims whitespace and drops empty entries from the comma-separated list', () => {
    const { args } = query({ optionCodes: ' PANO , , AWD ' });
    assert.deepEqual(args, ['PANO', 'AWD', 2]);
  });

  it('is a no-op when optionCodes is empty or absent', () => {
    assert.equal(query({}).sql.includes('dealer_inventory_options'), false);
    assert.equal(query({ optionCodes: '' }).sql.includes('dealer_inventory_options'), false);
  });

  it('composes with other filters and the make= index hint unchanged', () => {
    const { sql, args } = query({ make: 'BMW', optionCodes: 'PANO', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_dealer\)/);
    assert.match(sql, /i\.make = \? AND .*dealer_inventory_options/);
    assert.deepEqual(args, ['BMW', 'PANO', 1]);
  });
});

// Buyer search PR 2: the remaining deterministic filters (price/DOM range, colors) needed for
// /api/vehicles/search — no schema change, price/days_on_lot/color columns already exist.
describe('inventoryListQuery — price and DOM range', () => {
  it('priceMin/priceMax filter on i.price', () => {
    const { sql, args } = query({ priceMin: '20000', priceMax: '40000' });
    assert.match(sql, /WHERE i\.price >= \? AND i\.price <= \?/);
    assert.deepEqual(args, [20000, 40000]);
  });

  it('maxDays filters on i.days_on_lot <=, alongside the existing minDays >=', () => {
    const { sql, args } = query({ minDays: '5', maxDays: '30' });
    assert.match(sql, /WHERE i\.days_on_lot >= \? AND i\.days_on_lot <= \?/);
    assert.deepEqual(args, [5, 30]);
  });

  it('yearMin/yearMax filter on i.year', () => {
    const { sql, args } = query({ yearMin: '2023', yearMax: '2025' });
    assert.match(sql, /WHERE i\.year >= \? AND i\.year <= \?/);
    assert.deepEqual(args, [2023, 2025]);
  });

  it('a single yearMin (no yearMax) works for "2024 or newer"', () => {
    const { sql, args } = query({ yearMin: '2024' });
    assert.match(sql, /WHERE i\.year >= \?/);
    assert.deepEqual(args, [2024]);
  });
});

describe('inventoryListQuery — exteriorColor / interiorColor', () => {
  it('filters on the plain color columns', () => {
    const { sql, args } = query({ exteriorColor: 'Black', interiorColor: 'Tan' });
    assert.match(sql, /WHERE i\.exterior_color = \? AND i\.interior_color = \?/);
    assert.deepEqual(args, ['Black', 'Tan']);
  });

  it('is a no-op when absent', () => {
    const { sql } = query({});
    assert.doesNotMatch(sql, /exterior_color|interior_color/);
  });
});
