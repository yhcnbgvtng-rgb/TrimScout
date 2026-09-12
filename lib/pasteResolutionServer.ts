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
import { inventoryDealerForVin } from "./inventoryVinLookup";

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
 * Settle a sticker-built vehicle's dealership without any paid lookup.
 * The VIN comes first, the link only as a fallback, and nothing is
 * invented:
 *
 *   1. our own inventory crawl last saw this VIN at a rooftop
 *      (lib/inventoryVinLookup.ts) — cross-referenced against the
 *      directory so it carries the directory's spelling and address;
 *   2. the window sticker's sold-to block, cross-referenced the same way —
 *      the store the factory shipped to, usually but not always where it
 *      sits today, hence dealerConfirmed: false;
 *   3. only if the VIN yielded nothing: the store the pasted link's
 *      hostname resolved to (resolvePasteVin). A VIN-resolved dealer is
 *      never overwritten by a link-derived one;
 *   4. nothing — location blanked, dealerSource "unknown", so the UI can
 *      say "dealer not found". The sticker→vehicle mappers' placeholders
 *      ("Ford dealer") never ship.
 */
export async function resolveVehicleDealer(
  vehicle: Vehicle,
  resolved: { dealer?: DealerPageIdentity },
  soldTo: StickerSoldTo | null | undefined
): Promise<Vehicle> {
  const rows = await dealerDirectoryOrEmpty();

  const seen = inventoryDealerForVin(vehicle.vin);
  if (seen?.dealerName) {
    const row = crossReferenceStickerDealer(rows, { name: seen.dealerName, city: seen.city, state: seen.state });
    return withDealer(vehicle, {
      dealerName: row ? row.dealerName : seen.dealerName,
      city: (row ? row.city : seen.city) || "",
      state: ((row ? row.state : seen.state) || "").toUpperCase(),
      zip: row?.zipCode || undefined,
      dealerConfirmed: true,
      dealerSource: "inventory",
    });
  }

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

  const listing = resolved.dealer;
  if (listing?.name) {
    return withDealer(vehicle, {
      dealerName: listing.name,
      city: listing.city || "",
      state: listing.state || "",
      zip: listing.zip || undefined,
      dealerConfirmed: true,
      dealerSource: listing.source === "directory_domain" ? "listing_domain" : "listing_page",
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

function withDealer(
  vehicle: Vehicle,
  dealer: Pick<Vehicle["location"], "dealerName" | "city" | "state" | "zip" | "dealerConfirmed" | "dealerSource">
): Vehicle {
  return { ...vehicle, location: { ...vehicle.location, ...dealer } };
}
