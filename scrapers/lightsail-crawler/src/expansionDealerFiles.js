// Direct reader for the expansion brand set's pre-materialized dealer
// files (Ford/Lincoln/Chevrolet/GMC/Buick/Cadillac/Stellantis — see
// nj_policy.js's NJ_BRANDS_IN_EXPANSION).
//
// Every STATE_DEALER_LOADERS entry in dealer-bot-report.mjs (loadNjDealers,
// loadNcDealers, ...) sources its dealers exclusively from
// oem_locator.js's locatorRowsForState(), which reads dealers/oem-dumps/ —
// and that directory only ever holds OEM-locator dumps for *core* brands.
// Expansion brands were onboarded through a separate one-off nationwide
// dealer-contact-crawl instead (scripts/materialize-expansion-dealer-
// files.mjs), which writes its output straight to
// dealers/<state>/<brand>.json in the same buildDealerRecord shape core
// brands' write-<state>-dealer-files.mjs scripts produce — but nothing
// downstream ever reads those files back except the real crawl itself
// (standalone.js, via CRAWLER_DEALERS_FILE). Setting CRAWLER_BRAND_SET=
// expansion does NOT fix this: it only changes which brands
// isNjBrandIn()/isNjBrandOut() allow through, not where the dealer rows
// come from — so an expansion-brand dealer was structurally invisible to
// dealer-bot-report.mjs no matter what env var was set. Confirmed live
// 2026-09-23: dealers/nc/ford.json has real, current dealers (including
// Mark Ficken Ford) that loadNcDealers() can never return.
//
// This reads those already-materialized files directly, so
// dealer-bot-report.mjs can merge them in alongside the OEM-locator-backed
// core brands with no special-casing beyond "concat the two lists."

import fs from 'node:fs';
import path from 'node:path';
import { NJ_BRANDS_IN_EXPANSION, canonicalBrandName } from './nj_policy.js';

function slugify(brand) {
  return String(brand || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // No file for this state/brand yet (never materialized, or a state
    // this brand simply has no rooftops in) — not an error.
    return [];
  }
}

// Mirrors loadNjDealers()'s {cwd, brand} signature and dealer-record shape
// so callers can merge this straight into an OEM-locator-backed list.
export function loadExpansionDealersForState(state, { cwd = process.cwd(), brand = null } = {}) {
  const stateSlug = String(state || '').toLowerCase();
  const brands = brand
    ? NJ_BRANDS_IN_EXPANSION.filter((b) => canonicalBrandName(b) === canonicalBrandName(brand))
    : NJ_BRANDS_IN_EXPANSION;
  const out = [];
  for (const b of brands) {
    const file = path.join(cwd, 'dealers', stateSlug, `${slugify(b)}.json`);
    out.push(...readJsonArray(file));
  }
  return out;
}
