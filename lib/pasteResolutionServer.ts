/**
 * The bits of "what did the buyer paste" that every sticker route repeats.
 * Server-only (resolvePasteVin fetches the dealer page).
 */

import { looksLikeUrl, resolvePasteVin, type PasteVinResolution } from "./fordSticker";
import type { DealerPageIdentity } from "./dealerPageIdentity";
import type { CurrentDealerLookup } from "./listingSheet";

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
