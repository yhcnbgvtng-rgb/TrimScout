// Ford trim normalizer: dealer feeds write the trim as a sentence ("4X4 CREWCAB XLT", "F 250 Lariat", "ST Line", "XLT 4WD SuperCrew 5.5'").
// This pulls the official Ford trim out of that text, per model, and leaves everything it cannot read exactly as it came.
// Mapping rules and the measured effect are in docs/trim-normalize/ford-probe-2026-10-26.md (358,539 active Ford rows, 2026-10-26).
//
// Used in three places, like stellantisMake.js: the crawler (modelNormalizer.js, after extraction), the deals-API write path
// (handleInventoryBulk, which also catches stale shards and not-yet-updated boxes), and the box2 clean-up script for existing rows.
//
// Never invents a trim: a string with no official trim in it (engine text, "Preferred", a dealer name), a blank, and a string that names
// two trims it cannot choose between all come back unchanged. "Base" and the Escape "S" are deliberately not matched inside longer text
// (too generic: "Base 4 Door 4x4", "S" as a stray letter), so a row is never moved to them; a row that already says exactly "Base" or "S" is left alone.
// The caller keeps the original text (dealer_inventory.trim_raw) whenever a row is rewritten, so nothing is lost.

// The nine models profiled. `Super Duty` folds F-250/350/450/550 in every dealer spelling; `Expedition` includes Expedition MAX (MAX is a length).
const OFFICIAL = {
  'F-150': ['XL', 'STX', 'XLT', 'Lariat', 'King Ranch', 'Platinum', 'Limited', 'Tremor', 'Raptor R', 'Raptor'],
  'Super Duty': ['XL', 'XLT', 'Lariat', 'King Ranch', 'Platinum', 'Limited', 'Tremor'],
  Ranger: ['XL', 'STX', 'XLT', 'Lariat', 'Tremor', 'Raptor'],
  Maverick: ['XL', 'XLT', 'Lariat', 'Tremor', 'Lobo'],
  Bronco: ['Base', 'Big Bend', 'Black Diamond', 'Outer Banks', 'Badlands', 'Wildtrak', 'Heritage Limited', 'Heritage', 'Everglades', 'Raptor', 'First Edition', 'Stroppe Edition'],
  Explorer: ['Base', 'Active', 'ST-Line', 'ST', 'XLT', 'Limited', 'Platinum', 'King Ranch', 'Timberline', 'Police Interceptor', 'Tremor', 'Sport', 'Eddie Bauer'],
  Escape: ['S', 'SE', 'SEL', 'Titanium', 'ST-Line Select', 'ST-Line Elite', 'ST-Line', 'Platinum', 'Active', 'XLS', 'XLT', 'Limited'],
  Expedition: ['XL', 'XLT', 'Limited', 'King Ranch', 'Platinum', 'Timberline', 'Tremor', 'Active', 'Eddie Bauer'],
  Mustang: ['EcoBoost Premium', 'EcoBoost', 'GT Premium', 'GT', 'Dark Horse', 'Mach 1', 'Shelby GT500', 'Shelby GT350', 'Bullitt', 'Base', 'V6 Premium', 'V6', 'GT Deluxe', 'Boss 302', 'Cobra', 'Shelby Super Snake', 'RTR'],
};
// Never matched inside longer text (see the header). An exact "Base" / "S" is still an official value, just not a target.
const NOT_A_TARGET = new Set(['Base', 'S']);
// Where a dealer's spelling is a known alias for another official trim.
const ALIAS = { 'DARK HORSE SC': 'Dark Horse', 'DARK HORSE PREMIUM': 'Dark Horse', 'HERITAGE EDITION': 'Heritage', 'HERITAGE LIMITED EDITION': 'Heritage Limited', 'LOBO STANDARD': 'Lobo', 'LOBO HIGH': 'Lobo' };

