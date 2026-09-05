/**
 * Mercedes-Benz factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Mercedes-Benz listing carried an options_packages code, 53 high_value_features entries, and 16 dealer-equipment lines.
 */

import { isMercedesVin, looksLikeMercedesPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isMercedesVin, looksLikeMercedesPaste };

/**
 * Mercedes-Benz factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Mercedes-Benz factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const MERCEDES_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const MERCEDES_MAKE: ListingFeedMake = {
  key: "mercedes",
  label: "Mercedes-Benz",
  isVin: isMercedesVin,
  catalog: MERCEDES_OPTION_CODES,
};

export function mercedesBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(MERCEDES_MAKE, vin, searchRow, listingDetail);
}

export function getMercedesBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(MERCEDES_MAKE, vin, opts);
}

export function mercedesBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(MERCEDES_MAKE.key, build, listingUrl);
}
