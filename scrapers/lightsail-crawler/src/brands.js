// Per-brand configuration for the crawler. Most extraction logic in
// standalone.js/enricher.js is already brand-agnostic (Dealer.com,
// schema.org, price/string cleaning, image capture) — this registry holds
// only the handful of things that genuinely differ per manufacturer.

import { PORSCHE_BASE_MSRP } from "./enricher.js";

export const BRANDS = {
  Porsche: {
    name: "Porsche",
    // WMI (World Manufacturer Identifier) prefixes, used as a secondary
    // signal alongside the brand-agnostic URL-pattern filters in
    // resolveSitemapUrls (.htm, /inventory/, /vehicle-details/).
    vinPrefixes: ["WP0", "WP1"],
    // Whether this brand runs its own official Next.js/RSC retailer
    // platform (Strategy 2b) — true only for Porsche; confirmed this
    // session that Audi, VW, and Lamborghini each run separate,
    // brand-specific systems despite shared VW Group ownership.
    hasOfficialRetailerPlatform: true,
    // Real base-MSRP reference data, used only to compute an "options
    // premium" on top of a known starting price. null means: don't
    // fabricate one — report totalOptionsPrice/baseMsrp as unavailable
    // rather than guess.
    baseMsrpTable: PORSCHE_BASE_MSRP,
    plantFallback: { country: "Germany", city: "Stuttgart-Zuffenhausen" },
  },
  Ford: {
    name: "Ford",
    // Common Ford Motor Company WMI prefixes (US-built Ford/Lincoln
    // passenger and light-truck ranges). Secondary signal only — the
    // existing brand-agnostic URL filters already matched real Ford
    // dealer pages (23ford.com/used-inventory/index.htm) without this.
    vinPrefixes: ["1FA", "1FB", "1FC", "1FD", "1FM", "1FT", "3FA", "NM0"],
    hasOfficialRetailerPlatform: false,
    // Deliberately no base-MSRP table at launch: Ford's mass-market trims
    // are mostly fixed feature bundles, not the base-car-plus-à-la-carte-
    // options culture Porsche's table models. A hand-built table would be
    // a lot of manual entry for a number that's less meaningful here —
    // rely on the real dealer-listed price and whatever options DDC
    // actually itemizes instead. Revisit if real usage shows it matters.
    baseMsrpTable: null,
    plantFallback: null,
  },
};

export function getBrand(name) {
  const brand = BRANDS[name];
  if (!brand) throw new Error(`Unknown brand "${name}" — add it to src/brands.js`);
  return brand;
}
