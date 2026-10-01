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
// Deductible Coverage", "00 Dealer Document Processing Fee", "Doc Fee"). Widened 2026-09-30 after
// sampling live Jeep/Toyota/Ford junk: "cash"/"bonus"/"financed" catch OEM incentive-program
// boilerplate ("$3000 - Retail Customer Cash", "$500 - 2026 National Bonus Cash", "$20 per $1000
// financed") that "financing"/"rebates?" alone didn't — these are rebate program NAMES, not the
// word "rebate" itself, so they need their own terms rather than relying on stemming "financing".
// Widened again 2026-09-30 after the first purge still left two more live Jeep Grand Cherokee
// Limited categories standing: bare MSRP-discount phrasing ("122 off MSRP!", "010 off MSRP" — no
// "cash"/"bonus"/"financed" word, just a different incentive phrasing) and vehicle-history/
// condition disclosures ("1 Owner Clean Carfax", "1-OWNERCLEAN AUTO CHECK WITH NO ACCIDENTS
// REPORTED") — a buyer's-guide/condition statement about THIS specific used car, never a factory
// option on any car. "credit" catches dealer-applied credits ("$100 Tire Credit") the same way.
const NON_OPTION_TERMS = /\b(fees?|deductible|warranty|warranties|coverage|documentation|doc|registration|title|taxe?s?|financ(?:e|ed|ing)|apr|down payment|rebates?|incentives?|service contract|protection plan|maintenance plan|insurance|cash|bonus|msrp|owner|carfax|accidents?|credit)\b/i;
// A label that starts with a bare "0"/"00" is the tail of a number the old description parser split
// at its decimal point ("$899.00 ..." -> "00 ...", "2.0-amp" -> "0-amp"); real option names don't
// start that way. Fixed at the source in descriptionFeatures.js; this cleans what's already stored.
const SPLIT_NUMBER_FRAGMENT = /^0+(?!\d)/;

