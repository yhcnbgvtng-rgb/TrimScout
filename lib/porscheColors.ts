/**
 * Porsche exterior color codes → the names a shopper actually recognizes.
 *
 * Porsche dealer feeds (Dealer.com → MarketCheck, and our own Lightsail
 * crawl of the same pages) carry the paint as the factory *order code*
 * doubled — "0Q0Q", "2T2T", "0e0e" — one two-character code for the body and
 * one for the roof. A shopper comparing offers sees "0e0e" where every other
 * make shows "Chromite Black Metallic". This module turns the code into the
 * name and leaves anything that is already a name alone.
 *
 * Two tables:
 *
 *   PORSCHE_ORDER_CODES — the two-character order codes. Porsche reuses
 *   these across eras (1H was Platinum Silver Metallic, now Vanadium Grey
 *   Metallic; N4 was Dark Blue Metallic, now Oak Green Metallic Neo), so
 *   the modern meaning is what a live listing needs. Every code in the first
 *   block was read from Porsche's own configurator (configurator.porsche.com,
 *   en-US, 2026 model year, all model lines) on 2026-09-04 — see
 *   data/porsche_order_codes_configurator_2026.json for the per-model
 *   evidence. The second block is recent colors no longer on the 2026
 *   configurator, from paint-supplier cross-references; none collides with
 *   a configurator code.
 *
 *   PORSCHE_PAINT_CODES (generated) — the three-plus-character paint codes
 *   from the Stuttcars database, 1950–present, factory and Paint to Sample.
 *   Regenerate with `node scripts/build_porsche_color_codes.mjs`.
 *
 * Unknown codes are never guessed: a doubled code we can't name comes back
 * as "Porsche paint code 0E", and anything that doesn't look like a code
 * comes back untouched.
 */

import { isPorscheVin } from "./oemWmi";
import { PORSCHE_PAINT_CODES } from "./porscheColorCodes.generated";

export const PORSCHE_ORDER_CODES: Record<string, string> = {
  // Porsche configurator, en-US, 2026 model year (911, 718-less lineup, Taycan,
  // Panamera, Macan, Macan Electric, Cayenne, Cayenne Coupé, Cayenne Electric).
  "0E": "Chromite Black Metallic",
  "0L": "Carmine Red",
  "0Q": "White",
  "0T": "Pale Blue Metallic",
  "0W": "Madeira Gold Metallic",
  "1A": "Gentian Blue Metallic",
  "1H": "Vanadium Grey Metallic",
  "1I": "Frozen Berry Metallic",
  "2H": "Volcano Grey Metallic",
  "2M": "Slate Grey Neo",
  "2T": "Jet Black Metallic",
  "2Y": "Carrara White Metallic",
  "3H": "Chalk",
  "3I": "Python Green",
  "5L": "Mystic Green Metallic",
  "6M": "Provence",
  "7F": "Monteverde Metallic",
  "8J": "Purple Sky Metallic",
  "9W": "Napali Blue Metallic",
  A1: "Black",
  D0: "Frozen Blue Metallic",
  D6: "Algarve Blue Metallic",
  D9: "Cartagena Yellow Metallic",
  F0: "Dolomite Silver Metallic",
  G1: "Guards Red",
  G7: "Ice Grey Metallic",
  G9: "Shade Green Metallic",
  I7: "Copper Ruby Metallic",
  N4: "Oak Green Metallic Neo",
  O1: "Lugano Blue",
  R7: "Neptune Blue",
  U0: "Arctic Grey",
  U2: "GT Silver Metallic",
  U4: "Aventurine Green Metallic",
  // Paint to Sample is ordered as a code too — the feed shows "8989" for a
  // custom color, and the configurator carries the program's option codes.
  "89": "Paint to Sample",
  "0UB": "Paint to Sample",
  "0UD": "Paint to Sample Plus",
  SY7: "Paint to Sample",
  // Recent colors not on the 2026 configurator. Order codes cross-referenced
  // against the paint code (Stuttcars alt codes; PaintScratch / Color N Drive
  // touch-up listings, which print both forms, e.g. "M2A/H2").
  "5Q": "Cashmere Beige Metallic",
  C7: "Moonlight Blue Metallic",
  D7: "Shark Blue",
  H2: "Lava Orange",
  I5: "Montego Blue Metallic",
  J1: "Porsche Racing Green Metallic",
  J5: "Miami Blue",
  M0: "Papaya Metallic",
  N0: "Agate Grey Metallic",
  N1: "Sapphire Blue Metallic",
  N2: "Ruby Star Neo",
  N5: "Night Blue Metallic",
  P3: "Racing Yellow",
  S2: "Rhodium Silver Metallic",
  X1: "Arctic Silver Metallic",
  Y1: "Seal Grey Metallic",
  Z4: "Basalt Black Metallic",
};

/** Name for one Porsche color code (order code or paint code), or null when unknown. */
export function porscheColorName(code: string): string | null {
  const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!c) return null;
  return PORSCHE_ORDER_CODES[c] || PORSCHE_PAINT_CODES[c] || null;
}

/** "0Q", "2T", "0E" — two characters with a digit. Plain words like "Red" never qualify. */
function looksLikeOrderCode(s: string): boolean {
  return /^[A-Z0-9]{2}$/.test(s) && /[0-9]/.test(s);
}

/**
 * The feed's raw exterior color → a name. Already a name? Returned as-is
 * (trimmed). A code we know → its name. A doubled order code we don't know →
 * "Porsche paint code XX" rather than the bare "xxxx" the feed sent. Anything
 * else → unchanged. Null/blank → null.
 */
export function porscheExteriorColorName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, " ");
  if (!s) return null;
  const compact = s.toUpperCase().replace(/[\s\-_/]/g, "");
  // Names are words; codes are short, and (beyond three characters) carry a digit.
  const codeLike = /^[A-Z0-9]{2,8}$/.test(compact) && (compact.length <= 3 || /[0-9]/.test(compact));
  if (!codeLike) return s;

  if (compact.length === 4 && compact.slice(0, 2) === compact.slice(2)) {
    // Body + roof, "0Q0Q".
    const half = compact.slice(0, 2);
    const named = porscheColorName(half) || porscheColorName(compact);
    if (named) return named;
    return looksLikeOrderCode(half) ? `Porsche paint code ${half}` : s;
  }
  const named = porscheColorName(compact);
  if (named) return named;
  return looksLikeOrderCode(compact) ? `Porsche paint code ${compact}` : s;
}

export function isPorscheVehicle(v: { vin?: string | null; make?: string | null }): boolean {
  if (v.vin && isPorscheVin(v.vin)) return true;
  return /^\s*porsche\b/i.test(v.make || "");
}

/**
 * Exterior color for any make: Porsche codes become names; every other make's
 * value passes through untouched (trimmed, blank → null).
 */
export function exteriorColorNameFor(
  v: { vin?: string | null; make?: string | null },
  raw: string | null | undefined
): string | null {
  if (isPorscheVehicle(v)) return porscheExteriorColorName(raw);
  const s = raw == null ? "" : String(raw).trim();
  return s || null;
}
