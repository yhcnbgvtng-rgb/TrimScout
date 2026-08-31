/**
 * Copy for the two Increase Competition slots when they are not filled.
 * Kept free of listings/sticker I/O so the wizard can import it on the client.
 */

export const FORD_COMPETITION_NEED_LOCATION =
  "Enter ZIP and radius above to fill these two slots with the nearest sticker-matched lots.";

export const FORD_COMPETITION_LOADING = "Reading Ford stickers…";

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
  const message = (opts.note || "").trim() || "No sticker-confirmed lots in range.";
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
