/**
 * BMW factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active BMW listing carried 6 options_packages codes plus 64 high_value_features entries.
 */

import { isBmwVin, looksLikeBmwPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isBmwVin, looksLikeBmwPaste };

/**
 * BMW factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("BMW factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const BMW_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const BMW_MAKE: ListingFeedMake = {
  key: "bmw",
  label: "BMW",
  isVin: isBmwVin,
  catalog: BMW_OPTION_CODES,
};

export function bmwBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(BMW_MAKE, vin, searchRow, listingDetail);
}

export function getBmwBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(BMW_MAKE, vin, opts);
}

export function bmwBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(BMW_MAKE.key, build, listingUrl);
}
