import { fordModelGroup, normalizeFordTrim } from "../scrapers/lightsail-crawler/src/fordTrim.js";
import { classifyOemTrim } from "../scrapers/lightsail-crawler/src/oemTrim.js";

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

/**
 * Same rule for the Chevrolet / GMC / Toyota / Ram models in oemTrim.js (Silverado, Sierra, Tahoe, Yukon, Equinox, Tacoma, Tundra, RAV4, Camry, Highlander, Ram 1500 / 2500):
 * true when the trim text is not an official trim for the model. A pure spelling variant of an official trim ("TRD Off Road", "Trd_sport") is not unofficial; it is shown as the official spelling.
 */
function oemTrimDisplay(make: string | null | undefined, model: string | null | undefined, trim: string | null | undefined): { unofficial: boolean; canonical: string | null } | null {
  if (!trim || !String(trim).trim()) return null;
  return classifyOemTrim({ make: make ?? "", model: model ?? "", trim });
}

/** True when `trim` is unofficial for a profiled model of any covered make (Ford included). Blank trims, other makes and other models are never flagged. */
export function isUnofficialTrim(make: string | null | undefined, model: string | null | undefined, trim: string | null | undefined): boolean {
  return isUnofficialFordTrim(make, model, trim) || (oemTrimDisplay(make, model, trim)?.unofficial ?? false);
}

/** The trim to show for a vehicle: "—" for an unofficial trim on a profiled model, the official spelling for a spelling variant, the stored text otherwise (null stays null). */
export function displayTrim(make: string | null | undefined, model: string | null | undefined, trim: string | null | undefined): string | null {
  if (isUnofficialFordTrim(make, model, trim)) return NO_TRIM;
  const oem = oemTrimDisplay(make, model, trim);
  if (oem?.unofficial) return NO_TRIM;
  if (oem?.canonical) return oem.canonical;
  return trim ?? null;
}

/** Trim-filter options minus the unofficial ones. Only changes anything when make and model are both set and are a profiled model. */
export function officialTrimOptions<T extends { value: string }>(make: string, model: string, options: T[]): T[] {
  return options.filter((o) => !isUnofficialTrim(make, model, o.value));
}
