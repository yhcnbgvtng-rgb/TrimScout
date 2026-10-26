// The vPIC step of the make-vs-VIN dry run: batching, local cache, polite rate limiting, failure handling, and how a decoded make resolves shared-WMI rows.
// No network: fetch is injected.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodePrefixes, loadCache, saveCache, prefix8, VPIC_URL } from '../../../scripts/lib/vpicDecode.mjs';
import { summarizeGroups, summarizeVpic } from '../../../scripts/lib/makeWmiReclean.mjs';

const vinFor = (i) => `5TDAA${String(i).padStart(3, '0')}0P0000000`.slice(0, 17); // 5TD = Toyota/Lexus shared range
const items = (n) => Array.from({ length: n }, (_, i) => ({ key8: `5TDAA${String(i).padStart(3, '0')}`, vin: vinFor(i) }));
const okFetch = (makeOf, log) => async (url, init) => {
  const body = new URLSearchParams(init.body); const vins = body.get('data').split(';');
  log.push({ url, method: init.method, vins });
  return { ok: true, json: async () => ({ Results: vins.map((v) => ({ VIN: v, Make: makeOf(v) })) }) };
};
const noSleep = () => Promise.resolve();

describe('decodePrefixes', () => {
  it('posts at most 50 VINs per request, form-encoded, to the batch endpoint, and caches by 8-character prefix', async () => {
    const log = [], cache = { makes: {} }, sleeps = [];
    const r = await decodePrefixes(items(120), cache, { fetchImpl: okFetch(() => 'LEXUS', log), pauseMs: 1500, sleep: async (ms) => { sleeps.push(ms); } });
    assert.deepEqual(log.map((l) => l.vins.length), [50, 50, 20]);
    assert.ok(log.every((l) => l.url === VPIC_URL && l.method === 'POST'));
    assert.equal(r.decoded, 120); assert.equal(r.requests, 3); assert.equal(r.failed, 0);
    assert.equal(cache.makes['5TDAA000'], 'LEXUS');
    assert.deepEqual(sleeps, [1500, 1500]); // a pause between requests, none after the last
    assert.ok(!JSON.stringify(cache).includes(vinFor(0))); // the cache never holds a whole VIN
  });
  it('a cached prefix is not requested again, and the cache file survives a rerun', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpic-')); const file = path.join(dir, 'cache.json');
    const log = [];
    await decodePrefixes(items(3), loadCache(file), { fetchImpl: okFetch(() => 'TOYOTA', log), cachePath: file, sleep: noSleep });
    const again = await decodePrefixes(items(5), loadCache(file), { fetchImpl: okFetch(() => 'TOYOTA', log), cachePath: file, sleep: noSleep });
    assert.equal(again.cached, 3); assert.equal(again.decoded, 2);
    assert.deepEqual(log[1].vins, [vinFor(3), vinFor(4)]);
    assert.equal(Object.keys(loadCache(file).makes).length, 5);
    assert.equal(prefix8(vinFor(0)), '5TDAA000');
  });
  it('duplicate prefixes are decoded once; an answer with no make is cached as "" (not retried)', async () => {
    const log = [], cache = { makes: {} };
    const dup = [...items(2), ...items(2)];
    const r = await decodePrefixes(dup, cache, { fetchImpl: okFetch(() => '', []), sleep: noSleep });
    assert.equal(r.requested, 2); assert.equal(cache.makes['5TDAA000'], '');
    const r2 = await decodePrefixes(items(2), cache, { fetchImpl: okFetch(() => 'X', log), sleep: noSleep });
    assert.equal(r2.requests, 0); assert.equal(log.length, 0);
  });
  it('a failed batch is not cached (a rerun retries it) and three failures in a row stop the run', async () => {
    const cache = { makes: {} }; let calls = 0;
    const r = await decodePrefixes(items(400), cache, { fetchImpl: async () => { calls++; return { ok: false, status: 503, json: async () => ({}) }; }, sleep: noSleep });
    assert.equal(calls, 3); assert.match(r.stopped, /3 failed batches/); assert.deepEqual(cache.makes, {});
    const thrown = await decodePrefixes(items(10), cache, { fetchImpl: async () => { throw new Error('network down'); }, sleep: noSleep });
    assert.equal(thrown.decoded, 0); assert.deepEqual(cache.makes, {});
  });
  it('a failure between good batches does not stop the run', async () => {
    const cache = { makes: {} }; let n = 0; const log = [];
    const good = okFetch(() => 'LEXUS', log);
    const r = await decodePrefixes(items(150), cache, { fetchImpl: async (u, i) => (++n === 2 ? { ok: false, status: 500, json: async () => ({}) } : good(u, i)), sleep: noSleep });
    assert.equal(r.decoded, 100); assert.equal(r.failed, 50); assert.equal(r.stopped, null);
  });
  it('honours the request cap and the deadline hook', async () => {
    const cache = { makes: {} };
    const capped = await decodePrefixes(items(200), cache, { fetchImpl: okFetch(() => 'LEXUS', []), maxRequests: 2, sleep: noSleep });
    assert.equal(capped.requests, 2); assert.match(capped.stopped, /request cap/);
    const late = await decodePrefixes(items(10), { makes: {} }, { fetchImpl: okFetch(() => 'LEXUS', []), shouldStop: () => true, sleep: noSleep });
    assert.equal(late.requests, 0); assert.equal(late.stopped, 'deadline');
  });
  it('a VIN vPIC skips in its answer stays uncached', async () => {
    const cache = { makes: {} };
    const r = await decodePrefixes(items(2), cache, { fetchImpl: async () => ({ ok: true, json: async () => ({ Results: [{ VIN: vinFor(0), Make: 'LEXUS' }] }) }), sleep: noSleep });
    assert.equal(r.decoded, 1); assert.equal(r.failed, 1); assert.ok(!Object.hasOwn(cache.makes, '5TDAA001'));
  });
  it('an unreadable or corrupt cache file starts empty', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vpic-')), 'c.json'); fs.writeFileSync(f, '{nope');
    assert.deepEqual(loadCache(f), { makes: {} }); saveCache(f, { makes: { A: 'B' } }); assert.equal(loadCache(f).makes.A, 'B');
  });
});

