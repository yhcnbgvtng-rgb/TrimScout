// Trim normalizer for Chevrolet / GMC / Toyota / Ram, modeled on fordTrim.js: dealer feeds write the trim as a sentence
// ("4WD Crew Cab 147\" LT Trail Boss", "SR5 Double Cab 5' Bed V6 AT", "BIG HORN CREW CAB 4X4 5'7 BOX"). This pulls the official trim out of that
// text, per model, and leaves everything it cannot read exactly as it came. Official lists and the measured data are in
// docs/trim-normalize/oem-probe-2026-10-27.md (box2 read-only probe, active rows, 2026-10-27).
//
// Models: Silverado (1500 / 2500HD / 3500HD, LD / LTD), Tahoe, Equinox (not Equinox EV), Sierra (same spellings as Silverado, not Sierra EV),
// Yukon / Yukon XL, Tacoma, Tundra, RAV4 (Hybrid / Prime / Plug-in Hybrid), Camry, Highlander (Hybrid), Ram 1500 / 2500 (+ Classic).
//
// Same contract as fordTrim.js: HTML entities and ®/™ are cleaned first (cleanFordTrimText, one implementation for both files), a trim is only
// rewritten when exactly one official trim can be read out of the text, and everything else (a blank, engine / cab / bed text, a dealer name,
// two trims it cannot choose between) comes back unchanged. The caller keeps the original text in trim_raw whenever a row is rewritten.
// "Base" / "L" / "Grade" are official where listed but never a target: they are not matched inside longer text.
//
// Used where fordTrim.js is: the crawler (standalone.js), the sync client (scripts/box/inventory-sync.mjs), the deals-API write path
// (handleInventoryBulk) and the box2 clean-up script. `normalizeTrimForWrite` is the one entry point those use: Ford first, then these makes.
import { cleanFordTrimText, normalizeFordTrimForWrite } from './fordTrim.js';

export const cleanOemTrimText = cleanFordTrimText;

const SILVERADO = ['WT', 'Custom', 'Custom Trail Boss', 'LT', 'LT Trail Boss', 'RST', 'LTZ', 'High Country', 'ZR2', 'LS'];
const SIERRA = ['Pro', 'SLE', 'Elevation', 'SLT', 'AT4', 'AT4X', 'AT4X AEV Edition', 'Denali', 'Denali Ultimate'];
const RAM_COMMON = ['Tradesman', 'Big Horn', 'Lone Star', 'Big Horn/Lone Star', 'Laramie', 'Laramie Longhorn', 'Longhorn', 'Limited', 'Limited Longhorn', 'Rebel', 'Tungsten', 'Warlock', 'Express', 'Sport', 'SLT', 'ST', 'SSV'];

// group -> { make, official, exactOnly (official but never matched inside text), alias (squashed phrase -> official trim, matched inside text), addon }
//   addon: trims that are an appearance / add-on word next to a real trim ("Laramie Sport Appearance"), dropped when another trim is in the same string.
const GROUPS = {
  Silverado: { make: 'Chevrolet', official: SILVERADO, alias: { 'WORK TRUCK': 'WT' } },
  Tahoe: { make: 'Chevrolet', official: ['LS', 'LT', 'RST', 'Z71', 'Premier', 'High Country', 'LTZ', 'Commercial', 'Police'] },
  Equinox: { make: 'Chevrolet', official: ['LS', 'LT', 'RS', 'Premier', 'Activ', 'LTZ'] },
  Sierra: { make: 'GMC', official: SIERRA, addon: ['Pro'] },
  Yukon: { make: 'GMC', official: ['SLE', 'SLT', 'Elevation', 'AT4', 'AT4 Ultimate', 'Denali', 'Denali Ultimate'] },
  Tacoma: { make: 'Toyota', official: ['SR', 'SR5', 'TRD Sport', 'TRD Off-Road', 'TRD Pro', 'Limited', 'Trailhunter', 'Trail Edition', 'TRD PreRunner', 'PreRunner', 'Base'], exactOnly: ['Base'] },
  Tundra: { make: 'Toyota', official: ['SR', 'SR5', 'Limited', 'Platinum', '1794 Edition', 'TRD Pro', 'Capstone', 'Grade', 'Base'], exactOnly: ['Grade', 'Base'], alias: { 1794: '1794 Edition' } },
  RAV4: { make: 'Toyota', official: ['LE', 'XLE', 'XLE Premium', 'SE', 'XSE', 'Limited', 'Adventure', 'TRD Off-Road', 'Woodland', 'GR Sport', 'Sport', 'Platinum', 'Base'], exactOnly: ['Base'], addon: ['Sport'] },
  Camry: { make: 'Toyota', official: ['L', 'LE', 'SE', 'XLE', 'XSE', 'TRD', 'SE Nightshade', 'Base'], exactOnly: ['L', 'Base'], alias: { NIGHTSHADE: 'SE Nightshade' } },
  Highlander: { make: 'Toyota', official: ['L', 'LE', 'LE Plus', 'XLE', 'SE', 'XSE', 'Limited', 'Limited Platinum', 'Platinum', 'Bronze Edition', 'Sport', 'Base'], exactOnly: ['L', 'Base'], alias: { BRONZE: 'Bronze Edition' }, addon: ['Sport'] },
  'Ram 1500': { make: 'Ram', official: [...RAM_COMMON, 'RHO', 'TRX'], addon: ['Sport'], alias: { BIGHORN: 'Big Horn', 'BIG HORNLONE STAR': 'Big Horn/Lone Star', 'BIGHORN LONESTAR': 'Big Horn/Lone Star', LONESTAR: 'Lone Star' } },
  'Ram 2500': { make: 'Ram', official: [...RAM_COMMON, 'Black Express', 'Power Wagon'], addon: ['Sport'], alias: { POWERWAGON: 'Power Wagon', BIGHORN: 'Big Horn', 'BIG HORNLONE STAR': 'Big Horn/Lone Star', 'BIGHORN LONESTAR': 'Big Horn/Lone Star', LONESTAR: 'Lone Star' } },
};

