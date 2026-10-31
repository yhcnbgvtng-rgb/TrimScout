import { searchInventory, InventoryApiError, type InventoryVehicle } from "./inventoryApi";
import type { ParsedBuyerSearch } from "./buyerSearchQuery";
import { calculateDistanceMiles, isCityPlaced } from "./otdCalculator";
import { isReachableState } from "./dealerContactLookup";
import { contactStateFor, loadContactIndex, type ContactIndex } from "./dealerContactIndex";
import type { ContactState } from "./dealerContactLookup";
import { contactOnFileDealerIds } from "./contactFilter";
import { sortByDistance } from "./buyerSort";
import { isRfqEligible } from "./lastConfirmed";
import { collapseByVin } from "./onePerVin";
import { BUYER_COUNT_CAP } from "./buyerSearchQuery";

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
  return { ...rest, distanceMiles, dealerHasContact: dealerContactState == null ? null : isReachableState(dealerContactState), dealerContactState, rfqEligible: isRfqEligible(lastSeenAt) };
}

/** Rows per box call while a radius search walks the whole result set (the route's own page ceiling). */
const RADIUS_SCAN_PAGE = 100;

/** The actual box call + distance post-processing behind GET /api/vehicles/search. */
export async function runBuyerSearch(parsed: ParsedBuyerSearch): Promise<{ total: number; totalCapped: boolean; limit: number; offset: number; vehicles: BuyerVehicle[] }> {
  const { query, zip, radiusMiles, sortDistance, distanceDir, contactOnFile } = parsed;
  const contacts = await loadContactIndex();
  // No directory = no way to say who has a contact: refuse, never fall back to the unfiltered list under a checked box.
  if (contactOnFile && !contacts) throw new InventoryApiError("Dealer contacts are unavailable right now, so the contact filter cannot run.", 503);
  const fetchPage = (q: typeof query) => searchInventory(q, contactOnFile && contacts ? { dealerIds: contactOnFileDealerIds(contacts) } : undefined);
  // A dealer the model can only place by its state's centroid has no real distance: none is shown (null) and a radius never cuts it,
  // because "55 mi" would be the same made-up number for every dealer in the state.
  const distanceTo = (v: InventoryVehicle) => (zip && isCityPlaced(v.dealerCity || "") ? calculateDistanceMiles(zip, { city: v.dealerCity || "", state: v.dealerState || "" }) : null);
  // The one radius rule. The count and the list both come from the rows it keeps, so they cannot disagree.
  const insideRadius = (v: { distanceMiles: number | null }) => v.distanceMiles === null || v.distanceMiles <= (radiusMiles as number);

  // The box cannot filter by distance (no dealer lat/lng), so a radius is applied here. Applying it to ONE box page left the list empty
  // whenever that page held no nearby car while `total` still counted the whole state (NJ F-150 near 07836: "910 found", no rows). So with
  // a radius the whole box result set is read (the box's own count cap bounds it), the radius is applied to all of it, and the count,
  // the page and "load more" all come from that one filtered set.
  if (zip && radiusMiles !== undefined) {
    const all: InventoryVehicle[] = [];
    let boxTotal = 0, boxCapped = false, offset = 0;
    for (;;) {
      const page = await fetchPage({ ...query, limit: RADIUS_SCAN_PAGE, offset });
      boxTotal = page.total;
      boxCapped = Boolean(page.totalCapped);
      all.push(...page.vehicles);
      offset += RADIUS_SCAN_PAGE;
      if (page.vehicles.length < RADIUS_SCAN_PAGE || offset >= boxTotal || offset >= BUYER_COUNT_CAP) break;
    }
    // Rows past the cap were never read: the count is then a floor, shown as "N+".
    const truncated = boxCapped || all.length < boxTotal;
    const near = collapseByVin(all, distanceTo).rows
      .map((v) => toBuyerVehicle(v, distanceTo(v), contacts))
      .filter(insideRadius);
    const ordered = sortDistance ? sortByDistance(near, distanceDir) : near;
    const limit = query.limit ?? 50, from = query.offset ?? 0;
    return { total: near.length, totalCapped: truncated, limit, offset: from, vehicles: ordered.slice(from, from + limit) };
  }

  const result = await fetchPage(query);
  // One listing per VIN. A patched box already did it (rows, total, facets); this breaks the ties it leaves for a known location, and
  // collapses the page itself for a box that has not been patched yet (its total is then lowered by what this page dropped).
  const collapsed = collapseByVin(result.vehicles, zip ? distanceTo : null);
  const total = result.total - collapsed.dropped;
  let vehicles: BuyerVehicle[] = collapsed.rows.map((v) => toBuyerVehicle(v, distanceTo(v), contacts));
  if (zip && sortDistance) {
    vehicles = sortByDistance(vehicles, distanceDir);
  }
  return { total: Math.max(total, vehicles.length), totalCapped: Boolean(result.totalCapped), limit: result.limit, offset: result.offset, vehicles };
}
