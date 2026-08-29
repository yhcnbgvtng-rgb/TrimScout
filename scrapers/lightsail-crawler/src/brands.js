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
  Chevrolet: {
    name: "Chevrolet",
    // GM WMI prefixes for the Chevrolet division specifically (not GMC,
    // Buick, or Cadillac, which get their own third character under the
    // shared 1G/2G/3G GM ranges). Verified this session via cross-checked
    // web sources (Wikibooks' WMI table, carcheckervin.com's GM decoder,
    // youcanic's Chevrolet decoder) rather than trusted from memory:
    // 1G1 = US-built Chevrolet passenger cars, 1GC = US-built Chevrolet
    // trucks (Silverado/Colorado), 1GN = US-built Chevrolet SUVs/MPVs
    // (Tahoe/Suburban/Blazer/Traverse), 2G1/2GC = Canada-built cars/trucks,
    // 3G1/3GC = Mexico-built cars/trucks, KL1/KL7 = GM Korea-built
    // Chevrolet (Spark/Trax). 3GN and 1GB added after the fact: seen live
    // in this session's own NJ pilot enrichment output on real VINs
    // (3GN7DNRP5TS120963, a Mexico-built 2026 Equinox EV; 1GB4KSE74TF256032,
    // a US-built 2026 Silverado 3500 HD Chassis Cab) — the same
    // 1G/2G/3G x division-letter pattern as the others, just not called
    // out explicitly by the web sources consulted (one source explicitly
    // said it couldn't confirm 1GB — real data settled it). Secondary
    // signal only, same as Ford — the brand-agnostic URL/DDC-dataLayer
    // extraction doesn't need this to work, and the multi-brand isolation
    // check in standalone.js also falls back to matching vehicle.make
    // against "Chevrolet" directly.
    vinPrefixes: ["1G1", "1GB", "1GC", "1GN", "2G1", "2GC", "3G1", "3GC", "3GN", "KL1", "KL7"],
    hasOfficialRetailerPlatform: false,
    // Same reasoning as Ford: mass-market fixed trims, not a base-plus-
    // options culture — no hand-built MSRP table at launch.
    baseMsrpTable: null,
    plantFallback: null,
  },
  Acura: {
    name: "Acura",
    // Commonly-cited Acura WMI prefixes (19U = US-built, JH4 = Japan-built,
    // both via Honda's Marysville/Suzuka-linked plants) — not yet
    // cross-checked against real live VINs the way Chevrolet's table was
    // (no Acura crawl has run yet to produce any). Secondary signal only,
    // same as every other brand here — the brand-agnostic URL/DDC-
    // dataLayer extraction and the vehicle.make string match don't depend
    // on this being exact.
    vinPrefixes: ["19U", "JH4"],
    hasOfficialRetailerPlatform: false,
    // Same reasoning as Ford/Chevrolet: no hand-built base-MSRP table at
    // launch — rely on real dealer-listed price and whatever options DDC
    // itemizes.
    baseMsrpTable: null,
    plantFallback: null,
  },
  Audi: {
    name: "Audi",
    // Commonly-cited Audi WMI prefixes: WA1 (SUVs) and WAU (sedans/other
    // models), both via VW Group's German plants (Ingolstadt/Neckarsulm);
    // TRU covers some Hungary-built models (Audi Hungaria, e.g. TT). Not
    // yet cross-checked against real live VINs — no Audi crawl has run yet
    // to produce any, same caveat as Acura's table. Secondary signal only.
    vinPrefixes: ["WA1", "WAU", "TRU"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  McLaren: {
    name: "McLaren",
    // WMI SBM = McLaren Automotive Ltd, Woking, England — the brand's only
    // plant. Confirmed this session against a real live VIN pulled from
    // preowned.mclaren.com (SBM22GCA4LW000348, a 2020 GT). Not used by
    // mclaren_crawler.js's own extraction (that reads the VIN directly off
    // each vehicle detail page), but kept for consistency with every other
    // brand's registry entry and as a sanity check elsewhere.
    vinPrefixes: ["SBM"],
    // McLaren doesn't crawl per-dealer at all: mclaren_crawler.js pulls the
    // brand's entire North American used-inventory from one shared official
    // platform (preowned.mclaren.com), not each dealer's own site — a
    // different shape from Porsche's per-dealer Strategy 2b, so this flag
    // is left false rather than repurposed for a case standalone.js's main
    // loop doesn't actually implement.
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: { country: "England", city: "Woking" },
  },
};

export function getBrand(name) {
  const brand = BRANDS[name];
  if (!brand) throw new Error(`Unknown brand "${name}" — add it to src/brands.js`);
  return brand;
}
