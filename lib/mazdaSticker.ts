/**
 * Mazda factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Mazda listing carried 37 high_value_features entries (no options_packages codes on that particular trim).
 */

import { isMazdaVin, looksLikeMazdaPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isMazdaVin, looksLikeMazdaPaste };

/**
 * Mazda factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Mazda factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const MAZDA_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const MAZDA_MAKE: ListingFeedMake = {
  key: "mazda",
  label: "Mazda",
  isVin: isMazdaVin,
  catalog: MAZDA_OPTION_CODES,
};

export function mazdaBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(MAZDA_MAKE, vin, searchRow, listingDetail);
}

export function getMazdaBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(MAZDA_MAKE, vin, opts);
}

export function mazdaBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(MAZDA_MAKE.key, build, listingUrl);
}
