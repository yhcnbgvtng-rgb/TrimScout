/**
 * Kia factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Kia listing carried options_packages codes plus 52 high_value_features entries.
 */

import { isKiaVin, looksLikeKiaPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isKiaVin, looksLikeKiaPaste };

/**
 * Kia factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Kia factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const KIA_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const KIA_MAKE: ListingFeedMake = {
  key: "kia",
  label: "Kia",
  isVin: isKiaVin,
  catalog: KIA_OPTION_CODES,
};

export function kiaBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(KIA_MAKE, vin, searchRow, listingDetail);
}

export function getKiaBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(KIA_MAKE, vin, opts);
}

export function kiaBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(KIA_MAKE.key, build, listingUrl);
}
