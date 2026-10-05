import { searchInventory, type InventoryVehicle } from "./inventoryApi";
import type { ParsedBuyerSearch } from "./buyerSearchQuery";
import { calculateDistanceMiles } from "./otdCalculator";
import { contactStatus, loadContactIndex } from "./dealerContactIndex";

/** Fields a buyer has no reason to see — crawl-pipeline provenance, not vehicle or deal facts. */
export type BuyerVehicle = Omit<InventoryVehicle, "sourceBox" | "crawlFirstSeen"> & {
  distanceMiles: number | null;
  /** Does this dealership have a contact (email) on file? null = unknown (directory unavailable / no dealer id). */
  dealerHasContact: boolean | null;
};

function toBuyerVehicle(v: InventoryVehicle, distanceMiles: number | null, contacts: Set<string> | null): BuyerVehicle {
  const { sourceBox: _sourceBox, crawlFirstSeen: _crawlFirstSeen, ...rest } = v;
  return { ...rest, distanceMiles, dealerHasContact: contactStatus(contacts, v.dealerId) };
}

/** The actual box call + distance post-processing behind GET /api/vehicles/search. */
export async function runBuyerSearch(parsed: ParsedBuyerSearch): Promise<{ total: number; totalCapped: boolean; limit: number; offset: number; vehicles: BuyerVehicle[] }> {
  const { query, zip, radiusMiles, sortDistance } = parsed;
  const [result, contacts] = await Promise.all([searchInventory(query), loadContactIndex()]);
  let vehicles: BuyerVehicle[] = result.vehicles.map((v) =>
    toBuyerVehicle(v, zip ? calculateDistanceMiles(zip, { city: v.dealerCity || "", state: v.dealerState || "" }) : null, contacts)
  );
  if (zip && radiusMiles !== undefined) {
    vehicles = vehicles.filter((v) => v.distanceMiles !== null && v.distanceMiles <= radiusMiles);
  }
  if (zip && sortDistance) {
    vehicles = vehicles.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
  }
  return { total: result.total, totalCapped: Boolean(result.totalCapped), limit: result.limit, offset: result.offset, vehicles };
}
