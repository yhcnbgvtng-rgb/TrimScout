/**
 * Some dealer feeds send the factory paint CODE in the exterior-colour field instead of a
 * name (BMW / MINI: "0C7V", "0475", "0C6m"). A code is not a colour a shopper can read or
 * filter on, so the search UI shows "Color not listed" and keeps it out of the colour filter.
 */
export const COLOR_NOT_LISTED = "Color not listed";

/** Real colour words that are short and may be typed in capitals ("RED", "TAN") — never treated as codes. */
const SHORT_COLOR_WORDS = new Set(["RED", "TAN", "ICE", "SKY", "SEA", "SUN", "RUST", "GOLD", "BLUE", "GRAY", "GREY"]);

/**
 * A factory paint/trim CODE rather than a colour name: 3–6 letters-and-digits with at least one digit ("0C7V", "0475", "490",
 * "WA8555", "490vdb"), or 2–3 capital letters with no digit ("BK", "KAD", "PSC", "UM"). Real names ("Black", "Alpine White", "Red") never match.
 */
export function isColorCode(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  if (/^[0-9A-Za-z]{3,6}$/.test(s) && /[0-9]/.test(s)) return true;
  return /^[A-Z]{2,3}$/.test(s) && !SHORT_COLOR_WORDS.has(s);
}

/** What to show for an exterior colour: the name as-is, "Color not listed" for a bare code, "" when blank. */
export function exteriorColorDisplay(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  return isColorCode(s) ? COLOR_NOT_LISTED : s;
}

/** Colour-filter options: drops code-only values (and blanks) so the filter only offers real names. */
export function colorFilterOptions(colors: readonly string[]): string[] {
  return colors.filter((c) => !!c && !isColorCode(c));
}

/** Interior colours come through the same feeds and carry the same bare codes, so they get the same treatment. */
export const interiorColorDisplay = exteriorColorDisplay;

/** "Black · Tan" style list for the buyer screens: exterior and interior through the shared helper, blanks dropped. */
export function colorsLine(exterior: string | null | undefined, interior: string | null | undefined, extra: Array<string | null | undefined> = []): string {
  const ext = exteriorColorDisplay(exterior);
  const int = interiorColorDisplay(interior);
  return [ext, int ? `${int} interior` : "", ...extra].map((x) => (x || "").trim()).filter(Boolean).join(" · ");
}
