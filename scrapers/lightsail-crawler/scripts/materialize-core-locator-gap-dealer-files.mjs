#!/usr/bin/env node
// One-time (re-runnable) materialization of dealers/<state>/<brand>.json for
// the 6 core brands whose OEM-locator dump (dealers/oem-dumps/<brand>.json,
// built by fetch-oem-dealer-locators.mjs) has been stuck at an empty []
// since 2026-09-20: Honda and Nissan (confirmed genuine Akamai block on the
// locator page, via both plain fetch and a real patchright render — see
// fetchHonda/fetchNissan's own comments), Infiniti (locator is a Next.js
// SPA with no discoverable dealer API after a real, thorough automation
// pass), and BMW/Audi/Volvo (locator is a JS-hydrated widget whose backing
// API a live network-capture pass — the same technique that worked for
// Mini/Subaru — did not surface; BMW/Audi's own fetchBmw/fetchAudi were
// never actually investigated beyond a bare page fetch, and Volvo's got a
// genuine 403 on both the page and a guessed API path).
//
// Confirmed live 2026-09-23: this crawl-inventory gap left Honda/Nissan/
// Infiniti at ZERO vehicles fleet-wide and BMW/Audi/Volvo down to single-
// digit dealer counts nationwide (BMW 7, Audi 1, Volvo 2 dealer files
// across all 48 core states combined) — while a completely separate,
// already-successful project (the dealer-contact-crawl for TrimScout's own
// buyer-facing directory, PRs referenced in project memory) had already
// built real, verified, nationwide rosters for all 6 of these exact
// brands, each with a real website domain recovered from the dealer's own
// staff page. That data already lives in the live dealership_contacts
// table (served by the auth-api's /api/dealerships) — 1,088 Honda, 1,016
// Nissan, 351 BMW, 309 Audi, 273 Volvo, 189 Infiniti rows, each with a
// domain.
//
// This script does NOT touch any OEM locator, does NOT attempt to fetch or
// render bmwusa.com/audiusa.com/volvocars.com/honda.com/nissanusa.com/
// infinitiusa.com, and does not bypass anything — it reads dealer contact
// data TrimScout already legitimately collected for an unrelated purpose,
// and reuses it to fill an inventory-crawl gap, the same reuse pattern
// materialize-expansion-dealer-files.mjs already established for the
// domestic (Ford/GM/Stellantis) expansion brands.
//
// Requires CRAWLER_BRAND_SET to be unset (or 'core') — these are core
// brands, so isMegadealerOrSuperstore must apply the core (not expansion)
// combo-dealer exclusion. Requires TRIMSCOUT_API_KEY (or LIGHTSAIL_API_KEY)
// and reads the directory from the deals box's auth-api — same env
// convention as scripts/box/inventory-sync.mjs.
//
// Usage (run on any box that can reach the auth-api, e.g. box2 itself):
//   TRIMSCOUT_API_KEY=… node scripts/materialize-core-locator-gap-dealer-files.mjs
//   TRIMSCOUT_API_KEY=… node scripts/materialize-core-locator-gap-dealer-files.mjs --dry-run
//
// After running, dealers/<state>/<brand>.json for these 6 brands must be
// copied to every box that crawls core brands (box1, box2, and box3/box4's
// small RI/VT core runs) — this script only writes locally.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDealerRecord, isMegadealerOrSuperstore } from '../src/nj_policy.js';
import { SUPPORTED_STATES } from '../src/states.js';

