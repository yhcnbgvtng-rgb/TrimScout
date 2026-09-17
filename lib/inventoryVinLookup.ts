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
}

export type InventoryVinLookup = (vin: string) => Promise<InventoryDealerSighting | null>;

const LOOKUP_TIMEOUT_MS = 4_000;

export function sightingFromListings(listings: InventoryVehicle[]): InventoryDealerSighting | null {
  const named = listings.filter((l) => (l.dealerName || "").trim());
  if (!named.length) return null;
  const rank = (l: InventoryVehicle) => `${l.removedAt ? 0 : 1}${l.lastSeenAt || ""}`;
  const best = named.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  const id = best.dealerId && best.dealerId !== "0" ? String(best.dealerId) : null;
  return {
    dealerId: id,
    dealerName: best.dealerName.trim(),
    city: best.dealerCity || null,
    state: best.dealerState || null,
    lastSeen: (best.lastSeenAt || "").slice(0, 10) || null,
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
