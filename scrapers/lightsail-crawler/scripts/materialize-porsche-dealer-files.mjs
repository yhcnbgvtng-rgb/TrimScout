#!/usr/bin/env node
// Regenerates dealers/oem-dumps/porsche.json from the full nationwide
// dealers.json (216 rooftops / 48 states), then materializes
// dealers/<state>/porsche.json for every state that has Porsche coverage.
//
// Root cause this fixes: dealers/oem-dumps/porsche.json was generated back
// when SUPPORTED_STATES (src/states.js) covered only ~16 states -- it was
// never regenerated after that list grew to 50, and the per-state
// write-<state>-dealer-files.mjs materialization scripts for the 34 states
// added since then were never run for Porsche specifically. The root
// dealers.json already has the full 216-dealer/48-state authorized-center
// list; this only needed re-running against the current state list, not
// new data or a new OEM fetch.
//
// Deliberately Porsche-only, self-contained, and does NOT import
// scripts/fetch-oem-dealer-locators.mjs -- that script unconditionally
// fetches EVERY OEM brand over the network as a top-level side effect on
// import/run, which is both unreachable from a sandboxed environment and
// out of scope (this fix targets only Porsche's own dealer-seed gap).
// Logic mirrors oh_policy.js's loadOhDealers/writeOhDealerFiles, the
// existing proven pattern for this exact operation, generalized to any
// state and restricted to one brand instead of hardcoded to Ohio/all
// NJ_BRANDS_IN.
//
// Run from scrapers/lightsail-crawler/: node scripts/materialize-porsche-dealer-files.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_STATES } from '../src/states.js';
import { acceptNjDealer, buildDealerRecord, canonicalBrandName } from '../src/nj_policy.js';
import { locatorRowsForState, isOemMarketingHost, hostFromUrl } from '../src/oem_locator.js';
import { looksLikeBrandCityGuess } from '../src/nj_verified_domains.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BRAND = 'Porsche';

function uniqDumpRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const key = `${r.make}|${r.state}|${r.name}|${r.domain}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) => String(a.state).localeCompare(String(b.state)) || String(a.name).localeCompare(String(b.name)));
}

function dumpRow({ make, name, city, state, domain }) {
  const host = hostFromUrl(domain);
  if (!host || isOemMarketingHost(host) || !name || !state) return null;
  return {
    make,
    name: String(name).trim(),
    city: city ? String(city).trim() : null,
    state: String(state).trim().toUpperCase(),
    domain: host,
    lat: null,
    lng: null,
    source: 'oem-locator',
    sourceUrl: 'dealers.json',
  };
}

// Step 1: regenerate dealers/oem-dumps/porsche.json from the full dealers.json,
// filtered to the CURRENT SUPPORTED_STATES (already 50 states) instead of
// whatever the target-state list was when this dump was last generated.
const rawDealers = JSON.parse(fs.readFileSync(path.join(ROOT, 'dealers.json'), 'utf-8'));
const supported = new Set(SUPPORTED_STATES);
const dumpRows = [];
for (const raw of rawDealers) {
  const state = String(raw.state || '').toUpperCase();
  if (!supported.has(state)) continue;
  dumpRows.push(dumpRow({ make: BRAND, name: raw.name, city: raw.city, state, domain: raw.domain }));
}
const dedupedDump = uniqDumpRows(dumpRows);
const dumpDir = path.join(ROOT, 'dealers', 'oem-dumps');
fs.mkdirSync(dumpDir, { recursive: true });
fs.writeFileSync(path.join(dumpDir, 'porsche.json'), `${JSON.stringify(dedupedDump, null, 2)}\n`);
console.log(`wrote dealers/oem-dumps/porsche.json (${dedupedDump.length} rooftops, ${new Set(dedupedDump.map((r) => r.state)).size} states)`);

// Step 2: materialize dealers/<state>/porsche.json for every state with
// coverage -- same algorithm as oh_policy.js's loadOhDealers, generalized
// to any state and restricted to Porsche only. Never touches any other
// brand's file in a state's directory.
function loadPorscheDealersForState(state, cwd) {
  const out = [];
  const seenName = new Set();
  const seenHost = new Set();
  for (const raw of locatorRowsForState(state, { cwd })) {
    const make = canonicalBrandName(raw.make);
    if (make !== BRAND) continue;
    const dealer = { ...raw, make, state };
    if (!acceptNjDealer({ ...dealer, state: 'NJ' }, { brand: BRAND })) continue;
    if (looksLikeBrandCityGuess(dealer) && raw.source === 'pattern-guess') continue;
    const rec = buildDealerRecord(dealer);
    rec.domainSource = raw.source || 'oem-locator';
    const nameKey = `porsche|${String(rec.name).toLowerCase()}`;
    const hostKey = String(rec.domain || '').toLowerCase().replace(/^www\./, '');
    if (seenName.has(nameKey) || seenHost.has(hostKey)) continue;
    seenName.add(nameKey);
    seenHost.add(hostKey);
    out.push(rec);
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}

let statesWritten = 0;
let totalDealers = 0;
for (const state of SUPPORTED_STATES) {
  const dealers = loadPorscheDealersForState(state, ROOT);
  if (dealers.length === 0) continue; // don't create empty files for states with no Porsche coverage
  const stateDir = path.join(ROOT, 'dealers', state.toLowerCase());
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'porsche.json'), `${JSON.stringify(dealers, null, 2)}\n`);
  statesWritten++;
  totalDealers += dealers.length;
  console.log(`wrote dealers/${state.toLowerCase()}/porsche.json (${dealers.length} rooftops)`);
}
console.log(`\nDone: ${statesWritten} states, ${totalDealers} total Porsche rooftops materialized.`);
