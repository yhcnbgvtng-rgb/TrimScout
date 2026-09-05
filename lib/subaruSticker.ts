/**
 * Subaru factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Subaru listing carried 9 options_packages codes plus 43 high_value_features entries.
 */

import { isSubaruVin, looksLikeSubaruPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isSubaruVin, looksLikeSubaruPaste };

/**
 * Subaru factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Subaru factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const SUBARU_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const SUBARU_MAKE: ListingFeedMake = {
  key: "subaru",
  label: "Subaru",
  isVin: isSubaruVin,
  catalog: SUBARU_OPTION_CODES,
};

export function subaruBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(SUBARU_MAKE, vin, searchRow, listingDetail);
}

export function getSubaruBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(SUBARU_MAKE, vin, opts);
}

export function subaruBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(SUBARU_MAKE.key, build, listingUrl);
}
