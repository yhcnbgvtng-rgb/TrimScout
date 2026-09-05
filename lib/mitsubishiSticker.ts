/**
 * Mitsubishi factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Mitsubishi listing carried an options_packages code plus 24 high_value_features entries.
 */

import { isMitsubishiVin, looksLikeMitsubishiPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isMitsubishiVin, looksLikeMitsubishiPaste };

/**
 * Mitsubishi factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Mitsubishi factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const MITSUBISHI_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const MITSUBISHI_MAKE: ListingFeedMake = {
  key: "mitsubishi",
  label: "Mitsubishi",
  isVin: isMitsubishiVin,
  catalog: MITSUBISHI_OPTION_CODES,
};

export function mitsubishiBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(MITSUBISHI_MAKE, vin, searchRow, listingDetail);
}

export function getMitsubishiBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(MITSUBISHI_MAKE, vin, opts);
}

export function mitsubishiBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(MITSUBISHI_MAKE.key, build, listingUrl);
}
