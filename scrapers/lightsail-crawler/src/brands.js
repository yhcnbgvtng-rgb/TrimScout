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
  // NJ Lightsail box — remaining in-scope brands. VIN prefixes are a
  // secondary isolation signal only (same as Ford/Chevy/Acura above).
  Toyota: {
    name: "Toyota",
    vinPrefixes: ["4T1", "4T3", "4T4", "5TD", "5TE", "5TF", "2T1", "2T3", "JTD", "JTE", "JT2", "JT3"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Lexus: {
    name: "Lexus",
    vinPrefixes: ["JTH", "JTJ", "JT8", "2T2"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Kia: {
    name: "Kia",
    vinPrefixes: ["KNA", "KND", "KNH", "5XY", "3KP", "KN4"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Honda: {
    name: "Honda",
    vinPrefixes: ["1HG", "2HG", "3HG", "5FN", "5J6", "19X", "JHM", "SHH"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Nissan: {
    name: "Nissan",
    vinPrefixes: ["1N4", "1N6", "3N1", "5N1", "JN1", "JN8"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Infiniti: {
    name: "Infiniti",
    vinPrefixes: ["JN1", "JN8", "5N3", "3N1"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Subaru: {
    name: "Subaru",
    vinPrefixes: ["4S3", "4S4", "JF1", "JF2"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Mazda: {
    name: "Mazda",
    vinPrefixes: ["JM1", "JM3", "JM7", "3MZ"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Volkswagen: {
    name: "Volkswagen",
    vinPrefixes: ["3VW", "WVW", "WV1", "WV2", "WVG", "1V2"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  BMW: {
    name: "BMW",
    vinPrefixes: ["WBA", "WBS", "WBY", "5UX", "5YM"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  "Mercedes-Benz": {
    name: "Mercedes-Benz",
    vinPrefixes: ["WDD", "WDC", "W1K", "W1N", "4JG", "WD4"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Volvo: {
    name: "Volvo",
    vinPrefixes: ["YV1", "YV4", "LYV", "7JR"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Mini: {
    name: "Mini",
    vinPrefixes: ["WMW", "WMZ", "3MW"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Mitsubishi: {
    name: "Mitsubishi",
    vinPrefixes: ["JA3", "JA4", "4A3", "4A4"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Hyundai: {
    name: "Hyundai",
    // Added 2026-09-20. Not yet cross-checked against real live VINs the
    // way Chevrolet's table was — general automotive-VIN-decoding
    // knowledge only. KMH = Korea-built, 5NP/5NM/KMF = Montgomery AL-built
    // (HMMA). A 15-dealer/15-state pilot run did decode real VINs under
    // both prefix families (KMH.../5NM... -> South Korea/United States
    // respectively via NHTSA), which is a reasonable but not exhaustive
    // confirmation. Secondary signal only, same as every other brand here.
    vinPrefixes: ["KMH", "5NP", "5NM", "KMF"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  // Expansion brand set (CRAWLER_BRAND_SET=expansion — see nj_policy.js's
  // NJ_BRANDS_IN_EXPANSION comment). GMC/Buick/Cadillac/Lincoln's
  // vinPrefixes are general WMI-convention knowledge, not yet cross-checked
  // against real live VINs the way Chevrolet's table was — same caveat as
  // Acura/Audi above.
  GMC: {
    name: "GMC",
    vinPrefixes: ["1GT", "1GK", "3GT", "3GK"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Buick: {
    name: "Buick",
    vinPrefixes: ["1G4", "3G4", "KL4"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Cadillac: {
    name: "Cadillac",
    vinPrefixes: ["1G6", "1GY", "3G6"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  Lincoln: {
    name: "Lincoln",
    vinPrefixes: ["5LM", "1LN", "3LN", "2LM"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
  // Multi-nameplate on purpose: Chrysler/Dodge/Jeep/Ram/Fiat share the same
  // ~2,300 physical rooftops nationwide (confirmed live — the Stellantis
  // locator API returns identical dealer lists for all four brand codes at
  // the same zip). One crawl config covers all of them instead of
  // re-visiting the same sites four times; `nameplates` (consumed by
  // brand_match.js's resolveVehicleBrandMatch) keeps each vehicle's own
  // real make (Jeep/Ram/Dodge/Chrysler/Fiat) instead of collapsing every
  // vehicle to the literal string "Stellantis" — nobody shopping for a Jeep
  // Wrangler wants to see "Stellantis" as its make. `name` is still
  // "Stellantis" for logging/DB-brand-grouping/checkpoint-slug purposes
  // only. vinPrefixes not yet cross-checked against real live VINs.
  Stellantis: {
    name: "Stellantis",
    nameplates: ["Jeep", "Ram", "Dodge", "Chrysler", "Fiat"],
    vinPrefixes: ["1C3", "2C3", "1C4", "2C4", "3C4", "1C6", "3C6", "1J4", "1J8", "ZFA"],
    hasOfficialRetailerPlatform: false,
    baseMsrpTable: null,
    plantFallback: null,
  },
};

const BRAND_ALIASES = {
  mercedes: "Mercedes-Benz",
  "mercedes-benz": "Mercedes-Benz",
  vw: "Volkswagen",
  volkswagen: "Volkswagen",
  mini: "Mini",
  chevy: "Chevrolet",
  chevrolet: "Chevrolet",
  // Any of Stellantis's four (or five, with Fiat) nameplates resolves to
  // the same combined brand config — see the Stellantis entry's comment.
  jeep: "Stellantis",
  ram: "Stellantis",
  dodge: "Stellantis",
  chrysler: "Stellantis",
  fiat: "Stellantis",
};

export function resolveBrandName(name) {
  if (!name) return name;
  const trimmed = String(name).trim();
  const aliased = BRAND_ALIASES[trimmed.toLowerCase()];
  if (aliased) return aliased;
  const hit = Object.keys(BRANDS).find((k) => k.toLowerCase() === trimmed.toLowerCase());
  return hit || trimmed;
}

export function getBrand(name) {
  const resolved = resolveBrandName(name);
  const brand = BRANDS[resolved];
  if (!brand) throw new Error(`Unknown brand "${name}" — add it to src/brands.js`);
  return brand;
}
