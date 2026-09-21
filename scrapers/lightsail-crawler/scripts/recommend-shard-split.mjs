#!/usr/bin/env node
// Auto-split recommendation — the tool this project was missing when box
// 1/box 3/box 4 were each hand-assigned a state list (by dealer count or
// vehicle volume, not real timing) that turned out to project past the
// 24-hour hard SLA. Run this whenever the dealer list grows (new states,
// new brands, a state's roster gets meaningfully bigger) to check whether
// the CURRENT box count and concurrency can still fit everything within
// MAX_PROJECTED_HOURS, and if not, get a real rooftop-balanced split
// (optionally spread across MORE boxes than currently exist) instead of
// re-deriving the math by hand.
//
// This does not read or write any crontab — it only recommends. Applying
// a recommendation is a deliberate, separate step (see the printed
// CRAWL_STATES values, meant to be pasted into each box's crontab).
//
// Usage:
//   node scripts/recommend-shard-split.mjs --brand-set=core --boxes=2 --concurrency=2,4
//   node scripts/recommend-shard-split.mjs --brand-set=expansion --boxes=2 --concurrency=4,4
//   node scripts/recommend-shard-split.mjs --brand-set=expansion --boxes=4 --concurrency=4,4,4,4
//
// --brand-set: core | expansion (which brand list to size against)
// --boxes: how many boxes to split across (tries this count first; if even
//   a perfectly balanced split can't fit every box under the SLA, prints
//   how many boxes WOULD be needed instead of pretending the requested
//   count works)
// --concurrency: comma-separated MAX_CONCURRENT_STATES per box, one value
//   per box (or a single value applied to all). Boxes are NOT assumed
//   identical — box 1's 2 vCPUs vs box 2/3/4's 4 is exactly the kind of
//   asymmetry this needs to size correctly.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_STATES } from '../src/states.js';
import { NJ_BRANDS_IN_CORE, NJ_BRANDS_IN_EXPANSION } from '../src/nj_policy.js';
import { countRooftopsForState, projectedHours, P90_SECONDS_PER_ROOFTOP, MAX_PROJECTED_HOURS } from '../src/capacity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const brandSet = arg('brand-set', 'core');
const brands = brandSet === 'expansion' ? NJ_BRANDS_IN_EXPANSION : NJ_BRANDS_IN_CORE;
const boxCount = Number(arg('boxes', '2'));
const concurrencyArg = arg('concurrency', '4');
const concurrencyList = concurrencyArg.split(',').map(Number);
const concurrencies = concurrencyList.length === 1
  ? Array.from({ length: boxCount }, () => concurrencyList[0])
  : concurrencyList;

if (concurrencies.length !== boxCount) {
  console.error(`--concurrency must have exactly 1 value (applied to every box) or exactly ${boxCount} values (one per box) — got ${concurrencies.length}.`);
  process.exit(1);
}

const counts = {};
for (const state of SUPPORTED_STATES) {
  counts[state] = countRooftopsForState(state, brands, ROOT);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);

console.log(`Brand set: ${brandSet} (${brands.length} brands: ${brands.join(', ')})`);
console.log(`Total real rooftops across all ${SUPPORTED_STATES.length} supported states: ${total}`);
console.log(`p90 rate: ${P90_SECONDS_PER_ROOFTOP}s/rooftop, SLA: ${MAX_PROJECTED_HOURS}h\n`);

// Greedy: assign each state (largest first) to whichever box currently has
// the LOWEST projected ETA — this is what actually balances wall-clock
// time across boxes with different concurrency, not just raw rooftop
// count (see the module header comment on why that distinction mattered).
const statesSorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
const bins = Array.from({ length: boxCount }, () => []);
const sums = Array.from({ length: boxCount }, () => 0);
for (const [state, count] of statesSorted) {
  let bestBox = 0;
  let bestEta = Infinity;
  for (let i = 0; i < boxCount; i++) {
    const eta = (sums[i] + count) / Math.max(1, concurrencies[i]);
    if (eta < bestEta) { bestEta = eta; bestBox = i; }
  }
  bins[bestBox].push(state);
  sums[bestBox] += count;
}

let anyOverBudget = false;
for (let i = 0; i < boxCount; i++) {
  const hours = projectedHours(sums[i], concurrencies[i]);
  const overBudget = hours > MAX_PROJECTED_HOURS;
  if (overBudget) anyOverBudget = true;
  console.log(
    `BOX${i + 1} (${concurrencies[i]}x concurrency): ${bins[i].length} states, ${sums[i]} rooftops, `
    + `projected ${hours.toFixed(1)}h ${overBudget ? '— OVER the ' + MAX_PROJECTED_HOURS + 'h SLA ⚠️' : '(within SLA)'}`,
  );
  console.log(`  CRAWL_STATES=${bins[i].sort().join(',')}`);
}

if (anyOverBudget) {
  // How many boxes (of the SAME average concurrency as requested) would
  // actually be needed, at the p90 rate, to fit the whole workload.
  const avgConcurrency = concurrencies.reduce((a, b) => a + b, 0) / boxCount;
  const perBoxCeiling = MAX_PROJECTED_HOURS * 3600 * avgConcurrency / P90_SECONDS_PER_ROOFTOP;
  const boxesNeeded = Math.ceil(total / perBoxCeiling);
  console.log(
    `\n⚠️  ${boxCount} box(es) at this concurrency cannot fit the whole ${brandSet} workload within `
    + `${MAX_PROJECTED_HOURS}h. At ~${avgConcurrency}x average concurrency, this needs roughly ${boxesNeeded} `
    + `box(es) total to cover every state — or defer the lowest-rooftop states to a backlog and re-run this `
    + `tool with the same --boxes count against the reduced state list.`,
  );
} else {
  console.log(`\n✅ All ${boxCount} boxes fit within the ${MAX_PROJECTED_HOURS}h SLA at p90.`);
}
