// Turns one vehicle's raw options list (the same shape stored in dealer_inventory.options_json —
// [{ code, name, price, kind }]) into the canonicalized rows dealer_inventory_options holds, the
// table behind buyer /search's factory-options facet.
//
// Shared by handleInventoryBulk (every nightly upsert) and the options backfill script, so both
// apply exactly the same rules. Pure and importable — deals_api_server.js starts a real server at
// import time, so the rules can only be unit-tested from here.
//
// The #333 junk-sentence filter runs HERE, at the one place every option passes through on its way
// into the facet table, not just at one extraction site: before this, looksLikeOptionSentence() only
// guarded Dealer.com option descriptions inside the crawler, so Dealer.com package names, schema.org
// free-text features, and every row stored before #333 still reached the facet unfiltered.

import { looksLikeOptionSentence } from "./optionSentenceFilter.js";

// Lowercase, strip punctuation, collapse whitespace — mirrors lib/factoryOptionCatalog.ts's
// normalizeOptionKey() (a separate pipeline/table, but the same identity principle: two
// differently-worded/coded mentions of the same real option should resolve to the same key).
// Expands known abbreviations BEFORE normalizing so "B&W" doesn't collapse to a meaningless "b w".
const OPTION_SYNONYM_EXPANSIONS = [
  [/\bb\s*&\s*w\b/gi, "bowers wilkins"],
];

export function normalizeOptionKey(label) {
  let s = String(label || "").trim().toLowerCase();
  for (const [pattern, replacement] of OPTION_SYNONYM_EXPANSIONS) s = s.replace(pattern, replacement);
  return s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const str = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

// Dealer-side charges, finance and after-sale products that free-text descriptions list alongside
// equipment — never factory options. Confirmed live 2026-09-28 in the Honda CR-V facet ("$0
// Deductible Coverage", "00 Dealer Document Processing Fee", "Doc Fee").
const NON_OPTION_TERMS = /\b(fees?|deductible|warranty|warranties|coverage|documentation|doc|registration|title|taxe?s?|financing|apr|down payment|rebates?|incentives?|service contract|protection plan|maintenance plan|insurance)\b/i;
// A label that starts with a bare "0"/"00" is the tail of a number the old description parser split
// at its decimal point ("$899.00 ..." -> "00 ...", "2.0-amp" -> "0-amp"); real option names don't
// start that way. Fixed at the source in descriptionFeatures.js; this cleans what's already stored.
const SPLIT_NUMBER_FRAGMENT = /^0+(?!\d)/;

export function looksLikeNonOptionText(label) {
  return NON_OPTION_TERMS.test(label) || SPLIT_NUMBER_FRAGMENT.test(label.replace(/^\$/, ""));
}

/**
 * @returns {{ rows: Array<{ key: string, label: string, code: string | null }>, junkDropped: number }}
 * One row per distinct canonical key. Identity comes from the option's NAME, never its raw
 * per-listing `code` (a listing-position number like "OPT-35", different on every vehicle for the
 * same real option); a code with no name has nothing stable to key on and is skipped.
 */
export function optionRowsFromOptions(options) {
  const byKey = new Map();
  let junkDropped = 0;
  if (!Array.isArray(options)) return { rows: [], junkDropped };
  for (const o of options) {
    const rawName = o && typeof o.name === "string" ? o.name.trim() : "";
    if (!rawName) continue;
    // Checked on the raw, pre-truncation text — see looksLikeOptionSentence's own length note.
    if (looksLikeOptionSentence(rawName) || looksLikeNonOptionText(rawName)) { junkDropped++; continue; }
    const label = rawName.slice(0, 160);
    const key = normalizeOptionKey(label);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { key, label, code: str(o.code, 32) });
  }
  return { rows: [...byKey.values()], junkDropped };
}

/**
 * Whether a bulk-upsert payload carries option information at all. `null`/missing/empty means the
 * crawl extracted nothing THIS time (a fallback page strategy, a partial page, a transient failure) —
 * not that the vehicle has no options. dealer_inventory.options_json already keeps the last real
 * value in that case (COALESCE in the upsert); the facet table must do the same instead of wiping
 * the vehicle's rows, which is what it used to do.
 */
export function payloadHasOptions(options) {
  return Array.isArray(options) && options.length > 0;
}
