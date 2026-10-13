// Crawl-box side of the shared VIN enrichment cache (server half: crawlQueueServer.js makeVinCache).
//
// Why: with a shard queue a (state, brand) shard lands on whichever box is free, so its per-brand cache file
// (data/enriched_cache/<ST>__<brand>.json) may not exist on that box. Without help the enricher would repeat every NHTSA
// lookup another box already paid for — the throttled lookups that turned a 14k/night baseline into 216k/night on box3/box4
// when #480 first split the cache per brand (fixed by #496).
//
// How, without touching the enricher: #496 already tops a brand's cache up from the state-wide cache file
// (data/enriched_cache/<ST>.json, "legacy") whenever >= 25 of the VINs it is about to enrich are missing. So
//   before a job  pullState(): fetch the shared entries for the state that this box has not merged yet (byte offset kept
//                 per state) and merge them into that legacy file. #496's own top-up then finds them. Incremental: after
//                 the first night a pull is only what other boxes added since.
//   after a job   pushNew():   send the entries that appeared in the brand's cache during the job. The server drops VINs it
//                 already has, so re-sending something that was only pulled can't grow its file.
// Both are best-effort: any failure is logged and the job runs exactly as it does today.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonLarge, writeJsonLarge } from './bigJson.js';
import { cacheShardPath } from './inventory_shards.js';

const usable = (e) => Boolean(e && e.nhtsa);

export function makeVinCacheSync({ cwd, request, waitForPressure = async () => {}, log = console.log, maxPullBytes = (Number(process.env.CRAWL_QUEUE_PULL_MAX_MB) || 64) * 1024 * 1024, pushChunk = 2000 }) {
  const offsetsFile = path.join(cwd, 'data', 'crawl_queue', 'vin-cache-offsets.json');
  const legacyPath = (state) => cacheShardPath(state, cwd, null);
  const inflight = new Map();
  // Pull/snapshot/push each parse a cache file of tens to hundreds of MB inside the driver process, which runs several jobs at
  // once on a default-sized heap. One at a time keeps the worst case at one file, not one per slot.
  let turn = Promise.resolve();
  const serial = (fn) => { const run = turn.then(fn, fn); turn = run.catch(() => {}); return run; };

  async function readOffsets() { try { return JSON.parse(await fs.readFile(offsetsFile, 'utf-8')); } catch { return {}; } }
  async function writeOffsets(o) { await fs.mkdir(path.dirname(offsetsFile), { recursive: true }); const t = `${offsetsFile}.tmp-${process.pid}`; await fs.writeFile(t, JSON.stringify(o)); await fs.rename(t, offsetsFile); }

  async function pullOnce(state) {
    const offsets = await readOffsets();
    let from = offsets[state] || 0;
    const incoming = {};
    let bytes = 0; let lines = 0; let eof = false;
    while (!eof && bytes < maxPullBytes) {
      await waitForPressure();
      const r = await request({ method: 'GET', path: `/api/ops/vin-cache/pull?state=${state}&from=${from}`, raw: true, timeoutMs: 120_000 });
      const next = Number(r.headers['x-next-offset']);
      eof = r.headers['x-eof'] === '1';
      for (const line of r.text.split('\n')) {
        if (!line) continue;
        try { const [vin, entry] = JSON.parse(line); if (usable(entry)) { incoming[vin] = entry; lines++; } } catch { /* torn line: skip */ }
      }
      bytes += Buffer.byteLength(r.text);
      if (!Number.isFinite(next) || next <= from) break;
      from = next;
    }
    let merged = 0;
    if (lines) {
      let local = {};
      try { local = await readJsonLarge(legacyPath(state)); } catch { local = {}; }
      for (const [vin, entry] of Object.entries(incoming)) if (!usable(local[vin])) { local[vin] = entry; merged++; }
      if (merged) { await fs.mkdir(path.dirname(legacyPath(state)), { recursive: true }); await writeJsonLarge(legacyPath(state), local); }
    }
    // Offset only moves after the merge is on disk, so a crash in between re-reads instead of skipping entries.
    offsets[state] = from;
    await writeOffsets(offsets);
    return { state, pulledBytes: bytes, entries: lines, merged, eof };
  }

  return {
    /** Memoised per state: two jobs of one state starting together share one pull. Never throws. */
    pullState(state) {
      if (!inflight.has(state)) {
        const p = serial(() => pullOnce(state)).catch((e) => { log(`[vin-cache] pull ${state} skipped: ${e.message}`); return { state, error: e.message }; }).finally(() => setTimeout(() => inflight.delete(state), 60_000).unref?.());
        inflight.set(state, p);
      }
      return inflight.get(state);
    },
    /** Snapshot of the VINs already in the brand's cache file, taken before the job so pushNew sends only the difference. */
    snapshotBrand(state, brand) {
      return serial(async () => { try { return new Set(Object.keys(await readJsonLarge(cacheShardPath(state, cwd, brand)))); } catch { return new Set(); } });
    },
    pushNew(state, brand, before) {
      return serial(async () => {
      try {
        const now = await readJsonLarge(cacheShardPath(state, cwd, brand));
        const fresh = Object.entries(now).filter(([vin, e]) => !before.has(vin) && usable(e));
        let sent = 0; let dup = 0;
        for (let i = 0; i < fresh.length; i += pushChunk) {
          await waitForPressure();
          const r = await request({ path: '/api/ops/vin-cache/push', body: { state, entries: Object.fromEntries(fresh.slice(i, i + pushChunk)) }, timeoutMs: 60_000 });
          sent += r.appended || 0; dup += r.duplicate || 0;
        }
        return { state, brand, candidates: fresh.length, sent, duplicate: dup };
      } catch (e) {
        log(`[vin-cache] push ${state}/${brand} skipped: ${e.message}`);
        return { state, brand, error: e.message };
      }
      });
    },
  };
}
