import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeHeapGuard, heapGuardRatio, detachStrings, heapReserveBytes, IN_FLIGHT_RESERVE_BYTES, DEFAULT_HEAP_GUARD_RATIO } from '../src/heapGuard.js';
import { heapMbFor, DEFAULT_HEAP_MB, HEAVY_HEAP_MB } from '../scripts/run-daily-crawl.mjs';

const MB = 1048576;
describe('heapGuard', () => {
  it('trips at the ratio of the heap limit and not below', () => {
    let used = 1000 * MB;
    const g = makeHeapGuard({ ratio: 0.85, stats: () => ({ used_heap_size: used, heap_size_limit: 3584 * MB }), minIntervalMs: 0 });
    assert.equal(g.pressured(), false);
    used = 3100 * MB; assert.equal(g.pressured(), true);
    used = 3000 * MB; assert.equal(g.pressured(), false);
    assert.deepEqual(g.snapshot(), { usedMb: 3000, limitMb: 3584, ratio: 0.85, stopAtMb: 3046 });
  });
  it('stops at limit minus the reserve the index save needs (box1: 489 MB index -> ~2.7 GB of 3.5 GB), never below half the limit', () => {
    const at = (usedMb, reserveBytes) => makeHeapGuard({ ratio: 0.85, reserveBytes, stats: () => ({ used_heap_size: usedMb * MB, heap_size_limit: 3584 * MB }), minIntervalMs: 0 });
    const box1 = heapReserveBytes(489 * MB);
    assert.equal(Math.round(box1 / MB), Math.round(489 * 1.25 + 256));
    assert.equal(at(2700, box1).pressured(), false);
    assert.equal(at(2800, box1).pressured(), true, 'trips well before the 85% line, which the index save would not survive');
    assert.equal(at(2800, heapReserveBytes(107 * MB)).pressured(), false, 'box5 (107 MB index) keeps the 85% line');
    assert.equal(at(1700, 3000 * MB).pressured(), false, 'floor: half the limit');
    assert.equal(at(1800, 3000 * MB).pressured(), true);
    assert.equal(heapReserveBytes(0), IN_FLIGHT_RESERVE_BYTES);
    assert.equal(at(2800, box1).snapshot().stopAtMb, Math.round((3584 * MB - box1) / MB));
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

// ---- the crawl half of "excluded from the sold-diff": the real merge, with the set standalone.js fills --------------------------------------------------
import { mergeInventorySnapshot } from '../src/inventory_merge.js';
import { readFileSync } from 'node:fs';

describe('a heap-stopped store in the sold-diff', () => {
  const rec = (vin, dealerName) => ({ vin, dealerName, configDealerName: dealerName, status: 'ACTIVE', price: 1, firstSeen: '2026-11-01', lastSeen: '2026-11-05' });
  const previousSnapshot = {
    H1: rec('H1', 'BIG STORE'), H2: rec('H2', 'BIG STORE'), H3: rec('H3', 'BIG STORE'), // H3 is never read tonight (guard stopped the store)
    D1: rec('D1', 'DONE STORE'), D2: rec('D2', 'DONE STORE'), // D2 is really gone
  };
  const run = (failed) => mergeInventorySnapshot({
    previousSnapshot, currentInventory: new Map([['H1', rec('H1', 'BIG STORE')], ['H2', rec('H2', 'BIG STORE')], ['D1', rec('D1', 'DONE STORE')]]),
    dealers: [{ name: 'BIG STORE' }, { name: 'DONE STORE' }], failedDealerNames: new Set(failed), todayDate: '2026-11-06', todayIso: '2026-11-06T10:00:00Z',
  });
  it('flagged as failed: the unread car stays ACTIVE and unsold, the completed store still sells its gone car, read cars are saved', () => {
    const r = run(['BIG STORE']);
    assert.equal(r.updatedSnapshot.H3.status, 'ACTIVE');
    assert.deepEqual(r.soldVehicles.map((v) => v.vin), ['D2']);
    assert.ok(r.updatedSnapshot.H1 && r.updatedSnapshot.H2 && r.updatedSnapshot.D1);
  });
  it('not flagged (what would happen without the flag): the unread car is wrongly marked sold', () => {
    assert.deepEqual(run([]).soldVehicles.map((v) => v.vin).sort(), ['D2', 'H3']);
  });
  it('standalone.js adds the store to failedDealerNames in the heap-stop branch, after the retry-recovery delete, and resets the flag per store', () => {
    const src = readFileSync(new URL('../src/standalone.js', import.meta.url), 'utf8');
    const branch = src.slice(src.indexOf('if (heapStopped) {'));
    assert.match(branch.slice(0, 700), /failedDealerNames\.add\(dealer\.name\)/);
    assert.ok(src.indexOf('failedDealerNames.delete(dealer.name)') < src.indexOf('if (heapStopped) {'), 'the retry-pass delete runs BEFORE the heap flag, so the flag wins');
    assert.match(src, /heapStopped = false;/);
  });
});
