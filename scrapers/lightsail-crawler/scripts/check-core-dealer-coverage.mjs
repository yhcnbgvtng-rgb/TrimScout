#!/usr/bin/env node
// Read-only preflight: which (state, core brand) pairs would be skipped tonight for lack of dealers?
//
//   node scripts/check-core-dealer-coverage.mjs                       # CRAWL_STATES, or every state
//   node scripts/check-core-dealer-coverage.mjs --states=WI,WA,MI
//   node scripts/check-core-dealer-coverage.mjs --states=WI --brands=Hyundai,Subaru,Toyota
//
// Reads dealers/oem-dumps only; writes nothing, makes no network calls, starts no crawl. Exit 1 when
// any pair has zero dealers, so it can gate a deploy. Brands that have no usable locator at all
// (Honda, Nissan, Infiniti, BMW, Audi, Volvo are filled from the directory by
// materialize-core-locator-gap-dealer-files.mjs) are reported like any other.

import { SUPPORTED_STATES } from '../src/states.js';
import { NJ_BRANDS_IN_CORE } from '../src/nj_policy.js';
import { coverageMatrix, coverageGaps } from '../src/dealer_coverage.js';
import { parseListArg } from '../src/oem_dump_merge.js';

const states = (parseListArg(process.argv, 'states')
  || (process.env.CRAWL_STATES || '').split(',').map((s) => s.trim()).filter(Boolean)
  || []).map((s) => s.toUpperCase());
const wantStates = states.length ? states : SUPPORTED_STATES;
const unknown = wantStates.filter((s) => !SUPPORTED_STATES.includes(s));
if (unknown.length) { console.error(`unsupported state(s): ${unknown.join(', ')}`); process.exit(2); }
const brands = parseListArg(process.argv, 'brands') || NJ_BRANDS_IN_CORE;

const matrix = coverageMatrix(wantStates, brands);
const w = Math.max(...brands.map((b) => b.length));
console.log(`${'state'.padEnd(6)}${brands.map((b) => b.slice(0, 7).padStart(8)).join('')}`);
for (const s of wantStates) {
  console.log(`${s.padEnd(6)}${brands.map((b) => String(matrix[s][b]).padStart(8)).join('')}`);
}
const gaps = coverageGaps(matrix);
if (gaps.length) {
  const byBrand = {};
  for (const g of gaps) (byBrand[g.brand] ||= []).push(g.state);
  console.log(`\n${gaps.length} (state, brand) pair(s) have NO dealers and would be skipped:`);
  for (const [b, ss] of Object.entries(byBrand)) console.log(`  ${b.padEnd(w)}  ${ss.join(',')}`);
  process.exit(1);
}
console.log('\nevery state/brand pair has at least one dealer');
