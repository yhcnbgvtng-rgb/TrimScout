// inventoryListQuery() has broken in production six times across two days
// (2026-09-22 x5, 2026-09-25 x1) — always the same shape: a filter
// combination the hand-tuned index hints didn't cover, found live during
// an outage. It is a pure function (URLSearchParams in, {sql, args,
// orderBy} out), so every one of those combinations can be pinned down
// here without a live database, instead of relying on the next person to
// rediscover the same trap by hitting a slow query in production.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryListQuery, totalFromPage, applyCountCap, deferredPageSql } from '../src/inventoryListQuery.js';

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

describe('inventoryListQuery — make= + model=(+ trim=), state= optional (2026-09-28 fix, must not regress)', () => {
  it('switches to idx_inv_stock_make_model_trim once model= joins make= — idx_inv_stock_make_dealer does not cover model, so it visited every one of make\'s rows for a lookup (confirmed live: Ford 186k+ rows, 20s timeout, for a filter that only matched ~45k)', () => {
    const { sql, args } = query({ make: 'Ford', model: 'F-150', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_model_trim\)/);
    assert.doesNotMatch(sql, /idx_inv_stock_make_dealer\)/);
    assert.deepEqual(args, ['Ford', 'F-150']);
  });

  it('keeps the deeper index when trim= is also given — same index, trim just pins one column further right', () => {
    const { sql, args } = query({ make: 'Ford', model: 'F-150', trim: 'Lariat', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_model_trim\)/);
    assert.deepEqual(args, ['Ford', 'F-150', 'Lariat']);
  });

  it('uses the non-inStock sibling index when inStock is not set', () => {
    const { sql } = query({ make: 'Ford', model: 'F-150' });
    assert.match(sql, /FORCE INDEX \(idx_inv_make_model_trim\)/);
    assert.doesNotMatch(sql, /idx_inv_stock_make_model_trim/);
  });

  it('make= alone (no model=) still uses the shallower make-only index — switching indexes here would trade the default dealer:asc sort\'s filesort-free scan for a different filesort', () => {
    const { sql } = query({ make: 'Ford', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_dealer\)/);
    assert.doesNotMatch(sql, /idx_inv_stock_make_model_trim/);
  });

  it('the row-list SELECT keeps the dealership_contacts join (needs dealer_city/dealer_state) but countSql drops it — no WHERE clause ever filters on a d.* column', () => {
    const { sql, countSql } = query({ make: 'Ford', model: 'F-150', inStock: '1' });
    assert.match(sql, /LEFT JOIN dealership_contacts d ON d\.id = i\.dealer_id/);
    assert.doesNotMatch(countSql, /dealership_contacts/);
    assert.match(countSql, /FORCE INDEX \(idx_inv_stock_make_model_trim\)/);
    assert.match(countSql, /WHERE i\.make = \? AND i\.model = \? AND i\.removed_at IS NULL/);
  });

  it('make+model+state (in stock) now uses the make/model/state facet index instead of the state-wide walk — 2026-10-01', () => {
    // Was: state's idx_inv_stock_state won. Measured live, Ford F-150 in NJ (1,555 cars) never
    // finished inside 10s that way (a row lookup per NJ car to test make/model); this index's
    // equality prefix IS make+model+state, ~1s. state-only and make+state keep state's hint.
    const { sql } = query({ state: 'NJ', make: 'Ford', model: 'F-150', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_facet_make_model_state_trim\)/);
    assert.doesNotMatch(sql, /idx_inv_stock_state|idx_inv_stock_make_model_trim|idx_inv_stock_make_dealer/);
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

// Buyer search (PR 1 of the /search feature) additions: odometerMax, minPriceChanges, optionKeys.
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

describe('inventoryListQuery — removed=1 (admin "Sold" movement filter, 2026-09-28)', () => {
  it('matches removed_at IS NOT NULL within a rolling 24h window — no crawl run-id exists in this schema, so this is the durable "since last crawl" signal', () => {
    const { sql, args } = query({ removed: '1' });
    assert.match(sql, /WHERE i\.removed_at IS NOT NULL AND i\.removed_at >= DATE_SUB\(NOW\(\), INTERVAL 1 DAY\)/);
    assert.deepEqual(args, []);
  });

  it('is a no-op when absent', () => {
    const { sql } = query({});
    assert.doesNotMatch(sql, /removed_at IS NOT NULL/);
  });

  it('composes with make= — uses the dedicated (make, removed_at) index, not the in-stock make index (confirmed live: that one has no removed_at in its key and took 70s+ residual-filtering a common make)', () => {
    const { sql, args } = query({ make: 'BMW', removed: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_make_removed\)/);
    assert.match(sql, /WHERE i\.make = \? AND i\.removed_at IS NOT NULL AND i\.removed_at >= DATE_SUB\(NOW\(\), INTERVAL 1 DAY\)/);
    assert.deepEqual(args, ['BMW']);
  });

  it('composes with state= — uses the dedicated (state, removed_at) index, and state wins over make when both are set (matching the existing state-wins convention elsewhere in this file)', () => {
    const { sql, args } = query({ state: 'NJ', make: 'BMW', removed: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_state_removed\)/);
    assert.doesNotMatch(sql, /idx_inv_make_removed/);
    assert.deepEqual(args, ['NJ', 'BMW']);
  });

  it('works with no make=/state= at all — the "any make, any state" case the admin sheet must support — and still uses the plain removed_at index', () => {
    const { sql } = query({ removed: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_removed\)/);
    assert.match(sql, /removed_at IS NOT NULL/);
  });
});

describe('inventoryListQuery — optionKeys (must-have ALL, real set containment on canonical_key, as a JOIN not a correlated subquery)', () => {
  it('joins a derived table computing the matching (vin, dealer_id) pairs once, not a per-row correlated subquery', () => {
    const { sql, args } = query({ optionKeys: 'pano,awd' });
    assert.match(
      sql,
      /JOIN \(SELECT vin, dealer_id FROM dealer_inventory_options WHERE canonical_key IN \(\?,\?\) GROUP BY vin, dealer_id HAVING COUNT\(DISTINCT canonical_key\) = \?\) opt_match ON opt_match\.vin = i\.vin AND opt_match\.dealer_id = i\.dealer_id/
    );
    // Never regress back to a correlated subquery — that's the exact shape that hung for 2+
    // hours live on an optionKeys-only search (no make=/state= to narrow the outer scan first).
    assert.doesNotMatch(sql, /i\.vin IN \(SELECT/);
    assert.deepEqual(args, ['pano', 'awd', 2]);
  });

  it('trims whitespace and drops empty entries from the comma-separated list', () => {
    const { args } = query({ optionKeys: ' pano , , awd ' });
    assert.deepEqual(args, ['pano', 'awd', 2]);
  });

  it('is a no-op when optionKeys is empty or absent', () => {
    assert.equal(query({}).sql.includes('dealer_inventory_options'), false);
    assert.equal(query({ optionKeys: '' }).sql.includes('dealer_inventory_options'), false);
  });

  it('composes with other filters and the make= index hint unchanged — optionJoin args come first, matching their position in the SQL text', () => {
    const { sql, args } = query({ make: 'BMW', optionKeys: 'bowers wilkins', inStock: '1' });
    assert.match(sql, /FORCE INDEX \(idx_inv_stock_make_dealer\)/);
    assert.match(sql, /dealer_inventory_options.*i\.make = \?/s);
    assert.deepEqual(args, ['bowers wilkins', 1, 'BMW']);
  });

  it('works with no make=/state= at all — the exact shape that used to hang (an options-only AI search)', () => {
    const { sql, args } = query({ optionKeys: 'heated front seats,sunroof' });
    assert.match(sql, /JOIN \(SELECT vin, dealer_id FROM dealer_inventory_options/);
    assert.deepEqual(args, ['heated front seats', 'sunroof', 2]);
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

// Buyer search speed: a capped count stops early instead of visiting every matching row.
describe('inventoryListQuery — countCap', () => {
  it('is absent (exact COUNT) unless countCap is given', () => {
    const r = query({ make: 'Ford' });
    assert.equal(r.countCap, null);
    assert.equal(r.cappedCountSql, null);
  });

  it('wraps the count in a LIMIT cap+1 derived table, keeping the make index hint and no dealer join', () => {
    const r = query({ make: 'Ford', model: 'F-150', inStock: '1', countCap: '1000' });
    assert.equal(r.countCap, 1000);
    assert.match(r.cappedCountSql, /^SELECT COUNT\(\*\) AS total FROM \(SELECT 1 FROM dealer_inventory i FORCE INDEX \(idx_inv_stock_make_model_trim\) .*LIMIT 1001\) capped$/);
    assert.doesNotMatch(r.cappedCountSql, /dealership_contacts/);
  });

  it('keeps the optionKeys derived-table JOIN (not a correlated subquery) inside the capped count', () => {
    const r = query({ make: 'Ford', model: 'F-150', inStock: '1', optionKeys: 'heated front seats', countCap: '1000' });
    assert.match(r.cappedCountSql, /JOIN \(SELECT vin, dealer_id FROM dealer_inventory_options WHERE canonical_key IN \(\?\) GROUP BY vin, dealer_id HAVING COUNT\(DISTINCT canonical_key\) = \?\) opt_match/);
    assert.doesNotMatch(r.cappedCountSql, /i\.vin IN \(SELECT/);
  });

  it('ignores a junk or negative cap and bounds a huge one', () => {
    assert.equal(query({ countCap: 'abc' }).countCap, null);
    assert.equal(query({ countCap: '-5' }).countCap, null);
    assert.equal(query({ countCap: '999999999' }).countCap, 100000);
  });
});

describe('totalFromPage / applyCountCap', () => {
  it('a short page is the exact total — no COUNT needed', () => {
    assert.equal(totalFromPage(0, 24, 7), 7);
    assert.equal(totalFromPage(48, 24, 5), 53);
  });
  it('a full page, or a page past the end, still needs a count', () => {
    assert.equal(totalFromPage(0, 24, 24), null);
    assert.equal(totalFromPage(500, 24, 0), null);
  });
  it('flags a capped total as a floor, and passes an exact one through', () => {
    assert.deepEqual(applyCountCap(1001, 1000), { total: 1000, totalCapped: true });
    assert.deepEqual(applyCountCap(1000, 1000), { total: 1000, totalCapped: false });
    assert.deepEqual(applyCountCap(42, null), { total: 42, totalCapped: false });
  });
});

// Buyer search hot paths, measured live 2026-10-01 (see docs/BUYER_SEARCH.md for the EXPLAIN snapshots).
describe('inventoryListQuery — buyer hot-path shapes', () => {
  it('sort=trim orders (trim, dealer_name, vin) — the index order of idx_inv_stock_make_model_trim', () => {
    const r = query({ make: 'Ford', model: 'F-150', inStock: '1', sort: 'trim:asc' });
    assert.equal(r.orderBy, 'i.trim ASC, i.dealer_name ASC, i.vin ASC');
    assert.match(r.sql, /FORCE INDEX \(idx_inv_stock_make_model_trim\)/);
  });

  it('make+model+state in stock uses the make/model/state/trim facet index, not the state-wide walk', () => {
    const r = query({ make: 'Ford', model: 'F-150', state: 'NJ', inStock: '1', sort: 'trim:asc' });
    assert.match(r.sql, /FORCE INDEX \(idx_inv_facet_make_model_state_trim\)/);
    assert.doesNotMatch(r.sql, /idx_inv_stock_state/);
  });

  it('make+state with sort=model uses idx_inv_facet_make_state_model; the admin dealer default still uses the state index', () => {
    assert.match(query({ make: 'Porsche', state: 'NJ', inStock: '1', sort: 'model:asc' }).sql, /FORCE INDEX \(idx_inv_facet_make_state_model\)/);
    assert.match(query({ make: 'Porsche', state: 'NJ', inStock: '1' }).sql, /FORCE INDEX \(idx_inv_stock_state\)/);
  });

  it('state alone and make alone keep their existing hints', () => {
    assert.match(query({ state: 'NJ', inStock: '1' }).sql, /idx_inv_stock_state/);
    assert.match(query({ make: 'Ford', inStock: '1' }).sql, /idx_inv_stock_make_dealer/);
  });
});

describe('deferredPageSql', () => {
  it('picks page ids from the covering FROM/WHERE (no dealer join, no i.*) then fetches only those rows whole', () => {
    const r = query({ make: 'Ford', model: 'F-150', inStock: '1', sort: 'trim:asc', countCap: '1000' });
    const sql = deferredPageSql(r);
    assert.match(sql, /^SELECT i\.\*, d\.city AS dealer_city, d\.state AS dealer_state FROM \(SELECT i\.vin, i\.dealer_id FROM dealer_inventory i FORCE INDEX \(idx_inv_stock_make_model_trim\) /);
    assert.match(sql, /ORDER BY i\.trim ASC, i\.dealer_name ASC, i\.vin ASC LIMIT \? OFFSET \?\) pg JOIN dealer_inventory i ON i\.vin = pg\.vin AND i\.dealer_id = pg\.dealer_id LEFT JOIN dealership_contacts d ON d\.id = i\.dealer_id ORDER BY i\.trim ASC, i\.dealer_name ASC, i\.vin ASC$/);
    // the inner query must not touch dealership_contacts (that join is the outer query's, on 24 rows)
    assert.equal((sql.match(/dealership_contacts/g) || []).length, 1);
  });

  it('keeps the optionKeys derived-table JOIN inside the inner id query, args in bind order', () => {
    const r = query({ make: 'Ford', model: 'F-150', inStock: '1', optionKeys: 'heated front seats,4wd', countCap: '1000' });
    const sql = deferredPageSql(r);
    assert.ok(sql.indexOf('opt_match') < sql.indexOf(') pg JOIN'));
    assert.deepEqual(r.args.slice(0, 3), ['heated front seats', '4wd', 2]);
  });
});

describe('inventoryListQuery — every buyer-table column sorts on the server, blanks last (nullsLast=1)', () => {
  const ob = (sort, extra = {}) => query({ make: 'Honda', inStock: '1', sort, ...extra }).orderBy;

  it('without nullsLast the order is byte-for-byte what it always was (default, explicit and trim sorts, admin callers)', () => {
    assert.equal(query({}).orderBy, 'i.dealer_name ASC, i.vin ASC');
    assert.equal(ob('price:asc'), 'i.price ASC, i.vin ASC');
    assert.equal(ob('price:desc'), 'i.price DESC, i.vin ASC');
    assert.equal(ob('trim:asc'), 'i.trim ASC, i.dealer_name ASC, i.vin ASC');
    assert.equal(ob('trim:desc'), 'i.trim DESC, i.dealer_name DESC, i.vin DESC');
  });

  it('numeric columns: a leading "is blank" key (always ASC) puts NULLs after every value in BOTH directions', () => {
    for (const [key, col] of [['days', 'i.days_on_lot'], ['year', 'i.year'], ['mileage', 'i.mileage'], ['price', 'i.price'], ['vehicleid', 'i.vehicle_id']]) {
      assert.equal(ob(`${key}:asc`, { nullsLast: '1' }), `(${col}) IS NULL ASC, ${col} ASC, i.vin ASC`, `${key} asc`);
      assert.equal(ob(`${key}:desc`, { nullsLast: '1' }), `(${col}) IS NULL ASC, ${col} DESC, i.vin ASC`, `${key} desc`);
    }
  });

  it('text columns: empty string counts as blank as well as NULL', () => {
    for (const [key, col] of [['make', 'i.make'], ['model', 'i.model'], ['dealer', 'i.dealer_name'], ['vin', 'i.vin'], ['ext', 'i.exterior_color'], ['int', 'i.interior_color'], ['state', 'i.state'], ['listing', 'i.vdp_url']]) {
      assert.equal(ob(`${key}:asc`, { nullsLast: '1' }), `(${col} IS NULL OR ${col} = '') ASC, ${col} ASC, i.vin ASC`, `${key} asc`);
      assert.equal(ob(`${key}:desc`, { nullsLast: '1' }), `(${col} IS NULL OR ${col} = '') ASC, ${col} DESC, i.vin ASC`, `${key} desc`);
    }
  });

  it('trim keeps its three-key tie-break and just gains the blank key in front', () => {
    assert.equal(ob('trim:asc', { nullsLast: '1' }), "(i.trim IS NULL OR i.trim = '') ASC, i.trim ASC, i.dealer_name ASC, i.vin ASC");
    assert.equal(ob('trim:desc', { nullsLast: '1' }), "(i.trim IS NULL OR i.trim = '') ASC, i.trim DESC, i.dealer_name DESC, i.vin DESC");
  });

  it('contact: a yes/no flag, unknown (no directory row) last in both directions; its page query keeps the dealership_contacts join', () => {
    const asc = query({ make: 'Honda', inStock: '1', sort: 'contact:asc', nullsLast: '1' });
    assert.match(asc.orderBy, /^\(\(CASE WHEN d\.id IS NULL THEN NULL WHEN d\.contact_email IS NOT NULL AND TRIM\(d\.contact_email\) <> '' THEN 1 ELSE 0 END\)\) IS NULL ASC, \(CASE WHEN .* END\) ASC, i\.vin ASC$/);
    const desc = query({ make: 'Honda', inStock: '1', sort: 'contact:desc', nullsLast: '1' });
    assert.match(desc.orderBy, / END\) DESC, i\.vin ASC$/);
    assert.match(asc.countSql, /LEFT JOIN dealership_contacts d ON d\.id = i\.dealer_id/, 'the inner page query needs d to order by it');
    assert.match(deferredPageSql({ countSql: asc.countSql, orderBy: asc.orderBy }), /SELECT i\.vin, i\.dealer_id FROM dealer_inventory i .*LEFT JOIN dealership_contacts d .* ORDER BY .*d\.contact_email/);
  });

  it('no other sort drags the dealership_contacts join into the count / inner query (that join was measured as pure overhead)', () => {
    for (const s of ['price:asc', 'days:asc', 'vin:asc', 'ext:desc', 'state:asc', 'listing:asc', 'trim:asc', 'vehicleid:desc']) {
      assert.doesNotMatch(query({ make: 'Honda', inStock: '1', sort: s, nullsLast: '1' }).countSql, /dealership_contacts/, s);
    }
  });

  it('an unknown key still falls back to the dealer sort (and still gets the blank key when asked) — nothing is injectable through sort', () => {
    assert.equal(ob('nope:asc'), 'i.dealer_name ASC, i.vin ASC');
    assert.equal(ob('nope:asc', { nullsLast: '1' }), 'i.dealer_name ASC, i.vin ASC');
    // the key is whitelisted and the direction is one of two fixed words, so trailing junk can only ever mean ASC
    const junk = ob('price:asc;DROP TABLE x', { nullsLast: '1' });
    assert.equal(junk, '(i.price) IS NULL ASC, i.price ASC, i.vin ASC');
    assert.doesNotMatch(junk, /DROP/);
    assert.equal(ob('i.price:asc', { nullsLast: '1' }), 'i.dealer_name ASC, i.vin ASC');
  });

  it('nullsLast only counts when it is exactly "1"', () => {
    for (const v of ['0', 'true', '', 'yes']) assert.equal(ob('price:asc', { nullsLast: v }), 'i.price ASC, i.vin ASC', v);
  });

  it('the new sort keys keep every filter and index hint untouched', () => {
    const a = query({ make: 'Honda', model: 'CR-V', inStock: '1', sort: 'price:asc' });
    const b = query({ make: 'Honda', model: 'CR-V', inStock: '1', sort: 'price:asc', nullsLast: '1' });
    assert.equal(a.sql, b.sql);
    assert.deepEqual(a.args, b.args);
    assert.match(b.sql, /FORCE INDEX \(idx_inv_stock_make_model_trim\)/);
  });
});
