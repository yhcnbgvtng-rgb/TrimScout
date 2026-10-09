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
// Widened 2026-10-01 from the live Jeep Wrangler facet: "MYFLEXCARE SERVICE PLAN" (5,226 vehicles)
// is a dealer-sold service plan, the same category as the "maintenance plan" already listed. Also
// dealer-listing boilerplate from DealerOn description text ("2020 Jeep Wrangler Unlimited 4x4 for
// sale in Grand Rapids", "As an award-winning Ford Dealership").
const NON_OPTION_TERMS = /\b(fees?|deductible|warranty|warranties|coverage|documentation|doc|registration|title|taxe?s?|financ(?:e|ed|ing)|apr|down payment|rebates?|incentives?|service contract|service[\s-]+plans?|protection plan|maintenance plan|insurance|cash|bonus|msrp|owner|carfax|accidents?|credit|for[\s-]+sale|dealership|award[\s-]+winning|test[\s-]+drive)\b/i;
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

// The rules below were added 2026-10-01. Each is written so it means the same thing on a raw label
// and on its normalized canonical_key (lowercased, punctuation collapsed to single spaces), so the
// write path and the purge script's key-only classifier share one definition instead of two.

// A fragment of a prose list split on its commas: "and Mazda MX-5 Miata", "As an award-winning Ford
// Dealership", "or ..." (confirmed live in DealerOn description-derived rows). A real option name is
// a noun phrase and never opens with a conjunction. "in"/"at"/"to"/"by" are deliberately NOT here:
// "In-Dash Navigation" is a real option.
const LEADING_CONJUNCTION = /^(?:and|as|or|but|for|of)\s/i;

// A vehicle listing title, not an option: "2020 Jeep Wrangler Unlimited 4x4 for sale in Grand
// Rapids". A model year followed by more words. A bare year alone is already BARE_NUMBER_OR_CURRENCY.
const LEADING_MODEL_YEAR = /^(?:19[89]\d|20[0-4]\d)\s+[a-z]/i;

// The tail of a screen size split at its decimal point by the old description parser: "12.3"
// Display" became "3 Display", "8.4 Touchscreen Display" became "4 Touchscreen Display" (both live,
// 1,565 Wrangler vehicles for the first). Exactly ONE leading digit, so real sizes like "10-inch
// Touchscreen" or "12.3-inch Display" are untouched.
const SPLIT_SCREEN_SIZE = /^\d\s*"?\s*(?:touch\s*screen|display|screen)\b/i;

// Labels that are a heading, a call to action, or a truncated stub rather than an option: "For More
// Info" (1,201 Wrangler vehicles), "Exp" (1,618), "Equipment". Whole-label match only.
const GENERIC_STUB = /^(?:exp|equipment|options?|features?|details|highlights|specs|specifications|more info|for more info|see dealer|call for details|click here|other|misc|n a|na|none|standard|optional|standard equipment|optional equipment|installed options|additional options)$/i;

// A listing-position code used as a name ("OPT-35", "PKG 7") — different on every vehicle for the
// same real option, so it identifies nothing. Previously only the buyer catalog filtered these; now
// the write path drops them too, before they ever reach the facet table.
const LISTING_POSITION = /^(?:opt|option|code|pkg)[\s-]*\d+$/i;