describe('summarizeVpic (shared-WMI rows)', () => {
  const subs = [
    { model: 'TX 350', key8: '5TDAA000', n: 10 }, { model: 'Highlander', key8: '5TDKK000', n: 5 },
    { model: 'Rogue', key8: '5TDZZ000', n: 4 }, { model: 'Rogue', key8: '5TDYY000', n: 3 },
  ];
  it('a decoded make inside the WMI family is used; no answer, "" or a make outside the family leaves null', () => {
    const s = summarizeVpic('Nissan', subs, { '5TDAA000': 'LEXUS', '5TDKK000': 'TOYOTA', '5TDZZ000': 'Tesla' });
    assert.equal(s.rowsChecked, 22); assert.equal(s.rowsResolved, 15);
    assert.deepEqual(s.byTarget, { Lexus: 10, Toyota: 5 });
    assert.equal(s.rowsStillNull, 7); assert.equal(s.rowsNotDecoded, 3); // 5TDYY was never decoded; 5TDZZ was decoded outside the family
    assert.deepEqual(s.stillNullByWmi, { '5TD': 7 });
    assert.equal(summarizeVpic('Nissan', [subs[0]], { '5TDAA000': '' }).rowsStillNull, 10);
  });
  it('summarizeGroups hands the null groups to the vPIC step (and only those)', () => {
    const s = summarizeGroups('Nissan', [{ model: 'TX 350', key: '5TDAA', n: 10 }, { model: 'Rogue', key: '1N4AL', n: 4 }, { model: 'Altima', key: 'JTHBK', n: 2 }]);
    assert.deepEqual(s.unresolvedGroups, [{ model: 'TX 350', key: '5TDAA', n: 10 }]);
    assert.equal(s.rowsToNull, 10);
  });
});
