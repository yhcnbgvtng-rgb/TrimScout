// Brand-aware model/trim/body_style normalizer.
//
// ROOT CAUSE (confirmed live, 2026-08-26): different Dealer.com sites format
// their own DDC.dataLayer `model` field inconsistently — some cleanly
// separate model/trim in their own dataLayer, others bake the trim and/or
// body-style into the model string itself (e.g. "Macan S", "Cayenne GTS
// Coupe", "911 Carrera 4S Cabriolet"). standalone.js's Strategy 1 (DDC) and
// Strategy 2b (Porsche's own retailer platform) both extract `model`
// directly from each source's own field, uncleaned. This file is a single
// place to un-mix those three fields after extraction, per brand.
//
// Also confirmed live: the `body_style` column is NOT mostly null (it's
// ~95% populated for Porsche) but carries its own, separate contamination —
// some sources report a raw "bodyStyle" value that's actually a drivetrain
// + trim mashup ("S AWD", "GTS AWD", "4 AWD", "Carrera 4S Cabriolet")
// instead of a real shape category (SUV/Coupe/Sedan/...). This module
// cleans that too, routing the real trim/model tokens found inside a
// contaminated body_style value to the right place and leaving only a
// genuine shape category (or null) in body_style.
//
// Only Porsche has real logic today (`normalizePorscheFields`); other
// brands pass through `normalizeVehicleFields` unchanged until they need
// their own equivalent.

// ---------------------------------------------------------------------------
// Porsche vocabulary
// ---------------------------------------------------------------------------

// Canonical base model lines. Order doesn't matter — matching always picks
// the longest candidate that matches at the start of the (parenthetical-
// stripped) model string, case-insensitively.
const BASE_MODEL_CANON = {
  '911': '911',
  '718': '718',
  boxster: 'Boxster',
  cayman: 'Cayman',
  cayenne: 'Cayenne',
  macan: 'Macan',
  panamera: 'Panamera',
  taycan: 'Taycan',
  '924': '924',
  '356': '356',
};
const BASE_MODELS = Object.keys(BASE_MODEL_CANON).sort((a, b) => b.length - a.length);

// Genuine trim/performance-level tokens (moved OUT of `model`, INTO `trim`).
// Deliberately does NOT include bare "GT"/"CT" — those only mean anything
// paired with "Turbo" (handled as a 2-word lookahead below); an unpaired
// "GT"/"CT" isn't in this real dataset and isn't guessed at.
const TRIM_WORD_CANON = {
  s: 'S',
  '4s': '4S',
  gts: 'GTS',
  t: 'T',
  r: 'R',
  rs: 'RS',
  turbo: 'Turbo',
  carrera: 'Carrera',
  // Bare "4" is Porsche's AWD-tier trim qualifier ("Panamera 4", "Taycan
  // 4", the electric "Macan 4"). Only ever reached here as a *standalone*
  // leftover token after the base model has already been stripped off
  // (so "718"/"924"'s own digits are never at risk of being reinterpreted
  // as this token — they're consumed whole, as the base model, above).
  '4': '4',
};

// Real, Porsche-marketed nameplate/powertrain suffixes that stay attached
// to `model` (these distinguish genuinely different product lines, e.g.
// "Cayenne Coupe" is its own model page on porsche.com, not a trim of
// "Cayenne"). "Targa" is included here rather than in the trim list above:
// Porsche's own model-line structure treats Coupe / Cabriolet / Targa as
// sibling body styles of the 911 (porsche.com groups them exactly that
// way), the same way "Coupe" stays attached to "Cayenne". Keeping Targa
// consistent with Coupe/Cabriolet here (append-to-model) rather than
// trim avoids a special case; a real Targa's own trim qualifiers (4, 4S,
// GTS) still fall through to TRIM_WORD_CANON normally, e.g. raw
// "911 Targa 4 GTS" -> model "911 Targa", trim "4 GTS".
const BODY_APPEND_WORD_CANON = {
  coupe: 'Coupe',
  cabriolet: 'Cabriolet',
  electric: 'Electric',
  ev: 'Electric',
  'e-hybrid': 'E-Hybrid',
  spyder: 'Spyder',
  targa: 'Targa',
};
// 2-word nameplate suffixes ("Cross Turismo", "Sport Turismo") — neither
// word means anything alone, so these are matched as an adjacent pair
// before falling through to single-word classification.
const BODY_APPEND_PAIRS = {
  'cross turismo': 'Cross Turismo',
  'sport turismo': 'Sport Turismo',
};
// 2-word trim suffixes where the second word ("GT"/"CT") isn't a
// standalone recognized token — only meaningful paired with "Turbo".
const TRIM_PAIRS = {
  'turbo gt': 'Turbo GT',
  'turbo ct': 'Turbo CT',
};

