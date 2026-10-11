import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStableCache, builtForOtherBuild } from '../src/stableCache.js';

const quiet = { log() {}, error() {} };
const tick = () => new Promise((r) => setImmediate(r));

describe('createStableCache — stale-while-revalidate', () => {
  it('serves a fresh entry without recomputing', async () => {
    let t = 0, calls = 0;
    const c = createStableCache({ ttlMs: 1000, now: () => t, log: quiet });
    const compute = async () => ++calls;
    assert.equal(await c.get('k', compute), 1);
    t = 500;
    assert.equal(await c.get('k', compute), 1);
    assert.equal(calls, 1);
  });

  it('an expired entry is returned immediately while one background refresh runs', async () => {
    let t = 0, calls = 0, release;
    const c = createStableCache({ ttlMs: 1000, now: () => t, log: quiet });
    await c.get('k', async () => 'old');
    t = 5000;
    const slow = () => { calls++; return new Promise((r) => { release = () => r('new'); }); };
    assert.equal(await c.get('k', slow), 'old');      // not blocked on the slow refresh
    assert.equal(await c.get('k', slow), 'old');      // second caller does not start a second refresh
    assert.equal(calls, 1);
    release(); await tick();
    assert.equal(await c.get('k', slow), 'new');
  });

  it('keeps serving the stale value when the refresh fails (the box timing out under writes)', async () => {
    let t = 0;
    const c = createStableCache({ ttlMs: 1000, now: () => t, log: quiet });
    await c.get('k', async () => 'good');
    t = 9999;
    const failing = async () => { throw new Error('max_statement_time exceeded'); };
    assert.equal(await c.get('k', failing), 'good');
    await tick();
    assert.equal(await c.get('k', failing), 'good');
  });

  it('a cold miss waits for the compute and surfaces its error (nothing honest to serve)', async () => {
    const c = createStableCache({ ttlMs: 1000, log: quiet });
    await assert.rejects(c.get('k', async () => { throw new Error('timeout'); }), /timeout/);
    assert.equal(await c.get('k', async () => 'ok'), 'ok');
  });

  it('dedupes concurrent cold misses on the same key', async () => {
    let calls = 0;
    const c = createStableCache({ ttlMs: 1000, log: quiet });
    const compute = async () => { calls++; await tick(); return 'v'; };
    assert.deepEqual(await Promise.all([c.get('k', compute), c.get('k', compute), c.get('k', compute)]), ['v', 'v', 'v']);
    assert.equal(calls, 1);
  });

  it('survives a restart: persisted entries are loaded by a new instance', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stable-')), 'cache.json');
    const a = createStableCache({ ttlMs: 1000, filePath: file, log: quiet });
    await a.get('makes', async () => [{ make: 'Ford', n: 5 }]);
    await new Promise((r) => setTimeout(r, 2300)); // debounce flush
    const b = createStableCache({ ttlMs: 1000, filePath: file, now: () => Date.now() + 99999, log: quiet });
    let recomputed = false;
    const v = await b.get('makes', async () => { recomputed = true; throw new Error('box too busy'); });
    assert.deepEqual(v, [{ make: 'Ford', n: 5 }]);   // stale-but-real beats an error
    await tick();
    assert.equal(recomputed, true);                    // and it still tried to refresh
  });

  it('is bounded: the oldest entry is dropped past maxEntries', async () => {
    const c = createStableCache({ ttlMs: 1000, maxEntries: 2, log: quiet });
    for (const k of ['a', 'b', 'c']) await c.get(k, async () => k);
    assert.equal(c.peek('a'), null);
    assert.equal(c.stats().entries, 2);
  });

  it('ignores a corrupt cache file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stable-')), 'cache.json');
    fs.writeFileSync(file, '{not json');
    assert.equal(createStableCache({ ttlMs: 1, filePath: file, log: quiet }).stats().entries, 0);
  });
});

describe('createStableCache — entries built from an older facet build', () => {
  const OLD = '2026-10-10T15:45:46.355Z', NEW = '2026-10-11T00:53:33.974Z';
  const make = (extra = {}) => {
    let build = OLD, t = 0;
    const c = createStableCache({ ttlMs: 10 * 60_000, now: () => t, log: quiet, isOutdated: (v) => builtForOtherBuild(v, build), ...extra });
    return { c, setBuild: (b) => { build = b; }, setNow: (n) => { t = n; } };
  };

  it('a fresh entry from the CURRENT build is served as before, without recomputing', async () => {
    const { c } = make(); let calls = 0;
    const compute = async () => ({ countsAsOf: OLD, n: ++calls });
    await c.get('k', compute);
    assert.equal((await c.get('k', compute)).n, 1);
    assert.equal(calls, 1);
  });

  it('after a rebuild, an entry from the old build is expired at once (inside the ttl) and the caller gets the refreshed value', async () => {
    const { c, setBuild } = make(); let build = OLD;
    const compute = async () => ({ countsAsOf: build, junk: build === OLD });
    assert.equal((await c.get('k', compute)).junk, true);
    setBuild(NEW); build = NEW; // the rebuild finished; the entry is only seconds old
    const v = await c.get('k', compute);
    assert.deepEqual(v, { countsAsOf: NEW, junk: false });
    assert.deepEqual(await c.get('k', async () => { throw new Error('should be cached now'); }), { countsAsOf: NEW, junk: false });
  });

  it('a refresh slower than outdatedWaitMs does not hold the caller: the old copy is served, the refresh still lands', async () => {
    const { c, setBuild } = make({ outdatedWaitMs: 20 }); let release; let build = OLD;
    const compute = () => (build === OLD ? Promise.resolve({ countsAsOf: OLD }) : new Promise((r) => { release = () => r({ countsAsOf: NEW }); }));
    await c.get('k', compute);
    setBuild(NEW); build = NEW;
    assert.equal((await c.get('k', compute)).countsAsOf, OLD, 'served the old copy after the short wait');
    release(); await tick(); await tick();
    assert.equal((await c.get('k', compute)).countsAsOf, NEW);
  });

  it('a failing refresh keeps serving the old copy', async () => {
    const { c, setBuild } = make();
    await c.get('k', async () => ({ countsAsOf: OLD }));
    setBuild(NEW);
    assert.equal((await c.get('k', async () => { throw new Error('db timeout'); })).countsAsOf, OLD);
  });

  it('payloads without a countsAsOf stamp, and an unknown current build, are never outdated', () => {
    assert.equal(builtForOtherBuild({ options: [] }, NEW), false);
    assert.equal(builtForOtherBuild(null, NEW), false);
    assert.equal(builtForOtherBuild({ countsAsOf: OLD }, null), false);
    assert.equal(builtForOtherBuild({ countsAsOf: 'garbage' }, NEW), false);
  });

  it('compares instants, not spellings: a Date in memory equals the ISO string loaded after a restart', () => {
    assert.equal(builtForOtherBuild({ countsAsOf: NEW }, new Date(NEW)), false);
    assert.equal(builtForOtherBuild({ countsAsOf: new Date(NEW) }, NEW), false);
    assert.equal(builtForOtherBuild({ countsAsOf: OLD }, new Date(NEW)), true);
  });

  it('without isOutdated nothing changes (the other users of the cache)', async () => {
    let t = 0, calls = 0;
    const c = createStableCache({ ttlMs: 1000, now: () => t, log: quiet });
    const compute = async () => ({ countsAsOf: calls++ ? NEW : OLD });
    await c.get('k', compute); t = 500;
    assert.equal((await c.get('k', compute)).countsAsOf, OLD);
    assert.equal(calls, 1);
  });
});
