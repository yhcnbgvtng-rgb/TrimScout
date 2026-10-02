/**
 * The bits of "what did the buyer paste" that every sticker route repeats.
 * Server-only (resolvePasteVin fetches the dealer page).
 */

import { looksLikeUrl, resolvePasteVin, type PasteVinResolution } from "./fordSticker";
import type { DealerPageIdentity } from "./dealerPageIdentity";
import type { CurrentDealerLookup } from "./listingSheet";
import type { Vehicle } from "./types";
import { crossReferenceStickerDealer, type StickerSoldTo } from "./dealerSearch";
import { dealerDirectoryOrEmpty } from "./dealerDirectoryCache";
import { inventoryDealerForVin, type InventoryVinLookup } from "./inventoryVinLookup";

/**
 * A forced VIN arrives on the cross-OEM retry: another make's route read
 * the page, found a VIN that wasn't its own, and handed it here. The VIN is
 * settled, but the page is still where the dealership and the advertised
 * price live — so a pasted URL is still read (and, when the site blocks
 * us, the hostname still names the store).
 */
export async function resolveRoutePaste(paste: string, forcedVin: string): Promise<PasteVinResolution> {
  if (!forcedVin) return resolvePasteVin(paste);
  const page = looksLikeUrl(paste) ? await resolvePasteVin(paste) : null;
  return {
    vin: forcedVin,
    dealerBlocked: false,
    pageBlocked: page?.pageBlocked ?? false,
    source: "paste",
    listingPrice: page?.listingPrice ?? null,
    dealer: page?.dealer,
  };
}

/**
 * The listing's own dealer, in the shape the sticker→vehicle mappers take
 * for "current dealer". Used when the paid current-dealer lookup is off:
 * the store whose page the buyer pasted beats the sticker's factory ship-to
 * dealer, which is stale the moment a car is dealer-traded.
 */
export function listingDealerLookup(
  resolved: { dealer?: DealerPageIdentity },
  listingUrl: string | null
): CurrentDealerLookup | null {
  const d = resolved.dealer;
  if (!d?.name) return null;
  return {
    dealerName: d.name,
    dealerStreet: null,
    dealerCity: d.city || "",
    dealerState: d.state || "",
    dealerZip: d.zip || null,
    dealerPhone: null,
    vdpUrl: listingUrl,
  };
}

/** What a 422 "paste the VIN" answer may say about the store, so the wizard can name it. */
export function blockedDealerPayload(dealer: DealerPageIdentity | undefined) {
  if (!dealer?.name) return undefined;
  return { name: dealer.name, city: dealer.city, state: dealer.state };
}

/**
 * Settle a vehicle's dealership. Locked priority (2026-09-20): the VDP /
 * listing link's own hostname is dealer identity #1 — when it keys to
 * exactly one directory rooftop, that IS the dealer, full stop. The window
 * sticker stays ground truth for the *factory build* everywhere else, but
 * it never gets to silently outrank a clear domain match on WHO to ask.
 *
 *   1. the store the pasted link's hostname resolved to, uniquely
 *      (dealerDomainLookup's directory-domain match) — the dealership
 *      advertising the car on its own website is where the request goes.
 *      A factory ship-to store or a crawl sighting that names someone else
 *      is kept on the vehicle as factoryShipTo, a note, never the
 *      recipient. A shared multi-rooftop domain (a dealer group's one
 *      site for several stores) does NOT produce a unique match here —
 *      the caller sees no `resolved.dealer`, so control falls through to
 *      the tiers below instead of guessing which rooftop;
 *   2. only once the domain didn't resolve to one rooftop, in order:
 *      a. the window sticker's sold-to block, cross-referenced against the
 *         directory — the store the factory shipped to, usually but not
 *         always where it sits today, hence dealerConfirmed: false;
 *      b. our own inventory crawl's last sighting of this VIN
 *         (lib/inventoryVinLookup.ts, live dealer_inventory) — the
 *         directory row by id when the sync matched one, else
 *         cross-referenced by name so it carries the directory's spelling;
 *      c. the listing page's own declared name (json-ld / og:site_name /
 *         title) when the domain didn't key to a directory row at all —
 *         better than nothing, but never a directory-verified store;
 *      d. nothing — location blanked, dealerSource "unknown", so the UI
 *         can say "dealer not found" and hand it to the buyer's own pick.
 *         The sticker→vehicle mappers' placeholders ("Ford dealer") never
 *         ship.
 */
