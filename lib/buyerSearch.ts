import { searchInventory, InventoryApiError, type InventoryVehicle } from "./inventoryApi";
import type { ParsedBuyerSearch } from "./buyerSearchQuery";
import { calculateDistanceMiles } from "./otdCalculator";
import { contactStateFor, loadContactIndex, type ContactIndex } from "./dealerContactIndex";
import type { ContactState } from "./dealerContactLookup";
import { contactOnFileDealerIds } from "./contactFilter";
import { sortByDistance } from "./buyerSort";
import { isRfqEligible } from "./lastConfirmed";
import { collapseByVin } from "./onePerVin";

/** Fields a buyer has no reason to see — crawl-pipeline provenance, not vehicle or deal facts. */
export type BuyerVehicle = Omit<InventoryVehicle, "sourceBox" | "crawlFirstSeen" | "firstSeenAt" | "lastSeenAt"> & {
  distanceMiles: number | null;
  /** Does this dealership have a contact (email) on file? null = unknown (directory unavailable / no dealer id). */
  dealerHasContact: boolean | null;
  /** The shared contact state behind dealerHasContact; "unverified" is shown as "Unverified email", never as on file. null = unknown. */
  dealerContactState: ContactState | null;
  /** False when the crawl last saw the car more than RFQ_MAX_AGE_DAYS ago: it cannot be picked for a quote. The date itself never reaches buyers. */
  rfqEligible: boolean;
};

export function toBuyerVehicle(v: InventoryVehicle, distanceMiles: number | null, contacts: ContactIndex | null): BuyerVehicle {
  const { sourceBox: _sourceBox, crawlFirstSeen: _crawlFirstSeen, firstSeenAt: _firstSeenAt, lastSeenAt, ...rest } = v;
  const dealerContactState = contactStateFor(contacts, v);
  return { ...rest, distanceMiles, dealerHasContact: dealerContactState == null ? null : dealerContactState === "named", dealerContactState, rfqEligible: isRfqEligible(lastSeenAt) };
}

/** The actual box call + distance post-processing behind GET /api/vehicles/search. */
export async function runBuyerSearch(parsed: ParsedBuyerSearch): Promise<{ total: number; totalCapped: boolean; limit: number; offset: number; vehicles: BuyerVehicle[] }> {
  const { query, zip, radiusMiles, sortDistance, distanceDir, contactOnFile } = parsed;
  const contacts = await loadContactIndex();
  // No directory = no way to say who has a contact: refuse, never fall back to the unfiltered list under a checked box.
  if (contactOnFile && !contacts) throw new InventoryApiError("Dealer contacts are unavailable right now, so the contact filter cannot run.", 503);
  const result = await searchInventory(query, contactOnFile && contacts ? { dealerIds: contactOnFileDealerIds(contacts) } : undefined);
  // One listing per VIN. A patched box already did it (rows, total, facets); this breaks the ties it leaves for a known location, and
  // collapses the page itself for a box that has not been patched yet (its total is then lowered by what this page dropped).
  const distanceOf = zip ? (v: InventoryVehicle) => calculateDistanceMiles(zip, { city: v.dealerCity || "", state: v.dealerState || "" }) : null;
  const collapsed = collapseByVin(result.vehicles, distanceOf);
  const total = result.total - collapsed.dropped;
  let vehicles: BuyerVehicle[] = collapsed.rows.map((v) =>
    toBuyerVehicle(v, zip ? calculateDistanceMiles(zip, { city: v.dealerCity || "", state: v.dealerState || "" }) : null, contacts)
  );
  if (zip && radiusMiles !== undefined) {
    vehicles = vehicles.filter((v) => v.distanceMiles !== null && v.distanceMiles <= radiusMiles);
  }
  if (zip && sortDistance) {
    vehicles = sortByDistance(vehicles, distanceDir);
  }
  return { total: Math.max(total, vehicles.length), totalCapped: Boolean(result.totalCapped), limit: result.limit, offset: result.offset, vehicles };
}
