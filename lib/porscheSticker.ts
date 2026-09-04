/**
 * Porsche factory build — the dealer listing feed via MarketCheck, on the
 * shared lib/listingFeedBuild.ts engine. See that file for why there's no
 * sticker to read (no public endpoint, Finder bot-blocked, dealer VDPs 403
 * server fetches — all confirmed live 2026-09-04).
 *
 * Confirmed against a real 2026 Macan (WP1AA2A53TLB07942): the nine
 * installed PR codes the feed returns match the packages the dealer's own
 * Dealer.com VDP lists at the same prices.
 */

import { isPorscheVin, looksLikePorschePaste } from "./oemWmi";
import {
  buildFromMarketCheck,
  buildToVehicle,
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getListingFeedBuild,
  unknownCodeName as engineUnknownCodeName,
  type ListingFeedBuild,
  type ListingFeedBuildStatus,
  type ListingFeedMake,
  type ListingFeedOptionCategory,
  type ListingFeedOptionLine,
  type OptionCodeEntry,
} from "./listingFeedBuild";
import type { Vehicle } from "./types";

export { isPorscheVin, looksLikePorschePaste, defaultMustHaveLines, defaultNiceToHaveLines, filterableFactoryOptions };

export type PorscheBuildStatus = ListingFeedBuildStatus;
export type PorscheOptionCategory = ListingFeedOptionCategory;
export type PorscheOptionLine = ListingFeedOptionLine;
export type PorscheBuild = ListingFeedBuild;

/**
 * Porsche PR option codes → names (and prices only where actually known).
 *
 * Names are Porsche's own option designations. Prices are included only
 * when confirmed against a real dealer listing for the model/year noted —
 * everything else is null on purpose: a wrong price is worse than no price
 * on a page that exists to negotiate one. Extend per model year as real
 * listings confirm more.
 */
export const PORSCHE_OPTION_CODES: Record<string, OptionCodeEntry> = {
  // Confirmed on 2026 Macan WP1AA2A53TLB07942 (Paul Miller Porsche, Dealer.com VDP, 2026-09-04).
  PU5: { name: "Premium Package Plus", price: 3790, category: "package", confirmedOn: "2026 Macan" },
  KA6: { name: "Surround View", price: 1240, category: "tech", confirmedOn: "2026 Macan" },
  "1NP": { name: "Wheel Center Caps with Colored Porsche Crest", price: 200, category: "exterior", confirmedOn: "2026 Macan" },
  "2ZH": { name: "Heated Multifunction Steering Wheel", price: 280, category: "interior", confirmedOn: "2026 Macan" },
  // Named only — installed on the same VIN inside Premium Package Plus or as standard, so no standalone price was shown.
  "3FU": { name: "Panoramic Roof System", price: null, category: "exterior" },
  Q2J: { name: "14-Way Power Seats with Memory Package", price: null, category: "interior" },
  "8IU": { name: "LED Headlights with Porsche Dynamic Light System Plus (PDLS+)", price: null, category: "tech" },
  "4A4": { name: "Seat Heating (Front and Rear)", price: null, category: "interior" },
  "4D3": { name: "Seat Ventilation (Front)", price: null, category: "interior" },
  "7Y1": { name: "Lane Change Assist (LCA)", price: null, category: "tech" },
  // Widely documented Porsche codes, names only.
  "8LH": { name: "Sport Chrono Package", price: null, category: "performance" },
  "0P8": { name: "Sport Exhaust System", price: null, category: "performance" },
  "1BK": { name: "Porsche Active Suspension Management (PASM)", price: null, category: "performance" },
  "1P6": { name: "Adaptive Air Suspension incl. PASM", price: null, category: "performance" },
  "3G5": { name: "Rear Axle Steering", price: null, category: "performance" },
  "0N5": { name: "Sport Exhaust System in Black", price: null, category: "performance" },
  "9VL": { name: "BOSE Surround Sound System", price: null, category: "tech" },
  "9VJ": { name: "Burmester High-End Surround Sound System", price: null, category: "tech" },
  "4A3": { name: "Seat Heating (Front)", price: null, category: "interior" },
  "1LL": { name: "Porsche Ceramic Composite Brakes (PCCB)", price: null, category: "performance" },
  "8T3": { name: "Adaptive Cruise Control", price: null, category: "tech" },
  "9WT": { name: "Apple CarPlay / Porsche Connect", price: null, category: "tech" },
  "4X4": { name: "Side Airbags in Rear", price: null, category: "interior" },
  "6XE": { name: "Exterior Mirrors Folding, incl. Auto-Dimming", price: null, category: "exterior" },
};

export const PORSCHE_MAKE: ListingFeedMake = {
  key: "porsche",
  label: "Porsche",
  isVin: isPorscheVin,
  catalog: PORSCHE_OPTION_CODES,
};

/** Name for a code the catalog doesn't know yet — honest, not invented. */
export function unknownCodeName(code: string): string {
  return engineUnknownCodeName(PORSCHE_MAKE.label, code);
}

/** Pure parser: MarketCheck search row + listing-detail payload → PorscheBuild. Exported for tests. */
export function porscheBuildFromMarketCheck(vin: string, searchRow: unknown, listingDetail: unknown): PorscheBuild {
  return buildFromMarketCheck(PORSCHE_MAKE, vin, searchRow, listingDetail);
}

export function getPorscheBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<PorscheBuild> {
  return getListingFeedBuild(PORSCHE_MAKE, vin, opts);
}

export function porscheBuildToVehicle(build: PorscheBuild, listingUrl: string | null): Vehicle {
  return buildToVehicle(PORSCHE_MAKE.key, build, listingUrl);
}
