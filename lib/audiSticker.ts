/**
 * Audi factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: VW Group sibling to Volkswagen on the same listing-feed engine — verify feed richness on a real Audi listing before relying on it.
 */

import { isAudiVin, looksLikeAudiPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isAudiVin, looksLikeAudiPaste };

/**
 * Audi factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Audi factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const AUDI_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const AUDI_MAKE: ListingFeedMake = {
  key: "audi",
  label: "Audi",
  isVin: isAudiVin,
  catalog: AUDI_OPTION_CODES,
};

export function audiBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(AUDI_MAKE, vin, searchRow, listingDetail);
}

export function getAudiBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(AUDI_MAKE, vin, opts);
}

export function audiBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(AUDI_MAKE.key, build, listingUrl);
}
