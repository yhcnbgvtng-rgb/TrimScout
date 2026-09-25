import { searchInventory, type InventoryVehicle } from "./inventoryApi";
import type { ParsedBuyerSearch } from "./buyerSearchQuery";
import { calculateDistanceMiles } from "./otdCalculator";

/** Fields a buyer has no reason to see — crawl-pipeline provenance, not vehicle or deal facts. */
export type BuyerVehicle = Omit<InventoryVehicle, "sourceBox" | "crawlFirstSeen"> & { distanceMiles: number | null };

function toBuyerVehicle(v: InventoryVehicle, distanceMiles: number | null): BuyerVehicle {
  const { sourceBox: _sourceBox, crawlFirstSeen: _crawlFirstSeen, ...rest } = v;
  return { ...rest, distanceMiles };
}

/**
 * The actual box call + distance post-processing behind GET /api/vehicles/search — pulled out so
 * /api/search/parse can run the same search after Gemini fills the filters, as a direct function
 * call rather than the route re-fetching its own URL over HTTP.
 */
export async function runBuyerSearch(parsed: ParsedBuyerSearch): Promise<{ total: number; limit: number; offset: number; vehicles: BuyerVehicle[] }> {
  const { query, zip, radiusMiles, sortDistance } = parsed;
  const result = await searchInventory(query);
  let vehicles: BuyerVehicle[] = result.vehicles.map((v) =>
    toBuyerVehicle(v, zip ? calculateDistanceMiles(zip, { city: v.dealerCity || "", state: v.dealerState || "" }) : null)
  );
  if (zip && radiusMiles !== undefined) {
    vehicles = vehicles.filter((v) => v.distanceMiles !== null && v.distanceMiles <= radiusMiles);
  }
  if (zip && sortDistance) {
    vehicles = vehicles.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
  }
  return { total: result.total, limit: result.limit, offset: result.offset, vehicles };
}
