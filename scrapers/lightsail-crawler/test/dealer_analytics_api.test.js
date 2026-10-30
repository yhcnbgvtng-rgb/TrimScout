import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDealerAnalyticsApi, matchDealerAnalyticsRoute, brandTagsFromNotes, LIMITS } from '../src/dealerAnalyticsApi.js';
import { createStableCache } from '../src/stableCache.js';
import { authorizeAudit, authorizeAuditDealer } from '../src/auditKey.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const quiet = { log() {}, error() {} };
const flat = (sql) => sql.replace(/\s+/g, ' ').trim();
const P = (qs = '') => new URLSearchParams(qs);

function makeDb(over = {}) {
  const db = {
    runs: [{ day: '2026-10-31', finished_epoch: 1793448000 }],
    summary: [
      { dealer_id: 2187, dealer_name: 'Universal Chrysler Dodge Jeep Ram', city: 'Saint Louis', state: 'MO', brand_notes: 'Website: x | Brand: Chrysler | Brand: Jeep', is_group_bucket: 0, make_count: '25', active_units: '452', new_units: '54', used_units: '398', priced_units: '449', avg_price: '33034', avg_dom: '27.4', added_7d: '32', removed_7d: '23', drop_units_7d: '24', drop_units_30d: '60', avg_drop_usd_7d: '1800', avg_drop_pct_7d: '5.10', avg_drop_usd_30d: '1700', avg_drop_pct_30d: '4.90' },
      { dealer_id: 16951, dealer_name: 'ED MORSE NISSAN', city: 'SIERRA VISTA', state: 'AZ', brand_notes: null, is_group_bucket: 1, make_count: '61', active_units: '10934', new_units: '7522', used_units: '3412', priced_units: '10000', avg_price: '45727', avg_dom: '40', added_7d: '0', removed_7d: '0', drop_units_7d: '0', drop_units_30d: '0', avg_drop_usd_7d: null, avg_drop_pct_7d: null, avg_drop_usd_30d: null, avg_drop_pct_30d: null },
    ],
    contacts: { 2187: { id: 2187, dealer_name: 'Universal Chrysler Dodge Jeep Ram', city: 'Saint Louis', state: 'MO', notes: 'Brand: Jeep' } },
    trend: [{ day: '2026-10-30', active_units: 450, new_units: 54, used_units: 396, avg_price: 33000, added_units: 3, removed_units: 1 }, { day: '2026-10-31', active_units: 452, new_units: 54, used_units: 398, avg_price: 33034, added_units: 2, removed_units: 0 }],
    latest: { is_group_bucket: 0, make_count: 25, active_units: 452, new_units: 54, used_units: 398, priced_units: 449, avg_price: 33034, avg_dom: 27.4, age_0_30: 155, age_31_60: 297, age_61_90: 0, age_90_plus: 0, added_7d: 32, removed_7d: 23, drop_units_7d: 24, drop_units_30d: 60, avg_drop_usd_7d: 1800, avg_drop_pct_7d: 5.1, avg_drop_usd_30d: 1700, avg_drop_pct_30d: 4.9 },
    mix: [{ make: 'Jeep', model: 'Wrangler', units: '40', avg_price: '48000' }, { make: 'Jeep', model: 'Gladiator', units: '10', avg_price: '52000' }, { make: 'Ram', model: '1500', units: '60', avg_price: '55000' }],
    changeTotal: 2,
    changes: [
      { changed_on: '2026-10-31', vin: '1C4HJXFG0LW000001', old_price: 50000, new_price: 47500, year: 2025, make: 'Jeep', model: 'Wrangler', trim: 'Sahara', cond: 'new', vdp_url: 'https://www.universalcdjr.com/vdp/1', active: 1 },
      { changed_on: '2026-10-30', vin: '1C4HJXFG0LW000002', old_price: 40000, new_price: 41000, year: 2024, make: 'Jeep', model: 'Wrangler', trim: null, cond: 'used', vdp_url: null, active: null },
    ],
    own: [
      { make: 'Jeep', model: 'Wrangler', year: 2025, cond: 'new', units: '30', avg_price: '50000' },
      { make: 'Ram', model: '1500', year: 2024, cond: 'used', units: '10', avg_price: '40000' },
      { make: 'Jeep', model: 'Gladiator', year: 2025, cond: 'new', units: '5', avg_price: '60000' },
    ],
    market: [
      { make: 'Jeep', model: 'Wrangler', year: 2025, cond: 'new', units: 900, dealers: 120, avg_price: 51000 },
      { make: 'Ram', model: '1500', year: 2024, cond: 'used', units: 40, dealers: 2, avg_price: 38000 },
    ],
    ...over,
  };
  const calls = [];
  const query = async (rawSql, args = []) => {
    const sql = flat(rawSql);
    calls.push({ sql, args });
    if (db.failWith) throw db.failWith;
    if (/FROM dealer_analytics_runs/.test(sql)) return /AND day = \?/.test(sql) ? db.runs.filter((r) => r.day === args[0]) : db.runs;
    if (/FROM dealer_daily_summary s LEFT JOIN dealership_contacts/.test(sql)) return /is_group_bucket = 0/.test(sql) ? db.summary.filter((r) => !r.is_group_bucket) : db.summary;
    if (/COUNT\(\*\) AS buckets/.test(sql)) return [{ buckets: db.summary.filter((r) => r.is_group_bucket).length }];
    if (/FROM dealership_contacts WHERE id = \?/.test(sql)) return db.contacts[args[0]] ? [db.contacts[args[0]]] : [];
    if (/^SELECT DATE_FORMAT\(day/.test(sql)) return db.trend;
    if (/^SELECT is_group_bucket/.test(sql)) return db.latest ? [db.latest] : [];
    if (/^SELECT dealer_id FROM dealer_daily_summary/.test(sql)) return db.anySummary ? [{ dealer_id: args[0] }] : [];
    if (/GROUP BY make, model, year, cond/.test(sql)) return db.own;
    if (/GROUP BY make, model$/.test(sql)) return db.mix;
    if (/COUNT\(\*\) AS total FROM dealer_price_changes/.test(sql)) return [{ total: db.changeTotal }];
    if (/FROM dealer_price_changes p LEFT JOIN dealer_inventory/.test(sql)) return db.changes;
    if (/FROM market_price_daily/.test(sql)) return db.market;
    throw new Error(`unscripted SQL: ${sql}`);
  };
  return { db, calls, query };
}
const makeApi = (over, cacheImpl) => {
  const t = makeDb(over);
  const keys = [];
  const cache = cacheImpl || (async (key, compute) => { keys.push(key); return compute(); });
  const api = createDealerAnalyticsApi({ query: t.query, cache });
  return { ...t, api, keys };
};
const dealers = (api, qs = '') => api.handle({ kind: 'dealers' }, P(qs));
const dealer = (api, id, qs = '') => api.handle({ kind: 'dealer', id }, P(qs));
const market = (api, id, qs = '') => api.handle({ kind: 'market', id }, P(qs));

describe('routing', () => {
  it('matches only GET /api/inventory/dealer-analytics/dealers[/id[/market]]', () => {
    const base = '/api/inventory/dealer-analytics';
    assert.deepEqual(matchDealerAnalyticsRoute('GET', `${base}/dealers`), { kind: 'dealers' });
    assert.deepEqual(matchDealerAnalyticsRoute('GET', `${base}/dealers/2187`), { kind: 'dealer', id: '2187' });
    assert.deepEqual(matchDealerAnalyticsRoute('GET', `${base}/dealers/2187/market`), { kind: 'market', id: '2187' });
    assert.deepEqual(matchDealerAnalyticsRoute('GET', `${base}/dealers/abc`), { kind: 'dealer', id: 'abc' }, 'ids are validated by the handler (400), not the router');
    assert.equal(matchDealerAnalyticsRoute('POST', `${base}/dealers`), null);
    assert.equal(matchDealerAnalyticsRoute('GET', `${base}/dealers/1/market/x`), null);
    assert.equal(matchDealerAnalyticsRoute('GET', `${base}/other`), null);
    assert.equal(matchDealerAnalyticsRoute('GET', '/api/inventory/by-dealer'), null);
  });
  it('scoped audit keys are default-denied', () => {
    assert.equal(authorizeAudit('GET', '/api/inventory/dealer-analytics/dealers', P(), 'u1').allowed, false);
    assert.equal(authorizeAuditDealer('GET', '/api/inventory/dealer-analytics/dealers/1', P()).allowed, false);
  });
});

describe('input validation (400)', () => {
  it('rejects bad dealer ids', async () => {
    const { api } = makeApi();
    for (const id of ['abc', '0', '-1', '1.5', '1e3', '', '12345678901', "1; DROP TABLE x"]) {
      assert.equal((await dealer(api, id)).status, 400, id);
      assert.equal((await market(api, id)).status, 400, id);
    }
  });
  it('rejects bad flags, days, paging and direction', async () => {
    const { api } = makeApi();
    assert.equal((await dealers(api, 'includeBuckets=maybe')).status, 400);
    assert.equal((await dealers(api, 'day=2026-13-40')).status, 400);
    assert.equal((await dealers(api, 'day=yesterday')).status, 400);
    for (const qs of ['limit=0', `limit=${LIMITS.logMax + 1}`, 'limit=abc', 'offset=-1', `offset=${LIMITS.offsetMax + 1}`, 'direction=sideways']) {
      assert.equal((await dealer(api, '2187', qs)).status, 400, qs);
    }
    assert.equal((await market(api, '2187', 'day=bad')).status, 400);
  });
  it('accepts the edges of the allowed ranges', async () => {
    const { api } = makeApi();
    assert.equal((await dealer(api, '2187', `limit=${LIMITS.logMax}&offset=${LIMITS.offsetMax}&direction=drop`)).status, 200);
    assert.equal((await dealers(api, 'includeBuckets=0&day=2026-10-31')).status, 200);
  });
});

describe('not built yet (503) and unknown (404)', () => {
  it('503 with a clear message when no run has finished', async () => {
    const { api } = makeApi({ runs: [] });
    for (const r of [await dealers(api), await dealer(api, '2187'), await market(api, '2187')]) {
      assert.equal(r.status, 503);
      assert.match(r.body.error, /not been built yet/);
    }
  });
  it('503 when a table does not exist (MariaDB errno 1146)', async () => {
    const { api } = makeApi({ failWith: Object.assign(new Error("Table 'trimscout.dealer_analytics_runs' doesn't exist"), { errno: 1146 }) });
    const r = await dealers(api);
    assert.equal(r.status, 503);
    assert.match(r.body.error, /not been built yet/);
  });
  it('503 when the statement cap kills a query (errno 1969), other errors propagate', async () => {
    const t = makeApi({ failWith: Object.assign(new Error('Query execution was interrupted'), { errno: 1969 }) });
    const r = await dealers(t.api);
    assert.equal(r.status, 503);
    assert.match(r.body.error, /took too long/);
    const boom = makeApi({ failWith: new Error('connection lost') });
    await assert.rejects(dealers(boom.api), /connection lost/);
  });
  it('404 for a dealer that is in neither the directory nor the summary, and for a day with no finished run', async () => {
    const { api } = makeApi({ contacts: {}, trend: [], latest: null });
    assert.equal((await dealer(api, '99999')).status, 404);
    const m = makeApi({ contacts: {}, own: [], anySummary: false });
    assert.equal((await market(m.api, '99999')).status, 404);
    const d = makeApi();
    const r = await dealers(d.api, 'day=2026-01-01');
    assert.equal(r.status, 404);
    assert.match(r.body.error, /2026-01-01/);
  });
  it('a directory dealer with no summary row yet still answers (empty trend, null summary)', async () => {
    const { api } = makeApi({ trend: [], latest: null, mix: [], changes: [], changeTotal: 0 });
    const r = await dealer(api, '2187');
    assert.equal(r.status, 200);
    assert.equal(r.body.summary, null);
    assert.equal(r.body.ageBuckets, null);
    assert.deepEqual(r.body.trend, []);
  });
});

describe('GET /dealers', () => {
  it('hides group buckets by default, says how many it hid, and the toggle brings them back', async () => {
    const { api, calls } = makeApi();
    const def = await dealers(api);
    assert.equal(def.status, 200);
    assert.deepEqual(def.body.dealers.map((d) => d.dealerId), [2187]);
    assert.equal(def.body.bucketCount, 1);
    assert.equal(def.body.hiddenBuckets, 1);
    assert.equal(def.body.includeBuckets, false);
    assert.ok(calls.some((c) => /s\.is_group_bucket = 0/.test(c.sql)));
    const all = await dealers(api, 'includeBuckets=1');
    assert.deepEqual(all.body.dealers.map((d) => d.dealerId), [2187, 16951]);
    assert.equal(all.body.hiddenBuckets, 0);
    assert.equal(all.body.bucketCount, 1);
    assert.equal(all.body.dealers[1].isGroupBucket, true);
  });
  it('returns typed numbers, brand tags from the crawl notes, asOf and day', async () => {
    const { api } = makeApi();
    const { body } = await dealers(api);
    assert.equal(body.day, '2026-10-31');
    assert.equal(body.asOf, new Date(1793448000 * 1000).toISOString());
    const d = body.dealers[0];
    assert.deepEqual(d.brandTags, ['Chrysler', 'Jeep']);
    assert.equal(d.activeUnits, 452);
    assert.equal(d.avgDom, 27.4);
    assert.equal(d.dropUnits7d, 24);
    assert.equal(d.avgDropPct30d, 4.9);
    assert.equal(d.makeCount, 25);
    assert.equal(typeof d.avgPrice, 'number');
  });
  it('reads the requested finished day', async () => {
    const { api, calls } = makeApi({ runs: [{ day: '2026-10-30', finished_epoch: 1793361600 }, { day: '2026-10-31', finished_epoch: 1793448000 }] });
    const r = await dealers(api, 'day=2026-10-30');
    assert.equal(r.body.day, '2026-10-30');
    assert.ok(calls.some((c) => /dealer_daily_summary s/.test(c.sql) && c.args[0] === '2026-10-30'));
  });
});

describe('GET /dealers/:id', () => {
  it('returns the trend, mix, age buckets, summary and the price change log', async () => {
    const { api } = makeApi();
    const r = await dealer(api, '2187');
    assert.equal(r.status, 200);
    const b = r.body;
    assert.deepEqual(b.trend.map((t) => t.activeUnits), [450, 452]);
    assert.deepEqual(b.ageBuckets, [{ bucket: '0-30', units: 155 }, { bucket: '31-60', units: 297 }, { bucket: '61-90', units: 0 }, { bucket: '90+', units: 0 }]);
    assert.deepEqual(b.mix.makes, [{ make: 'Jeep', units: 50 }, { make: 'Ram', units: 60 }].sort((x, y) => y.units - x.units));
    assert.deepEqual(b.mix.models.map((m) => `${m.make} ${m.model} ${m.units}`), ['Ram 1500 60', 'Jeep Wrangler 40', 'Jeep Gladiator 10']);
    assert.equal(b.mix.modelsTruncated, false);
    assert.equal(b.dealer.dealerName, 'Universal Chrysler Dodge Jeep Ram');
    assert.deepEqual(b.dealer.brandTags, ['Jeep']);
    assert.equal(b.summary.activeUnits, 452);
    assert.equal(b.isGroupBucket, false);
    const c = b.priceChanges;
    assert.equal(c.total, 2);
    assert.equal(c.limit, 50);
    assert.equal(c.changes[0].pctChange, -5);
    assert.equal(c.changes[0].deltaUsd, -2500);
    assert.equal(c.changes[0].vdpUrl, 'https://www.universalcdjr.com/vdp/1');
    assert.equal(c.changes[0].inStock, true);
    assert.equal(c.changes[1].pctChange, 2.5);
    assert.equal(c.changes[1].vdpUrl, null);
    assert.equal(c.changes[1].inStock, null, 'a VIN no longer in dealer_inventory has no stock flag');
  });
  it('pages the log with the validated limit and offset and filters by direction', async () => {
    const { api, calls } = makeApi();
    await dealer(api, '2187', 'limit=25&offset=50&direction=drop');
    const log = calls.find((c) => /FROM dealer_price_changes p LEFT JOIN/.test(c.sql));
    assert.deepEqual(log.args, [2187, 25, 50]);
    assert.match(log.sql, /p\.new_price < p\.old_price/);
    assert.match(log.sql, /ORDER BY p\.changed_on DESC, p\.vin LIMIT \? OFFSET \?/);
    const up = makeApi();
    await dealer(up.api, '2187', 'direction=increase');
    assert.ok(up.calls.some((c) => /p\.new_price > p\.old_price/.test(c.sql)));
  });
  it('caps the models list and says it was cut', async () => {
    const mix = Array.from({ length: LIMITS.mixModelsMax + 20 }, (_, i) => ({ make: 'Toyota', model: `M${String(i).padStart(3, '0')}`, units: '1', avg_price: '30000' }));
    const { api } = makeApi({ mix });
    const { body } = await dealer(api, '2187');
    assert.equal(body.mix.models.length, LIMITS.mixModelsMax);
    assert.equal(body.mix.modelsTruncated, true);
    assert.equal(body.mix.makes[0].units, LIMITS.mixModelsMax + 20, 'make totals count every model, not just the returned ones');
  });
  it('reports the dealer as a group bucket from the summary row', async () => {
    const { api } = makeApi({ latest: { ...makeDb().db.latest, is_group_bucket: 1 } });
    assert.equal((await dealer(api, '2187')).body.isGroupBucket, true);
  });
});

describe('GET /dealers/:id/market', () => {
  it('compares the dealer to the market per make/model/year/condition and flags thin samples', async () => {
    const { api, calls } = makeApi();
    const { status, body } = await market(api, '2187');
    assert.equal(status, 200);
    assert.equal(body.marketIncludesDealer, true);
    const wr = body.rows.find((r) => r.model === 'Wrangler');
    assert.equal(wr.deltaUsd, -1000);
    assert.equal(wr.deltaPct, -1.96);
    assert.equal(wr.thinMarket, false);
    assert.equal(wr.marketDealers, 120);
    const ram = body.rows.find((r) => r.model === '1500');
    assert.equal(ram.thinMarket, true, 'two dealers in the sample is under the minimum of three');
    assert.equal(ram.deltaUsd, 2000);
    const gl = body.rows.find((r) => r.model === 'Gladiator');
    assert.equal(gl.marketAvgPrice, null);
    assert.equal(gl.deltaPct, null);
    assert.equal(gl.thinMarket, true);
    assert.deepEqual(body.rows.map((r) => r.model), ['Wrangler', '1500', 'Gladiator'], 'most units first');
    const q = calls.find((c) => /FROM market_price_daily/.test(c.sql));
    assert.deepEqual(q.args, ['2026-10-31', ['Jeep', 'Ram']], 'only the makes this dealer stocks');
  });
  it('weights the overall delta by units and leaves out thin markets', async () => {
    const { api } = makeApi();
    const { body } = await market(api, '2187');
    assert.equal(body.overall.comparableUnits, 30);
    assert.equal(body.overall.weightedDeltaPct, -2);
  });
  it('a dealer with no priced stock gets empty rows and no market query', async () => {
    const { api, calls } = makeApi({ own: [] });
    const { status, body } = await market(api, '2187');
    assert.equal(status, 200);
    assert.deepEqual(body.rows, []);
    assert.equal(body.overall.weightedDeltaPct, null);
    assert.ok(!calls.some((c) => /market_price_daily/.test(c.sql)));
  });
});

describe('cache use', () => {
  it('every payload goes through the injected cache, keyed by the finished run', async () => {
    const t = makeApi();
    await dealers(t.api); await dealers(t.api, 'includeBuckets=1'); await dealer(t.api, '2187'); await market(t.api, '2187');
    assert.ok(t.keys.length >= 5);
    for (const k of t.keys) assert.match(k, /^da:(dealers|dealer|log|market):2026-10-31@1793448000/, k);
    assert.equal(new Set(t.keys.filter((k) => k.startsWith('da:dealers'))).size, 2, 'bucket toggle is part of the key');
  });
  it('a real stable cache answers the second identical request without touching the database', async () => {
    let t = 0;
    const cache = createStableCache({ ttlMs: 60_000, now: () => t, log: quiet }).get;
    const x = makeApi({}, cache);
    await dealer(x.api, '2187');
    const after = x.calls.length;
    const again = await dealer(x.api, '2187');
    assert.equal(again.status, 200);
    assert.equal(x.calls.length, after, 'no new SQL on the second request (the run lookup is memoised too)');
  });
  it('a new finished run is a new cache key, so the page never waits out a TTL', async () => {
    let clock = 0;
    const db = makeDb();
    const keys = [];
    const api = createDealerAnalyticsApi({ query: db.query, cache: async (k, c) => { keys.push(k); return c(); }, now: () => clock });
    await dealers(api);
    db.db.runs = [{ day: '2026-11-01', finished_epoch: 1793534400 }];
    clock += LIMITS.runMemoMs + 1;
    await dealers(api);
    assert.notEqual(keys[0], keys[1]);
  });
  it('the module never uses the upsert-cleared invCached and the server wires its own stable cache instance', () => {
    const mod = fs.readFileSync(path.join(SRC, 'dealerAnalyticsApi.js'), 'utf8');
    assert.ok(!/invCached|invCache|invInvalidate/.test(mod.replace(/\/\/.*$/gm, '')), 'no invCached in code');
    const srv = fs.readFileSync(path.join(SRC, 'deals_api_server.js'), 'utf8');
    assert.match(srv, /import \{ createDealerAnalyticsApi, matchDealerAnalyticsRoute \} from "\.\/dealerAnalyticsApi\.js";/);
    assert.match(srv, /const dealerAnalyticsCached = createStableCache\(\{[\s\S]*?\}\)\.get;/);
    assert.match(srv, /cache: dealerAnalyticsCached,/);
    assert.match(srv, /max_statement_time=8 FOR/);
    const route = srv.indexOf('matchDealerAnalyticsRoute(req.method, pathname)');
    assert.ok(route > 0 && route < srv.indexOf('pathname === "/api/inventory/by-dealer"'), 'route sits ahead of by-dealer');
  });
});

describe('queries stay light and read-only', () => {
  it('every statement is a SELECT, and dealer_inventory is only read per dealer', async () => {
    const t = makeApi();
    await dealers(t.api, 'includeBuckets=1'); await dealer(t.api, '2187', 'direction=drop'); await market(t.api, '2187');
    assert.ok(t.calls.length > 8);
    for (const c of t.calls) {
      assert.match(c.sql, /^SELECT /, c.sql);
      assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|REPLACE)\b/i.test(c.sql), c.sql);
      if (/FROM dealer_inventory\b/.test(c.sql)) assert.match(c.sql, /dealer_id = \?/, `fleet-wide read of dealer_inventory: ${c.sql}`);
      if (/LEFT JOIN dealer_inventory/.test(c.sql)) assert.match(c.sql, /i\.vin = p\.vin AND i\.dealer_id = p\.dealer_id/);
    }
  });
});

describe('brandTagsFromNotes', () => {
  it('matches lib/crawlSheet.ts brandsFromNotes', () => {
    assert.deepEqual(brandTagsFromNotes('Brand: Chevrolet | Title: GM | Brand: Buick'), ['Chevrolet', 'Buick']);
    assert.deepEqual(brandTagsFromNotes('Website: x | Staff page: no_staff_page | Brand: Nissan'), ['Nissan']);
    assert.deepEqual(brandTagsFromNotes('Brand: Jeep | Brand: Jeep'), ['Jeep']);
    assert.deepEqual(brandTagsFromNotes(null), []);
    assert.deepEqual(brandTagsFromNotes('Website: x'), []);
  });
});
