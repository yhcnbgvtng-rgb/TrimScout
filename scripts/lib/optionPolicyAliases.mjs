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
  // Subaru: "cvt" is the transmission ("Limited AWD CVT"); "All Wheel" is the drivetrain spelled out ("Touring XT All Wheel", "Limited Hybrid All Wheel"); "Lifetime Powertrain"
  // is a dealer warranty tag ("Premium LIFETIME POWERTRAIN"). None distinguishes a trim.
  subaru: { noise: ["cvt"], noisePhrases: ["all wheel", "lifetime powertrain"] },
  // Nissan: transmission words ("SL AWD Automatic", "SV FWD CVT", "Performance M T"), the drivetrain spelled out ("All Wheel", "Four Wheel"), the body word on a sedan
  // ("SV Sedan"), the dealer "Ltd Avail" tag and the Lifetime Powertrain warranty tag. None distinguishes a trim.
  nissan: { noise: ["cvt", "automatic", "auto", "manual"], noisePhrases: ["all wheel", "four wheel", "sedan", "ltd avail", "w lifetime powertrain", "lifetime powertrain", "m t"] },
  // Mazda: the transmission words dealers append ("2.5 S Preferred Auto", "Club Manual", "Premium AWD CVT"). None distinguishes a trim.
  mazda: { noise: ["cvt", "automatic", "auto", "manual"], noisePhrases: [] },
};
const SEATS = ["6p", "7p", "8p", "6 passenger", "7 passenger", "8 passenger"]; // seating count, not a trim (same ruling as the Toyota 7/8 passenger alias)

// Mazda feeds drop the decimal in the engine size ("25 S Preferred" for "2.5 S Preferred", "33 Turbo Preferred" for "3.3 Turbo Preferred"); each is the same trim, spelled out.
const ENGINE25 = (...trims) => Object.fromEntries(trims.map((t) => [t.replace("2.5", "25"), t]));
const ENGINE33 = (...trims) => Object.fromEntries(trims.map((t) => [t.replace("3.3", "33"), t]));

