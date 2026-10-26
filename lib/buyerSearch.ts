import { searchInventory, InventoryApiError, type InventoryVehicle } from "./inventoryApi";
import type { ParsedBuyerSearch } from "./buyerSearchQuery";
import { calculateDistanceMiles } from "./otdCalculator";
import { contactStatus, loadContactIndex, type ContactIndex } from "./dealerContactIndex";
import { contactOnFileDealerIds } from "./contactFilter";
import { sortByDistance } from "./buyerSort";

/** Fields a buyer has no reason to see — crawl-pipeline provenance, not vehicle or deal facts. */
export type BuyerVehicle = Omit<InventoryVehicle, "sourceBox" | "crawlFirstSeen"> & {
  distanceMiles: number | null;
  /** Does this dealership have a contact (email) on file? null = unknown (directory unavailable / no dealer id). */
  dealerHasContact: boolean | null;
  /** The last night the crawl actually saw this car listed (its last_seen_at). The UI shows "Last confirmed <date>" once it is 48+ hours old (lastConfirmed.ts). */
  lastConfirmedAt: string | null;
};

export function toBuyerVehicle(v: InventoryVehicle, distanceMiles: number | null, contacts: ContactIndex | null): BuyerVehicle {
  const { sourceBox: _sourceBox, crawlFirstSeen: _crawlFirstSeen, ...rest } = v;
  return { ...rest, distanceMiles, dealerHasContact: contactStatus(contacts, v), lastConfirmedAt: v.lastSeenAt || null };
}

/** The actual box call + distance post-processing behind GET /api/vehicles/search. */
export async function runBuyerSearch(parsed: ParsedBuyerSearch): Promise<{ total: number; totalCapped: boolean; limit: number; offset: number; vehicles: BuyerVehicle[]; excludeApplied?: string[]; filtersApplied?: string[] }> {
  const { query, zip, radiusMiles, sortDistance, distanceDir, contactOnFile } = parsed;
  const contacts = await loadContactIndex();
  // No directory = no way to say who has a contact: refuse, never fall back to the unfiltered list under a checked box.
  if (contactOnFile && !contacts) throw new InventoryApiError("Dealer contacts are unavailable right now, so the contact filter cannot run.", 503);
  const result = await searchInventory(query, contactOnFile && contacts ? { dealerIds: contactOnFileDealerIds(contacts) } : undefined);
  let vehicles: BuyerVehicle[] = result.vehicles.map((v) =>
    toBuyerVehicle(v, zip ? calculateDistanceMiles(zip, { city: v.dealerCity || "", state: v.dealerState || "" }) : null, contacts)
  );
  if (zip && radiusMiles !== undefined) {
    vehicles = vehicles.filter((v) => v.distanceMiles !== null && v.distanceMiles <= radiusMiles);
  }
  if (zip && sortDistance) {
    vehicles = sortByDistance(vehicles, distanceDir);
  }
  return { total: result.total, totalCapped: Boolean(result.totalCapped), limit: result.limit, offset: result.offset, vehicles, ...(result.excludeApplied ? { excludeApplied: result.excludeApplied } : {}), ...(result.filtersApplied ? { filtersApplied: result.filtersApplied } : {}) };
}
