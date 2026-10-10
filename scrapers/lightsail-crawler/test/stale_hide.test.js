// Cars last seen more than STALE_HIDE_DAYS ago are hidden from buyer search, and from its counts and facets the same way.
// The list filter (inventoryListQuery seenWithinDays) and the facet subtraction (staleFacets + retailFacets) are pure, so the
// "counts match the list" rule is checked here on one synthetic table rather than against a live database.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inventoryListQuery, seenWithinDaysOf } from '../src/inventoryListQuery.js';
import { staleSlices, STALE_MAX_SLICES } from '../src/staleFacets.js';
import { adjustFacetLists, adjustMakeList } from '../src/retailFacets.js';

const query = (pairs) => inventoryListQuery(new URLSearchParams(pairs));
const CLAUSE = 'i.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';

describe('inventoryListQuery — seenWithinDays (buyer search hides cars not seen for 7+ days)', () => {
  it('adds one post-filter with the day count as its only extra arg', () => {
    const { sql, args } = query({ seenWithinDays: '7', inStock: '1', state: 'FL', make: 'Ford' });
    assert.ok(sql.includes(CLAUSE));
    assert.deepEqual(args, ['FL', 'Ford', 7]);
  });
  it('without it the SQL, args and order are unchanged (admin views and direct pages still see every car)', () => {
    for (const pairs of [{}, { inStock: '1', state: 'FL', make: 'Ford' }, { dealerId: '11249', inStock: '1' }]) {
      assert.deepEqual(query({ ...pairs, seenWithinDays: '' }), query(pairs));
      assert.ok(!query(pairs).sql.includes('last_seen_at'));
    }
  });
  it('ignores junk instead of building SQL from it', () => {
    for (const bad of ['0', '-3', '7; DROP TABLE x', 'abc', '1000', '7.5']) assert.equal(seenWithinDaysOf(bad), null, bad);
    assert.equal(seenWithinDaysOf('7'), 7);
  });
});

describe('staleSlices — bounded day slices of last_seen_at older than the cutoff', () => {
  it('is one open-ended slice when nothing is older than the cutoff day', () => {
    assert.deepEqual(staleSlices(7, 5), [{ upperDays: 7, lowerDays: null }]);
    assert.deepEqual(staleSlices(7, 7), [{ upperDays: 7, lowerDays: null }]);
  });
  it('runs contiguous one-day slices to the oldest car, the last one unbounded below', () => {
    assert.deepEqual(staleSlices(7, 10), [{ upperDays: 7, lowerDays: 8 }, { upperDays: 8, lowerDays: 9 }, { upperDays: 9, lowerDays: 10 }, { upperDays: 10, lowerDays: null }]);
  });
  it('caps the number of slices', () => {
    assert.equal(staleSlices(7, 5000).length, STALE_MAX_SLICES);
  });
});

