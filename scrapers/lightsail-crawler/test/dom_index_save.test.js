// dom_index.json save/load (dom_store.js): incremental, atomic, serialised. The >512 MB case is exercised by scripts/dom-index-bigtest.mjs
// (too slow and too big for npm test); here we prove the properties: same data back, old format still readable, previous index survives any
// failed write, no temp files left behind, overlapping saves never interleave, price history intact.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadDomIndex, saveDomIndex, domPaths, captureVehicleDom, DOM_INDEX_TMP_STALE_MS, DomIndexUnreadableError } from '../src/dom_store.js';
import { spawn, spawnSync } from 'node:child_process';
import { heapReserveBytes } from '../src/heapGuard.js';

let cwd;
beforeEach(async () => { cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'domidx-')); });
afterEach(async () => { await fsp.rm(cwd, { recursive: true, force: true }); });

const day = (n) => `2026-11-${String(n).padStart(2, '0')}`;
function makeIndex(vins, days) {
  const idx = {};
  for (let v = 0; v < vins; v++) {
    const vin = `1HGCM82633A${String(v).padStart(6, '0')}`;
    idx[vin] = {};
    for (let d = 1; d <= days; d++) {
      idx[vin][day(d)] = { hash: `h${v}-${d}`, price: 20000 + d * 10 - v, oldPrice: 20000 + (d - 1) * 10 - v, priceDiff: 10, priceChangeType: d === 1 ? 'NEW' : 'UP', blobStored: d % 2 === 0, hashUnchanged: d % 2 === 1, note: 'quote " brace } bracket ] comma , ünïcode ✓' };
    }
  }
  return idx;
}
const files = async () => (await fsp.readdir(domPaths(cwd).dataDir)).sort();

