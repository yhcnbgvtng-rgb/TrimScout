/**
 * MINI factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: BMW-owned but a wholly separate WMI block and listing brand — verify feed richness on a real MINI listing before relying on it.
 */

import { isMiniVin, looksLikeMiniPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isMiniVin, looksLikeMiniPaste };

/**
 * MINI factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("MINI factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const MINI_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const MINI_MAKE: ListingFeedMake = {
  key: "mini",
  label: "MINI",
  isVin: isMiniVin,
  catalog: MINI_OPTION_CODES,
};

export function miniBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(MINI_MAKE, vin, searchRow, listingDetail);
}

export function getMiniBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(MINI_MAKE, vin, opts);
}

export function miniBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(MINI_MAKE.key, build, listingUrl);
}
