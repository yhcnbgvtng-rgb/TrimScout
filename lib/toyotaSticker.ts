/**
 * Toyota (and Lexus) factory build — the dealer listing feed via
 * MarketCheck, on the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-04 against real NJ listings: a 2026 Camry SE
 * carried `options_packages: ["SR"]` and a 2026 RAV4 XSE `["CY","DA"]`,
 * with Toyota's own equipment lines (Cold Weather Package, Convenience
 * Package, wireless CarPlay, moonroof…) in the feed's `options`.
 */

import { isToyotaVin, looksLikeToyotaPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isToyotaVin, looksLikeToyotaPaste };

/**
 * Toyota factory option/package codes. Toyota's codes are model- and
 * year-specific, so this starts empty on purpose: an unknown code is named
 * honestly ("Toyota factory option CY") and the real equipment still shows
 * from the feed's own lines. Add entries only from confirmed listings.
 */
export const TOYOTA_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const TOYOTA_MAKE: ListingFeedMake = {
  key: "toyota",
  label: "Toyota",
  isVin: isToyotaVin,
  catalog: TOYOTA_OPTION_CODES,
};

export function toyotaBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(TOYOTA_MAKE, vin, searchRow, listingDetail);
}

export function getToyotaBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(TOYOTA_MAKE, vin, opts);
}

export function toyotaBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(TOYOTA_MAKE.key, build, listingUrl);
}
