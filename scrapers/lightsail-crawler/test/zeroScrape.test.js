import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyZeroScrape, zeroScrapeCutoff, parseZeroScrapeRequest, buildMarkStaleStatement, aggregateZeroScrape, ZERO_SCRAPE_DEALER_IDS_SQL, ZERO_SCRAPE_BATCH_SQL, MIN_PEERS } from '../src/zeroScrape.js';

const RUN = new Date('2026-10-10T02:00:00Z');
const hrsAgo = (h) => new Date(RUN.getTime() - h * 3600_000);
const store = (id, h, o = {}) => ({ dealerId: id, sourceBox: 'box2', make: 'BMW', lastSeen: hrsAgo(h), live: 10, ...o });
// A healthy cohort: 8 peers, all seen within the last night.
const peers = (n = 8, start = 100) => Array.from({ length: n }, (_, i) => store(start + i, 4));

describe('zeroScrapeCutoff', () => {
  it('is three nights back less half a night of grace', () => {
    assert.equal(RUN.getTime() - zeroScrapeCutoff(RUN).getTime(), 60 * 3600_000);
  });
});

describe('classifyZeroScrape', () => {
  it('marks a store unseen for 3+ nights while its cohort is healthy', () => {
    const r = classifyZeroScrape([store(1, 72), ...peers()], { runStart: RUN });
    assert.deepEqual(r.stale, [1]);
  });
  it('leaves a store that missed only two nights alone', () => {
    assert.deepEqual(classifyZeroScrape([store(1, 50), ...peers()], { runStart: RUN }).stale, []);
  });
  it('holds everything when the cohort is mostly unseen (our outage, not dead stores)', () => {
    const dead = Array.from({ length: 8 }, (_, i) => store(200 + i, 90));
    const r = classifyZeroScrape([store(1, 72), ...dead], { runStart: RUN });
    assert.deepEqual(r.stale, []);
    assert.match(r.held[0].reason, /unhealthy/);
  });
  it('holds a store with too few peers to judge', () => {
    const r = classifyZeroScrape([store(1, 72), ...peers(MIN_PEERS - 2)], { runStart: RUN });
    assert.deepEqual(r.stale, []);
    assert.match(r.held[0].reason, /too few peers/);
  });
  it('falls back to the whole box when the make cohort is tiny', () => {
    const otherMakes = Array.from({ length: 8 }, (_, i) => store(300 + i, 4, { make: 'Toyota' }));
    assert.deepEqual(classifyZeroScrape([store(1, 72, { make: 'MINI' }), ...otherMakes], { runStart: RUN }).stale, [1]);
  });
  it('uses the newest sighting across a store\'s makes and skips stores already stale', () => {
    const mixed = [store(1, 72), store(1, 5, { make: 'MINI' }), store(2, 72, { alreadyStale: true }), ...peers()];
    assert.deepEqual(classifyZeroScrape(mixed, { runStart: RUN }).stale, []);
  });
  it('never judges a store on another box by this box\'s peers', () => {
    const r = classifyZeroScrape([store(1, 72, { sourceBox: 'box3' }), ...peers()], { runStart: RUN });
    assert.deepEqual(r.stale, []);
  });
});

describe('request + statement', () => {
  it('requires a runStart and bounds nights', () => {
    assert.equal(parseZeroScrapeRequest({}).ok, false);
    assert.equal(parseZeroScrapeRequest({ runStart: RUN.toISOString(), nights: 1 }).ok, false);
    assert.equal(parseZeroScrapeRequest({ runStart: RUN.toISOString() }).nights, 3);
  });
  it('only ever sets stale_at — never removed_at', () => {
    const { sql } = buildMarkStaleStatement([1, 2], RUN);
    assert.match(sql, /SET stale_at = CURRENT_TIMESTAMP/);
    assert.doesNotMatch(sql, /SET removed_at/);
  });
});

import { inventoryListQuery } from '../src/inventoryListQuery.js';
describe('buyer visibility', () => {
  const sqlFor = (qs) => JSON.stringify(inventoryListQuery(new URLSearchParams(qs)));
  it('in-stock listings hide stale cars by default', () => assert.match(sqlFor('inStock=1&make=BMW'), /stale_at IS NULL/));
  it('the admin sheet opts back in with includeStale=1', () => assert.doesNotMatch(sqlFor('inStock=1&make=BMW&includeStale=1'), /stale_at/));
  it('does not add the filter to a non-in-stock query', () => assert.doesNotMatch(sqlFor('make=BMW'), /stale_at/));
});

describe('aggregateZeroScrape', () => {
  const row = (id, o = {}) => ({ dealerId: id, sourceBox: 'box2', make: 'BMW', lastSeen: '2026-10-09 04:00:00', live: '3', alreadyStale: 0, ...o });
  const fakeRun = (ids, calls = []) => async (sql, args) => {
    calls.push({ sql, args });
    if (sql === ZERO_SCRAPE_DEALER_IDS_SQL) return ids.map((dealer_id) => ({ dealer_id }));
    return args[0].map((id) => row(id));
  };

  it('reads dealer ids first, then batches of perQuery dealers, and never runs a whole-table GROUP BY', async () => {
    const calls = [];
    const stores = await aggregateZeroScrape(fakeRun(Array.from({ length: 60 }, (_, i) => i + 1), calls), { perQuery: 25 });
    assert.equal(calls[0].sql, ZERO_SCRAPE_DEALER_IDS_SQL);
    assert.deepEqual(calls.slice(1).map((c) => c.args[0].length), [25, 25, 10]);
    assert.ok(calls.slice(1).every((c) => c.sql === ZERO_SCRAPE_BATCH_SQL && /dealer_id IN \(\?\)/.test(c.sql)));
    assert.equal(stores.length, 60);
  });

  it('maps rows to numbers and Dates and keeps the stale flag', async () => {
    const [s] = await aggregateZeroScrape(async (sql, args) => (sql === ZERO_SCRAPE_DEALER_IDS_SQL ? [{ dealer_id: '7' }] : [row(7, { live: '12', alreadyStale: '1' })]));
    assert.equal(s.dealerId, 7);
    assert.equal(s.live, 12);
    assert.equal(s.alreadyStale, true);
    assert.ok(s.lastSeen instanceof Date);
  });

  it('works with no dealers', async () => {
    assert.deepEqual(await aggregateZeroScrape(async () => []), []);
  });

  it('gives up with a clear error once the overall budget is spent', async () => {
    let t = 0;
    await assert.rejects(
      aggregateZeroScrape(async (sql, args) => { t += 50_000; return fakeRun([1, 2, 3, 4])(sql, args); }, { now: () => t, perQuery: 1, totalMs: 120_000 }),
      /exceeded 120000ms after \d+ of 4 dealers/,
    );
  });

  it('propagates a failing batch (the handler turns it into an error, nothing is marked)', async () => {
    await assert.rejects(aggregateZeroScrape(async (sql) => { if (sql === ZERO_SCRAPE_BATCH_SQL) throw new Error('max_statement_time exceeded'); return [{ dealer_id: 1 }]; }), /max_statement_time/);
  });
});
