import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyZeroScrape, zeroScrapeCutoff, parseZeroScrapeRequest, buildMarkStaleStatement, MIN_PEERS } from '../src/zeroScrape.js';

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
