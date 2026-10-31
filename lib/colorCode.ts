/**
 * Some dealer feeds send the factory paint CODE in the exterior-colour field instead of a
 * name (BMW / MINI: "0C7V", "0475", "0C6m"). A code is not a colour a shopper can read or
 * filter on, so the search UI shows "Color not listed" and keeps it out of the colour filter.
 */
export const COLOR_NOT_LISTED = "Color not listed";

/** 3–5 characters, letters and digits only, with at least one digit: "0C7V", "0475", "490". Real names ("Black", "White") never contain a digit. */
export function isColorCode(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  return /^[0-9A-Za-z]{3,5}$/.test(s) && /[0-9]/.test(s);
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
