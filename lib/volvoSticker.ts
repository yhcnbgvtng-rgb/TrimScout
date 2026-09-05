/**
 * Volvo factory build — the dealer listing feed via MarketCheck, on
 * the shared lib/listingFeedBuild.ts engine.
 *
 * Confirmed live 2026-09-05: a real active Volvo listing carried 6 options_packages codes, 56 high_value_features entries, and 9 dealer-equipment lines.
 */

import { isVolvoVin, looksLikeVolvoPaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  getListingFeedBuild,
  type ListingFeedBuild,
  type ListingFeedMake,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isVolvoVin, looksLikeVolvoPaste };

/**
 * Volvo factory option/package codes. Starts empty on purpose, same as
 * Toyota/Honda/Nissan: an unknown code is named honestly ("Volvo factory
 * option XY") and the real equipment still shows from the feed's own lines.
 * Add entries only from confirmed listings.
 */
export const VOLVO_OPTION_CODES: Record<string, OptionCodeEntry> = {};

export const VOLVO_MAKE: ListingFeedMake = {
  key: "volvo",
  label: "Volvo",
  isVin: isVolvoVin,
  catalog: VOLVO_OPTION_CODES,
};

export function volvoBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): ListingFeedBuild {
  return buildFromMarketCheck(VOLVO_MAKE, vin, searchRow, listingDetail);
}

export function getVolvoBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  return getListingFeedBuild(VOLVO_MAKE, vin, opts);
}

export function volvoBuildToVehicle(build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(VOLVO_MAKE.key, build, listingUrl);
}
