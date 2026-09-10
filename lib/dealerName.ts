/**
 * Dealer-name matching rules, shared by anything that has to line a vehicle's
 * dealer name up against the contact directory.
 *
 * Lives on its own because dealEngagement.ts — where this used to sit — imports
 * node:crypto, which cannot be bundled for the browser. The wizard needs these
 * rules client-side, so the pure string logic has to be reachable without
 * pulling a server-only module in behind it.
 */

// Ford's own window-sticker system truncates the ship-to dealer name at a
// fixed 30 characters, which lands mid-suffix for "..., Inc." and produces
// "..., In" — every time, for every dealer whose name+suffix crosses that
// boundary, not just one. The canonical name a real dealer account is
// registered under always comes from dealership_contacts (pre-filled from
// the signup invite and locked, never hand-typed), so the window-sticker
// name is the only side that's ever wrong here — reconciling "in" to the
// full suffix fixes every dealer hitting this truncation, not just one.
// A dealer name genuinely ending in the standalone word "in" is not a
// realistic collision.
const DEALER_NAME_SUFFIX = /\s+(inc|incorporated|llc|corp|corporation|co|ltd|in)$/;

export function normalizeDealerKey(name: string): string {
  const punctuationNormalized = name
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return punctuationNormalized.replace(DEALER_NAME_SUFFIX, "");
}

// The confirmed "Inc." -> "In" truncation is now handled directly above
// (DEALER_NAME_SUFFIX includes "in"), so this is only a heads-up signal
// for OTHER truncation shapes we haven't confirmed/handled yet: a name
// landing in the same suspicious length range, ending in a short (1-2
// letter) trailing token that isn't already one of the recognized
// suffixes, is worth a human glancing at rather than silently missing a
// dealership_contacts match forever.
const TRUNCATION_SUSPECT_LENGTH: [min: number, max: number] = [28, 32];
const RECOGNIZED_SUFFIX_WORDS = new Set(["inc", "incorporated", "llc", "corp", "corporation", "co", "ltd", "in"]);

export function looksLikeTruncatedDealerName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < TRUNCATION_SUSPECT_LENGTH[0] || trimmed.length > TRUNCATION_SUSPECT_LENGTH[1]) {
    return false;
  }
  const lastWord = (trimmed.split(/\s+/).pop() || "").replace(/[.,]/g, "").toLowerCase();
  if (!lastWord || lastWord.length > 2 || !/^[a-z]+$/.test(lastWord)) return false;
  return !RECOGNIZED_SUFFIX_WORDS.has(lastWord);
}