// Real shape categories for the dedicated body_style column.
const REAL_BODY_STYLE_CANON = {
  suv: 'SUV',
  'sport utility': 'SUV',
  coupe: 'Coupe',
  sedan: 'Sedan',
  convertible: 'Convertible',
  cabriolet: 'Cabriolet',
  hatchback: 'Hatchback',
  wagon: 'Wagon',
  crossover: 'Crossover',
  targa: 'Targa',
};
// Drivetrain noise that shows up baked into some sources' bodyStyle field.
// Not a body shape and there's no drivetrain column in the schema (out of
// scope to add one — schema is not being modified) — dropped rather than
// misfiled.
const DRIVETRAIN_NOISE = new Set(['awd', 'rwd']);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Combines an existing trim value with newly-extracted trim words, without
// duplicating tokens the existing value already carries (e.g. model "Macan
// S" + existing trim "S" must NOT become "S S"). Newly-extracted words win
// placement (they carry the fuller context, e.g. "Carrera 4S" extracted
// from model vs. a lone "4S" already sitting in trim), any genuinely extra
// existing word is appended after.
function mergeTrim(existingTrim, extractedWords) {
  const ex = (existingTrim || '').trim();
  const ext = extractedWords.join(' ').trim();
  if (!ext) return ex || null;
  if (!ex) return ext;
  if (ex.toLowerCase() === ext.toLowerCase()) return ex;
  const extLowerWords = ext.toLowerCase().split(/\s+/);
  const exWords = ex.split(/\s+/).filter((w) => !extLowerWords.includes(w.toLowerCase()));
  return exWords.length ? `${ext} ${exWords.join(' ')}` : ext;
}

// Cleans the body_style column's own raw value. Returns the real shape
// category (or null if none was recognized) plus any trim/model words that
// were actually found mashed into it, so the caller can route those to the
// right field instead of dropping them.
function normalizeBodyStyleField(rawBodyStyle) {
  if (!rawBodyStyle) return { bodyStyle: null, extraTrimWords: [], extraModelWords: [] };
  const s = rawBodyStyle.trim();
  if (!s) return { bodyStyle: null, extraTrimWords: [], extraModelWords: [] };

  // Fast path: already a single real value (the common case — ~95% of
  // Porsche body_style values today are already exactly this).
  if (REAL_BODY_STYLE_CANON[s.toLowerCase()]) {
    return { bodyStyle: REAL_BODY_STYLE_CANON[s.toLowerCase()], extraTrimWords: [], extraModelWords: [] };
  }

  const words = s.split(/\s+/);
  let realBodyStyle = null;
  const extraTrimWords = [];
  const extraModelWords = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wl = w.toLowerCase();

    if (i + 1 < words.length) {
      const pair = `${wl} ${words[i + 1].toLowerCase()}`;
      if (REAL_BODY_STYLE_CANON[pair]) {
        realBodyStyle = REAL_BODY_STYLE_CANON[pair];
        i++;
        continue;
      }
    }

    if (DRIVETRAIN_NOISE.has(wl)) continue; // e.g. "AWD"/"RWD" — dropped, not a shape
    if (wl === 'ev') { extraModelWords.push('Electric'); continue; }
    if (REAL_BODY_STYLE_CANON[wl]) { realBodyStyle = REAL_BODY_STYLE_CANON[wl]; continue; }
    if (BODY_APPEND_WORD_CANON[wl]) { extraModelWords.push(BODY_APPEND_WORD_CANON[wl]); continue; }
    if (TRIM_WORD_CANON[wl]) { extraTrimWords.push(TRIM_WORD_CANON[wl]); continue; }
    // Genuinely unrecognized word inside a contaminated body_style value —
    // dropped rather than kept (keeping it would just relocate the same
    // contamination), and not guessed at.
  }
  return { bodyStyle: realBodyStyle, extraTrimWords, extraModelWords };
}

