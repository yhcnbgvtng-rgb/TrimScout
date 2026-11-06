// Manual stress test for dom_index.json save/load (not part of npm test: minutes long, hundreds of MB). Writes ONLY to a temp dir it creates.
//   node --expose-gc --max-old-space-size=3584 scripts/dom-index-bigtest.mjs --mb 600 --mode new     # new incremental save + load, verified
//   node --expose-gc --max-old-space-size=3584 scripts/dom-index-bigtest.mjs --mb 480 --mode old     # the previous JSON.stringify/readFile code, for comparison
// Builds a synthetic index shaped like box1's real one (VIN -> date -> {hash,price,oldPrice,priceDiff,priceChangeType,blobStored,hashUnchanged}),
// ~200 bytes per vin-date, then saves, reloads, compares a digest, and reports peak RSS / peak used heap / elapsed for each phase.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import { loadDomIndex, saveDomIndex, domPaths } from '../src/dom_store.js';
import { createDomDelta, checkpointDomDelta, mergeDomDelta } from '../src/dom_index_delta.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? d : process.argv[i + 1]; };
const targetMb = Number(arg('mb', 600));
const mode = arg('mode', 'new');
const saves = Number(arg('saves', 3));
const MB = 1048576;

const mkRec = (v, d) => ({ hash: crypto.createHash('sha256').update(`v${v}-${d >> 2}`).digest('hex'), price: 20000 + ((v * 7 + d * 13) % 40000), oldPrice: d ? 20000 + ((v * 7 + (d - 1) * 13) % 40000) : null, priceDiff: d % 5 === 0 ? 100 : 0, priceChangeType: d ? (d % 5 === 0 ? 'DOWN' : 'UNCHANGED') : 'NEW', blobStored: d % 4 === 0, hashUnchanged: d % 4 !== 0 });
const vinOf = (v) => `1N4${String(v).padStart(14, '0')}`.slice(0, 17);

function build(targetBytes) {
  const idx = {};
  let bytes = 2, entries = 0, v = 0;
  const hashes = [];
  while (bytes < targetBytes) {
    const days = 8 + (v % 9); // 8..16 dates per VIN
    const dates = {};
    for (let d = 0; d < days; d++) dates[`2026-10-${String(1 + d).padStart(2, '0')}`] = mkRec(v, d);
    const vin = vinOf(v);
    idx[vin] = dates;
    bytes += JSON.stringify(dates).length + 22;
    entries += days; v++;
  }
  return { idx, vins: v, entries, approxBytes: bytes };
}
const digest = (idx) => { const h = crypto.createHash('sha256'); for (const k of Object.keys(idx)) { h.update(k); h.update(JSON.stringify(idx[k])); } return h.digest('hex'); };

let peak = { rss: 0, heap: 0 };
const sample = () => { const m = process.memoryUsage(); peak.rss = Math.max(peak.rss, m.rss); peak.heap = Math.max(peak.heap, v8.getHeapStatistics().used_heap_size); };
const timer = setInterval(sample, 20); timer.unref();
async function phase(name, fn) {
  global.gc?.(); peak = { rss: 0, heap: 0 }; sample();
  const base = { rss: process.memoryUsage().rss, heap: v8.getHeapStatistics().used_heap_size };
  const t0 = performance.now();
  let out, err;
  try { out = await fn(); } catch (e) { err = e; }
  sample();
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`${name.padEnd(28)} ${err ? 'FAILED: ' + err.message : 'ok'}  ${secs}s  start heap ${Math.round(base.heap / MB)} MB  peak heap ${Math.round(peak.heap / MB)} MB (+${Math.round((peak.heap - base.heap) / MB)})  peak RSS ${Math.round(peak.rss / MB)} MB`);
  return { out, err };
}

const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dom-index-bigtest-'));
const { indexPath } = domPaths(cwd);
await fs.mkdir(path.dirname(indexPath), { recursive: true });
console.log(`node ${process.version}  heap limit ${Math.round(v8.getHeapStatistics().heap_size_limit / MB)} MB  mode ${mode}  target ${targetMb} MB  dir ${cwd}`);
try {
  let { idx, vins, entries } = (await phase('build in memory', async () => build(targetMb * MB))).out;
  console.log(`  ${vins} VINs, ${entries} vin-dates`);
  const want = (await phase('digest of built index', async () => digest(idx))).out;

  if (mode === 'merge') { // end-of-run flow of one brand process: loaded copy released, delta merged into the current file under the lock; repeated like consecutive brand runs finishing
    await saveDomIndex(idx, cwd);
    idx = null; global.gc?.();
    for (let r = 1; r <= saves; r++) {
      const delta = createDomDelta({ cwd, label: `bigtest${r}` });
      const mine = {}; for (let v = 0; v < 3000; v++) mine[`ZZ${r}${String(v).padStart(8, '0')}`] = { '2026-11-06': { hash: 'n', price: v, oldPrice: null, priceDiff: 0, priceChangeType: 'NEW', blobStored: true, hashUnchanged: false } };
      for (const [k, v] of Object.entries(mine)) { delta.entries[k] = v; delta.count++; }
      await phase(`merge #${r} (3000 new VINs)`, async () => { await checkpointDomDelta(delta); return mergeDomDelta(delta, { log: () => {} }); });
    }
    const final = (await phase('load merged index', () => loadDomIndex(cwd))).out;
    console.log(`  merged index has ${Object.keys(final).length} VINs (built ${vins} + ${saves * 3000})  ${Object.keys(final).length === vins + saves * 3000 ? 'OK' : 'MISMATCH'}`);
  } else if (mode === 'limit') { // does the old whole-string save really hit V8's wall at this size?
    await phase('JSON.stringify(whole index)', async () => { const s = JSON.stringify(idx); return s.length; });
  } else if (mode === 'old') {
    for (let i = 1; i <= saves; i++) await phase(`old save #${i}`, async () => { await fs.writeFile(`${indexPath}.tmp`, JSON.stringify(idx)); await fs.rename(`${indexPath}.tmp`, indexPath); });
  } else {
    for (let i = 1; i <= saves; i++) await phase(`new save #${i}`, async () => saveDomIndex(idx, cwd));
  }
  if (mode !== 'limit' && mode !== 'merge') {
    const st = await fs.stat(indexPath).catch(() => null);
    if (st) console.log(`  file ${st.size} bytes (${(st.size / MB).toFixed(1)} MB)  ${st.size > 536870888 ? '> V8 string limit 536,870,888' : '<= V8 string limit'}`);
    idx = null; global.gc?.();
    const loadFn = mode === 'old' ? async () => JSON.parse(await fs.readFile(indexPath, 'utf-8')) : () => loadDomIndex(cwd);
    const { out: back, err } = await phase(`${mode} load`, loadFn);
    if (!err) {
      const got = (await phase('digest of reloaded', async () => digest(back))).out;
      console.log(got === want ? '  ROUND TRIP IDENTICAL (sha256 over every VIN and its full history)' : '  ROUND TRIP MISMATCH');
      if (got !== want) process.exitCode = 1;
    }
    const left = (await fs.readdir(path.dirname(indexPath))).filter((n) => n !== 'dom_index.json');
    console.log(`  leftover files: ${left.length ? left.join(', ') : 'none'}`);
  }
} finally {
  await fs.rm(cwd, { recursive: true, force: true });
}