// Upper-case, every run of non-alphanumerics becomes one space: "TRD Off-Road", "TRD Off Road", "Trd_off Road" compare equal.
const squash = (s) => ` ${String(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;

const VOCAB = {};
for (const [group, g] of Object.entries(GROUPS)) {
  const exact = new Set(g.exactOnly || []);
  const entries = g.official.filter((t) => !exact.has(t)).map((t) => ({ trim: t, key: squash(t) }));
  for (const [phrase, trim] of Object.entries(g.alias || {})) entries.push({ trim, key: squash(phrase) });
  VOCAB[group] = entries.sort((a, b) => b.key.length - a.key.length); // longest first: "LT Trail Boss" before "LT", "Denali Ultimate" before "Denali"
}

const MODEL_RE = [
  ['Chevrolet', 'Silverado', /^silverado(?: ?(?:1500|2500|3500)(?: ?(?:hd|ld|ltd|limited))?| ?(?:hd|ld|ltd|limited))?$/i],
  ['Chevrolet', 'Tahoe', /^tahoe$/i],
  ['Chevrolet', 'Equinox', /^equinox$/i],
  ['GMC', 'Sierra', /^sierra(?: ?(?:1500|2500|3500)(?: ?(?:hd|ld|ltd|limited))?| ?(?:hd|ld|ltd|limited))?$/i],
  ['GMC', 'Yukon', /^yukon(?: xl)?(?: ?1500)?$/i],
  ['Toyota', 'Tacoma', /^tacoma$/i],
  ['Toyota', 'Tundra', /^tundra$/i],
  ['Toyota', 'RAV4', /^rav4(?: (?:hybrid|prime|plug-?in hybrid|phev))?$/i],
  ['Toyota', 'Camry', /^camry$/i],
  ['Toyota', 'Highlander', /^highlander(?: hybrid)?$/i],
  ['Ram', 'Ram 1500', /^1500(?: classic)?$/i],
  ['Ram', 'Ram 2500', /^2500(?: classic)?$/i],
];

/** The profiled group ("Silverado", "Ram 1500", ...) for a make + model label, or null. Silverado / Sierra EV, chassis cabs, Equinox EV and Camry-like unlisted models are out. */
export function oemTrimGroup(make, model) {
  const mk = String(make || '').trim().toLowerCase();
  const md = String(model || '').trim().replace(/\s+/g, ' ');
  if (!mk || !md) return null;
  for (const [m, group, re] of MODEL_RE) if (m.toLowerCase() === mk && re.test(md)) return group;
  return null;
}

/** The official trim list for a make + model, or null (display layer and tests). */
export function officialOemTrims(make, model) {
  const group = oemTrimGroup(make, model);
  return group ? GROUPS[group].official.slice() : null;
}

function hitsIn(group, text) {
  let s = squash(text).replace(' SPORT UTILITY ', ' SUV ').replace(' SPORT APPEARANCE PACKAGE ', ' PKG ').replace(' SPORT APPEARANCE ', ' PKG ');
  const hits = [];
  for (const { trim, key } of VOCAB[group]) {
    if (s.includes(key)) { if (!hits.includes(trim)) hits.push(trim); s = s.replace(key, ' @ '); } // consumed, so "LT" is not found again inside "LT Trail Boss"
  }
  return hits;
}

/**
 * Classify and normalize one Chevrolet / GMC / Toyota / Ram trim.
 * @returns {{ trim: string|null, status: 'clean'|'fix'|'ambiguous'|'leftover'|'blank'|'skipped', hits?: string[] }}
 *   `trim` is what to store: the official trim for 'fix', the input unchanged otherwise.
 */
export function normalizeOemTrim({ make, model, trim } = {}) {
  const group = oemTrimGroup(make, model);
  if (!group) return { trim: trim ?? null, status: 'skipped' };
  const original = trim == null ? '' : String(trim).trim();
  if (!original) return { trim: trim ?? null, status: 'blank' };
  const g = GROUPS[group];
  const raw = cleanOemTrimText(original);
  if (g.official.includes(raw)) return raw === original ? { trim: raw, status: 'clean' } : { trim: raw, status: 'fix', hits: [raw] };
  let hits = hitsIn(group, raw);
  // A trim contained in a longer one found in the same string is the longer one's own word ("Big Horn" inside "Big Horn/Lone Star").
  hits = hits.filter((x) => !hits.some((y) => x !== y && squash(y).includes(squash(x))));
  if (hits.length > 1 && g.addon) { const kept = hits.filter((x) => !g.addon.includes(x)); if (kept.length) hits = kept; }
  // Silverado: a Trail Boss in the text with only LT / Custom matched means the Trail Boss variant was written in a shape we do not read ("LT Z71 Trail Boss"): leave it.
  if (group === 'Silverado' && hits.length === 1 && (hits[0] === 'LT' || hits[0] === 'Custom') && /\bTRAIL BOSS\b/.test(squash(raw))) return { trim: trim ?? null, status: 'ambiguous', hits: [hits[0], 'Trail Boss'] };
  if (hits.length === 1) return { trim: hits[0], status: 'fix', hits };
  if (hits.length === 0) return { trim: trim ?? null, status: 'leftover' };
  return { trim: trim ?? null, status: 'ambiguous', hits };
}

/** The write-path form `{ trim, trimRaw, status }`, same as normalizeFordTrimForWrite: `trimRaw` is the dealer's original text, only when the trim is rewritten. */
export function normalizeOemTrimForWrite({ make, model, trim, maxLen = 160 } = {}) {
  const r = normalizeOemTrim({ make, model, trim });
  if (r.status !== 'fix') return { trim: trim ?? null, trimRaw: null, status: r.status };
  const original = String(trim).trim();
  return { trim: r.trim, trimRaw: original === r.trim ? null : original.slice(0, maxLen), status: 'fix' };
}

/** The one entry point for the write paths: Ford (fordTrim.js) first, then Chevrolet / GMC / Toyota / Ram. Same return shape as both. */
export function normalizeTrimForWrite({ make, model, trim, maxLen = 160 } = {}) {
  const f = normalizeFordTrimForWrite({ make, model, trim, maxLen });
  if (f.status !== 'skipped') return f;
  return normalizeOemTrimForWrite({ make, model, trim, maxLen });
}

/**
 * For the /search display rule. null = not one of these models (the caller decides). Otherwise `unofficial` is true when the stored text is not an official trim
 * (a sentence, a dealer name, engine text); a pure spelling variant of an official trim ("TRD Off Road", "Trd_sport", "RST" in lower case) is not unofficial and carries its `canonical` spelling.
 */
export function classifyOemTrim({ make, model, trim } = {}) {
  if (!oemTrimGroup(make, model)) return null;
  const original = trim == null ? '' : String(trim).trim();
  if (!original) return { unofficial: false, canonical: null };
  const r = normalizeOemTrim({ make, model, trim });
  if (r.status === 'clean') return { unofficial: false, canonical: null };
  if (r.status === 'fix' && squash(cleanOemTrimText(original)) === squash(r.trim)) return { unofficial: false, canonical: r.trim };
  return { unofficial: true, canonical: null };
}