if (process.env.CRAWLER_BRAND_SET === 'expansion') {
  console.error('Refusing to run: these are core brands — do not set CRAWLER_BRAND_SET=expansion for this script.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

const AUTH_HOST = process.env.TRIMSCOUT_AUTH_HOST || '127.0.0.1';
const AUTH_PORT = process.env.TRIMSCOUT_AUTH_PORT || '3003';
const KEY = process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;
if (!KEY) {
  console.error('usage: TRIMSCOUT_API_KEY=… node materialize-core-locator-gap-dealer-files.mjs [--dry-run]');
  process.exit(2);
}

// Brand -> substring(s) matched against dealerName, case-insensitively.
// Plain substrings are safe for all six: none collides with an unrelated
// dealer-name word ("Infiniti" has no near-miss, "BMW"/"Audi"/"Volvo" are
// distinctive short brand tokens, "Honda"/"Nissan" likewise). A combo
// rooftop naming two of these brands together still correctly gets filed
// under each match — isMegadealerOrSuperstore below is what excludes an
// actual multi-franchise combo store, not this match step.
const BRAND_MATCHERS = {
  Honda: /\bhonda\b/i,
  Nissan: /\bnissan\b/i,
  Infiniti: /\binfiniti\b/i,
  BMW: /\bbmw\b/i,
  Audi: /\baudi\b/i,
  Volvo: /\bvolvo\b/i,
};

function hostOf(website, domains) {
  if (Array.isArray(domains) && domains[0]) return String(domains[0]).replace(/^www\./i, '').toLowerCase();
  const bare = String(website || '').trim().replace(/^https?:\/\//i, '').split('/')[0];
  return bare ? bare.replace(/^www\./i, '').toLowerCase() : '';
}

function slugify(brand) {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function fetchDirectory() {
  const res = await fetch(`http://${AUTH_HOST}:${AUTH_PORT}/api/dealerships`, {
    headers: { 'X-Trimscout-Api-Key': KEY },
  });
  if (!res.ok) throw new Error(`/api/dealerships -> ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.dealerships) ? json.dealerships : [];
}

const directory = await fetchDirectory();
console.log(`Loaded ${directory.length} dealership_contacts rows from the live directory.`);

let grandTotal = 0;
let grandExcluded = 0;

for (const [brand, matcher] of Object.entries(BRAND_MATCHERS)) {
  const byState = new Map();
  const seenNameDomain = new Set();
  let excluded = 0;
  let unsupportedState = 0;
  let noDomain = 0;
  let dup = 0;
  let matched = 0;

  for (const d of directory) {
    const name = String(d.dealerName || '').trim();
    if (!name || !matcher.test(name)) continue;
    matched++;
    const state = String(d.state || '').trim().toUpperCase();
    const domain = hostOf(d.website, d.domains);
    if (!domain) { noDomain++; continue; }
    if (!SUPPORTED_STATES.includes(state)) { unsupportedState++; continue; }
    if (isMegadealerOrSuperstore({ name, domain })) { excluded++; continue; }

    const rec = buildDealerRecord({ name, city: d.city || null, domain, make: brand, state, lat: null, lng: null });
    const dedupKey = `${rec.name.toLowerCase()}|${rec.domain.toLowerCase()}`;
    if (seenNameDomain.has(dedupKey)) { dup++; continue; }
    seenNameDomain.add(dedupKey);

    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(rec);
  }

  const total = [...byState.values()].reduce((sum, arr) => sum + arr.length, 0);
  grandTotal += total;
  grandExcluded += excluded;
  console.log(`${brand}: ${matched} name-matched -> ${total} materialized across ${byState.size} states (${excluded} superstore/combo-excluded, ${unsupportedState} unsupported-state, ${noDomain} no-domain, ${dup} dup)`);

  if (!DRY_RUN) {
    const slug = slugify(brand);
    for (const [state, dealers] of byState) {
      const outDir = path.join(ROOT, 'dealers', state.toLowerCase());
      await fs.mkdir(outDir, { recursive: true });
      dealers.sort((a, b) => a.name.localeCompare(b.name));
      await fs.writeFile(path.join(outDir, `${slug}.json`), `${JSON.stringify(dealers, null, 2)}\n`);
    }
  }
}

console.log(`\n${DRY_RUN ? 'DRY RUN — nothing written.' : 'Materialization complete.'} Grand total: ${grandTotal} dealers materialized, ${grandExcluded} excluded as superstore/combo chains.`);
