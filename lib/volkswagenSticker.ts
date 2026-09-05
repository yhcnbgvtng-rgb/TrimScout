/**
 * Volkswagen factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Volkswagen listing carried an options_packages code plus 42 high_value_features entries.
 */

import { isVolkswagenVin, looksLikeVolkswagenPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isVolkswagenVin, looksLikeVolkswagenPaste };

/**
 * Volkswagen factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Volkswagen factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const VOLKSWAGEN_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const VOLKSWAGEN_MAKE: ListingFeedMake = {
  key: "volkswagen",
  label: "Volkswagen",
  isVin: isVolkswagenVin,
  catalog: VOLKSWAGEN_OPTION_CODES,
};

export function volkswagenBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(VOLKSWAGEN_MAKE, vin, searchRow, listingDetail);
}

export function getVolkswagenBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(VOLKSWAGEN_MAKE, vin, opts);
}

export function volkswagenBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(VOLKSWAGEN_MAKE.key, build, listingUrl);
}