describe('counts match the list — every age band, same table', () => {
  const NOW = Date.parse('2026-10-10T16:00:00Z');
  const DAY = 86400e3;
  const mk = (make, state, model, trim, cond, ageDays) => ({ make, state, model, trim, cond, seen: NOW - ageDays * DAY });
  // ages straddle every band: fresh (<3d), label band (3-7d), hidden (>7d); one wholesale car is also stale
  const table = [
    mk('Ford', 'FL', 'F-150', 'XLT', 'new', 0), mk('Ford', 'FL', 'F-150', 'XLT', 'new', 2.9), mk('Ford', 'FL', 'F-150', 'XLT', 'used', 3),
    mk('Ford', 'FL', 'F-150', 'XLT', 'new', 6.9), mk('Ford', 'FL', 'F-150', 'XLT', 'new', 7), mk('Ford', 'FL', 'F-150', 'XLT', 'new', 7.1),
    mk('Ford', 'FL', 'F-150', 'Lariat', 'new', 20), mk('Ford', 'GA', 'F-150', 'XLT', 'new', 9), mk('Ford', 'GA', 'Bronco', 'Badlands', 'new', 1),
    mk('Toyota', 'FL', 'RAV4', 'XLE', 'wholesale', 1), mk('Toyota', 'FL', 'RAV4', 'XLE', 'wholesale', 30), mk('Toyota', 'FL', 'RAV4', 'XLE', 'new', 40), mk('Toyota', 'FL', 'RAV4', 'XLE', 'new', 4),
  ];
  const visible = (c) => c.cond !== 'wholesale' && NOW - c.seen <= 7 * DAY; // retailOnly + seenWithinDays=7
  const group = (rows, key) => Object.entries(rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {})).map(([k, n]) => ({ [key]: k, n })).sort((a, b) => b.n - a.n || String(a[key]).localeCompare(String(b[key])));
  const raw = (rows, key) => group(rows, key);
  const buckets = (rows) => Object.values(rows.reduce((m, r) => { const k = [r.make, r.state, r.model, r.trim].join('|'); (m[k] ||= { make: r.make, state: r.state, model: r.model, trim: r.trim, n: 0 }).n++; return m; }, {}));
  const wholesale = buckets(table.filter((c) => c.cond === 'wholesale'));
  const stale = buckets(table.filter((c) => c.cond !== 'wholesale' && NOW - c.seen > 7 * DAY)); // what staleBuckets reads: stale AND not wholesale
  const hidden = [...wholesale, ...stale];
  const shown = table.filter(visible);

  it('a car exactly 7 days old is still shown; one a moment older is hidden', () => {
    assert.equal(visible(mk('Ford', 'FL', 'F-150', 'XLT', 'new', 7)), true);
    assert.equal(visible(mk('Ford', 'FL', 'F-150', 'XLT', 'new', 7.01)), false);
  });
  it('make counts equal the number of cars the search returns', () => {
    const lists = { states: [], makes: raw(table, 'make'), models: [], trims: [] };
    assert.deepEqual(adjustFacetLists(lists, hidden, {}).makes, group(shown, 'make'));
    assert.deepEqual(adjustMakeList(lists.makes, hidden), group(shown, 'make'));
  });
  it('state, model and trim counts equal the search results under each scope', () => {
    const inMake = (rows, make) => rows.filter((c) => c.make === make);
    const lists = {
      states: raw(inMake(table, 'Ford'), 'state'),
      models: raw(inMake(table, 'Ford'), 'model'),
      trims: raw(table.filter((c) => c.make === 'Ford' && c.model === 'F-150'), 'trim'),
      makes: [],
    };
    const r = adjustFacetLists(lists, hidden, { make: 'Ford', model: 'F-150' });
    assert.deepEqual(r.states, group(inMake(shown, 'Ford'), 'state'));
    assert.deepEqual(r.models, group(inMake(shown, 'Ford'), 'model'));
    assert.deepEqual(r.trims, group(shown.filter((c) => c.make === 'Ford' && c.model === 'F-150'), 'trim'));
  });
  it('a stale wholesale car is subtracted once, not twice', () => {
    const lists = { states: [], makes: raw(table, 'make'), models: [], trims: [] };
    const makes = adjustFacetLists(lists, hidden, {}).makes;
    assert.deepEqual(makes.find((m) => m.make === 'Toyota'), { make: 'Toyota', n: 1 });
  });
});

describe('the box default for the catalog rebuild is the web constant', () => {
  it('STALE_HIDE_DAYS in deals_api_server.js defaults to lib/lastConfirmed.ts STALE_HIDE_DAYS', () => {
    const web = Number(/export const STALE_HIDE_DAYS = (\d+);/.exec(fs.readFileSync(new URL('../../../lib/lastConfirmed.ts', import.meta.url), 'utf8'))[1]);
    const box = Number(/const STALE_HIDE_DAYS = process\.env\.STALE_HIDE_DAYS === undefined \? (\d+) :/.exec(fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8'))[1]);
    assert.equal(web, 7);
    assert.equal(box, web);
  });
});
