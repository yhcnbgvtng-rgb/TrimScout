// APPROVED-FOR-REVIEW exact aliases for the Hyundai, BMW and Mercedes-Benz option policies (read by scripts/build-cadillac-honda-kia-option-policy.mjs).
// Same ruling as the Ford aliases (#456): exact, documented spellings only. No fuzzy or prefix matching; order codes and Demo / Fleet / In Transit words
// are ignored; anything not listed stays untrusted. Counts are live cars from the 2026-10-13 box2 read-only pull (dealer_inventory, removed_at IS NULL).
// A model-year the policy does not cover (e.g. a 2026 Santa Fe against a 2027-only policy) is NOT fixable here: no alias ever maps one year to another.
//
// Per "<year>|<CSV model>" scope:
//   models          extra DB `model` spellings the scope matches (the CSV spelling is always included)
//   modelImplied    DB model spelling -> a word its CSV trims carry ("Sonata Hybrid" + "SEL" = the CSV's "SEL Hybrid")
//   trimAliases     DB trim (noise words removed, normalized) -> CSV trim
//   modelTrim       "<DB model>|<DB trim>" -> CSV trim, for feeds that put trim words in the model ("GLE 350" + "4MATIC")
//   noise / noisePhrases   extra words ignored in a DB trim
// Brand-wide noise (words that never distinguish a trim):
export const BRAND_NOISE = {
  hyundai: { noise: ["automatic", "cvt"], noisePhrases: [] }, // transmission words ("SEL FWD Automatic")
  bmw: { noise: ["automatic"], noisePhrases: ["sports activity vehicle", "sports activity"] },
  mercedes: { noise: ["reg"], noisePhrases: [] }, // "&reg;" left in the feed text for (R): "C 300 4MATIC &reg; Sedan"
};
const SEATS = ["6p", "7p", "8p", "6 passenger", "7 passenger", "8 passenger"]; // seating count, not a trim (same ruling as the Toyota 7/8 passenger alias)

