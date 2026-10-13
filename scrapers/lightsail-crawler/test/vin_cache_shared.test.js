// Crawl-box half of the shared VIN cache: pull merges other boxes' lookups into the state cache that #496's top-up reads; push
// sends only what appeared during the job; both are best-effort and incremental.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeVinCacheSync } from '../src/vinCacheShared.js';
import { makeVinCache } from '../src/crawlQueueServer.js';
import { cacheShardPath } from '../src/inventory_shards.js';
import { seedCacheFromLegacy } from '../src/enricher.js';
import { writeJsonLarge, readJsonLarge } from '../src/bigJson.js';

const V = (i) => `1FT${String(i).padStart(14, '0')}`;
const E = (n) => ({ nhtsa: { Make: 'FORD', n } });

// A request() that talks to a real server-side VinCache instance in-process.
function wire(serverDir) {
  const server = makeVinCache(serverDir);
  const calls = [];
  const request = async ({ method = 'POST', path: p, body, raw }) => {
    calls.push(`${method} ${p.split('?')[0]}`);
    if (p.startsWith('/api/ops/vin-cache/pull')) {
      const u = new URL(`http://x${p}`);
      const r = await server.pull({ state: u.searchParams.get('state'), from: Number(u.searchParams.get('from')), max: 400 });
      return { text: r.body, headers: { 'x-next-offset': String(r.nextOffset), 'x-eof': r.eof ? '1' : '0' } };
    }
    if (p === '/api/ops/vin-cache/push') return server.push(body);
    throw new Error(`unexpected ${p}`);
  };
  return { server, request, calls };
}

describe('vin cache sync (crawl box)', () => {
  it('pull merges the shared entries into the state-wide cache file that the enricher\'s legacy top-up reads, keeping local entries', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-'));
    const w = wire(fs.mkdtempSync(path.join(os.tmpdir(), 'vcsrv-')));
    await w.server.push({ state: 'TX', entries: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [V(i), E(i)])) });
    await fs.promises.mkdir(path.dirname(cacheShardPath('TX', cwd)), { recursive: true });
    await writeJsonLarge(cacheShardPath('TX', cwd), { [V(0)]: E('local-wins') });
    const sync = makeVinCacheSync({ cwd, request: w.request, log: () => {} });
    const r = await sync.pullState('TX');
    assert.equal(r.entries, 20);
    const legacy = await readJsonLarge(cacheShardPath('TX', cwd));
    assert.equal(Object.keys(legacy).length, 20);
    assert.equal(legacy[V(0)].nhtsa.n, 'local-wins');
    assert.ok(w.calls.filter((c) => c.startsWith('GET')).length > 1, 'paged through several windows');
    // #496's own top-up now finds them without any change to the enricher
    const cache = {};
    const seeded = await seedCacheFromLegacy({ cache, vehicles: Array.from({ length: 30 }, (_, i) => ({ vin: V(i) })), readLegacy: () => readJsonLarge(cacheShardPath('TX', cwd)) });
    assert.equal(seeded.readLegacy, true);
    assert.equal(Object.keys(cache).length, 20);
  });
  it('is incremental: the second pull fetches only what was added since', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-'));
    const w = wire(fs.mkdtempSync(path.join(os.tmpdir(), 'vcsrv-')));
    await w.server.push({ state: 'OH', entries: { [V(1)]: E(1), [V(2)]: E(2) } });
    const sync = makeVinCacheSync({ cwd, request: w.request, log: () => {} });
    assert.equal((await sync.pullState('OH')).entries, 2);
    await w.server.push({ state: 'OH', entries: { [V(3)]: E(3) } });
    const sync2 = makeVinCacheSync({ cwd, request: w.request, log: () => {} }); // a later job/night: new process, offset kept on disk
    const r = await sync2.pullState('OH');
    assert.equal(r.entries, 1);
    assert.equal(r.merged, 1);
  });
  it('concurrent jobs of one state share a single pull', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-'));
    const w = wire(fs.mkdtempSync(path.join(os.tmpdir(), 'vcsrv-')));
    await w.server.push({ state: 'OH', entries: { [V(1)]: E(1) } });
    const sync = makeVinCacheSync({ cwd, request: w.request, log: () => {} });
    const [a, b] = await Promise.all([sync.pullState('OH'), sync.pullState('OH')]);
    assert.equal(a, b);
    assert.equal(w.calls.filter((c) => c.startsWith('GET')).length, 1);
  });
  it('push sends only lookups that appeared during the job, in chunks, and a re-send of pulled entries adds nothing server-side', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-'));
    const w = wire(fs.mkdtempSync(path.join(os.tmpdir(), 'vcsrv-')));
    await fs.promises.mkdir(path.dirname(cacheShardPath('TX', cwd, 'Ford')), { recursive: true });
    await writeJsonLarge(cacheShardPath('TX', cwd, 'Ford'), { [V(1)]: E(1), [V(2)]: E(2) });
    const sync = makeVinCacheSync({ cwd, request: w.request, log: () => {}, pushChunk: 2 });
    const before = await sync.snapshotBrand('TX', 'Ford');
    assert.equal(before.size, 2);
    await writeJsonLarge(cacheShardPath('TX', cwd, 'Ford'), { [V(1)]: E(1), [V(2)]: E(2), ...Object.fromEntries([3, 4, 5].map((i) => [V(i), E(i)])), [V(6)]: { noNhtsa: true } });
    const p = await sync.pushNew('TX', 'Ford', before);
    assert.deepEqual({ candidates: p.candidates, sent: p.sent }, { candidates: 3, sent: 3 });
    assert.equal(w.calls.filter((c) => c.startsWith('POST')).length, 2); // 3 entries in chunks of 2
    const again = await sync.pushNew('TX', 'Ford', before);
    assert.equal(again.sent, 0);
    assert.equal(again.duplicate, 3);
  });
  it('a missing shard cache file is an empty snapshot, and any server trouble is swallowed (best-effort)', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-'));
    const logs = [];
    const sync = makeVinCacheSync({ cwd, request: async () => { throw new Error('box2 down'); }, log: (m) => logs.push(m) });
    assert.equal((await sync.snapshotBrand('TX', 'Ford')).size, 0);
    assert.equal((await sync.pullState('TX')).error, 'box2 down');
    assert.equal((await sync.pushNew('TX', 'Ford', new Set())).error !== undefined, true);
    assert.equal(logs.length, 2);
  });
});