// Upper-case, every run of non-alphanumerics becomes one space: "ST-Line", "ST Line", "St_Line" compare equal.
const squash = (s) => ` ${String(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;

const VOCAB = {};
for (const [group, list] of Object.entries(OFFICIAL)) {
  VOCAB[group] = list
    .filter((t) => !NOT_A_TARGET.has(t))
    .map((t) => ({ trim: t, key: squash(t) }))
    .sort((a, b) => b.key.length - a.key.length); // longest first: "GT Premium" before "GT", "XLT" before "XL"
}

/** The profiled model group for a Ford model label, or null. */
export function fordModelGroup(model) {
  const m = String(model || '').trim();
  if (!m) return null;
  if (/^F-?150$/i.test(m)) return 'F-150';
  if (/^(Super Duty|F-?[2-7]\d0)/i.test(m) && !/lightning/i.test(m)) return 'Super Duty';
  if (/^Expedition( MAX)?$/i.test(m)) return 'Expedition';
  if (/^(Ranger|Maverick|Bronco|Explorer|Escape|Mustang)$/i.test(m)) return m[0].toUpperCase() + m.slice(1).toLowerCase();
  return null;
}

function hitsIn(group, text) {
  let s = squash(text)
    .replace(' SPORT UTILITY ', ' SUV ').replace(' SPORT APPEARANCE PACKAGE ', ' PKG ').replace(' SPORT APPEARANCE ', ' PKG ');
  const hits = [];
  for (const { trim, key } of VOCAB[group]) {
    if (s.includes(key)) { hits.push(trim); s = s.replace(key, ' @ '); } // consumed, so "XL" is not found again inside "XLT"
  }
  return hits;
}

/**
 * Classify and normalize one Ford trim.
 * @returns {{ trim: string|null, status: 'clean'|'fix'|'ambiguous'|'leftover'|'blank'|'skipped', hits?: string[] }}
 *   `trim` is what to store: the official trim for 'fix', the input unchanged otherwise.
 */
export function normalizeFordTrim({ make, model, trim } = {}) {
  const group = /^ford$/i.test(String(make || '').trim()) ? fordModelGroup(model) : null;
  if (!group) return { trim: trim ?? null, status: 'skipped' };
  const raw = trim == null ? '' : String(trim).trim();
  if (!raw) return { trim: trim ?? null, status: 'blank' };
  if (OFFICIAL[group].includes(raw)) return { trim: raw, status: 'clean' };
  const alias = ALIAS[squash(raw).trim()];
  if (alias && OFFICIAL[group].includes(alias)) return { trim: alias, status: 'fix', hits: [alias] };
  let hits = hitsIn(group, raw);
  // A trim contained in a longer one found in the same string is the longer one's own word ("GT" inside "GT Premium").
  hits = hits.filter((x) => !hits.some((y) => x !== y && squash(y).includes(squash(x))));
  // Tremor is a package on these lines (it rides on an XL / XLT / Lariat ...): keep the real trim. On F-150 and the SUVs it is a trim.
  if (hits.length > 1 && hits.includes('Tremor') && (group === 'Super Duty' || group === 'Ranger' || group === 'Maverick')) hits = hits.filter((x) => x !== 'Tremor');
  if (hits.length === 2 && hits.includes('XL') && hits.includes('STX')) hits = ['STX'];
  // Appearance / tuner add-ons next to a real trim.
  if (hits.length > 1) hits = hits.filter((x) => x !== 'Sport' && x !== 'RTR').length ? hits.filter((x) => x !== 'Sport' && x !== 'RTR') : hits;
  if (group === 'Bronco' && hits.length === 2 && hits.includes('Heritage') && hits.includes('Heritage Limited')) hits = ['Heritage Limited'];
  if (hits.length === 1) {
    let out = hits[0];
    if (group === 'Bronco' && out === 'Heritage' && /\bLIMITED\b/i.test(raw)) out = 'Heritage Limited';
    return { trim: out, status: 'fix', hits };
  }
  if (hits.length === 0) return { trim: trim ?? null, status: 'leftover' };
  return { trim: trim ?? null, status: 'ambiguous', hits };
}

/**
 * The write-path form: `{ trim, trimRaw }`. `trimRaw` is the dealer's original text, set only when the trim is rewritten (null otherwise),
 * so a column that is null means "what you see is what the dealer sent".
 */
export function normalizeFordTrimForWrite({ make, model, trim, maxLen = 160 } = {}) {
  const r = normalizeFordTrim({ make, model, trim });
  if (r.status !== 'fix') return { trim: trim ?? null, trimRaw: null, status: r.status };
  const original = String(trim).trim();
  return { trim: r.trim, trimRaw: original === r.trim ? null : original.slice(0, maxLen), status: 'fix' };
}