// The core Porsche normalizer. Pure function — never mutates its input,
// safe/idempotent to run on already-clean data (a second pass over its own
// output reproduces the same output), which matters both because the
// crawler will run it on every crawl and because the backfill script
// diffs old vs. new to decide what to write.
export function normalizePorscheFields({ model, trim, bodyStyle }) {
  const bs = normalizeBodyStyleField(bodyStyle);

  if (!model || !model.trim()) {
    // No model text to parse. Still fold in anything real recovered from a
    // contaminated body_style value (but never invent a model — if we
    // don't know the base model, extraModelWords have nowhere safe to go).
    const trimWords = bs.extraTrimWords;
    return {
      model: model || null,
      trim: mergeTrim(trim, trimWords),
      bodyStyle: bs.bodyStyle,
    };
  }

  // Strip trailing/embedded parenthetical noise, e.g. "Cayenne S (MY24)"
  // (confirmed live) — a model-year annotation, not real model/trim data.
  let m = model.trim().replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  const baseKey = BASE_MODELS.find((b) => new RegExp(`^${escapeRegex(b)}(?=\\s|$)`, 'i').test(m));
  if (!baseKey) {
    // Doesn't start with a recognized Porsche base model — leave as-is
    // rather than guess. Still apply body_style cleanup independently.
    return { model: m, trim: mergeTrim(trim, bs.extraTrimWords), bodyStyle: bs.bodyStyle };
  }

  const canonicalBase = BASE_MODEL_CANON[baseKey];
  const rest = m.slice(baseKey.length).trim();
  const tokens = rest ? rest.split(/\s+/) : [];

  const modelParts = [canonicalBase];
  const trimWords = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const tokLower = tok.toLowerCase();

    if (i + 1 < tokens.length) {
      const pair = `${tokLower} ${tokens[i + 1].toLowerCase()}`;
      if (TRIM_PAIRS[pair]) { trimWords.push(TRIM_PAIRS[pair]); i++; continue; }
      if (BODY_APPEND_PAIRS[pair]) { modelParts.push(BODY_APPEND_PAIRS[pair]); i++; continue; }
    }

    if (tokLower === 'ev') { modelParts.push('Electric'); continue; }
    if (BODY_APPEND_WORD_CANON[tokLower]) { modelParts.push(BODY_APPEND_WORD_CANON[tokLower]); continue; }
    if (TRIM_WORD_CANON[tokLower]) { trimWords.push(TRIM_WORD_CANON[tokLower]); continue; }
    // Unrecognized token (e.g. "Boxster"/"Cayman" following "718") — kept
    // attached to model rather than dropped or misclassified as trim.
    modelParts.push(tok);
  }

  // Fold in real nameplate words recovered from a contaminated body_style
  // value (e.g. body_style "E-Hybrid AWD" on a plain "Cayenne" model),
  // skipping anything already present in the model we just built.
  const modelPartsLower = modelParts.map((p) => p.toLowerCase());
  for (const w of bs.extraModelWords) {
    if (!modelPartsLower.includes(w.toLowerCase())) {
      modelParts.push(w);
      modelPartsLower.push(w.toLowerCase());
    }
  }

  const allTrimWords = [...trimWords, ...bs.extraTrimWords];
  return {
    model: modelParts.join(' '),
    trim: mergeTrim(trim, allTrimWords),
    bodyStyle: bs.bodyStyle,
  };
}

// Brand dispatcher. Only Porsche has real logic today; every other brand
// passes through completely unchanged (Ford/Chevrolet extraction/data is
// explicitly out of scope for this fix).
export function normalizeVehicleFields(brandName, vehicle) {
  if (!vehicle) return vehicle;
  if ((brandName || '').toLowerCase() !== 'porsche') return vehicle;
  const { model, trim, bodyStyle } = normalizePorscheFields({
    model: vehicle.model,
    trim: vehicle.trim,
    bodyStyle: vehicle.bodyStyle,
  });
  return { ...vehicle, model, trim, bodyStyle };
}
