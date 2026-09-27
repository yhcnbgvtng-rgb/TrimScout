// Recovers trim from a VDP URL slug when no extraction strategy found it on
// the page itself — confirmed live 2026-09-26 as a real, common gap:
// karlchevrolet.com ("new-Ankeny-2027-Chevrolet-Bolt-LT-<VIN>"),
// greshamtoyota.com ("new-Gresham-2026-Toyota-RAV4-XLE+Premium-<VIN>"), and
// firstteamhonda.com ("used-2025-honda-civic-sport-<VIN>-in-chesapeake-va")
// all carry the real trim right in the URL, on three different platforms
// across three different brands, with none of it ever parsed. At
// karlchevrolet.com this was 1000/1000 (100%) of that dealer's inventory —
// a full per-dealer platform gap, not a random miss.
//
// Deliberately conservative, same philosophy as porscheUrlFields.js's
// existing model/year URL recovery (this crawler was burned before by
// guessing a field from unrelated page/URL text): trim is only ever taken
// from the exact slug words between an already-known MODEL and the VIN
// itself, never from words extracted for anything else. Both anchors are
// real, hard signals already established elsewhere in this vehicle's own
// record (model from schema.org/DDC, VIN from wherever it was found) —
// nothing here parses the URL "blind." If either anchor can't be located
// in the slug, or the candidate looks too long to be a genuine trim, this
// returns null rather than guess: a missing trim stays missing rather
// than risk shipping a wrong one.
//
// Cross-brand and cross-platform by construction: nothing here is keyed
// on a specific make, dealer domain, or extraction strategy. Any vehicle
// whose page didn't supply trim, on any brand, gets the same shot at
// recovering it from the URL slug.

const MAX_TRIM_WORDS = 4;
const MAX_TRIM_LENGTH = 40;

function decodeSlug(url) {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // Malformed percent-encoding — fall back to the raw string rather
    // than throw away an otherwise-usable URL.
  }
  return decoded.replace(/\+/g, ' ');
}

function normalizeTrimWord(word) {
  if (!word) return word;
  // Preserve trim codes the dealer's own slug already capitalized (LT,
  // RS, XLE, SR5) — re-titlecasing "XLE" would wrongly produce "Xle".
  if (word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Finds the contiguous run of tokens (case-insensitive) matching every
// word of `model`, and returns the index just past that run — or null if
// model's words don't appear together, in order, anywhere in `tokens`.
// Real gap found live 2026-09-27: Toyota's "i-FORCE MAX" nameplate (e.g.
// "Tundra i-FORCE MAX", "4Runner i-FORCE MAX") has an internal hyphen in
// the model string as stored (from schema.org), but the VDP URL slug
// spells it with every word "+"-separated instead — "Tundra-i-FORCE-MAX"
// once decoded, i.e. FOUR plain words, not three with one hyphenated.
// Splitting modelWords on whitespace only ("i-force" stays one word)
// never matches the slug's four separate tokens, so recovery silently
// declined for every i-FORCE MAX vehicle. Splitting on hyphens too fixes
// this without changing behavior for any model that has no internal
// hyphen (Civic Hybrid, Corvette Z06, RAV4, etc. are unaffected).
function findModelEndIndex(tokens, model) {
  const modelWords = model.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (!modelWords.length) return null;
  const tokensLower = tokens.map((t) => t.toLowerCase());
  for (let start = 0; start <= tokensLower.length - modelWords.length; start++) {
    let matched = true;
    for (let i = 0; i < modelWords.length; i++) {
      if (tokensLower[start + i] !== modelWords[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return start + modelWords.length;
  }
  return null;
}

function findVinIndex(tokens, vin) {
  const vinUpper = vin.toUpperCase();
  return tokens.findIndex((t) => t.toUpperCase() === vinUpper);
}

/**
 * `url`, `model`, `vin` — model and vin must already be known (from
 * whichever extraction strategy produced this vehicle); this function
 * never invents either. Returns the recovered trim string, or null when
 * nothing safe to extract was found.
 */
export function recoverTrimFromUrl(url, model, vin) {
  if (!url || !model || !vin) return null;

  const decoded = decodeSlug(url);
  const lastSegment = decoded.split('/').filter(Boolean).pop();
  if (!lastSegment) return null;

  // Split on '-' first, then flatten any token that itself contains a
  // space (from a decoded "+" — e.g. "Corvette+Z06" or "XLE+Premium") into
  // its own separate single-word tokens. Without this, a multi-word model
  // like "Corvette Z06" that the SOURCE SLUG joined with "+" instead of
  // "-" never lines up against modelWords, which expects one word per
  // token — confirmed live: abelgm.com's "Corvette+Z06" slug segment.
  const tokens = lastSegment
    .split('-')
    .flatMap((t) => t.trim().split(/\s+/))
    .filter(Boolean);
  if (tokens.length < 2) return null;

  const modelEndIdx = findModelEndIndex(tokens, model);
  if (modelEndIdx === null) return null;

  const vinIdx = findVinIndex(tokens, vin);
  // The VIN must appear strictly after the model match — a slug where the
  // VIN comes first (or is absent entirely) doesn't match the pattern
  // this function targets.
  if (vinIdx === -1 || vinIdx <= modelEndIdx) return null;

  const trimTokens = tokens.slice(modelEndIdx, vinIdx);
  if (!trimTokens.length || trimTokens.length > MAX_TRIM_WORDS) return null;

  // Real false positive, caught live against production data: a slug
  // like ".../acura-tlx-2-4l-19UUB1F34LA002790-..." recovers ["2", "4l"]
  // — the engine displacement ("2.4L"), not a trim — because it happens
  // to sit between the model match and the VIN, same as a real trim
  // would. A genuine trim code always has real letter content (LT, RS,
  // XLE, 3LZ, Sport); a bare number or a number-plus-unit-letter doesn't.
  // Reject the whole candidate if not one word in it has 2+ consecutive
  // letters, rather than ship a spec value mislabeled as a trim.
  if (!trimTokens.some((t) => /[a-z]{2,}/i.test(t))) return null;

  const trim = trimTokens.map(normalizeTrimWord).join(' ');

  if (!trim || trim.length > MAX_TRIM_LENGTH) return null;
  return trim;
}
