import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeHeapGuard, heapGuardRatio, detachStrings, DEFAULT_HEAP_GUARD_RATIO } from '../src/heapGuard.js';
import { heapMbFor, DEFAULT_HEAP_MB, HEAVY_HEAP_MB } from '../scripts/run-daily-crawl.mjs';

const MB = 1048576;
describe('heapGuard', () => {
  it('trips at the ratio of the heap limit and not below', () => {
    let used = 1000 * MB;
    const g = makeHeapGuard({ ratio: 0.85, stats: () => ({ used_heap_size: used, heap_size_limit: 3584 * MB }), minIntervalMs: 0 });
    assert.equal(g.pressured(), false);
    used = 3100 * MB; assert.equal(g.pressured(), true);
    used = 3000 * MB; assert.equal(g.pressured(), false);
    assert.deepEqual(g.snapshot(), { usedMb: 3000, limitMb: 3584, ratio: 0.85 });
  });
  it('reads heap statistics at most once per interval', () => {
    let calls = 0, t = 0;
    const g = makeHeapGuard({ ratio: 0.5, stats: () => { calls++; return { used_heap_size: 900, heap_size_limit: 1000 }; }, minIntervalMs: 500, now: () => t });
    for (let i = 0; i < 50; i++) g.pressured();
    assert.equal(calls, 1);
    t = 600; g.pressured(); assert.equal(calls, 2);
  });
  it('ratio 0 turns it off; bad env values fall back to the default', () => {
    const g = makeHeapGuard({ ratio: 0, stats: () => ({ used_heap_size: 999, heap_size_limit: 1000 }), minIntervalMs: 0 });
    assert.equal(g.pressured(), false);
    assert.equal(heapGuardRatio({ CRAWLER_HEAP_GUARD_RATIO: '0' }), 0);
    assert.equal(heapGuardRatio({ CRAWLER_HEAP_GUARD_RATIO: '0.9' }), 0.9);
    for (const bad of ['abc', '1.5', '-1', '1']) assert.equal(heapGuardRatio({ CRAWLER_HEAP_GUARD_RATIO: bad }), DEFAULT_HEAP_GUARD_RATIO);
    assert.equal(heapGuardRatio({}), DEFAULT_HEAP_GUARD_RATIO);
  });
  it('detachStrings keeps values, Dates and undefined, and returns uncloneable input as is', () => {
    const v = { vin: 'X', d: new Date(5), n: null, u: undefined, o: ['a', 'b'] };
    const c = detachStrings(v);
    assert.notEqual(c, v);
    assert.deepEqual(c, v);
    const f = { fn() {} };
    assert.equal(detachStrings(f), f);
  });
  it('detachStrings releases the page a captured substring came from', { skip: typeof global.gc !== 'function' && 'run with --expose-gc' }, () => {
    const keep = []; const kept = [];
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 40; i++) {
      const page = `<html>${'x'.repeat(2_000_000)}<b>${'desc'.repeat(10)}${i}</b></html>`;
      const slice = page.slice(page.indexOf('<b>'), page.indexOf('</b>')); // a sliced string pinning the 2 MB page
      keep.push({ slice }); kept.push(detachStrings({ slice }));
    }
    keep.length = 0; global.gc();
    assert.ok(process.memoryUsage().heapUsed - before < 20 * MB, 'cloned records must not pin the pages');
  });
});

describe('heap sizing extra runs', () => {
  it('CRAWLER_HEAVY_HEAP_EXTRA adds runs, case-insensitive, ignores junk', () => {
    assert.equal(heapMbFor('MD', 'nissan'), DEFAULT_HEAP_MB);
    process.env.CRAWLER_HEAVY_HEAP_EXTRA = 'md:Nissan, FL:infiniti,bad entry';
    try {
      assert.equal(heapMbFor('MD', 'Nissan'), HEAVY_HEAP_MB);
      assert.equal(heapMbFor('fl', 'INFINITI'), HEAVY_HEAP_MB);
      assert.equal(heapMbFor('MD', 'honda'), DEFAULT_HEAP_MB);
    } finally { delete process.env.CRAWLER_HEAVY_HEAP_EXTRA; }
    assert.equal(heapMbFor('FL', 'gmc'), HEAVY_HEAP_MB);
  });
});
