/**
 * Which rooftop our own inventory crawl last saw a VIN at. One of the two
 * "dealer from the VIN" sources (the other is the window sticker's sold-to
 * block); both outrank anything derived from a pasted link.
 *
 * Reads the live dealer_inventory table on the deals box (lib/inventoryApi.ts),
 * fed nightly by the crawl box — not a snapshot. A car a dealer group lists on
 * several rooftops has one listing per store; the one still in stock and seen
 * most recently wins. Fails soft: any backend trouble reads as "never seen".
 */

import { inventoryVin, type InventoryVehicle } from "./inventoryApi";

export interface InventoryDealerSighting {
  /** Directory id of the rooftop when the sync matched one (0 / null when the store isn't on file). */
  dealerId: string | null;
  dealerName: string;
  city: string | null;
  state: string | null;
  /** YYYY-MM-DD of the last crawl that saw the VIN there. */
  lastSeen: string | null;
  /** YYYY-MM-DD the crawl first saw the VIN on that lot (the dealer's own first-listed date when the feed carries it). */
  firstSeen: string | null;
  /** Days on the lot as of lastSeen — the feed's figure, else counted from firstSeen. */
  daysOnLot: number | null;
  /** The dealer's own window-sticker link, captured off their VDP during the crawl — real and dealer-specific, unlike a VIN-only OEM-site guess. */
  windowStickerUrl: string | null;
  /** The dealer's own listing page for this VIN as our crawl captured it — what the wizard's VIN links to. Only ever an http(s) URL. */
  vdpUrl?: string | null;
}

export type InventoryVinLookup = (vin: string) => Promise<InventoryDealerSighting | null>;

const LOOKUP_TIMEOUT_MS = 4_000;

/** Crawled URLs are page-scraped text: only a plain http(s) URL may become a link (never javascript:/data:). */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const u = (raw || "").trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try { return new URL(u).toString(); } catch { return null; }
}

export function sightingFromListings(listings: InventoryVehicle[]): InventoryDealerSighting | null {
  const named = listings.filter((l) => (l.dealerName || "").trim());
  if (!named.length) return null;
  const rank = (l: InventoryVehicle) => `${l.removedAt ? 0 : 1}${l.lastSeenAt || ""}`;
  const best = named.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  const id = best.dealerId && best.dealerId !== "0" ? String(best.dealerId) : null;
  const lastSeen = (best.lastSeenAt || "").slice(0, 10) || null;
  const firstSeen = (best.crawlFirstSeen || best.firstSeenAt || "").slice(0, 10) || null;
  const counted = firstSeen && lastSeen ? Math.max(0, Math.round((Date.parse(lastSeen) - Date.parse(firstSeen)) / 86_400_000)) : null;
  const daysOnLot = best.daysOnLot != null && best.daysOnLot > 0 ? best.daysOnLot : counted;
  return {
    dealerId: id,
    dealerName: best.dealerName.trim(),
    city: best.dealerCity || null,
    state: best.dealerState || null,
    lastSeen,
    firstSeen,
    daysOnLot,
    windowStickerUrl: best.windowStickerUrl || null,
    vdpUrl: safeHttpUrl(best.vdpUrl),
  };
}

export async function inventoryDealerForVin(vin: string): Promise<InventoryDealerSighting | null> {
  const clean = (vin || "").trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(clean)) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS).unref?.());
  try {
    const res = await Promise.race([inventoryVin(clean), timeout]);
    return res ? sightingFromListings(res.listings || []) : null;
  } catch {
    return null;
  }
}
