// Building tonight's job list, and the per-box manifest of shards it finished. Pure + small file helpers.
import fs from 'node:fs';
import path from 'node:path';
import { jobKey, queueNight } from './crawlQueueCore.js';
import { buildJobs, brandRates, median } from './crawlQueuePlan.js';
import { brandSlug } from './inventory_shards.js';

/** Night key honouring the pilot override (CRAWL_QUEUE_NIGHT=2026-10-14-pilot); file dates use its first 10 characters. */
export function nightFromEnv(env = process.env, now = Date.now()) {
  const n = env.CRAWL_QUEUE_NIGHT;
  if (n && /^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(n)) return n;
  return queueNight(now);
}
export const fileDateOf = (night) => night.slice(0, 10);

/**
 * @param snapshot  committed config/crawl_queue_timings.json  ({universe, timings})
 * @param history   server GET /history -> { timings: { key: [{seconds}] } } (may be empty/null on the first nights)
 * @param local     [{state, brand, brandSet, dealers}] this box declares from its own CRAWL_STATES and dealer files
 * @param opts      { states: ['DE'] to restrict (pilot), heavy(state, brand) }
 */
export function buildSeedJobs({ snapshot, history = null, local = [], states = null, exclude = [], heavy = () => false, brandSetOf }) {
  const universe = new Map();
  for (const [key, u] of Object.entries(snapshot.universe || {})) universe.set(key, { state: u.state, brand: u.brand, brandSet: brandSetOf(u.brand), dealers: u.dealers });
  for (const l of local) { const k = jobKey(l.state, l.brand); const prev = universe.get(k); universe.set(k, { state: l.state, brand: l.brand, brandSet: l.brandSet, dealers: l.dealers > 0 ? l.dealers : prev?.dealers || 0 }); }
  // Server history (actual queue nights) beats the committed snapshot once a shard has at least two samples there.
  const timings = { ...(snapshot.timings || {}) };
  for (const [key, runs] of Object.entries((history && history.timings) || {})) {
    const secs = runs.slice(-7).map((r) => r.seconds).filter(Number.isFinite);
    if (secs.length >= 2) timings[key] = { ...(timings[key] || {}), seconds: Math.round(median(secs)), samples: secs.length };
  }
  let list = [...universe.values()].filter((u) => (!states || states.includes(u.state)) && !exclude.includes(u.state));
  list = list.map((u) => ({ ...u, heavy: heavy(u.state, u.brand) }));
  return buildJobs(list, timings, brandRates(timings)).map((j) => ({ state: j.state, brand: j.brand, brandSet: j.brandSet, dealers: j.dealers, estSeconds: j.estSeconds, heavy: j.heavy, vehicles: j.vehicles, lastBox: j.lastBox }));
}

// ---- manifest: the shards this box finished tonight (what its sync is allowed to upload) ------------------------------
export const manifestFile = (crawlerDir, night) => path.join(crawlerDir, 'data', 'crawl_queue', `manifest-${night}.json`);
export const shardFileName = (state, brand) => `${state.toUpperCase()}__${brandSlug(brand)}.json`;

export function makeManifestWriter(crawlerDir, night, box) {
  let chain = Promise.resolve();
  const file = manifestFile(crawlerDir, night);
  return {
    file,
    add(entry) {
      chain = chain.then(() => {
        let m = { night, box, shards: [] };
        try { m = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* new */ }
        m.shards = m.shards.filter((s) => s.jobKey !== entry.jobKey).concat(entry);
        m.updatedAt = new Date().toISOString();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(m, null, 1));
        fs.renameSync(tmp, file);
      });
      return chain;
    },
    done() { return chain; },
  };
}