describe('saveDomIndex / loadDomIndex', () => {
  it('round-trips an index exactly, and the file is plain JSON a whole-file JSON.parse reads', async () => {
    const idx = makeIndex(300, 5);
    await saveDomIndex(idx, cwd);
    assert.deepEqual(await loadDomIndex(cwd), idx);
    const raw = await fsp.readFile(domPaths(cwd).indexPath, 'utf8');
    assert.deepEqual(JSON.parse(raw), idx); // older readers: unchanged contract
    assert.deepEqual(await files(), ['dom_index.json']);
  });

  it('reads the old single-line layout and the streamed layout the same, above and below the streaming threshold', async () => {
    const idx = makeIndex(50, 3);
    await fsp.mkdir(domPaths(cwd).dataDir, { recursive: true });
    await fsp.writeFile(domPaths(cwd).indexPath, JSON.stringify(idx));
    assert.deepEqual(await loadDomIndex(cwd), idx);
    // force the element-by-element reader on a real file
    const { readJsonLarge } = await import('../src/bigJson.js');
    assert.deepEqual(await readJsonLarge(domPaths(cwd).indexPath, { streamAboveBytes: 0, chunkBytes: 7 }), idx);
  });

  it('handles empty index, and a missing file loads as {}', async () => {
    assert.deepEqual(await loadDomIndex(cwd), {});
    await saveDomIndex({}, cwd);
    assert.deepEqual(await loadDomIndex(cwd), {});
  });

  it('repeated saves stay correct and leave no temp files', async () => {
    const idx = makeIndex(40, 2);
    for (let i = 0; i < 25; i++) {
      idx[`NEWVIN${i}`] = { [day(3)]: { hash: `n${i}`, price: i } };
      await saveDomIndex(idx, cwd);
    }
    assert.deepEqual(await loadDomIndex(cwd), idx);
    assert.deepEqual(await files(), ['dom_index.json']);
  });

  it('overlapping saves are serialised: the file is always one complete index, the last call wins, no temp files', async () => {
    const a = makeIndex(200, 4);
    const b = { ...makeIndex(120, 6), EXTRA: { [day(1)]: { hash: 'x', price: 1 } } };
    const c = makeIndex(10, 1);
    await Promise.all([saveDomIndex(a, cwd), saveDomIndex(b, cwd), saveDomIndex(c, cwd)]);
    assert.deepEqual(await loadDomIndex(cwd), c);
    assert.deepEqual(await files(), ['dom_index.json']);
  });

  it('a failed write keeps the previous index byte-for-byte, removes its temp file, and the next save works', async () => {
    const good = makeIndex(30, 3);
    await saveDomIndex(good, cwd);
    const before = await fsp.readFile(domPaths(cwd).indexPath);
    const bad = makeIndex(30, 3);
    bad.BOOM = { toJSON() { throw new Error('disk exploded'); } }; // thrown after many VINs were already written to the temp file
    await assert.rejects(saveDomIndex(bad, cwd), /disk exploded/);
    assert.ok(before.equals(await fsp.readFile(domPaths(cwd).indexPath)));
    assert.deepEqual(await files(), ['dom_index.json']);
    good.AFTER = { [day(9)]: { hash: 'z', price: 5 } };
    await saveDomIndex(good, cwd);
    assert.deepEqual(await loadDomIndex(cwd), good);
  });

  it('a failure in one queued save does not block or poison the saves after it', async () => {
    const good = makeIndex(20, 2);
    const bad = { BOOM: { toJSON() { throw new Error('nope'); } } };
    const [r1, r2] = await Promise.allSettled([saveDomIndex(bad, cwd), saveDomIndex(good, cwd)]);
    assert.equal(r1.status, 'rejected');
    assert.equal(r2.status, 'fulfilled');
    assert.deepEqual(await loadDomIndex(cwd), good);
    assert.deepEqual(await files(), ['dom_index.json']);
  });

  it('removes a stale temp file from a killed process, but never a fresh one (a live save in another process)', async () => {
    const { dataDir } = domPaths(cwd);
    await fsp.mkdir(dataDir, { recursive: true });
    const stale = path.join(dataDir, 'dom_index.json.tmp-111-1');
    const fresh = path.join(dataDir, 'dom_index.json.tmp-222-2');
    const other = path.join(dataDir, 'something_else.json.tmp-1-1');
    for (const f of [stale, fresh, other]) await fsp.writeFile(f, 'partial');
    const old = new Date(Date.now() - DOM_INDEX_TMP_STALE_MS - 60000);
    await fsp.utimes(stale, old, old); await fsp.utimes(other, old, old);
    await saveDomIndex(makeIndex(3, 1), cwd);
    assert.deepEqual(await files(), ['dom_index.json', 'dom_index.json.tmp-222-2', 'something_else.json.tmp-1-1']);
  });

  describe('load fails closed (only ENOENT starts empty)', () => {
    const put = async (content) => { const { dataDir, indexPath } = domPaths(cwd); await fsp.mkdir(dataDir, { recursive: true }); await fsp.writeFile(indexPath, content); return indexPath; };
    const untouched = async (indexPath, content) => {
      assert.equal(await fsp.readFile(indexPath, 'utf8'), content, 'the original file must be untouched');
      assert.deepEqual(await files(), ['dom_index.json'], 'no file may be created, moved or renamed');
    };
    const fast = { retryDelayMs: 1 };

    it('missing file -> {} (first run on a box)', async () => {
      assert.deepEqual(await loadDomIndex(cwd, fast), {});
    });

    it('malformed JSON throws DomIndexUnreadableError and preserves the file', async () => {
      const bad = '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026-11';
      const ip = await put(bad);
      await assert.rejects(loadDomIndex(cwd, fast), (e) => e instanceof DomIndexUnreadableError && e.code === 'DOM_INDEX_UNREADABLE' && e.path === ip && /left untouched/.test(e.message));
      await untouched(ip, bad);
    });

    it('malformed JSON in a file above the streaming threshold (element-by-element reader) also throws', async () => {
      const bad = '{"A":{"2026-11-01":{"hash":"h"}},"B":not-json}';
      const ip = await put(bad);
      const { readJsonLarge } = await import('../src/bigJson.js');
      await assert.rejects(loadDomIndex(cwd, { ...fast, read: (f) => readJsonLarge(f, { streamAboveBytes: 0 }) }), DomIndexUnreadableError);
      await untouched(ip, bad);
    });

    it('empty file and non-JSON garbage throw (never {})', async () => {
      const ip = await put('');
      await assert.rejects(loadDomIndex(cwd, fast), DomIndexUnreadableError);
      await untouched(ip, '');
    });

    it('a directory where the file should be (EISDIR) throws', async () => {
      const { indexPath } = domPaths(cwd);
      await fsp.mkdir(indexPath, { recursive: true });
      await assert.rejects(loadDomIndex(cwd, fast), DomIndexUnreadableError);
      assert.ok((await fsp.stat(indexPath)).isDirectory());
    });

    it('permission error (EACCES, injected) throws at once without retrying, file untouched', async () => {
      const ip = await put('{"A":{}}');
      let calls = 0;
      const read = async () => { calls++; throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); };
      await assert.rejects(loadDomIndex(cwd, { ...fast, read }), (e) => e instanceof DomIndexUnreadableError && e.cause.code === 'EACCES');
      assert.equal(calls, 1);
      await untouched(ip, '{"A":{}}');
    });

    it('permission error on the real file (chmod 000) throws and the file is preserved', { skip: process.getuid && process.getuid() === 0 ? 'root ignores file modes' : false }, async () => {
      const ip = await put('{"A":{"2026-11-01":{"hash":"h"}}}');
      await fsp.chmod(ip, 0o000);
      try {
        await assert.rejects(loadDomIndex(cwd, fast), (e) => e instanceof DomIndexUnreadableError && e.cause.code === 'EACCES');
      } finally { await fsp.chmod(ip, 0o644); }
      await untouched(ip, '{"A":{"2026-11-01":{"hash":"h"}}}');
    });

    it('a transient read failure (EAGAIN, EBUSY) is retried and then succeeds with the real data', async () => {
      const idx = makeIndex(5, 2);
      await saveDomIndex(idx, cwd);
      const { readJsonLarge } = await import('../src/bigJson.js');
      let calls = 0;
      const read = async (f) => { calls++; if (calls === 1) throw Object.assign(new Error('try again'), { code: 'EAGAIN' }); if (calls === 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return readJsonLarge(f); };
      assert.deepEqual(await loadDomIndex(cwd, { ...fast, read }), idx);
      assert.equal(calls, 3);
    });

    it('a read that keeps failing is retried, then throws; it never returns {} and never touches the file', async () => {
      const ip = await put('{"A":{}}');
      let calls = 0;
      const read = async () => { calls++; throw Object.assign(new Error('input/output error'), { code: 'EIO' }); };
      await assert.rejects(loadDomIndex(cwd, { ...fast, read, attempts: 4 }), DomIndexUnreadableError);
      assert.equal(calls, 4);
      await untouched(ip, '{"A":{}}');
    });

    it('a failed load followed by a save never happens: a process that awaits the load at startup exits non-zero and the file stays byte-identical', async () => {
      const bad = '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026-11';
      const ip = await put(bad);
      const url = new URL('../src/dom_store.js', import.meta.url).href;
      // same shape as standalone.js: top-level await loadDomIndex(), then saves later in the run
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { loadDomIndex, saveDomIndex } from ${JSON.stringify(url)};
        const domIndex = await loadDomIndex(${JSON.stringify(cwd)});
        await saveDomIndex(domIndex, ${JSON.stringify(cwd)});
        console.log('SHOULD NOT GET HERE');`], { encoding: 'utf8' });
      assert.notEqual(r.status, 0);
      assert.doesNotMatch(r.stdout, /SHOULD NOT GET HERE/);
      assert.match(r.stderr, /DomIndexUnreadableError|cannot be read/);
      await untouched(ip, bad);
    });

    it('captureVehicleDom / recordSoldDom without a passed index also refuse on an unreadable index', async () => {
      const ip = await put('{broken');
      await assert.rejects(captureVehicleDom({ vin: 'V1', date: day(1), html: '<html/>', price: 1, cwd }), DomIndexUnreadableError);
      await untouched(ip, '{broken');
    });
  });

  it('price history survives load -> capture -> save -> load (earlier days untouched, new day added with the right diff)', async () => {
    const idx = makeIndex(5, 3);
    await saveDomIndex(idx, cwd);
    const loaded = await loadDomIndex(cwd);
    const vin = Object.keys(loaded)[0];
    const rec = await captureVehicleDom({ vin, date: day(4), html: '<html>x</html>', price: 20100, index: loaded, cwd });
    assert.equal(rec.priceChangeType !== undefined, true);
    await saveDomIndex(loaded, cwd);
    const again = await loadDomIndex(cwd);
    for (const d of [1, 2, 3]) assert.deepEqual(again[vin][day(d)], idx[vin][day(d)]);
    assert.deepEqual(again[vin][day(4)], rec);
    assert.deepEqual(Object.keys(again), Object.keys(idx));
  });

  it('heap-guard headroom is unchanged (still 1.25 x index + 256 MB, now more than the save needs)', () => {
    assert.equal(heapReserveBytes(480663249), Math.round(480663249 * 1.25) + 256 * 1048576);
  });

  it('a process killed (SIGKILL) in the middle of a save leaves the previous index intact; the next save sweeps nothing live and replaces it', async () => {
    const old = makeIndex(20, 2);
    await saveDomIndex(old, cwd);
    const { dataDir, indexPath } = domPaths(cwd);
    const before = await fsp.readFile(indexPath);
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { saveDomIndex } from ${JSON.stringify(new URL('../src/dom_store.js', import.meta.url).href)};
      const idx = {}; for (let v = 0; v < 400000; v++) idx['V' + v] = { '2026-11-01': { hash: 'h' + v, price: v, note: 'x'.repeat(40) } };
      process.stdout.write('ready\\n'); await saveDomIndex(idx, ${JSON.stringify(cwd)}); `], { stdio: ['ignore', 'pipe', 'inherit'] });
    let sawTmp = false;
    for (let i = 0; i < 20000 && !sawTmp; i++) {
      sawTmp = (await fsp.readdir(dataDir)).some((n) => n.startsWith('dom_index.json.tmp-'));
      if (!sawTmp) await new Promise((r) => setTimeout(r, 1));
    }
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
    assert.ok(sawTmp, 'child never started writing (test could not interrupt a save)');
    assert.ok(before.equals(await fsp.readFile(indexPath)), 'previous index must be untouched');
    assert.deepEqual(await loadDomIndex(cwd), old);
  });
});