// A real calendar date (MM/DD/YYYY or MM/DD/YY, optionally wrapped in parens) LEADING the label —
// confirmed live 2026-09-30: 57,501 rows of literally just "09/30/2026" alone (an OEM incentive
// program's expiration date), but also, after the first purge, many more rows where that same
// expiration date is glued onto the FRONT of something else with no separator — a real option name
// ("09/30/2026 Apple CarPlay"), a price/incentive sentence ("09/30/2026 Price includes $620 of
// dealer added accessories"), or even a full vehicle description ("09/30/2026 Steel Blue 2027 Jeep
// Grand Cherokee Limited 2") — the same missing-separator concatenation bug class documented
// elsewhere in this crawler, just prepending instead of mid-word. Anchored to the START only (not
// requiring the whole string to be just the date), so any of these glued variants are caught, not
// just the bare date alone — a row this corrupted can't be trusted to have the REST of its text
// intact either, so it's dropped rather than an attempt made to strip the date and keep the tail.
// Validates month 01-12 and day 01-31 so this can never reject a real option that happens to start
// with slash-separated numbers for an unrelated reason (confirmed against the live "40/20/40 Split
// Bench Seat" family — "40" is not a valid month OR day, so it never matches regardless of what
// follows).
const BARE_DATE = /^[(]?(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(?:\d{2}|19\d{2}|20\d{2})\)?(?:\s|$)/;

// A label that is ONLY one or more digit groups (each optionally "$"-prefixed, comma-grouped, with
// a decimal point), optionally separated by spaces or hyphens — a dealer fee amount, a finance
// payment figure, a zip code, a bare year, or a numeric code RANGE, never a factory option name.
// Confirmed live 2026-09-30: "$30", "506", "995", "78705" (an Austin, TX zip in a delivery-radius
// disclaimer), "2023"/"2026" (bare model/promo years), and "001-120" (a bare code range — the
// hyphen-separated form specifically called out in the live /search repro). Requires every
// hyphen/space-separated segment to be purely numeric, so "4WD", "360-Degree Camera", "10-Speed
// Automatic Transmission", and "20-inch Wheels..." are untouched (their non-numeric segment breaks
// the match).
const BARE_NUMBER_OR_CURRENCY = /^\$?[\d,]+(?:\.\d+)?(?:[\s-]+\$?[\d,]+(?:\.\d+)?)*$/;

// Mileage/location/delivery-radius marketing text, never a factory option — confirmed live
// 2026-09-30: "Free deliveries within 200 miles", "Located 2 Miles north of Isanti", "With only 3
// miles on the odometer", and bare "<N> miles" alone (demo-mileage disclosures, not a spec). No
// genuine factory option name in the live sample set (24.1M rows) mentions mileage at all — tire/
// warranty specs that do are already caught by NON_OPTION_TERMS' warranty/coverage terms.
const MENTIONS_MILEAGE = /\bmiles?\b/i;

// A real Monroney-sticker-style spec line glued onto the NEXT one with no separator between them —
// confirmed live 2026-09-30 as the single largest remaining category by vehicle count after the
// first two purge rounds: "Standard EquipmentMECHANICAL3" (two section headers run together,
// "Standard Equipment" + "MECHANICAL", plus a trailing footnote digit), "Hill Hold Control and
// Electric Parking BrakeEXTERIOR20 x 8" (an equipment line + "EXTERIOR" + the start of a wheel
// spec). A long (4+) run of consecutive uppercase letters immediately after a lowercase letter,
// with no space between them, is never real option-name capitalization (a real brand name that
// does this — "SiriusXM" — only ever has a SHORT run: 2 letters, "XM"), so the length threshold is
// exactly what keeps this from ever matching it. Deliberately NOT a general camelCase detector: a
// bare single-capital transition ("RatioNormal", "DisplayRadio" — two Title-Case words run
// together with no space) is indistinguishable from a real brand name doing the same thing without
// a dictionary, so those are left as a known, accepted residual — same trade-off this file already
// documents elsewhere for low-confidence cases.
const LONG_CAPS_RUN_GLUED_ON = /[a-z][A-Z]{4,}/;

export function looksLikeNonOptionText(label) {
  // Leading punctuation ("$0 ...", "(0 A) Marsh Gray") doesn't hide a split-number fragment.
  const trimmed = label.trim();
  return (
    NON_OPTION_TERMS.test(label) ||
    SPLIT_NUMBER_FRAGMENT.test(label.replace(/^[^a-z0-9]+/i, "")) ||
    BARE_DATE.test(trimmed) ||
    BARE_NUMBER_OR_CURRENCY.test(trimmed) ||
    MENTIONS_MILEAGE.test(label) ||
    LONG_CAPS_RUN_GLUED_ON.test(label)
  );
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

// looksLikeOptionSentence/looksLikeNonOptionText are written for the RAW label (real punctuation —
// slashes, "$", commas) and run on every write. The one-shot purge script instead needs to classify
// the ~850K already-stored DISTINCT canonical_key values as cheaply as possible: confirmed live
// 2026-09-30, grouping 24.1M rows by canonical_key to also pull one real label per group (needed to
// run the raw-label checks above) took 13+ minutes — reading canonical_key alone off its own
// covering index (idx_opt_canonical) took 28s. canonical_key is already lowercased with every
// run of punctuation collapsed to a single space (normalizeOptionKey), so a few of the raw-label
// patterns need an adapted, space-separated form here — this function is intentionally A SEPARATE
// classifier from looksLikeNonOptionText, not a shared call, because "safe to run on normalized
// text" is a different, narrower claim than "safe to run on raw text":
//   - BARE_DATE: "09/30/2026 Apple CarPlay" -> "09 30 2026 apple carplay" (slashes become spaces) —
//     same month/day validation and same LEADING-date match (not whole-string), space-separated.
//   - BARE_NUMBER_OR_CURRENCY: "$30" -> "30" and "001-120" -> "001 120" still match (every
//     hyphen/space-separated segment purely numeric); a COMMA-formatted number doesn't ("$1,000" ->
//     "1 000" — same shape as "001 120" above, so this one is NOT actually a gap: both read as
//     "two numeric segments separated by a space" once normalized, same as the raw-label pattern
//     reads "001-120" as two segments separated by a hyphen). The raw-label check in
//     looksLikeNonOptionText still runs independently on every future WRITE either way.
//   - NON_OPTION_TERMS / MENTIONS_MILEAGE / SPLIT_NUMBER_FRAGMENT / looksLikeOptionSentence's
//     marker words: unaffected by normalization (the words themselves survive intact), used as-is.
//   - LONG_CAPS_RUN_GLUED_ON has NO normalized equivalent here, on purpose: normalizeOptionKey
//     lowercases everything, which destroys the exact signal this check depends on (a run of
//     UPPERCASE immediately after lowercase). A key like "standard equipmentmechanical3" is
//     genuinely indistinguishable, after normalization, from any other run-together lowercase text
//     — this purge pass cannot find rows already stored with this specific defect. They're still
//     caught going forward by looksLikeNonOptionText on every new WRITE (nightly sync, backfill);
//     an already-corrupted stored row of this exact shape needs either a slower, label-reading
//     purge pass, or simply waits to self-heal the next time that vehicle is re-crawled.
const BARE_DATE_NORMALIZED = /^(0?[1-9]|1[0-2]) (0?[1-9]|[12]\d|3[01]) (?:\d{2}|19\d{2}|20\d{2})(?:\s|$)/;
const BARE_NUMBER_NORMALIZED = /^\d+(?:\s+\d+)*$/;

export function looksLikeJunkCanonicalKey(key) {
  if (typeof key !== "string" || !key) return false;
  return (
    looksLikeOptionSentence(key) ||
    NON_OPTION_TERMS.test(key) ||
    SPLIT_NUMBER_FRAGMENT.test(key) ||
    BARE_DATE_NORMALIZED.test(key) ||
    BARE_NUMBER_NORMALIZED.test(key) ||
    MENTIONS_MILEAGE.test(key)
  );
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

// ---- Buyer-facing option catalog hygiene -------------------------------------------------------
// The /search "Factory options" list is a shopper's checklist, not a data dump. Measured live
// 2026-10-01: Ford F-150 had 95,895 (model, trim, key) facet rows and only 4,111 with 20+ vehicles —
// the rest is long-tail dealer free text that no shopper can pick or meaningfully filter on. The
// catalog endpoint therefore keeps only keys with real volume, drops anything that still looks like
// junk or a listing-position code, caps the list, and cleans the labels.

/** Fewer vehicles than this and an option is noise, not something a shopper can usefully filter on. */
export const CATALOG_MIN_VEHICLES = 25;
/** The list a shopper actually scrolls — most common first. */
export const CATALOG_MAX_OPTIONS = 60;

// "opt 35" — a listing-position code (confirmed live 2026-09-25), not an option name.
const LISTING_POSITION_KEY = /^(?:opt|option|code|pkg)\s*\d+$/;

/** Whether a stored (canonical_key, label) is fit to show a buyer as a pickable factory option. */
export function isBuyerFacingOption(key, label) {
  if (typeof key !== "string" || typeof label !== "string") return false;
  if (MOJIBAKE.test(label)) return false;
  const cleanLabel = buyerOptionLabel(label);
  if (cleanLabel.length < 3 || cleanLabel.length > 60) return false;
  if (key.split(" ").length > 9) return false; // a spec run-on, not an option name
  if (LISTING_POSITION_KEY.test(key)) return false;
  if (!/[a-z]/.test(key)) return false; // digits/symbols only
  return !looksLikeJunkCanonicalKey(key) && !looksLikeNonOptionText(cleanLabel);
}

// Mojibake from a UTF-8 bullet/dash decoded as Latin-1 ("â?¢", "Â·") — a label carrying it can't be
// trusted to be clean anywhere else either, so it is dropped rather than repaired.
const MOJIBAKE = /[\u00c2\u00c3\u00e2][\u0080-\u00bf?\u2018-\u203a]/;

/** Plain-English display label: bullets/asterisks/punctuation trimmed off both ends, collapsed whitespace, SHOUTING dealer text title-cased. */
export function buyerOptionLabel(label) {
  const clean = String(label || "").replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9)"%]+$/, "").replace(/\s+/g, " ").trim();
  if (clean.length > 4 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) {
    return clean.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }
  return clean;
}

/**
 * Raw facet rows ({ canonical_key, label, vehicleCount }, any order) -> the buyer-facing list:
 * junk removed, labels cleaned, same-label duplicates folded together, most common first, capped.
 */
export function buyerOptionCatalog(rows) {
  const byLabel = new Map();
  for (const r of rows) {
    const vehicleCount = Number(r.vehicleCount);
    if (!(vehicleCount >= CATALOG_MIN_VEHICLES) || !isBuyerFacingOption(r.canonical_key, r.label)) continue;
    const label = buyerOptionLabel(r.label);
    const prev = byLabel.get(label.toLowerCase());
    // Two keys can differ only in punctuation we already display identically ("Sync 4" / "SYNC 4"
    // normalize to one key, but near-variants exist) — keep the bigger one, never sum: they
    // describe overlapping vehicles, so a sum would overstate the count.
    if (!prev || vehicleCount > prev.vehicleCount) byLabel.set(label.toLowerCase(), { key: r.canonical_key, label, vehicleCount });
  }
  return [...byLabel.values()].sort((a, b) => b.vehicleCount - a.vehicleCount || a.label.localeCompare(b.label)).slice(0, CATALOG_MAX_OPTIONS);
}
