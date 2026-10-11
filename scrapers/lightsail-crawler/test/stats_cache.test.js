import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStatsCache, STATS_CACHE_MS } from '../src/statsCache.js';

const quiet = { log() {}, error() {} };

describe('stats cache', () => {
  it('is a 30-minute cache', () => assert.equal(STATS_CACHE_MS, 30 * 60_000));

  it('computes once inside the window, however many page loads', async () => {
    let t = 0, runs = 0;
    const get = createStatsCache({ now: () => t, log: quiet });
    const compute = async () => ++runs;
    assert.equal(await get('analytics:{}', compute), 1);
    t = 29 * 60_000;
    assert.equal(await get('analytics:{}', compute), 1);
    assert.equal(runs, 1);
  });

  it('serves the stale copy at once after 30 min and refreshes in the background', async () => {
    let t = 0, runs = 0, release;
    const gate = new Promise((r) => { release = r; });
    const get = createStatsCache({ now: () => t, log: quiet });
    await get('k', async () => ++runs);
    t = 31 * 60_000;
    const served = await get('k', async () => { runs++; await gate; return 'fresh'; });
    assert.equal(served, 1, 'caller is not made to wait on the scan');
    assert.equal(runs, 2);
    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(await get('k', async () => 'never'), 'fresh');
  });

  it('keeps the old copy when the refresh fails', async () => {
    let t = 0;
    const get = createStatsCache({ now: () => t, log: quiet });
    await get('k', async () => 'old');
    t = 40 * 60_000;
    assert.equal(await get('k', async () => { throw new Error('boom'); }), 'old');
  });

  it('caps filtered keys so the persisted file stays small', async () => {
    const get = createStatsCache({ log: quiet });
    for (let i = 0; i < 60; i++) await get(`analytics:${i}`, async () => i);
    let runs = 0;
    await get('analytics:0', async () => ++runs);
    assert.equal(runs, 1, 'the oldest key was evicted');
  });
});

// deals_api_server.js starts a server on import, so pin the wiring in its source.
describe('deals_api_server.js wiring', () => {
  const src = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');
  it('serves the MEDIAN payloads from statsCached, not the write-invalidated invCached', () => {
    assert.match(src, /statsCached\(key, \(\) => computeInventoryAnalytics\(pool, f\)\)/);
    assert.match(src, /statsCached\(cacheKey, \(\) => computeMarketPulse\(pool, state \|\| null\)\)/);
    assert.doesNotMatch(src, /invCached\([^)]*computeInventoryAnalytics/);
    assert.doesNotMatch(src, /invCached\([^)]*computeMarketPulse/);
  });
  it('statsCached is not cleared by invInvalidate', () => {
    const body = src.match(/const invInvalidate = \(\) => \{[\s\S]*?\n\};/)[0];
    assert.doesNotMatch(body, /stats/i);
  });
});