export async function resolveVehicleDealer(
  vehicle: Vehicle,
  resolved: { dealer?: DealerPageIdentity },
  soldTo: StickerSoldTo | null | undefined,
  lookupSighting: InventoryVinLookup = inventoryDealerForVin
): Promise<Vehicle> {
  const [rows, seen] = await Promise.all([dealerDirectoryOrEmpty(), lookupSighting(vehicle.vin)]);
  // Lot age from our own crawl — the only "how long has it sat" we have when the factory build is missing.
  if (seen?.daysOnLot != null && !(vehicle.daysOnLot > 0)) vehicle = { ...vehicle, daysOnLot: seen.daysOnLot, lotFirstSeen: seen.firstSeen || undefined };
  const sightingRow = (): (typeof rows)[number] | null => {
    if (!seen?.dealerName) return null;
    const byId = seen.dealerId ? rows.find((r) => String(r.id) === seen.dealerId) : null;
    return byId || crossReferenceStickerDealer(rows, { name: seen.dealerName, city: seen.city, state: seen.state });
  };

  const listing = resolved.dealer;

  // Priority 1: an exact, unique domain match on the pasted link's hostname.
  // This is the dealer, even when the sticker's sold-to or our own crawl
  // sighting names a different store — those become a factoryShipTo note,
  // never the recipient. (A shared multi-rooftop domain never reaches this
  // branch: the caller only passes a `listing` when the match was unique.)
  if (listing?.name && listing.source === "directory_domain") {
    const origin = seen?.dealerName ? { name: seen.dealerName, city: seen.city, state: seen.state } : soldTo?.name?.trim() ? soldTo : null;
    const originRow = origin ? (seen?.dealerName ? sightingRow() : crossReferenceStickerDealer(rows, origin)) : null;
    const originName = originRow ? originRow.dealerName : origin?.name?.trim() || "";
    const factoryShipTo =
      originName && !sameDealerName(originName, listing.name)
        ? { dealerName: originName, city: (originRow ? originRow.city : origin?.city) || "", state: ((originRow ? originRow.state : origin?.state) || "").toUpperCase() }
        : null;
    return withDealer(vehicle, {
      dealerName: listing.name,
      city: listing.city || "",
      state: listing.state || "",
      zip: listing.zip || undefined,
      dealerConfirmed: true,
      dealerSource: "listing_domain",
      factoryShipTo,
    });
  }

  // The domain didn't key to one rooftop — only now do VIN-derived signals
  // narrow it down. The factory's own sold-to record outranks our crawl's
  // sighting: it's the authoritative "who did Ford/GM/etc. ship this car
  // to", where a sighting is just the last place our own crawl happened to
  // see the VIN listed.
  if (soldTo?.name?.trim()) {
    const row = crossReferenceStickerDealer(rows, soldTo);
    return withDealer(vehicle, {
      dealerName: row ? row.dealerName : soldTo.name.trim(),
      city: (row ? row.city : soldTo.city) || "",
      state: ((row ? row.state : soldTo.state) || "").toUpperCase(),
      zip: (row ? row.zipCode : soldTo.zip) || undefined,
      dealerConfirmed: false,
      dealerSource: "window_sticker",
    });
  }

  if (seen?.dealerName) {
    const row = sightingRow();
    return withDealer(vehicle, {
      dealerName: row ? row.dealerName : seen.dealerName,
      city: (row ? row.city : seen.city) || "",
      state: ((row ? row.state : seen.state) || "").toUpperCase(),
      zip: row?.zipCode || undefined,
      dealerConfirmed: true,
      dealerSource: "inventory",
    });
  }

  // The domain matched nothing in the directory at all, but the page named
  // itself (json-ld / og:site_name / title) — last resort, never confirmed
  // since it was never checked against the directory.
  if (listing?.name) {
    return withDealer(vehicle, {
      dealerName: listing.name,
      city: listing.city || "",
      state: listing.state || "",
      zip: listing.zip || undefined,
      dealerConfirmed: true,
      dealerSource: "listing_page",
    });
  }

  return withDealer(vehicle, {
    dealerName: "",
    city: "",
    state: "",
    zip: undefined,
    dealerConfirmed: false,
    dealerSource: "unknown",
  });
}

/** "Crown Ford Inc" and "Crown Ford" are the same store; punctuation and suffixes don't count. */
function sameDealerName(a: string, b: string | null | undefined): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|co|corp|of)\b/g, "").replace(/[^a-z0-9]/g, "");
  const x = norm(a), y = norm(b || "");
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
}

function withDealer(
  vehicle: Vehicle,
  dealer: Pick<Vehicle["location"], "dealerName" | "city" | "state" | "zip" | "dealerConfirmed" | "dealerSource" | "factoryShipTo">
): Vehicle {
  return { ...vehicle, location: { ...vehicle.location, ...dealer } };
}