export const ALIASES = {
  hyundai: {
    "2026|Sonata": { models: ["Sonata Hybrid"], modelImplied: { "Sonata Hybrid": "hybrid" } }, // 1,404 cars; CSV trims Blue / SEL / Limited Hybrid
    "2027|Palisade": { noisePhrases: SEATS }, // "SEL 7P", "Limited 8P": ~700 cars
    "2027|Palisade Hybrid": { models: ["Palisade HEV"], noisePhrases: SEATS }, // ~3,000 cars + 29 HEV
    "2027|Santa Fe": { noisePhrases: SEATS }, // "Limited 6P/7P": ~400 cars
    "2027|Santa Fe Hybrid": { noisePhrases: SEATS },
    "2026|Venue": { trimAliases: { "SEL w/Two-Tone Roof": "SEL w/2-Tone Roof", "SEL Wtwo Tone Roof": "SEL w/2-Tone Roof" } }, // same trim, spelled out: 618 cars
    "2026|Elantra N": { trimAliases: { Sedan: "N", DCT: "N", Manual: "N", Base: "N" } }, // the only Elantra N trim; body / transmission words: ~1,000 cars
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
      models: ["3 Series", "330i", "330i NA", "330i NA xDrive", "M340", "M340i"],
      noise: ["na"], // "NA" = the North America market tag BMW appends ("330i NA xDrive"); ruling 2026-10-13
      trimAliases: { "330i xDrive": "330i xDrive Sedan", "330i": "330i Sedan", "M340i xDrive": "M340i xDrive Sedan", M340i: "M340i Sedan" },
      modelTrim: { "M340|i": "M340i Sedan", "M340|i xDrive": "M340i xDrive Sedan", "330i NA xDrive|xDrive": "330i xDrive Sedan", "330i|NA xDrive": "330i xDrive Sedan", "330i|xDrive NA": "330i xDrive Sedan", "330i|xDrive": "330i xDrive Sedan", "330i|330i": "330i Sedan", "330i|330i xDrive": "330i xDrive Sedan", "3 Series|330i": "330i Sedan", "3 Series|330i xDrive": "330i xDrive Sedan", "3 Series|M340i xDrive": "M340i xDrive Sedan", "3 Series|M340i": "M340i Sedan" },
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
    "2026|C-Class Sedan": { models: ["C-Class", "C 300", "AMG C 43"], trimAliases: { "AMG C 43 4MATIC Sedan": "Mercedes-AMG C 43 Sedan", "C 43 AMG": "Mercedes-AMG C 43 Sedan", "AMG C 43": "Mercedes-AMG C 43 Sedan" }, modelTrim: { "AMG C 43|4MATIC": "Mercedes-AMG C 43 Sedan", "C-Class|C 300": "C 300 Sedan", "C 300|C 300": "C 300 Sedan", "C 300|4MATIC": "C 300 4MATIC Sedan", "C-Class|C 300 4MATIC": "C 300 4MATIC Sedan", "C 300|C 300 4MATIC": "C 300 4MATIC Sedan" } },
    "2026|GLA SUV": { models: ["GLA", "GLA 250", "AMG GLA 35"], trimAliases: { "AMG GLA 35 4MATIC SUV": "AMG GLA 35 SUV", "GLA 35 AMG": "AMG GLA 35 SUV", "AMG GLA 35": "AMG GLA 35 SUV" }, modelTrim: { "AMG GLA 35|4MATIC": "AMG GLA 35 SUV", "GLA 250|4MATIC": "GLA 250 4MATIC SUV", "GLA 250|4MATIC SUV": "GLA 250 4MATIC SUV", "GLA 250|GLA 250": "GLA 250 SUV", "GLA|GLA 250": "GLA 250 SUV", "GLA|250 4MATIC": "GLA 250 4MATIC SUV" } },
    "2026|GLB SUV": { models: ["GLB", "GLB 250", "AMG GLB 35"], trimAliases: { "AMG GLB 35 4MATIC SUV": "AMG GLB 35 SUV", "GLB 35 AMG": "AMG GLB 35 SUV", "AMG GLB 35": "AMG GLB 35 SUV" }, modelTrim: { "AMG GLB 35|4MATIC": "AMG GLB 35 SUV", "GLB 250|4MATIC": "GLB 250 4MATIC SUV", "GLB 250|4MATIC SUV": "GLB 250 4MATIC SUV", "GLB 250|GLB 250": "GLB 250 SUV", "GLB|GLB 250": "GLB 250 SUV", "GLB|250 4MATIC": "GLB 250 4MATIC SUV" } },
    "2027|GLC SUV": { models: ["GLC", "GLC 300", "GLC 350e", "AMG GLC 53", "AMG GLC 53 All-Wheel Drive 4MATIC+"], modelTrim: { "GLC 350e|4MATIC": "GLC 350e 4MATIC SUV", "GLC 350e|4MATIC SUV": "GLC 350e 4MATIC SUV" } },
    "2027|GLC Coupe": { models: ["GLC", "GLC 300", "AMG GLC 53", "AMG GLC 53 All-Wheel Drive 4MATIC+"] },
    "2027|GLC Electric SUV": { models: ["GLC 400"], modelTrim: { "GLC 400|4MATIC": "GLC 400 4MATIC Electric SUV" } },
    "2027|GLE SUV": {
      models: ["GLE", "GLE 350", "GLE 450", "AMG GLE 53e"],
      trimAliases: { "AMG GLE 53e 4MATIC SUV": "AMG GLE 53 Hybrid SUV" }, // mbusa.com: the 2027 "AMG GLE 53 HYBRID" plug-in (model page id gle53ew4) is the launch page's "GLE 53e HYBRID"
      modelTrim: { "GLE 350|4MATIC": "GLE 350 4MATIC SUV", "GLE 350|4MATIC SUV": "GLE 350 4MATIC SUV", "GLE 350|GLE 350": "GLE 350 4MATIC SUV", "GLE 450|4MATIC SUV": "GLE 450 4MATIC SUV" },
    },
    "2027|GLE Coupe": { models: ["GLE", "GLE 450", "AMG GLE 53e"], trimAliases: { "AMG GLE 53e 4MATIC Coupe": "AMG GLE 53 Hybrid Coupe" } },
    "2027|GLS SUV": { models: ["GLS", "GLS 450"], modelTrim: { "GLS 450|4MATIC": "GLS 450 4MATIC SUV", "GLS 450|4MATIC SUV": "GLS 450 4MATIC SUV", "GLS 450|GLS 450": "GLS 450 4MATIC SUV" } },
    "2027|E-Class Sedan": { models: ["E-Class"], trimAliases: { "E 350": "E 350 Sedan", "E 350 4MATIC": "E 350 4MATIC Sedan" } }, // "E 350 RWD Sedan" resolves on its own (RWD is noise)
    "2027|S-Class Sedan": { models: ["S-Class"], trimAliases: { "S 580": "S 580 4MATIC Sedan" } },
    "2027|CLA Sedan": {
      models: ["CLA", "CLA 220", "CLA 250+", "CLA 350"],
      trimAliases: { "CLA 220": "CLA 220 Hybrid Sedan", "CLA 220 Hybrid": "CLA 220 Hybrid Sedan", "CLA 250": "CLA 250 Electric Sedan", "CLA 250 Electric": "CLA 250 Electric Sedan", "CLA 350 Electric 4MATIC": "CLA 350 4MATIC Electric Sedan" },
    },
    "2027|Mercedes-AMG GT 2-door Coupe": { models: ["AMG GT"] }, // "AMG &reg; GT 55 Coupe" etc. resolve exactly once the model spelling is covered
    "2027|CLE Coupe": { models: ["CLE", "CLE 300", "CLE 450", "AMG CLE 53"], trimAliases: { "AMG CLE 53 4MATIC Coupe": "AMG CLE 53 Coupe" } },
    "2027|CLE Cabriolet": { models: ["CLE", "CLE 300", "CLE 450", "AMG CLE 53"], trimAliases: { "AMG CLE 53 4MATIC Cabriolet": "AMG CLE 53 Cabriolet" } },
    "2027|G-Class SUV": { models: ["G-Class", "AMG G 63"], trimAliases: { "G 580e SUV": "G 580 Electric SUV", "G 580 Electric": "G 580 Electric SUV", "AMG G 63": "AMG G 63 SUV", "G 63 AMG": "AMG G 63 SUV" } },
  },
  // Subaru (2026-10-14, from subaru.com's own Build & Price data). Every alias below names exactly ONE policy trim; anything that could be two is left unmapped
  // (Ascent "Premium" / "Limited" = 7- or 8-Passenger; Forester "Standard Model"; "2.5RS"; "Series.Yellow"; equipment-abbreviation trims such as "Premium w/BSD/RCTA/PRG").
  subaru: {
    "2026|Crosstrek": { models: ["Crosstrek Hybrid"], modelImplied: { "Crosstrek Hybrid": "hybrid" } }, // Sport Hybrid / Limited Hybrid are the only Crosstrek Hybrid trims
    "2026|Forester": {
      models: ["Forester Hybrid"], modelImplied: { "Forester Hybrid": "hybrid" },
      trimAliases: { "Sport Onyx Edition": "Sport" }, // the Onyx Edition is Option Package 25 on the Sport trim ("Onyx Edition Package" $1,700 in the CSV): 1,738 cars
    },
    "2026|Ascent": { trimAliases: { Touring: "Touring 7-Passenger", "Onyx Edition Touring": "Onyx Edition Touring 7-Passenger", "Limited Bronze Edition": "Limited Bronze Edition 7-Passenger" } }, // 7-Passenger is the only seating those trims come in
    "2027|Ascent": { trimAliases: { Touring: "Touring 7-Passenger", "Onyx Edition Touring": "Onyx Edition Touring 7-Passenger", "Limited Bronze Edition": "Limited Bronze Edition 7-Passenger" } },
    "2026|Uncharted": { trimAliases: { Premium: "Premium FWD" } }, // the only Premium trim
    "2027|Uncharted": { trimAliases: { Premium: "Premium FWD" } },
    "2026|Trailseeker": { trimAliases: { "Touring w/Leather": "Touring Leather" } }, // the only trim with Leather in its name
    "2027|Trailseeker": { trimAliases: { "Touring w/Leather": "Touring Leather" } },
  },
  // Nissan (2026-10-14, from nissanusa.com's own Build & Price pages). Every alias names exactly ONE policy trim; anything that could be two is left unmapped
  // (Frontier "SV" / "S" / "PRO-4X": the site has Crew Cab, King Cab and Long Bed versions of each; Rogue 2026 "SL" and Murano 2027 "SV" and Pathfinder "S" are not on the site).
  nissan: {
    "2026|Rogue": { trimAliases: { Darkarmor: "Dark Armor" }, noisePhrases: ["cold weather package"] }, // "SV Cold Weather Package" is the SV trim with that package
    "2027|Rogue": { trimAliases: { Darkarmor: "Dark Armor" }, noisePhrases: ["cold weather package"] },
    "2026|Kicks": { noisePhrases: ["premium package", "cold weather package", "cold weather", "premium"] }, // "SR AWD Premium Package", "SR PREMIUM": package names on the SR / SV trims
    "2027|Kicks": { noisePhrases: ["premium package", "cold weather package", "cold weather", "premium"] },
    "2026|Sentra": { noisePhrases: ["premium package"] },
    "2027|Sentra": { noisePhrases: ["premium package"] },
    "2026|Altima": { trimAliases: { "2.5 SV": "SV", "25 SV": "SV", "2.5 SR": "SR", "25 SR": "SR" } }, // the 2.5 is the engine; "25" is the same spelled without the dot
    "2026|LEAF": { noise: ["x2b"] }, // "SV&#x2B" is "SV+" with the plus left as an HTML entity
    "2026|Z": { trimAliases: { "Heritage Edition": "Heritage Edition (Z32 Midnight Purple)" } }, // the only Heritage trim
    "2027|Armada": { trimAliases: { "PRO-4X": "PRO-4X Premium" } }, // the only PRO-4X trim in 2027
    "2026|Rogue Plug-in Hybrid": { noisePhrases: ["plug in hybrid", "phev", "sport utility 4d"] }, // "Platinum PLUG IN HYBRID", "SL Sport Utility 4D"
    // Frontier (ruling 2026-10-14). The site's trims carry the cab and bed; a feed that says just "SV" / "PRO-4X" / "PRO-X" means the Crew Cab (the short-bed Crew Cab and
    // its Long Bed twin carry the same paid options except one 2027 SV package; PRO-X exists only as a Crew Cab). Spelling, drivetrain-suffix and package-in-trim variants
    // ("Pro 4x", "SV 4WD Automatic", "PRO-4X w/R Package", "...R by Roush", "w/Wheel & Tire Package") resolve the same way. The truncated "Long" of an SV / PRO-4X
    // ("Crew Cab SV Long": "Crew Cab" is a noise phrase, so the key is "sv long") is the Long Bed. LEFT UNMAPPED on purpose: bare "S" (the site only has King Cab S), "Crew Cab S", "Crew Cab 4x4 Long", Dark Armor / Sport Edition without a cab, dealer text.
    "2026|Frontier": {
      trimAliases: { SV: "Crew Cab SV", "PRO-4X": "Crew Cab PRO-4X", "PRO-X": "Crew Cab PRO-X", "SV Long": "Crew Cab SV Long Bed", "PRO-4X Long": "Crew Cab PRO-4X Long Bed" },
      noise: ["r"], noisePhrases: ["w r package", "wr package", "w wheel tire package", "r by roush", "by r roush"],
    },
    "2027|Frontier": {
      trimAliases: { SV: "Crew Cab SV", "PRO-4X": "Crew Cab PRO-4X", "PRO-X": "Crew Cab PRO-X", "SV Long": "Crew Cab SV Long Bed", "PRO-4X Long": "Crew Cab PRO-4X Long Bed" },
      noise: ["r"], noisePhrases: ["w r package", "wr package", "w wheel tire package", "r by roush", "by r roush"],
    },
  },
  // Mazda (2026-10-14, from mazdausa.com's Build & Price data; every string below is a real one from the 2026-10-14 box2 read-only dry run). Every alias names exactly ONE
  // policy trim. LEFT UNMAPPED on purpose (listed in POLICY_REPORT_mazda.md / the PR): blank trims, dealer text ("Inventory", "Base"), paint words glued to the trim
  // ("Club Jet Black Mica"), a bare "Premium" on the CX-90 / CX-90 PHEV (Premium Plus or Premium Sport), "3.3 Turbo Premium" and "3.3 Turbo S Premium" on the CX-90 (the
  // site has only Premium Plus / Premium Sport there), the body-less "Mazda3" / "MAZDA3" models (hatchback or sedan), "MX-5" (soft top or RF), "CX-70 MHEV".
  mazda: {
    "2026|CX-5": { models: ["Mazda CX-5"], trimAliases: ENGINE25("2.5 S", "2.5 S Select", "2.5 S Preferred", "2.5 S Premium", "2.5 S Premium Plus") },
    "2026|CX-30": { models: ["Mazda CX-30"], trimAliases: ENGINE25("2.5 S", "2.5 S Select Sport", "2.5 S Preferred", "2.5 S Premium", "2.5 S Carbon Edition", "2.5 S Aire Edition", "2.5 Turbo Aire Edition", "2.5 Turbo Premium Plus") },
    "2026|CX-50": { models: ["Mazda CX-50"], trimAliases: ENGINE25("2.5 S Select", "2.5 S Preferred", "2.5 S Premium", "2.5 S Meridian Edition", "2.5 Turbo", "2.5 Turbo Meridian Edition", "2.5 Turbo Premium Plus") },
    "2026|CX-50 Hybrid": { models: ["Mazda CX-50 Hybrid"], trimAliases: { Preferred: "Hybrid Preferred", Premium: "Hybrid Premium", "Premium Plus": "Hybrid Premium Plus" } }, // the Hybrid model's only trims
    "2026|CX-70": { models: ["Mazda CX-70"], trimAliases: ENGINE33("3.3 Turbo Preferred", "3.3 Turbo Premium", "3.3 Turbo Premium Plus", "3.3 Turbo S Premium", "3.3 Turbo S Premium Plus") },
    "2026|CX-70 PHEV": { models: ["CX-70 Plug-In Hybrid", "Mazda CX-70 Plug-In Hybrid", "Mazda CX-70 PHEV"], trimAliases: { SC: "PHEV SC", "SC Plus": "PHEV SC Plus" } },
    "2026|CX-90": {
      models: ["Mazda CX-90", "Mazda CX90"],
      trimAliases: { ...ENGINE33("3.3 Turbo Select", "3.3 Turbo Preferred", "3.3 Turbo Premium Plus", "3.3 Turbo Premium Sport", "3.3 Turbo S Premium Plus", "3.3 Turbo S Premium Sport"), Select: "3.3 Turbo Select", Preferred: "3.3 Turbo Preferred", "Premium Plus": "3.3 Turbo Premium Plus", "Premium Sport": "3.3 Turbo Premium Sport", "S Premium Plus": "3.3 Turbo S Premium Plus", "S Premium Sport": "3.3 Turbo S Premium Sport" },
    },
    "2026|CX-90 PHEV": { models: ["CX-90 Plug-In Hybrid", "Mazda CX-90 Plug-In Hybrid", "Mazda CX-90 PHEV"], trimAliases: { Preferred: "PHEV Preferred", "Premium Plus": "PHEV Premium Plus", "Premium Sport": "PHEV Premium Sport" } },
    "2026|Mazda3 Hatchback": { noisePhrases: ["hatchback"], trimAliases: ENGINE25("2.5 S", "2.5 S Select Sport", "2.5 S Preferred", "2.5 S Premium", "2.5 S Carbon Edition", "2.5 Turbo Premium Plus") },
    "2026|Mazda3 Sedan": { models: ["3 Sedan"], noisePhrases: ["sedan"], trimAliases: ENGINE25("2.5 S", "2.5 S Select Sport", "2.5 S Preferred", "2.5 S Carbon Edition", "2.5 Turbo Premium Plus") },
    "2026|MX-5 Miata": { models: ["Mazda MX-5 Miata"] },
    "2026|MX-5 Miata RF": { models: ["Mazda MX-5 Miata RF"] },
  },
  // Audi (2026-10-15, every string below is a real one from the 2026-10-15 box2 read-only dry run: trim text + counts only). The feed drops the transmission words the policy
  // trims end in ("tiptronic", "S tronic"), glues words together ("Premiumplustfsiquattrotiptronic") or ends the trim with the start of the dealer's name. Every alias names
  // exactly ONE policy trim of its own model + year: either the string is that trim with those words missing, or the policy has only ONE trim at that level / on that model.
  // LEFT UNMAPPED on purpose (listed in the PR): blank trims; any trim ending in a dealer's name ("quattro Audi San", "TFSI tiptronic Audi Chantilly", "Rusnak/Westlake");
  // the A3 "Sedan TFSI quattro S" (the 40 TFSI or the S line plus: two trims); "Q5 quat. 2.0 R4200/D14A7" (a part number, not a trim); the Q6 e-tron "Q6 e-tron Audi ..." strings.
  audi: {
    "2026|RS 6 Avant": { trimAliases: { "4.0T performance": "RS 6 Avant performance" } }, // the engine, the model's only trim
    "2026|S e-tron GT": { trimAliases: { "Premium Plus": "Premium Plus quattro", Prestige: "Prestige quattro", "Premium Plus quattro Audi": "Premium Plus quattro" } }, // the S e-tron GT is all-wheel drive
    "2027|A3": { trimAliases: { "Sedan 40 TFSI quattro": "40 TFSI quattro S tronic (A3 Sedan)", "Sedan TFSI quattro Black": "TFSI quattro Black optic plus S tronic (A3 Sedan)" } }, // "40" and "Black" each belong to one trim only
    "2027|A6 Sedan": { trimAliases: { "Premium TFSI quattro S": "Premium TFSI quattro S tronic" } }, // the model's only trim ("S" = S tronic)
    "2027|Q3": { trimAliases: { "SUV TFSI quattro S": "TFSI quattro S tronic", Tfsiquattrostronic: "TFSI quattro S tronic" } }, // the model's only trim
    "2027|Q6 e-tron": { trimAliases: { Premium: "Premium quattro", "Premium Plus": "Premium Plus quattro", Prestige: "Prestige quattro", "Premium quattro Audi": "Premium quattro", "Premium Plus quattro Audi": "Premium Plus quattro" } },
    "2027|Q6 Sportback e-tron": { trimAliases: { Premium: "Premium quattro", "Premium Plus": "Premium Plus quattro", Prestige: "Prestige quattro", "Premium quattro Audi": "Premium quattro", "Premium Plus quattro Audi": "Premium Plus quattro" } },
    "2027|Q7": { trimAliases: { "Premium Plus TFSI quattro": "Premium Plus TFSI quattro tiptronic", Premiumplustfsiquattrotiptronic: "Premium Plus TFSI quattro tiptronic" } },
    "2027|Q8": {
      trimAliases: {
        "Premium 55 TFSI quattro": "Premium 55 TFSI quattro tiptronic", "Premium Plus 55 TFSI": "Premium Plus 55 TFSI quattro tiptronic", "Prestige 55 TFSI quattro": "Prestige 55 TFSI quattro tiptronic",
        Premium: "Premium 55 TFSI quattro tiptronic", "Premium Plus": "Premium Plus 55 TFSI quattro tiptronic", Prestige: "Prestige 55 TFSI quattro tiptronic", Premiumplus55tfsiquattrotiptronic: "Premium Plus 55 TFSI quattro tiptronic", Premiumplus: "Premium Plus 55 TFSI quattro tiptronic",
      },
    },
    "2027|Q9": { trimAliases: { "Premium Plus TFSI quattro": "Premium Plus TFSI quattro tiptronic", Prestigetfsiquattrotiptronic: "Prestige TFSI quattro tiptronic" } },
    "2027|RS Q8": { trimAliases: { Performance: "quattro tiptronic (RS Q8 performance)" } }, // the model's only trim
    "2027|S3": { trimAliases: { "Sedan TFSI quattro S": "TFSI quattro S tronic" } }, // the model's only trim
    "2027|SQ6 e-tron": { trimAliases: { "Premium Plus": "Premium Plus quattro", Prestige: "Prestige quattro", "Premium Plus quattro Audi": "Premium Plus quattro" } }, // the model's only two trims
    "2027|SQ6 Sportback e-tron": { trimAliases: { "Premium Plus quattro Audi": "Premium Plus quattro" } },
    "2027|SQ8": { trimAliases: { "Premium Plus TFSI quattro": "Premium Plus TFSI quattro tiptronic", "Premium Plus": "Premium Plus TFSI quattro tiptronic", Prestige: "Prestige TFSI quattro tiptronic" } },
  },
};
