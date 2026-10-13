// Planning side of the crawl shard queue: turn past run summaries into per-shard timings, size the job list, and simulate
// what the live queue will do (every free slot takes the longest unclaimed job) so a dry run can print the expected
// assignment and finish time per box BEFORE anything is switched on. Pure functions plus two small file readers.
//
// The simulation is exactly the live policy (crawlQueueCore.pickNext), not a separate optimizer, so what the dry run
// prints is what the queue will do given the same durations.
import fs from 'node:fs';
import path from 'node:path';
import { jobKey, parseJobKey } from './crawlQueueCore.js';

/** One entry per (state, brand) brand-run found in a driver summary_<date>.json (or a queue_summary_<night>.json). */
export function entriesFromSummary(summary, { box = null, file = null } = {}) {
  const out = [];
  const date = (summary && summary.date) || (file && /(\d{4}-\d{2}-\d{2})/.exec(file)?.[1]) || null;
  for (const [state, sv] of Object.entries((summary && summary.states) || {})) {
    for (const [brand, r] of Object.entries((sv && sv.brands) || {})) {
      if (!r || r.status === 'skipped' || !r.durationMs) continue;
      out.push({
        key: jobKey(state, brand),
        state: state.toUpperCase(),
        brand,
        durationMs: r.durationMs,
        status: r.status || 'ok',
        dealerCount: r.dealerCount || 0,
        vehicles: r.stats?.totalActiveInventory ?? null,
        box,
        date,
        startedAt: r.startedAt || sv.startedAt || null,
      });
    }
  }
  return out;
}

/**
 * Reads summaries laid out as <dir>/<box>/summary_*.json (what `scp` of each box's data/daily_crawl_runs produces),
 * or a flat directory of files when `box` can't be inferred. Returns { entries, runs } — runs is one row per summary file
 * with the box's wall-clock, used as the "what happened last week" baseline.
 */