export const ALIASES = {
  hyundai: {
    "2026|Sonata": { models: ["Sonata Hybrid"], modelImplied: { "Sonata Hybrid": "hybrid" } }, // 1,404 cars; CSV trims Blue / SEL / Limited Hybrid
    "2027|Palisade": { noisePhrases: SEATS }, // "SEL 7P", "Limited 8P": ~700 cars
    "2027|Palisade Hybrid": { models: ["Palisade HEV"], noisePhrases: SEATS }, // ~3,000 cars + 29 HEV
    "2027|Santa Fe": { noisePhrases: SEATS }, // "Limited 6P/7P": ~400 cars
    "2027|Santa Fe Hybrid": { noisePhrases: SEATS },
    "2026|Venue": { trimAliases: { "SEL w/Two-Tone Roof": "SEL w/2-Tone Roof", "SEL Wtwo Tone Roof": "SEL w/2-Tone Roof" } }, // same trim, spelled out: 618 cars
    "2026|Elantra N": { trimAliases: { Sedan: "N", DCT: "N", Manual: "N" } }, // the only Elantra N trim; body / transmission words: ~1,000 cars
  },
  bmw: {
    // The feed drops the model prefix BMW puts in the trim name ("X3 30 xDrive").
    "2026|X3": {
      models: ["X3 30 xDrive"],
      trimAliases: { "30 xDrive": "X3 30 xDrive", "M50 xDrive": "X3 M50 xDrive" },
      modelTrim: { "X3 30 xDrive|AWD Automatic": "X3 30 xDrive", "X3 30 xDrive|All Wheel Drive Automatic": "X3 30 xDrive", "X3 30 xDrive|Sports Activity Vehicle": "X3 30 xDrive" },
    },
    "2027|X1": { models: ["X1 xDrive28i"], trimAliases: { xDrive28i: "X1 xDrive28i", M35i: "X1 M35i" } },
    "2027|X2": { trimAliases: { xDrive28i: "X2 xDrive28i", M35i: "X2 M35i" } },
    "2027|X5": { models: ["X5 40", "X5 40 xDrive"], trimAliases: { "40 xDrive": "X5 40 xDrive" }, modelTrim: { "X5 40|xDrive": "X5 40 xDrive" } },
    "2027|X6": { models: ["X6 M", "X6 xDrive40i"], trimAliases: { xDrive40i: "X6 xDrive40i", M60i: "X6 M60i", Competition: "X6 M Competition" } },
    "2027|X7": {
      models: ["X7 xDrive40i"],
      trimAliases: { xDrive40i: "X7 xDrive40i", M60i: "X7 M60i" },
      modelTrim: { "X7 xDrive40i|AWD Automatic": "X7 xDrive40i", "X7 xDrive40i|All Wheel Drive Automatic": "X7 xDrive40i" },
    },
    "2027|XM": { trimAliases: { Label: "XM Label" } },
    "2027|iX3": { trimAliases: { "50 xDrive": "iX3 50 xDrive" } },
    // Sedans: only model names that are sedan-only in the US ("330i", "3 Series", "5 Series", "7 Series"). 2 / 4 Series span coupe, gran coupe and convertible, so they are left out.
    "2026|3 Series Sedan": {
      models: ["3 Series", "330i"],
      modelTrim: { "330i|xDrive": "330i xDrive Sedan", "330i|330i": "330i Sedan", "330i|330i xDrive": "330i xDrive Sedan", "3 Series|330i": "330i Sedan", "3 Series|330i xDrive": "330i xDrive Sedan", "3 Series|M340i xDrive": "M340i xDrive Sedan", "3 Series|M340i": "M340i Sedan" },
    },
    "2027|5 Series Sedan": {
      models: ["5 Series", "530i", "540i", "550e"],
      modelTrim: {
        "530i|xDrive": "530i xDrive Sedan", "530i|530i": "530i Sedan", "530i|530i xDrive": "530i xDrive Sedan", "5 Series|530i": "530i Sedan", "5 Series|530i xDrive": "530i xDrive Sedan",
        "5 Series|540i xDrive": "540i xDrive Sedan", "5 Series|550e xDrive": "550e xDrive Sedan", "540i|xDrive": "540i xDrive Sedan", "540i|540i xDrive": "540i xDrive Sedan", "550e|xDrive": "550e xDrive Sedan", "550e|550e xDrive": "550e xDrive Sedan",
      },
    },
    "2027|7 Series Sedan": {
      models: ["7 Series", "740i"],
      modelTrim: { "740i|xDrive": "740 xDrive Sedan", "740i|740i": "740 Sedan", "740i|740i xDrive": "740 xDrive Sedan", "7 Series|740i": "740 Sedan", "7 Series|740i xDrive": "740 xDrive Sedan" },
    },
  },
  mercedes: {
    // The feed puts the series number in the model and leaves the drivetrain / body in the trim. A pair is listed only when the model + trim name ONE policy trim.
    "2026|C-Class Sedan": { models: ["C-Class", "C 300"], modelTrim: { "C-Class|C 300": "C 300 Sedan", "C 300|C 300": "C 300 Sedan", "C 300|4MATIC": "C 300 4MATIC Sedan", "C-Class|C 300 4MATIC": "C 300 4MATIC Sedan", "C 300|C 300 4MATIC": "C 300 4MATIC Sedan" } },
    "2026|GLA SUV": { models: ["GLA", "GLA 250"], modelTrim: { "GLA 250|4MATIC": "GLA 250 4MATIC SUV", "GLA 250|4MATIC SUV": "GLA 250 4MATIC SUV", "GLA 250|GLA 250": "GLA 250 SUV", "GLA|GLA 250": "GLA 250 SUV", "GLA|250 4MATIC": "GLA 250 4MATIC SUV" } },
    "2026|GLB SUV": { models: ["GLB", "GLB 250"], modelTrim: { "GLB 250|4MATIC": "GLB 250 4MATIC SUV", "GLB 250|4MATIC SUV": "GLB 250 4MATIC SUV", "GLB 250|GLB 250": "GLB 250 SUV", "GLB|GLB 250": "GLB 250 SUV", "GLB|250 4MATIC": "GLB 250 4MATIC SUV" } },
    "2027|GLC SUV": { models: ["GLC", "GLC 300", "GLC 350e"], modelTrim: { "GLC 350e|4MATIC": "GLC 350e 4MATIC SUV", "GLC 350e|4MATIC SUV": "GLC 350e 4MATIC SUV" } },
    "2027|GLC Coupe": { models: ["GLC", "GLC 300"] },
    "2027|GLC Electric SUV": { models: ["GLC 400"], modelTrim: { "GLC 400|4MATIC": "GLC 400 4MATIC Electric SUV" } },
    "2027|GLE SUV": {
      models: ["GLE", "GLE 350", "GLE 450"],
      modelTrim: { "GLE 350|4MATIC": "GLE 350 4MATIC SUV", "GLE 350|4MATIC SUV": "GLE 350 4MATIC SUV", "GLE 350|GLE 350": "GLE 350 4MATIC SUV", "GLE 450|4MATIC SUV": "GLE 450 4MATIC SUV" },
    },
    "2027|GLE Coupe": { models: ["GLE", "GLE 450"] },
    "2027|GLS SUV": { models: ["GLS", "GLS 450"], modelTrim: { "GLS 450|4MATIC": "GLS 450 4MATIC SUV", "GLS 450|4MATIC SUV": "GLS 450 4MATIC SUV", "GLS 450|GLS 450": "GLS 450 4MATIC SUV" } },
    "2027|E-Class Sedan": { models: ["E-Class"], trimAliases: { "E 350": "E 350 Sedan", "E 350 4MATIC": "E 350 4MATIC Sedan" } }, // "E 350 RWD Sedan" resolves on its own (RWD is noise)
    "2027|S-Class Sedan": { models: ["S-Class"], trimAliases: { "S 580": "S 580 4MATIC Sedan" } },
    "2027|CLA Sedan": {
      models: ["CLA", "CLA 220", "CLA 250+", "CLA 350"],
      trimAliases: { "CLA 220": "CLA 220 Hybrid Sedan", "CLA 220 Hybrid": "CLA 220 Hybrid Sedan", "CLA 250": "CLA 250 Electric Sedan", "CLA 250 Electric": "CLA 250 Electric Sedan", "CLA 350 Electric 4MATIC": "CLA 350 4MATIC Electric Sedan" },
    },
    "2027|CLE Coupe": { models: ["CLE", "CLE 300", "CLE 450"] },
    "2027|CLE Cabriolet": { models: ["CLE", "CLE 300", "CLE 450"] },
    "2027|G-Class SUV": { models: ["G-Class"], trimAliases: { "G 580e SUV": "G 580 Electric SUV", "G 580 Electric": "G 580 Electric SUV", "AMG G 63": "AMG G 63 SUV" } },
  },
};
