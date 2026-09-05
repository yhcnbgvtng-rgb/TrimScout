/**
 * Hyundai factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Hyundai listing carried 7 options_packages codes plus 33 high_value_features entries.
 */

import { isHyundaiVin, looksLikeHyundaiPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isHyundaiVin, looksLikeHyundaiPaste };

/**
 * Hyundai factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Hyundai factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const HYUNDAI_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const HYUNDAI_MAKE: ListingFeedMake = {
  key: "hyundai",
  label: "Hyundai",
  isVin: isHyundaiVin,
  catalog: HYUNDAI_OPTION_CODES,
};

export function hyundaiBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(HYUNDAI_MAKE, vin, searchRow, listingDetail);
}

export function getHyundaiBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(HYUNDAI_MAKE, vin, opts);
}

export function hyundaiBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(HYUNDAI_MAKE.key, build, listingUrl);
}