export function loadHistoryDir(dir) {
  const entries = [];
  const runs = [];
  const boxDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const roots = boxDirs.length ? boxDirs.map((b) => ({ box: b, dir: path.join(dir, b) })) : [{ box: null, dir }];
  for (const { box, dir: d } of roots) {
    for (const f of fs.readdirSync(d).filter((x) => /^(queue_)?summary_.*\.json$/.test(x)).sort()) {
      let s;
      try { s = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')); } catch { continue; }
      const e = entriesFromSummary(s, { box, file: f });
      entries.push(...e);
      if (s.startedAt && s.finishedAt) runs.push({ box, file: f, date: e[0]?.date || null, wallHours: (Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 3.6e6, brandRuns: e.length, slotHours: e.reduce((a, x) => a + x.durationMs, 0) / 3.6e6 });
    }
  }
  return { entries, runs };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const percentile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };

/**
 * key -> { seconds, samples, dealers, lastBox, vehicles }. Uses the last `nights` distinct dates, ok runs only (a run that
 * was killed at the 2h cap says nothing about how long the shard needs). `excludeDates` drops known-bad nights.
 */
export function buildTimings(entries, { nights = 7, pct = 50, excludeDates = [] } = {}) {
  const dates = [...new Set(entries.map((e) => e.date).filter(Boolean))].sort().reverse().filter((d) => !excludeDates.includes(d)).slice(0, nights);
  const use = new Set(dates);
  const by = new Map();
  for (const e of entries) {
    if (!use.has(e.date)) continue;
    const t = by.get(e.key) || { secs: [], dealers: 0, vehicles: null, lastBox: null, lastDate: '', nonOk: 0, brand: e.brand, state: e.state };
    if (e.status === 'ok') t.secs.push(e.durationMs / 1000); else t.nonOk++;
    t.dealers = e.dealerCount || t.dealers;
    if (e.vehicles != null) t.vehicles = e.vehicles;
    if (e.date >= t.lastDate) { t.lastDate = e.date; t.lastBox = e.box; }
    by.set(e.key, t);
  }
  const out = {};
  for (const [key, t] of by) {
    if (!t.secs.length) continue; // only ever failed/timed out in the window: sized from the per-dealer rate instead
    out[key] = { seconds: Math.round(pct === 50 ? median(t.secs) : percentile(t.secs, pct)), samples: t.secs.length, dealers: t.dealers, vehicles: t.vehicles, lastBox: t.lastBox, state: t.state, brand: t.brand };
  }
  const seen = Object.fromEntries([...by].map(([k, t]) => [k, { state: t.state, brand: t.brand, dealers: t.dealers, lastBox: t.lastBox }]));
  return { timings: out, seen, dates, nonOk: Object.fromEntries([...by].filter(([, t]) => t.nonOk).map(([k, t]) => [k, t.nonOk])) };
}

/** Seconds per dealer for a brand (median over its shards) — the fallback for a shard with no history yet. */
export function brandRates(timings) {
  const per = {};
  for (const t of Object.values(timings)) if (t.dealers > 0) (per[t.brand] ||= []).push(t.seconds / t.dealers);
  const all = Object.values(per).flat();
  const fleet = all.length ? median(all) : 40;
  return { byBrand: Object.fromEntries(Object.entries(per).map(([b, v]) => [b, median(v)])), fleet };
}

/**
 * The job list the queue is seeded with. `universe` is [{state, brand, brandSet, dealers?, heavy?}]. Estimated seconds come
 * from `timings`; a shard with none is sized dealers x the brand's median rate (flagged estimated:'rate'), and one with no
 * dealer count either gets the fleet median job (estimated:'default').
 */
export function buildJobs(universe, timings, rates = brandRates(timings)) {
  const med = median(Object.values(timings).map((t) => t.seconds).concat([1200]));
  return universe.map((u) => {
    const key = jobKey(u.state, u.brand);
    const t = timings[key];
    let estSeconds, estimated;
    if (t) { estSeconds = t.seconds; estimated = 'history'; }
    else if (u.dealers > 0) { estSeconds = Math.round(u.dealers * (rates.byBrand[u.brand] || rates.fleet)); estimated = 'rate'; }
    else { estSeconds = Math.round(med); estimated = 'default'; }
    return { jobKey: key, state: u.state.toUpperCase(), brand: u.brand, brandSet: u.brandSet, dealers: u.dealers ?? t?.dealers ?? 0, heavy: Boolean(u.heavy), estSeconds, estimated, lastBox: t?.lastBox || null, vehicles: t?.vehicles ?? null };
  });
}

/**
 * Event-driven simulation of the live policy. boxes: [{name, slots, speed=1, brandSets?:string[], heavySlots?:number, startOffsetS?:number}].
 * speed multiplies a job's seconds on that box (>1 = slower). Returns per-box job lists with start/end seconds and the
 * makespan. Every slot, the moment it frees, takes the longest remaining job it is allowed to take.
 */
export function simulateQueue(jobs, boxes) {
  const remaining = [...jobs].sort((a, b) => b.estSeconds - a.estSeconds || (a.jobKey < b.jobKey ? -1 : 1));
  const slots = [];
  for (const b of boxes) for (let i = 0; i < b.slots; i++) slots.push({ box: b, free: b.startOffsetS || 0, idx: i });
  const result = Object.fromEntries(boxes.map((b) => [b.name, { name: b.name, slots: b.slots, jobs: [], busyS: 0, finishS: b.startOffsetS || 0 }]));
  const heavyRunning = Object.fromEntries(boxes.map((b) => [b.name, []])); // end times of running heavy jobs
  const unassignable = [];
  while (remaining.length) {
    slots.sort((a, b) => a.free - b.free);
    let placed = false;
    for (const s of slots) {
      const b = s.box;
      const heavyCap = b.heavySlots ?? 2;
      const idx = remaining.findIndex((j) => {
        if (b.brandSets && b.brandSets.length && !b.brandSets.includes(j.brandSet)) return false;
        if (j.heavy) { const live = heavyRunning[b.name].filter((e) => e > s.free).length; if (live >= heavyCap) return false; }
        return true;
      });
      if (idx === -1) continue;
      const [j] = remaining.splice(idx, 1);
      const dur = Math.round(j.estSeconds * (b.speed || 1));
      const end = s.free + dur;
      if (j.heavy) heavyRunning[b.name].push(end);
      result[b.name].jobs.push({ jobKey: j.jobKey, estSeconds: dur, startS: s.free, endS: end, moved: j.lastBox != null && j.lastBox !== b.name, lastBox: j.lastBox, brandSet: j.brandSet, vehicles: j.vehicles });
      result[b.name].busyS += dur;
      result[b.name].finishS = Math.max(result[b.name].finishS, end);
      s.free = end;
      placed = true;
      break;
    }
    if (!placed) { unassignable.push(...remaining.splice(0)); }
  }
  const boxesOut = Object.values(result);
  return { boxes: boxesOut, makespanS: Math.max(0, ...boxesOut.map((b) => b.finishS)), unassignable };
}

const hh = (s) => `${(s / 3600).toFixed(1)}h`;

/** Human-readable dry-run report. `baseline` is [{box, wallHours}] medians of the real last-week runs, for comparison. */
export function formatPlan(plan, { jobs, title = 'Crawl queue dry run', baseline = [], nights = [], note = [] } = {}) {
  const L = [];
  L.push(`== ${title} ==`);
  if (nights.length) L.push(`timings: median of ${nights.length} night(s) (${nights[nights.length - 1]} .. ${nights[0]}), ok runs only`);
  const byEst = jobs.reduce((a, j) => ({ ...a, [j.estimated]: (a[j.estimated] || 0) + 1 }), {});
  L.push(`jobs: ${jobs.length} (${Object.entries(byEst).map(([k, v]) => `${v} sized from ${k}`).join(', ')}); total ${hh(jobs.reduce((a, j) => a + j.estSeconds, 0))} of single-slot work`);
  L.push('');
  L.push('box    slots  jobs  busy      expected finish   utilisation  moved-from-last-box');
  for (const b of plan.boxes) {
    const util = b.slots && plan.makespanS ? (b.busyS / (b.slots * plan.makespanS)) * 100 : 0;
    const moved = b.jobs.filter((j) => j.moved).length;
    L.push(`${b.name.padEnd(6)} ${String(b.slots).padStart(5)}  ${String(b.jobs.length).padStart(4)}  ${hh(b.busyS).padStart(7)}   ${hh(b.finishS).padStart(14)}   ${util.toFixed(0).padStart(9)}%   ${moved}/${b.jobs.length}`);
  }
  L.push(`fleet finish (makespan): ${hh(plan.makespanS)} after the 22:00 start`);
  if (plan.unassignable.length) L.push(`UNASSIGNABLE (no enabled box may run them): ${plan.unassignable.map((j) => j.jobKey).join(', ')}`);
  if (baseline.length) {
    L.push('');
    L.push('last week, fixed-state crons (median wall-clock per box): ' + baseline.map((b) => `${b.box} ${b.wallHours.toFixed(1)}h`).join(', '));
  }
  for (const n of note) L.push(n);
  L.push('');
  L.push('first jobs claimed (biggest first):');
  const firsts = plan.boxes.flatMap((b) => b.jobs.filter((j) => j.startS === 0).map((j) => ({ ...j, box: b.name }))).sort((a, b) => b.estSeconds - a.estSeconds).slice(0, 12);
  for (const j of firsts) L.push(`  ${j.box.padEnd(5)} ${j.jobKey.padEnd(22)} ${hh(j.estSeconds)}`);
  return L.join('\n');
}

export { median, percentile, parseJobKey };
