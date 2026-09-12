/**
 * Which rooftop our own inventory crawl last saw a VIN at. One of the two
 * "dealer from the VIN" sources (the other is the window sticker's sold-to
 * block); both outrank anything derived from a pasted link.
 *
 * Reads the small derived index (scripts/build-inventory-vin-index.mjs),
 * never the 84 MB snapshot. Pure apart from the static JSON import.
 */

import index from "../data/inventory-vin-dealers.json";

export interface InventoryDealerSighting {
  dealerName: string;
  city: string | null;
  state: string | null;
  /** YYYY-MM-DD of the last crawl that saw the VIN there. */
  lastSeen: string | null;
}

type IndexRow = [string, string, string, string];
const VINS = (index as unknown as { vins: Record<string, IndexRow> }).vins;

export function inventoryDealerForVin(vin: string): InventoryDealerSighting | null {
  const row = VINS[(vin || "").trim().toUpperCase()];
  if (!row) return null;
  const [dealerName, city, state, lastSeen] = row;
  if (!dealerName) return null;
  return { dealerName, city: city || null, state: state || null, lastSeen: lastSeen || null };
}

export function inventoryIndexSize(): number {
  return Object.keys(VINS).length;
}