// ---- Deny rules added 2026-10-07 (option-normalize audit, docs/OPTION_NORMALIZE_AUDIT_2026-10-07.md) ----
// Each rule is anchored/narrow on purpose and means the same thing on a raw label and on its normalized
// canonical_key (lowercased, punctuation collapsed), so the write path and the key-only purge classifier
// share ONE definition. Deliberately NO broad rules on a trailing digit ("Sync 4"), a lowercase start
// ("heated mirrors"), a leading digit ("10-Speed Automatic") or a slash ("Radio: AM/FM/HD") — all real options.
export const DENY_RULES = [
  // Cross-references: "See toyota", "See onstar", "See dealer or vw".
  // (A footnote number can sit in front: "56 See toyota".)
  ["see-ref", /^(?:\d{1,3}\s+)?see\s+[a-z]/i],
  // A screen size split at its decimal and left as a bare "<n> in": "3 In", "5 in", "9 in".
  ["bare-size", /^\d+(?:\.\d+)?\s*-?\s*(?:in|inch|inches)\.?$|^\d+(?:\.\d+)?\s*"$/i],
  // The ".com" tail of a URL split off at the dot: "com", "com or dealer for details", "com/connected-services ...".
  ["url-crumb", /(?:^|\s)com(?:[\/\s)]|$)|https?:|www\.|\.com\b|\bmygarage\b/i],
  ["see-details", /\bfor (?:important )?details\b/i],
  // OnStar / SiriusXM / Apple / Google legal and plan boilerplate fragments.
  ["legal-boilerplate", /\btrademarks?\b|\bregistered in the\b|\bactive data plan\b|\bdata allowance\b|\bconnected devices\b|\bon your car display\b|\btrial subscription\b/i],
  // A section header glued to the next spec line: "Standard EquipmentExterior18-in".
  ["glued-header", /^(?:standard|optional) equipment[a-z]/i],
  // Instrument-cluster items every car has — exact words only ("digital gauge cluster with settings" stays).
  ["instrument", /^(?:clock|digital clock|odometer|trip odometer|fuel gauge|tachometer|speedometer)$/i],
  // Single words left behind when a sentence was split ("ECO" is a real Toyota drive mode and is NOT here).
  ["stub-word", /^(?:look|now|inc|tag|plus|news|artists|creators|comedy|live sports|talk and news|durability|mud|snow|cooled|rear|power)$/i],
  // A spec label whose value was cut off: bare "Engine"/"Transmission"/"Wheels"/"Tires"/"Radio", "Engine: 3",
  // "Wheels: 18 x 7", "Radio: AM/FM 8", a lone "17 x 7", "illuminated 3".
  ["spec-truncated", /^(?:engine|transmission|wheels?|tires?|radio)\b[^a-z]*(?:[a-z]{2,3}[\/\s][a-z]{2,3}(?:[\/\s][a-z]{2,3})?\s+)?[\d\s.x\/]*$|^(?:1[4-9]|2\d)\s*x\s*\d+(?:\.\d+)?$|^illuminated \d$|^bluetooth\W*streaming audio and \d usb c \d$/i],
  // A parenthesis opened and never closed (or closed and never opened): the comma split cut the label.
  ["unbalanced-paren", /^[^(]*\)|\([^)]*$/],
  // Ends on a word that can only continue a sentence.
  ["dangling", /\b(?:with|and|or|for|to|of|until)$/i],
  // Second-person marketing copy.
  ["marketing", /\b(?:you|your)\b|\bset the pace\b|\bcleaning and adjusting\b/i],

  // ---- Added 2026-10-08: fragments split at a period, a .com or a comma that the first pass missed. Real strings from
  // the live facet table (Toyota + Chevrolet, ranks 1-260 by vehicles). Same rule of thumb as above: anchored, narrow,
  // and nothing here may match a real option ("2 USB Data Ports", "20 Inch Aluminum Wheels", "Sync 4" all stay).
  // SiriusXM genre/channel words left over when its blurb was split: "artists" "creators" "comedy" "to comedy" "talk and sports".
  ["siriusxm-genre", /^(?:to\s+)?(?:comedy|artists|creators|news|sports|talk|talk and (?:sports|news)|live sports|pop|rock|hip hop|country|jazz|classic rock)$|\bcurated by\b|\bpodcasts? and more\b|^car and driver$/i],
  // Whole-label single words that are the leftovers of a split sentence or a list heading (exact match only).
  ["stub-word-2", /^(?:panic|audio|side|quarter|lower|dust|rocks|uplevel|inside|tags|license|trucks|comfort|colors|packages|awards?:?|extra wide|neutral density|body side|fuel range|tire pressure|oil life|average fuel economy|www|nhtsa|canada)$/i],
  // A length unit left alone when a size was split at its decimal: "-ft", "5-ft", "5 ft", "2 gal".
  ["bare-unit", /^-?\s*\d*\s*-?\s*(?:ft|feet|gal|gallons?)\.?$/i],
  // A one-digit engine displacement split at its decimal: "4L V6", "5L DOHC", "5L 4-Cylinder" (real ones read "2.5L").
  ["split-displacement", /^\d\s*l\b/i],
  // A spec label whose number was cut: "Torque: 170 lb", "Torque: 17", "Axle Ratio: 3", "583 Axle Ratio".
  ["spec-cut", /^torque\b[^a-z]*\d*\s*(?:lb)?\.?$|^(?:\d+\s+)?axle ratio\W*\d*$/i],
  // A screen size split at its decimal that kept the word "diagonal": "4 diagonal touch-screen display Use".
  ["split-diagonal", /^\d\s*(?:"|in(?:ch)?)?\s*diagonal\b/i],
  // Dealer-site boilerplate that landed in the options list.
  ["dealer-boilerplate", /\btrade-?ins? accepted\b|\brecent arrival\b|\bdealer is not responsible\b|\btypographic(?:al)? errors\b|\bdmv paperwork\b|\btrouble-free handling\b|\bdealers in the continental\b|\bgold certified\b|^\W*certified\W*$|^\W*vehicle history\W*$|^\W*option packages\W*$|\bserving [a-z]+$|\b[a-z]+ county$/i],
  // A sentence, not an option name: opens on a word no option name opens with.
  ["sentence-lead", /^(?:when|if|it|they|these|those|there|such as|after|without|requires|includes|find the|pedestrians|forward collision mitigation is|horsepower calculations)\b/i],
];

/** The deny rule a label trips, or null. Raw labels and normalized keys are both fine input. */
// "Wheels: 18 x 8" is a real wheel-size spec, kept (owner decision 2026-10-07). Bare "Wheels"/"Tires" stay dropped.
const WHEEL_SIZE_SPEC = /^wheels?\W*\d+(?:[.\s]\d+)?\s*x\s*\d+(?:[.\s]\d+)?$/i;

export function denyRuleFor(text) {
  const t = String(text || "").trim();
  if (!t || WHEEL_SIZE_SPEC.test(t.replace(/^[^a-z0-9]+/i, ""))) return null;
  for (const [name, re] of DENY_RULES) if (re.test(t)) return name;
  return null;
}

// Truncated labels whose full form is certain, repaired instead of dropped (never invents anything else):
// the comma-split parser used to cut "Multi-Information Display (MID, ...)" after "(MID".
const TRUNCATION_REPAIRS = [
  [/^multi[\s-]*information display \(mid$/i, (l) => `${l})`],
  // Toyota's footnote numbers glued in front of a feature name make ~60 spellings of one option: "21 Lane Departure Alert
  // with Steering Assist (LDA w/SA)", "42 Lane Tracing Assist (LTA)". Stripped ONLY in front of these exact feature names, so
  // "20 Inch Aluminum Wheels" or "2 USB Data Ports" are never touched.
  [/^\d{1,3}\s+(?=(?:Lane (?:Departure|Tracing)|Road Sign Assist|Automatic High Beams|Full-Speed Range|Dynamic Radar|Proactive Driving|Traction Control|auto LSD))/i, (l) => l.replace(/^\d{1,3}\s+/, "")],
];

/** Repairs a known truncated label; returns the label unchanged when there is nothing to repair. */
export function repairTruncatedLabel(label) {
  const t = String(label || "").trim();
  for (const [re, fix] of TRUNCATION_REPAIRS) if (re.test(t)) return fix(t);
  return t;
}

// Shared by looksLikeNonOptionText (raw labels) and looksLikeJunkCanonicalKey (normalized keys).
function looksLikeFragmentOrBoilerplate(text) {
  const t = text.trim();
  const words = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (
    LEADING_CONJUNCTION.test(t) ||
    LEADING_MODEL_YEAR.test(t) ||
    SPLIT_SCREEN_SIZE.test(t) ||
    GENERIC_STUB.test(words) ||
    LISTING_POSITION.test(t)
  );
}

// The rules that existed before the 2026-10-07 deny list. Split out so the backfill report can attribute
// each drop to "legacy" (already dropped today) vs a NEW deny rule (incremental), with no double counting.
export function looksLikeLegacyNonOptionText(label) {
  // Leading punctuation ("$0 ...", "(0 A) Marsh Gray") doesn't hide a split-number fragment.
  const trimmed = label.trim();
  const unbulleted = label.replace(/^[^a-z0-9]+/i, "");
  return (
    NON_OPTION_TERMS.test(label) ||
    SPLIT_NUMBER_FRAGMENT.test(unbulleted) ||
    BARE_DATE.test(trimmed) ||
    BARE_NUMBER_OR_CURRENCY.test(trimmed) ||
    MENTIONS_MILEAGE.test(label) ||
    LONG_CAPS_RUN_GLUED_ON.test(label) ||
    looksLikeFragmentOrBoilerplate(unbulleted)
  );
}

export function looksLikeNonOptionText(label) {
  return looksLikeLegacyNonOptionText(label) || denyRuleFor(label.replace(/^[^a-z0-9]+/i, "")) !== null;
}

// Several options joined into one string by the dealer's own feed: "4 Display; Rear View Auto Dim
// Mirror; GPS Navigation; 8" (live, a DealerOn description). Kept whole it is junk (and usually long
// enough to trip the sentence filter, losing the real options inside it); split, the real parts
// survive and the fragments are dropped by the same rules as everything else. Semicolons, pipes and
// bullets only — never commas or slashes, which real option names use ("Wiper/Washer", "Front,
// Rear and Side Airbags").
const LIST_SEPARATOR = /\s*(?:;|\||•)\s*/;

export function splitOptionLabel(rawName) {
  const parts = String(rawName || "").split(LIST_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [];
}

/**
 * @param {unknown} options
 * @param {{ resolveKey?: (key: string) => ({ key: string, label: string } | null) }} [opts]
 *   resolveKey maps a dealer key to an allowlisted canonical option (factoryOptionAllowlist.js's
 *   resolveAllowlisted, bound to the vehicle's make). A hit stores the canonical key and label so
 *   every dealer spelling of one real option lands on one key; a miss keeps the dealer key as-is
 *   (still subject to every junk rule) — the buyer catalog, not the write path, decides what to show.
 * @returns {{ rows: Array<{ key: string, label: string, code: string | null }>, junkDropped: number, dropped: Array<{ label: string, rule: string }>, repaired: Array<{ from: string, to: string }> }}
 * One row per distinct canonical key. Identity comes from the option's NAME, never its raw
 * per-listing `code` (a listing-position number like "OPT-35", different on every vehicle for the
 * same real option); a code with no name has nothing stable to key on and is skipped.
 */
export function optionRowsFromOptions(options, opts = {}) {
  const resolveKey = typeof opts.resolveKey === "function" ? opts.resolveKey : null;
  const byKey = new Map();
  let junkDropped = 0;
  const dropped = []; // { label, rule } for every dropped label — the backfill's per-make report reads this
  const repaired = []; // { from, to }
  if (!Array.isArray(options)) return { rows: [], junkDropped, dropped, repaired };
  for (const o of options) {
    const rawName = o && typeof o.name === "string" ? o.name.trim() : "";
    if (!rawName) continue;
    const parts = splitOptionLabel(rawName);
    // A code belongs to the option it was listed with — never copy it onto parts split out of a
    // joined list, where it can't be attributed to any one of them.
    const code = parts.length === 1 ? str(o.code, 32) : null;
    for (const rawPart of parts) {
      const part = repairTruncatedLabel(rawPart);
      if (part !== rawPart) repaired.push({ from: rawPart, to: part });
      // Checked on the raw, pre-truncation text — see looksLikeOptionSentence's own length note.
      if (looksLikeOptionSentence(part) || looksLikeNonOptionText(part)) {
        junkDropped++;
        // "legacy" = already dropped before the deny list; otherwise the NEW rule that caught it (incremental only).
        const legacy = looksLikeOptionSentence(part) || looksLikeLegacyNonOptionText(part);
        dropped.push({ label: part, rule: legacy ? "legacy" : denyRuleFor(part.replace(/^[^a-z0-9]+/i, "")) });
        continue;
      }
      let label = part.slice(0, 160);
      let key = normalizeOptionKey(label);
      if (!key) continue;
      const canonical = resolveKey ? resolveKey(key) : null;
      if (canonical) ({ key, label } = canonical);
      if (!byKey.has(key)) byKey.set(key, { key, label, code });
    }
  }
  return { rows: [...byKey.values()], junkDropped, dropped, repaired };
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
    MENTIONS_MILEAGE.test(key) ||
    looksLikeFragmentOrBoilerplate(key) ||
    // "unbalanced-paren" can't be seen on a key (punctuation is already stripped); every other rule can.
    denyRuleFor(key) !== null
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

/** Whether a stored (canonical_key, label) is fit to show a buyer as a pickable factory option. */
export function isBuyerFacingOption(key, label) {
  if (typeof key !== "string" || typeof label !== "string") return false;
  const cleanLabel = buyerOptionLabel(label);
  // Checked on the CLEANED label, not the raw one: a mojibake bullet in front ("â?¢ Black 3-Piece
  // Hard Top") is stripped by buyerOptionLabel and leaves a perfectly good name. Checking the raw
  // label hid real, popular options — live 2026-10-01, Jeep Wrangler's "Black 3-Piece Hard Top"
  // (7,355 vehicles) and "Stop-Start Dual Battery System" (7,071) never reached the filter panel.
  // Mojibake that survives cleaning (mid-label) still means the text can't be trusted.
  if (MOJIBAKE.test(cleanLabel)) return false;
  if (cleanLabel.length < 3 || cleanLabel.length > 60) return false;
  if (key.split(" ").length > 9) return false; // a spec run-on, not an option name
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
 *
 * @param {{ gate?: boolean, resolve?: (key: string) => ({ key: string, label: string } | null) }} [opts]
 *   gate: true = allowlist mode for this make — ONLY options `resolve` vouches for are shown, under
 *   their allowlisted label (OPTION_CATALOG_MODE=allowlist AND this make has an allowlist; a make
 *   with none falls back to the heuristic list rather than going blank). The returned `key` is
 *   always the STORED canonical_key, because that is what optionKeys= matches; before the options
 *   backfill re-keys old rows, two stored spellings of one allowlisted option fold to whichever has
 *   more vehicles (same rule as the label fold below), and become one exact key after it.
 */
export function buyerOptionCatalog(rows, opts = {}) {
  const gate = Boolean(opts.gate) && typeof opts.resolve === "function";
  const byLabel = new Map();
  for (const r of rows) {
    const vehicleCount = Number(r.vehicleCount);
    if (!(vehicleCount >= CATALOG_MIN_VEHICLES) || !isBuyerFacingOption(r.canonical_key, r.label)) continue;
    let label = buyerOptionLabel(r.label);
    if (gate) {
      const vouched = opts.resolve(r.canonical_key);
      if (!vouched) continue;
      label = vouched.label;
    }
    const prev = byLabel.get(label.toLowerCase());
    // Two keys can differ only in punctuation we already display identically ("Sync 4" / "SYNC 4"
    // normalize to one key, but near-variants exist) — keep the bigger one, never sum: they
    // describe overlapping vehicles, so a sum would overstate the count.
    if (!prev || vehicleCount > prev.vehicleCount) byLabel.set(label.toLowerCase(), { key: r.canonical_key, label, vehicleCount });
  }
  return [...byLabel.values()].sort((a, b) => b.vehicleCount - a.vehicleCount || a.label.localeCompare(b.label)).slice(0, CATALOG_MAX_OPTIONS);
}
