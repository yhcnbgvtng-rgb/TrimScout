// The on/off switch for the crawl shard queue. OFF unless a flag file says otherwise, so the fixed-state crons keep
// doing exactly what they do today; rollback is deleting the file (or `enabled:false`) and nothing else.
//
//   <crawler dir>/data/crawl_queue/flag.json
//   { "enabled": true, "box": "box3", "role": "worker", "slots": 4, "brandSets": ["core","expansion"], "maxHeavy": 2, "excludeStates": ["NY"] }
//   excludeStates = states that stay on a box's fixed-state cron and are NOT offered to the queue (every worker must list the same ones).
//   role "host" = box2: it hosts the queue and receives syncs but does not crawl (its cron-started crawl exits at once).
//
// CRAWL_QUEUE=1 / CRAWL_QUEUE=0 in the environment overrides the file's `enabled` (a manual pilot, or an emergency off
// without touching files). A missing, unreadable or malformed file means OFF — never "on by accident".
import fs from 'node:fs';
import path from 'node:path';

export const FLAG_REL = path.join('data', 'crawl_queue', 'flag.json');

export function flagPath(crawlerDir) { return path.join(crawlerDir, FLAG_REL); }

/** @returns {{enabled:boolean, box:string|null, role:'worker'|'host', slots:number, brandSets:string[]|null, maxHeavy:number, excludeStates:string[], source:string}} */
export function readFlag(crawlerDir, env = process.env) {
  const off = { enabled: false, box: null, role: 'worker', slots: 0, brandSets: null, maxHeavy: 1, excludeStates: [], source: 'default-off' };
  let file = null;
  try { file = JSON.parse(fs.readFileSync(flagPath(crawlerDir), 'utf-8')); } catch { /* missing/corrupt = off */ }
  const envSays = env.CRAWL_QUEUE;
  let enabled = Boolean(file && file.enabled === true);
  let source = file ? 'flag-file' : 'default-off';
  if (envSays === '1') { enabled = true; source = 'env'; }
  if (envSays === '0') { enabled = false; source = 'env-off'; }
  if (!enabled) return { ...off, source };
  const slots = Number(env.CRAWL_QUEUE_SLOTS || (file && file.slots)) || 2;
  const role = (file && file.role) === 'host' || env.CRAWL_QUEUE_ROLE === 'host' ? 'host' : 'worker';
  const box = (file && file.box) || env.TRIMSCOUT_BOX_LABEL || null;
  if (!box) return { ...off, source: 'no-box-label' }; // refuse to run without knowing who we are
  return {
    enabled: true, box, role, slots: Math.max(1, Math.min(8, slots)),
    brandSets: (file && Array.isArray(file.brandSets) && file.brandSets.length) ? file.brandSets : null,
    maxHeavy: Number(file && file.maxHeavy) || 1, excludeStates: ((file && Array.isArray(file.excludeStates)) ? file.excludeStates : []).map((x) => String(x).toUpperCase()), source,
  };
}
