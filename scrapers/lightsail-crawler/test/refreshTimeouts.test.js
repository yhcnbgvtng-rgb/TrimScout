// Background facet-cache refreshes get 120s; a buyer's request keeps 20s / 45s (src/refreshTimeouts.js, src/stableCache.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRefreshTimeouts, BACKGROUND_STATEMENT_SECONDS, BACKGROUND_WAIT_MS } from '../src/refreshTimeouts.js';
import { createStableCache } from '../src/stableCache.js';

const quiet = { log() {}, error() {} };
const mk = () => createRefreshTimeouts({ interactiveSeconds: 20, interactiveWaitMs: 45_000 });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('refresh timeouts', () => {
  it('a buyer request gets 20s on the statement and 45s on the connection wait; a background refresh gets 120s / 150s', async () => {
    const t = mk();
    assert.equal(BACKGROUND_STATEMENT_SECONDS, 120);
    assert.ok(BACKGROUND_WAIT_MS > BACKGROUND_STATEMENT_SECONDS * 1000, 'the wait must outlast the statement');
    assert.deepEqual([t.statementSeconds(), t.waitMs()], [20, 45_000]);
    const inside = await t.runBackground(async () => { await tick(); return [t.statementSeconds(), t.waitMs()]; });
    assert.deepEqual(inside, [120, BACKGROUND_WAIT_MS], 'carried across awaits');
    assert.deepEqual([t.statementSeconds(), t.waitMs()], [20, 45_000], 'and gone again afterwards');
  });
  it('a buyer request that runs WHILE a background refresh is in flight still gets 20s', async () => {
    const t = mk();
    const seen = [];
    const bg = t.runBackground(async () => { await tick(20); seen.push(['bg', t.statementSeconds()]); });
    await tick(5);
    seen.push(['buyer', t.statementSeconds()]);
    await bg;
    assert.deepEqual(seen, [['buyer', 20], ['bg', 120]]);
  });
});

describe('stable cache: only the background refresh of an expired entry uses the long budget', () => {
  it('cold key = a buyer is waiting (interactive); expired key = background (long); fresh key = no compute', async () => {
    const t = mk();
    let clock = 0;
    const cache = createStableCache({ ttlMs: 1000, now: () => clock, log: quiet, runBackground: t.runBackground });
    const budgets = [];
    const compute = async () => { await tick(); budgets.push(t.statementSeconds()); return { n: budgets.length }; };
    assert.deepEqual(await cache.get('k', compute), { n: 1 });   // cold: the caller waits for this
    assert.deepEqual(await cache.get('k', compute), { n: 1 });   // fresh
    clock = 5000;
    assert.deepEqual(await cache.get('k', compute), { n: 1 });   // expired: stale copy returned at once ...
    await tick(30);                                              // ... refresh finishes in the background
    assert.deepEqual(budgets, [20, 120]);
    assert.deepEqual(await cache.get('k', compute), { n: 2 });
  });
  it('without a runBackground hook nothing changes (old behaviour)', async () => {
    const cache = createStableCache({ ttlMs: 10, now: () => 100, log: quiet });
    cache.peek('x');
    assert.deepEqual(await cache.get('x', async () => 7), 7);
  });
});

describe('wiring in deals_api_server.js', () => {
  const src = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');
  it('the timeouts helper exists before the stable cache is built (it is passed in at construction), and the cache gets runBackground', () => {
    assert.ok(src.indexOf('createRefreshTimeouts({') < src.indexOf('createStableCache({'), 'declared first, or runBackground is in its temporal dead zone');
    assert.match(src, /const stableCached = createStableCache\(\{\s*runBackground,/);
  });
  it('no query site reads the fixed constants any more — they all go through the budget helpers', () => {
    assert.doesNotMatch(src, /max_statement_time=\$\{INV_LIST_STATEMENT_TIMEOUT_SECONDS\}/);
    assert.doesNotMatch(src, /^\s+POOL_WAIT_TIMEOUT_MS,$/m);
    assert.ok((src.match(/max_statement_time=\$\{statementSeconds\(\)\}/g) || []).length >= 10);
    assert.match(src, /INV_LIST_STATEMENT_TIMEOUT_SECONDS = INTERACTIVE_STATEMENT_SECONDS/, 'the interactive value is still 20');
    assert.match(src, /INTERACTIVE_STATEMENT_SECONDS = 20;/);
  });
});
