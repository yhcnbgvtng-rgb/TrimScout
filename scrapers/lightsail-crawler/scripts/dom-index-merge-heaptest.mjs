// Manual stress test (not part of npm test): can a crawler process still finish its dom_index merge when it ends the run with a nearly full heap?
// Models the end of a brand run on box1 under the REAL limit (node --max-old-space-size=3584, no --expose-gc, like the cron line):
//   1. a box1-sized index (--index-mb, default 480) is on disk and the process holds a loaded copy of it (domIndex, as standalone.js does)
//   2. retained crawler allocations (ballast: plain objects and strings, i.e. V8 heap, not external buffers) bring used heap to --used-mb
//      (#719's guard trips at limit - reserve = limit - (1.25 x index + 256 MB); --used-mb defaults to that threshold, --over-mb adds in-flight overshoot)
//   3. domIndex = null (a reference drop only: NO explicit gc), then mergeDomDelta() with a delta of 3000 new VINs and --overlap existing VIN-dates that conflict
// Output: PASS/FAIL, peak used heap during the merge, elapsed. A V8 abort ("heap out of memory") shows up as a non-zero exit of the child.
//   node scripts/dom-index-merge-heaptest.mjs [--index-mb 480] [--over-mb 0] [--used-mb N] [--overlap 500] [--keep-ref]   (parent spawns the child)
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MB = 1048576;
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? d : process.argv[i + 1]; };
const flag = (k) => process.argv.includes(`--${k}`);
const self = fileURLToPath(import.meta.url);

if (process.argv[2] !== '--child') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dom-merge-heaptest-'));
  try {
    const passthru = process.argv.slice(2);
    // phase 1 in its own process (building the index needs its own heap): write the index file
    let r = spawnSync(process.execPath, ['--max-old-space-size=3584', self, '--child', 'build', dir, ...passthru], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) { console.log('build failed'); process.exit(2); }
    r = spawnSync(process.execPath, ['--max-old-space-size=3584', self, '--child', 'merge', dir, ...passthru], { encoding: 'utf8' });
    process.stdout.write(r.stdout);
    if (r.status !== 0) { console.log(`FAIL: child exited ${r.status}${r.signal ? ' signal ' + r.signal : ''}`); console.log((r.stderr || '').split('\n').filter((l) => /heap|memory|FATAL|Error/i.test(l)).slice(0, 4).join('\n')); process.exit(1); }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  process.exit(0);
}

const [, , , phase, dir] = process.argv;
const { saveDomIndex, loadDomIndex } = await import('../src/dom_store.js');
const { createDomDelta, mergeDomDelta } = await import('../src/dom_index_delta.js');
const { heapReserveBytes } = await import('../src/heapGuard.js');
const indexMb = Number(arg('index-mb', 480));

if (phase === 'build') {
  const idx = {};
  let bytes = 2;
  for (let v = 0; bytes < indexMb * MB; v++) {
    const dates = {};
    for (let d = 0; d < 8 + (v % 9); d++) dates[`2026-10-${String(1 + d).padStart(2, '0')}`] = { hash: `h${v}-${d >> 2}`.padEnd(64, 'a'), price: 20000 + ((v * 7 + d * 13) % 40000), oldPrice: d ? 20000 : null, priceDiff: 0, priceChangeType: d ? 'UNCHANGED' : 'NEW', blobStored: d % 4 === 0, hashUnchanged: d % 4 !== 0 };
    idx[`1N4${String(v).padStart(14, '0')}`.slice(0, 17)] = dates;
    bytes += JSON.stringify(dates).length + 22;
  }
  await saveDomIndex(idx, dir);
  console.log(`built ${Object.keys(idx).length} VINs, file ${((await fs.stat(path.join(dir, 'data/dom_index.json'))).size / MB).toFixed(1)} MB`);
  process.exit(0);
}

// merge phase
const limit = v8.getHeapStatistics().heap_size_limit;
const fileBytes = (await fs.stat(path.join(dir, 'data/dom_index.json'))).size;
const guardAt = Math.max(0.5 * limit, Math.min(0.85 * limit, limit - heapReserveBytes(fileBytes)));
const targetUsed = Number(arg('used-mb', Math.round(guardAt / MB))) * MB + Number(arg('over-mb', 0)) * MB;
let domIndex = await loadDomIndex(dir);
const vins = Object.keys(domIndex);
const ballast = [];
let n = 0;
while (v8.getHeapStatistics().used_heap_size < targetUsed) { for (let i = 0; i < 20000; i++, n++) ballast.push({ a: n, b: 'crawl-state-' + n, c: [n, n + 1, n + 2], d: { e: 'x' + n } }); }
const delta = createDomDelta({ cwd: dir, label: 'heaptest' });
const mk = (p) => ({ hash: 'z'.padEnd(64, 'z'), price: p, oldPrice: null, priceDiff: 0, priceChangeType: 'NEW', blobStored: true, hashUnchanged: false });
for (let i = 0; i < 3000; i++) { delta.entries[`ZZ${String(i).padStart(10, '0')}`] = { '2026-11-06': mk(i) }; delta.count++; }
const overlap = Number(arg('overlap', 500));
for (let i = 0; i < overlap; i++) { const vin = vins[i * 7]; const date = Object.keys(domIndex[vin])[0]; delta.entries[vin] = { [date]: mk(999999 + i) }; delta.count++; }
const before = v8.getHeapStatistics();
console.log(`limit ${Math.round(limit / MB)} MB, guard trips at ${Math.round(guardAt / MB)} MB, used before merge ${Math.round(before.used_heap_size / MB)} MB (incl. loaded index ${vins.length} VINs, ballast ${ballast.length} objects)`);
if (!flag('keep-ref')) domIndex = null; else console.log('(--keep-ref: the loaded index is still referenced during the merge)');
let peak = 0;
const t = setInterval(() => { peak = Math.max(peak, v8.getHeapStatistics().used_heap_size); }, 10);
const t0 = performance.now();
const r = await mergeDomDelta(delta, { log: () => {} });
clearInterval(t);
peak = Math.max(peak, v8.getHeapStatistics().used_heap_size);
const after = await loadDomIndex(dir).catch((e) => e);
console.log(`PASS: merged +${r.added} new, ${r.conflicts} conflicts in ${((performance.now() - t0) / 1000).toFixed(1)}s, peak used heap ${Math.round(peak / MB)} MB of ${Math.round(limit / MB)} MB (headroom ${Math.round((limit - peak) / MB)} MB); merged file has ${after instanceof Error ? after.message : Object.keys(after).length + ' VINs'}; ballast still alive: ${ballast.length}`);
