#!/usr/bin/env node
// One-time materialization of dealers/<state>/<brand>.json for the
// expansion brand set (Ford/Lincoln/Chevrolet/GMC/Buick/Cadillac/
// Stellantis — see nj_policy.js's NJ_BRANDS_IN_EXPANSION). Unlike the core
// brands, these don't have a per-state OEM-locator dump write-<state>-
// dealer-files.mjs script pulls from; they have their own dedicated
// nationwide dealer-contact-crawl rosters instead (real data delivered
// 2026-09 — see the project memory for each brand). This script reads
// those rosters, applies the same production policy (buildDealerRecord,
// isMegadealerOrSuperstore, SUPPORTED_STATES) every other brand goes
// through, and writes one file per state per brand.
//
// Requires CRAWLER_BRAND_SET=expansion so isMegadealerOrSuperstore applies
// the expansion carve-out (combo/multi-franchise dealers allowed, only
// true superstore chains excluded — see that function's own comment).
// Refuses to run otherwise, so this never silently materializes files
// under the wrong policy.
//
// Usage:
//   CRAWLER_BRAND_SET=expansion node scripts/materialize-expansion-dealer-files.mjs
//   CRAWLER_BRAND_SET=expansion node scripts/materialize-expansion-dealer-files.mjs --dry-run

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDealerRecord, isMegadealerOrSuperstore } from '../src/nj_policy.js';
import { SUPPORTED_STATES } from '../src/states.js';

if (process.env.CRAWLER_BRAND_SET !== 'expansion') {
  console.error('Refusing to run: CRAWLER_BRAND_SET=expansion must be set (see this file\'s header comment).');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// dealer-rosters/ is untracked (never committed — see its own directory),
// so it only exists in the main TrimScout checkout, not this git worktree.
// Hardcoded to that checkout rather than resolved relative to this file.
const DEALER_ROSTERS_DIR = '/Users/paul/Claude - GitHub/TrimScout/scrapers/dealer-rosters';
const DRY_RUN = process.argv.includes('--dry-run');

const ARCHIVE = '/Users/paul/Claude - GitHub/TrimScout-crawl-archive-2026-09-12';
const SIZING_SCRATCH = '/private/tmp/claude-501/-Users-paul-Claude---GitHub/28223fad-cc93-4a16-9c2c-56b5b83d84ea/scratchpad/box3-sizing';

// Minimal RFC4180-ish CSV parser (handles quoted fields with embedded
// commas/newlines and "" escaped quotes) — no CSV dependency in package.json,
// and every source file here is a plain comma-delimited export, so a small
// hand-rolled parser is simpler than adding a new dependency for one script.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])));
}

function hostOf(url) {
  const bare = String(url || '').trim().replace(/^https?:\/\//i, '').split('/')[0];
  if (!bare) return '';
  return bare.replace(/^www\./i, '').toLowerCase();
}

async function loadCsvRows(filePath, { nameCol, cityCol, stateCol, websiteCol }) {
  const text = await fs.readFile(filePath, 'utf-8');
  return parseCsv(text).map((r) => ({
    name: (r[nameCol] || '').trim(),
    city: (r[cityCol] || '').trim(),
    state: (r[stateCol] || '').trim().toUpperCase(),
    domain: hostOf(r[websiteCol]),
  })).filter((r) => r.name);
}

async function loadJsonRows(filePath, { nameKey, cityKey, stateKey, websiteKey }) {
  const rows = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  return rows.map((r) => ({
    name: (r[nameKey] || '').trim(),
    city: (r[cityKey] || '').trim(),
    state: (r[stateKey] || '').trim().toUpperCase(),
    domain: hostOf(r[websiteKey]),
  })).filter((r) => r.name);
}

const SOURCES = {
  Ford: () => loadCsvRows(
    `${ARCHIVE}/ford_dealer_build/all_ford_contacts_nationwide_dedup_names.csv`,
    { nameCol: 'dealer_name', cityCol: 'city', stateCol: 'state', websiteCol: 'website' },
  ),
  Chevrolet: () => loadJsonRows(
    `${SIZING_SCRATCH}/chevrolet_nationwide.json`,
    { nameKey: 'dealer_name', cityKey: 'city', stateKey: 'state', websiteKey: 'website' },
  ),
  GMC: () => loadCsvRows(
    `${ARCHIVE}/gmc_dealer_build/gmc_all_contacts_nationwide_v2.csv`,
    { nameCol: 'dealer_name', cityCol: 'city', stateCol: 'state', websiteCol: 'website' },
  ),
  Buick: () => loadCsvRows(
    `${DEALER_ROSTERS_DIR}/buick/Buick_Dealer_Contacts_NATIONWIDE.csv`,
    { nameCol: 'Dealer Name', cityCol: 'City', stateCol: 'State', websiteCol: 'Website' },
  ),
  Cadillac: () => loadCsvRows(
    `${DEALER_ROSTERS_DIR}/cadillac/Cadillac_Dealer_Contacts_NATIONWIDE.csv`,
    { nameCol: 'Dealer Name', cityCol: 'City', stateCol: 'State', websiteCol: 'Website' },
  ),
  Lincoln: () => loadCsvRows(
    `${DEALER_ROSTERS_DIR}/lincoln/Lincoln_Dealer_Contacts_NATIONWIDE.csv`,
    { nameCol: 'Dealer Name', cityCol: 'City', stateCol: 'State', websiteCol: 'Website' },
  ),
  Stellantis: () => loadJsonRows(
    `${ARCHIVE}/stellantis_dealer_build/final_merged.json`,
    { nameKey: 'dealer_name', cityKey: 'city', stateKey: 'state', websiteKey: 'website' },
  ),
};

function slugify(brand) {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

let grandTotal = 0;
let grandExcluded = 0;

for (const [brand, loader] of Object.entries(SOURCES)) {
  const raw = await loader();
  const byState = new Map();
  const seenNameDomain = new Set();
  let excluded = 0;
  let unsupportedState = 0;

  for (const row of raw) {
    if (!row.domain) continue; // no website on file — can't crawl inventory without one
    if (!SUPPORTED_STATES.includes(row.state)) { unsupportedState++; continue; }
    if (isMegadealerOrSuperstore({ name: row.name, domain: row.domain })) { excluded++; continue; }

    const rec = buildDealerRecord({
      name: row.name,
      city: row.city,
      domain: row.domain,
      make: brand,
      state: row.state,
    });
    const dedupKey = `${rec.name.toLowerCase()}|${rec.domain.toLowerCase()}`;
    if (seenNameDomain.has(dedupKey)) continue;
    seenNameDomain.add(dedupKey);

    if (!byState.has(row.state)) byState.set(row.state, []);
    byState.get(row.state).push(rec);
  }

  const total = [...byState.values()].reduce((sum, arr) => sum + arr.length, 0);
  grandTotal += total;
  grandExcluded += excluded;
  console.log(`${brand}: ${raw.length} raw -> ${total} materialized across ${byState.size} states (${excluded} superstore-excluded, ${unsupportedState} unsupported-state, ${raw.length - total - excluded - unsupportedState} no-domain/dup)`);

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

console.log(`\n${DRY_RUN ? 'DRY RUN — nothing written.' : 'Materialization complete.'} Grand total: ${grandTotal} dealers materialized, ${grandExcluded} excluded as superstore chains.`);
