/**
 * Nissan (and Infiniti) factory build — the dealer listing feed via
 * MarketCheck, on the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Sentra listing carried
 * `options_packages` codes plus ~49 `high_value_features` entries in the
 * feed — same shape already proven for Toyota/Honda.
 */

import { isNissanVin, looksLikeNissanPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isNissanVin, looksLikeNissanPaste };

/**
 * Nissan factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda: an unknown code is named honestly ("Nissan factory option
 * N92") and the real equipment still shows from the feed's own lines. Add
 * entries only from confirmed listings.
 */
export const NISSAN_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const NISSAN_MAKE: ListingFeedMake = {
  key: "nissan",
  label: "Nissan",
  isVin: isNissanVin,
  catalog: NISSAN_OPTION_CODES,
};

export function nissanBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(NISSAN_MAKE, vin, searchRow, listingDetail);
}

export function getNissanBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(NISSAN_MAKE, vin, opts);
}

export function nissanBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(NISSAN_MAKE.key, build, listingUrl);
}
