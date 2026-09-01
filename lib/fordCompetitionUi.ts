/**
 * Shopper-facing copy for other lots in the offer and must-have filters.
 * Kept free of listings/sticker I/O so the wizard can import it on the client.
 */

export const FORD_COMPETITION_NEED_LOCATION =
  "Enter ZIP and radius above to fill these two slots with the nearest matching lots from two dealers when possible.";

export const FORD_COMPETITION_LOADING = "Finding matching lots…";

export const FORD_MUST_HAVE_HEADING = "Must-have factory options";

export const FORD_MUST_HAVE_HELP =
  "Check only the options you require. Unchecked options are ignored — TrimScout will not search for them.";

export const FORD_COMPETITION_FACTORY_OPTIONS = "Factory options";

export const FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE =
  "Factory options could not be read for this VIN.";

export const FORD_OTHER_LOTS_HEADING = "Other lots in this offer";

export const FORD_OTHER_LOTS_HELP =
  "These two vehicles ride with your favorite in the same request so more dealers can respond.";

export const FORD_OTHER_LOTS_HELP_FIND =
  "We'll suggest two lots from different dealers after ZIP and radius. You can still paste your own.";

export const FORD_OTHER_LOTS_HELP_PASTE =
  "Paste two VINs or listing links. We will not search for other lots.";

export const FORD_OTHER_LOTS_MODE_FIND = "Find matching lots for me";

export const FORD_OTHER_LOTS_MODE_PASTE = "I already have two vehicles to include";

export const FORD_BUILD_SHEET_LINK = "Factory build";

export const FORD_EMPTY_LOTS = "No matching lots in range.";

export type OtherLotsMode = "find" | "paste";

export interface FactoryOptionDisplay {
  code: string | null;
  description: string;
  price?: number | null;
  isPackageChild?: boolean;
}

/** Code + description as the build prints them; do not invent a code. */
export function formatFactoryOptionLine(opt: FactoryOptionDisplay): string {
  const description = (opt.description || "").replace(/\s+/g, " ").trim();
  const code = (opt.code || "").trim();
  if (!code) return description;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (description && !new RegExp(`\\b${escaped}\\b`, "i").test(description)) {
    return `${code}  ${description}`;
  }
  return description || code;
}

export type FordCompetitionEmptyKind = "need_location" | "loading" | "error" | "empty";

export interface FordCompetitionEmptyCopy {
  kind: FordCompetitionEmptyKind;
  message: string;
}

export function fordCompetitionEmptyCopy(opts: {
  huntReady: boolean;
  loading: boolean;
  error: string | null;
  note: string | null;
  droppedCount?: number;
  matchCount: number;
}): FordCompetitionEmptyCopy | null {
  if (opts.matchCount > 0) return null;
  if (!opts.huntReady) {
    return { kind: "need_location", message: FORD_COMPETITION_NEED_LOCATION };
  }
  if (opts.loading) {
    return { kind: "loading", message: FORD_COMPETITION_LOADING };
  }
  if (opts.error) {
    return { kind: "error", message: opts.error };
  }
  const message = (opts.note || "").trim() || FORD_EMPTY_LOTS;
  return { kind: "empty", message };
}

/** Prefer advertised listing price; else sticker MSRP. Never "call dealer". */
export function advertisedOrStickerPrice(
  listingPrice: number | null | undefined,
  msrp: number | null | undefined
): { amount: number | null; source: "listing" | "sticker" | "unconfirmed" } {
  if (typeof listingPrice === "number" && Number.isFinite(listingPrice) && listingPrice > 0) {
    return { amount: listingPrice, source: "listing" };
  }
  if (typeof msrp === "number" && Number.isFinite(msrp) && msrp > 0) {
    return { amount: msrp, source: "sticker" };
  }
  return { amount: null, source: "unconfirmed" };
}

/** Shopper-facing price source. Internal `sticker` facts display as MSRP. */
export function shopperPriceSourceLabel(source: "listing" | "sticker" | "unconfirmed"): string {
  if (source === "sticker") return "MSRP";
  return source;
}

export function formatPriceAmount(amount: number | null | undefined): string {
  if (amount == null || amount <= 0) return "unconfirmed";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function autoFillCompetitionSlots<T>(matches: T[]): [T | null, T | null] {
  return [matches[0] ?? null, matches[1] ?? null];
}
