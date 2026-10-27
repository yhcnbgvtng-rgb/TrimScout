import { fordModelGroup, normalizeFordTrim } from "../scrapers/lightsail-crawler/src/fordTrim.js";

/** What /search shows where a trim goes when a Ford trim is not official for its model. */
export const NO_TRIM = "—";

/**
 * True for a Ford row (one of the nine profiled models) whose trim text is not an official trim for that model — dealer sentences ("8 FOOT BED"),
 * dealer names, engine text, and unrewritten feed text alike. Blank trims, other makes and other models are never flagged. Display only: the DB text is untouched.
 */
export function isUnofficialFordTrim(make: string | null | undefined, model: string | null | undefined, trim: string | null | undefined): boolean {
  if (!trim || !String(trim).trim()) return false;
  if (!/^ford$/i.test(String(make ?? "").trim()) || !fordModelGroup(model)) return false;
  return normalizeFordTrim({ make: "Ford", model: model ?? "", trim }).status !== "clean";
}

/** The trim to show for a vehicle: "—" for an unofficial Ford trim, the stored text otherwise (null stays null). */
export function displayTrim(make: string | null | undefined, model: string | null | undefined, trim: string | null | undefined): string | null {
  if (isUnofficialFordTrim(make, model, trim)) return NO_TRIM;
  return trim ?? null;
}

/** Trim-filter options minus the unofficial Ford ones. Only changes anything when make and model are both set and are a profiled Ford model. */
export function officialTrimOptions<T extends { value: string }>(make: string, model: string, options: T[]): T[] {
  return options.filter((o) => !isUnofficialFordTrim(make, model, o.value));
}
