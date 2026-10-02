import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adminFacetQueries, adminFacetResponse } from '../src/inventoryAdminFacets.js';
import { inventoryListQuery, multiParam } from '../src/inventoryListQuery.js';

const facets = (pairs) => adminFacetQueries(new URLSearchParams(pairs));

describe('adminFacetQueries — scoping (disjunctive: a field ignores its own selection)', () => {
  it('no selection: unscoped states + makes, no models/trims', () => {
    const f = facets([]);
    assert.deepEqual(f.queries.states.args, []);
    assert.deepEqual(f.queries.makes.args, []);
    assert.equal(f.queries.models, null);
    assert.equal(f.queries.trims, null);
  });
  it('State=FL,GA scopes makes (IN) but not states', () => {
    const f = facets([['state', 'fl'], ['state', 'GA']]);
    assert.match(f.queries.makes.sql, /state IN \(\?,\?\)/);
    assert.deepEqual(f.queries.makes.args, ['FL', 'GA']);
    assert.deepEqual(f.queries.states.args, [], 'states list ignores its own selection');
  });
  it('Make=Ford,Chevrolet unlocks models scoped by make (+state) and scopes states by make', () => {
    const f = facets([['make', 'Ford'], ['make', 'Chevrolet'], ['state', 'NJ']]);
    assert.match(f.queries.models.sql, /make IN \(\?,\?\) AND state IN \(\?\)/);
    assert.deepEqual(f.queries.models.args, ['Ford', 'Chevrolet', 'NJ']);
    assert.deepEqual(f.queries.states.args, ['Ford', 'Chevrolet']);
    assert.equal(f.queries.trims, null, 'trims need a model too');
  });
  it('Make + Model unlocks trims scoped by make, model and state', () => {
    const f = facets([['make', 'Ford'], ['model', 'F-150'], ['model', 'Bronco'], ['state', 'NJ']]);
    assert.deepEqual(f.queries.trims.args, ['Ford', 'F-150', 'Bronco', 'NJ']);
    assert.match(f.queries.trims.sql, /idx_inv_facet_make_model_state_trim/);
    assert.deepEqual(f.queries.states.args, ['Ford', 'F-150', 'Bronco'], 'states honour make + model');
  });
  it('a model with no make is ignored (nothing selective to scope it by)', () => {
    const f = facets([['model', 'F-150']]);
    assert.equal(f.queries.models, null);
    assert.equal(f.queries.trims, null);
    assert.deepEqual(f.queries.states.args, []);
  });
});

describe('adminFacetQueries — cache key', () => {
  it('is order-independent so click order shares one entry', () => {
    assert.equal(facets([['state', 'GA'], ['state', 'FL']]).cacheKey, facets([['state', 'fl'], ['state', 'ga']]).cacheKey);
  });
  it('differs between different selections', () => {
    assert.notEqual(facets([['make', 'Ford']]).cacheKey, facets([['make', 'Ford'], ['state', 'NJ']]).cacheKey);
  });
});

describe('adminFacetResponse', () => {
  it('numbers the counts and marks the response multi-capable', () => {
    const r = adminFacetResponse({ states: [{ state: 'FL', n: '12' }], makes: [], models: undefined, trims: null });
    assert.equal(r.multi, true);
    assert.deepEqual(r.states, [{ state: 'FL', n: 12 }]);
    assert.deepEqual(r.models, []);
  });
});

describe('multi-value list filters (inventoryListQuery)', () => {
  const q = (pairs) => inventoryListQuery(new URLSearchParams(pairs));
  it('one value keeps the exact `= ?` SQL the index hints were tuned for', () => {
    const { sql, args } = q([['make', 'Ford']]);
    assert.match(sql, /i\.make = \?/);
    assert.deepEqual(args, ['Ford']);
  });
  it('several values become IN (...) — OR within a field, AND across fields', () => {
    const { sql, args } = q([['state', 'fl'], ['state', 'ga'], ['make', 'Ford'], ['make', 'Kia'], ['cond', 'new'], ['cond', 'cpo'], ['inStock', '1']]);
    assert.match(sql, /i\.state IN \(\?,\?\) AND i\.make IN \(\?,\?\) AND i\.cond IN \(\?,\?\)/);
    assert.deepEqual(args, ['FL', 'GA', 'Ford', 'Kia', 'new', 'cpo']);
  });
  it('trims containing commas survive intact (repeated params, not a comma list)', () => {
    const { args } = q([['trim', 'XLT, 4x4'], ['trim', 'Lariat']]);
    assert.deepEqual(args, ['XLT, 4x4', 'Lariat']);
  });
  it('multiple makes keep the make index hint', () => {
    const { sql } = q([['make', 'Ford'], ['make', 'Kia'], ['inStock', '1']]);
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_dealer\)/);
  });
  it('dedupes, drops blanks and caps the list', () => {
    assert.deepEqual(multiParam(new URLSearchParams([['make', 'A'], ['make', ' A '], ['make', '']]), 'make'), ['A']);
    const many = Array.from({ length: 80 }, (_, i) => ['make', `M${i}`]);
    assert.equal(multiParam(new URLSearchParams(many), 'make').length, 25);
  });
});
