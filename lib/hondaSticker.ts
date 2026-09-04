/**
 * Honda (and Acura) factory build — the dealer listing feed via
 * MarketCheck, on the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-04 against real NJ listings: a 2026 CR-V Sport
 * carried `options_packages: ["TSP","18BR"]`; a 2026 Accord Hybrid Sport-L
 * and a 2026 Civic Sport carried no codes at all — Honda trims bundle their
 * equipment — but the feed's `options` lines still listed it (heated
 * seats, 18" Berlina Black wheels, BSI, ACC, moonroof…). The engine's third
 * tier is what makes Honda work.
 */

import { isHondaVin, looksLikeHondaPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isHondaVin, looksLikeHondaPaste };

/**
 * Honda factory/accessory codes. Starts empty on purpose — an unknown code
 * is named honestly and the equipment still shows from the feed's own
 * lines. Add entries only from confirmed listings.
 */
export const HONDA_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const HONDA_MAKE: ListingFeedMake = {
  key: "honda",
  label: "Honda",
  isVin: isHondaVin,
  catalog: HONDA_OPTION_CODES,
};

export function hondaBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(HONDA_MAKE, vin, searchRow, listingDetail);
}

export function getHondaBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(HONDA_MAKE, vin, opts);
}

export function hondaBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(HONDA_MAKE.key, build, listingUrl);
}
