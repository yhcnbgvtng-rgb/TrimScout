// Pulled out of standalone.js into its own module specifically so this can be unit-tested without
// running a live crawl: standalone.js executes at import time (no "am I the main module" guard),
// so importing it anywhere else starts a real crawl. This function is pure (string in, boolean
// out) and has earned real test coverage — see its own comment for the live incident that
// prompted it.
//
// Some dealers' Dealer.com feeds put marketing prose in opt.textMap.description instead of a
// plain option name — confirmed live 2026-09-27: dealer_inventory_options had 1.19M of 9.54M
// rows (12.5%) with descriptions over 40 characters, many of them full sentences ("the FX4
// Off-Road Package adds skid plates underneath", "Picture the FX4 confidence on the road ahead")
// or even a whole vehicle listing blurb ("2026 Ford F-150 King Ranch 4x4 FX4 Off-Road bodyside
// decal") stored as if it were one atomic option. This fragments what should be one real option
// (e.g. "FX4 Off-Road Package") across dozens of near-duplicate canonical_key rows (confirmed:
// 212 distinct "fx4"-ish keys for just 15,546 rows) — bloating the options table, slowing the
// buyer search's option-catalog query, and very likely confusing the AI search's own option
// matching (it has to pick the right one out of dozens of near-identical variants).
//
// A pure length cutoff misses the shorter ones ("picture the fx4 confidence..." is only 46
// characters, about the same length as a real option like "Bowers & Wilkins Diamond Surround
// Sound System"), so this also checks for multiple sentence-marker words — a real option name is
// a noun phrase and essentially never contains two or more of these; a description that does
// almost always is a sentence. Deliberately conservative (>=2 markers, not 1) so a legitimate
// option that happens to contain one common word ("20-inch Wheels With FX4 Off-Road Bodyside
// Decal") is never dropped — some junk with only one or zero marker words will still slip
// through, which is the accepted trade-off for never losing a real option name.
const OPTION_SENTENCE_MARKERS = /\b(the|this|that|and|adds?|includes?|protects?|picture|equipped|combined|including|aided|while|gives?)\b/gi;

export function looksLikeOptionSentence(text) {
  if (typeof text !== "string") return false;
  // >= 75, not a strict > 80: the DB column that eventually stores this is VARCHAR(80), so real
  // junk pulled from a live table is already truncated AT 80 — this filter runs on the raw,
  // pre-truncation description, but a test fixture built from an already-stored example can be
  // exactly 80 characters, and a margin below the hard limit is more honest than relying on
  // never seeing exactly-80-character input in practice.
  if (text.length >= 75) return true;
  const matches = text.match(OPTION_SENTENCE_MARKERS);
  return Boolean(matches && matches.length >= 2);
}
