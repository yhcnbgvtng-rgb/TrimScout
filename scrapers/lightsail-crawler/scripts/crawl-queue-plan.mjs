#!/usr/bin/env node
// Dry run for the crawl shard queue: prints the planned shard assignment and the expected finish time per box from the
// last week's timings. Reads files only; sends nothing, starts nothing, touches no box.
//
//   node scripts/crawl-queue-plan.mjs                                  # committed timings snapshot, boxes box1 box3 box4
//   node scripts/crawl-queue-plan.mjs --boxes=box3:4,box4:4           # a different fleet (name:slots[:brandSets][:speed])
//   node scripts/crawl-queue-plan.mjs --history=/path/to/collected    # <dir>/<box>/summary_*.json copied from the boxes
//   node scripts/crawl-queue-plan.mjs --history=... --export-timings=config/crawl_queue_timings.json   # refresh the snapshot
//   --exclude-states=NY,OH,...   states kept on a box's fixed cron (not offered to the queue)  --exclude-last-box=box1   same, for every state that box ran last week
//   options: --pct=50 (timing percentile; 75 = a slow night)  --nights=7  --exclude-dates=2026-10-11  --json  --assignment
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NJ_BRANDS_IN_CORE, NJ_BRANDS_IN_EXPANSION } from '../src/nj_policy.js';
import { loadHistoryDir, buildTimings, buildJobs, brandRates, simulateQueue, formatPlan, median } from '../src/crawlQueuePlan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT_PATH = path.join(ROOT, 'config', 'crawl_queue_timings.json');
const arg = (name, dflt = null) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const flag = (name) => process.argv.includes(`--${name}`);

export const brandSetOf = (brand) => (NJ_BRANDS_IN_EXPANSION.includes(brand) ? 'expansion' : 'core');

/** "box1:2:core,box3:4,box4:4:expansit..." -> boxes. brandSets are '+'-joined (core+expansion); a trailing number is the speed factor. */
export function parseBoxes(spec) {
  return spec.split(',').filter(Boolean).map((part) => {
    const [name, slots, sets, speed] = part.split(':');
    return { name, slots: Number(slots), brandSets: sets && sets !== '*' ? sets.split('+') : null, speed: speed ? Number(speed) : 1 };
  });
}

// The fleet as it can be switched on Wednesday without any box code upgrade: box1/box2 have no per-brand shard code
// (#480) and no expansion dealer support, so box1 is only schedulable once that code is deployed — see the PR description.
export const DEFAULT_FLEET = 'box1:2:core,box3:4,box4:4';

async function heavyFn() {
  try {
    const m = await import('./run-daily-crawl.mjs');
    return (state, brand) => (m.heapMbFor ? m.heapMbFor(state, brand) > m.DEFAULT_HEAP_MB : false);
  } catch { return () => false; }
}

export async function planFromTimings({ snapshot, fleet, excludeStates = [], excludeLastBox = null }) {
  const universe = Object.entries(snapshot.universe).filter(([, u]) => !excludeStates.includes(u.state) && !(excludeLastBox && u.lastBox === excludeLastBox)).map(([key, u]) => ({ state: u.state, brand: u.brand, brandSet: brandSetOf(u.brand), dealers: u.dealers }));
  const heavy = await heavyFn();
  for (const u of universe) u.heavy = heavy(u.state, u.brand);
  const jobs = buildJobs(universe, snapshot.timings);
  return { jobs, plan: simulateQueue(jobs, fleet) };
}

async function main() {
  const fleet = parseBoxes(arg('boxes', DEFAULT_FLEET));
  const pct = Number(arg('pct', 50));
  let snapshot;
  const historyDir = arg('history');
  if (historyDir) {
    const { entries, runs } = loadHistoryDir(historyDir);
    const exclude = (arg('exclude-dates', '') || '').split(',').filter(Boolean);
    const { timings, seen, dates } = buildTimings(entries, { nights: Number(arg('nights', 7)), pct, excludeDates: exclude });
    const baseline = [...new Set(runs.map((r) => r.box))].map((box) => ({ box, wallHours: median(runs.filter((r) => r.box === box && dates.includes(r.date)).map((r) => r.wallHours)) })).filter((b) => Number.isFinite(b.wallHours));
    const p75 = buildTimings(entries, { nights: Number(arg('nights', 7)), pct: 75, excludeDates: exclude }).timings;
    snapshot = { generatedAt: new Date().toISOString(), source: `summaries in ${historyDir}`, dates, pct, universe: seen, timings, timingsP75: p75, baseline };
    const out = arg('export-timings');
    if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`); console.error(`wrote ${out} (${Object.keys(timings).length} timed shards, ${Object.keys(seen).length} shards)`); }
  } else {
    snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  }
  const exStates = (arg('exclude-states', '') || '').split(',').filter(Boolean).map((x) => x.toUpperCase());
  if (!historyDir && pct === 75 && snapshot.timingsP75) snapshot = { ...snapshot, timings: snapshot.timingsP75 };
  const { jobs, plan } = await planFromTimings({ snapshot, fleet, excludeStates: exStates, excludeLastBox: arg('exclude-last-box') });
  if (flag('json')) { console.log(JSON.stringify({ fleet, makespanS: plan.makespanS, boxes: plan.boxes.map((b) => ({ ...b, jobs: flag('assignment') ? b.jobs : b.jobs.length })) }, null, 1)); return; }
  console.log(formatPlan(plan, { jobs, title: `Crawl queue dry run — fleet ${fleet.map((b) => `${b.name}x${b.slots}`).join(' ')}`, baseline: snapshot.baseline || [], nights: snapshot.dates || [], note: [`timing percentile: p${pct}; box speed factors: ${fleet.map((b) => `${b.name}=${b.speed}`).join(' ')} (1 = as fast as the night the timing was measured)`] }));
  if (flag('assignment')) {
    for (const b of plan.boxes) {
      console.log(`\n--- ${b.name}: ${b.jobs.length} shards ---`);
      for (const j of b.jobs) console.log(`${(j.startS / 3600).toFixed(2).padStart(6)}h  +${(j.estSeconds / 3600).toFixed(2)}h  ${j.jobKey}${j.moved ? `   (was ${j.lastBox})` : ''}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
