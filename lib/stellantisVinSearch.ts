/**
 * Coarse similar-car search + Stellantis-sticker must-have filter.
 *
 * Mirrors lib/vinSearch.ts's Ford hunt and lib/gmVinSearch.ts's GM hunt,
 * reusing the same OEM-agnostic pieces (searchCoarseListings, rankFordMatches,
 * enrichMatchListingPrices, selectCompetitionSlots, composeEmptyHuntNote,
 * mapPool) with Stellantis-specific sticker parsing and must-have matching
 * swapped in.
 *
 * Like GM's hunt (and unlike Ford's), this compares trim: a Jeep/Ram/Dodge/
 * Chrysler trim (Rubicon, Limited, Big Horn...) is itself the spec a buyer
 * is comparing against, not just an optional add-on. No engine-prefix
 * exclusion step — same reasoning as GM's hunt: nothing to generalize from
 * Ford's Explorer-specific hack.
 */

import fs from "node:fs";
import path from "node:path";
import { calculateDistanceMiles } from "./otdCalculator";
import {
  confirmStellantisMustHavesFromSticker,
  getStellantisSticker,
  parseStellantisStickerText,
  stellantisFactoryOptionBreakout,
  stellantisStickerPdfUrl,
  stickerHasMustHave,
  type StellantisSticker,
} from "./stellantisSticker";
import type { FordFactoryOptionLine } from "./fordSticker";
import { selectCompetitionSlots } from "./fordCompetitionUi";
import {
  composeEmptyHuntNote,
  enrichMatchListingPrices,
  hasListingsApiKey,
  isUsableHuntLocation,
  listingMatchesSubjectModel,
  mapPool,
  rankFordMatches,
  searchCoarseListings,
  MAX_STICKER_CANDIDATES,
  type ListingCandidate,
  type PriceFact,
} from "./vinSearch";
import type { ListingsProvider } from "./listingsProvider";

export interface StellantisMatchCard {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  exteriorColor?: string;
  dealerId?: string;
  dealerName: string;
  city: string;
  state: string;
  zip?: string;
  distanceMiles: number | null;
  listingPrice: number | null;
  listingPriceSource: PriceFact;
  msrp: number | null;
  msrpSource: PriceFact;
  dealerUrl: string | null;
  pdfUrl: string;
  matchedMustHaves: string[];
  matchedNiceToHaves: string[];
  stickerStatus: StellantisSticker["status"];
  /** Full optional-equipment list from this VIN's Stellantis sticker. Never invented. */
  factoryOptions: FordFactoryOptionLine[];
  factoryOptionsStatus: "ok" | "unavailable";
  /** Days the listing has been active, straight off the search row — no extra call. */
  daysOnMarket: number | null;
  /** Free proxy for motivation from the same search row; not a true price-change count. */
  priceChangeHint: number | null;
}

export interface StellantisSearchDropped {
  vin: string;
  reason: "unreleased" | "missing_must_have" | "sticker_error" | "outside_radius";
  missing?: string[];
  dealerName?: string;
  distanceMiles?: number | null;
}

export interface StellantisSearchResult {
  provider: ListingsProvider;
  note: string;
  listingsError?: boolean;
  needsLocation?: boolean;
  originZip?: string;
  radiusMiles?: number;
  candidatesConsidered: number;
  stickersFetched: number;
  matches: StellantisMatchCard[];
  dropped: StellantisSearchDropped[];
  hasListingsKey: boolean;
}

function stellantisHuntResult(partial: Omit<StellantisSearchResult, "hasListingsKey">): StellantisSearchResult {
  return { ...partial, hasListingsKey: hasListingsApiKey() };
}

function normalizeModelName(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeTrimName(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Mirrors gmVinSearch.ts's listingMatchesSubjectTrim — a Wrangler Sport
 * shouldn't surface Rubicon suggestions any more than a Silverado LT should
 * surface RST. Missing trim data on either side passes rather than excludes. */
function listingMatchesSubjectTrim(listing: { trim?: string }, subjectTrim?: string): boolean {
  const want = normalizeTrimName(subjectTrim);
  const got = normalizeTrimName(listing.trim);
  if (!want || !got) return true;
  return want === got;
}

/**
 * Real sticker fixtures (lib/testdata/stellantis-stickers/) — a 2021 Jeep
 * Wrangler Unlimited Rubicon 392 and a 2021 Ram 1500 Limited. Different
 * models, so this pool naturally only self-matches by model, same as
 * DEMO_COMPARABLE_LISTINGS/DEMO_GM_COMPARABLE_LISTINGS.
 */
export const DEMO_STELLANTIS_COMPARABLE_LISTINGS: ListingCandidate[] = [
  {
    vin: "1C4JJXSJ3MW678163",
    year: 2021,
    make: "Jeep",
    model: "Wrangler",
    trim: "Unlimited Rubicon 392",
    dealerName: "Space Chrysler Jeep Dodge Ram",
    city: "Parsippany",
    state: "NJ",
    zip: "07054",
    dealerUrl: null,
    listingPrice: null,
    lat: 40.859,
    lng: -74.425,
  },
  {
    vin: "1C6SRFHT4MN652569",
    year: 2021,
    make: "Ram",
    model: "1500",
    trim: "Limited Crew Cab 4x4",
    dealerName: "All American Chrysler Jeep Dodge Ram",
    city: "Old Bridge",
    state: "NJ",
    zip: "08857",
    dealerUrl: null,
    listingPrice: null,
    lat: 40.401,
    lng: -74.36,
  },
];

function demoStellantisListingsForModel(model?: string): ListingCandidate[] {
  const want = normalizeModelName(model);
  if (!want) return [];
  return DEMO_STELLANTIS_COMPARABLE_LISTINGS.filter((l) => listingMatchesSubjectModel(l, model));
}

export function demoStellantisListingsNote(model?: string): string {
  const matched = demoStellantisListingsForModel(model);
  if (matched.length === 0) {
    return `Demo listings are limited to a Wrangler and a Ram 1500 and do not apply to ${
      model || "this vehicle"
    }. Other lots were not added.`;
  }
  return "No listings API key configured. Demo comparables use known Jeep/Ram VINs plus factory build data.";
}

function stellantisDemoFixturePaths(vin: string): string[] {
  const file = `${vin.trim().toUpperCase()}.txt`;
  const paths = [path.join(process.cwd(), "lib/testdata/stellantis-stickers", file)];
  try {
    paths.unshift(path.join(import.meta.dirname, "testdata/stellantis-stickers", file));
  } catch {
    // import.meta.dirname is unavailable in some bundles
  }
  return paths;
}

/** Bundled demo stickers — no live Stellantis round-trip. */
export function stickerFromStellantisDemoFixture(vin: string): StellantisSticker | null {
  for (const filePath of stellantisDemoFixturePaths(vin)) {
    try {
      if (!fs.existsSync(filePath)) continue;
      return parseStellantisStickerText(vin, fs.readFileSync(filePath, "utf8"));
    } catch {
      // try next path
    }
  }
  return null;
}

async function fetchStellantisStickerPreferDemoFixture(vin: string): Promise<StellantisSticker> {
  const local = stickerFromStellantisDemoFixture(vin);
  if (local) return local;
  return getStellantisSticker(vin);
}

export async function findSimilarStellantisVehicles(opts: {
  subjectVin: string;
  subject?: StellantisSticker;
  mustHaveLines: string[];
  niceToHaveLines?: string[];
  zip?: string;
  radiusMiles?: number;
  listings?: ListingCandidate[];
  fetchSticker?: (vin: string) => Promise<StellantisSticker>;
  fetchVdpPrice?: (url: string) => Promise<number | null>;
}): Promise<StellantisSearchResult> {
  const zip = (opts.zip || "").trim();
  const radius = opts.radiusMiles;
  if (!isUsableHuntLocation(zip, radius)) {
    return stellantisHuntResult({
      provider: "demo",
      note: "Enter a 5-digit ZIP and a search radius in miles to see two matching lots in range.",
      needsLocation: true,
      candidatesConsidered: 0,
      stickersFetched: 0,
      matches: [],
      dropped: [],
    });
  }
  const radiusMiles = radius as number;
  const subject = opts.subject || (await getStellantisSticker(opts.subjectVin));
  const mustHaves = opts.mustHaveLines.filter(Boolean);
  const niceHaves = opts.niceToHaveLines || [];

  let provider: ListingsProvider = "demo";
  let note = "";
  let listings = opts.listings;
  if (!listings) {
    const searched = await searchCoarseListings(
      {
        year: subject.year && subject.year >= 1990 && subject.year <= 2035 ? subject.year : undefined,
        make: subject.make || "",
        model: subject.model,
        trim: subject.trim,
        zip,
        radiusMiles,
      },
      { listingsForModel: demoStellantisListingsForModel, noteForModel: demoStellantisListingsNote }
    );
    provider = searched.provider;
    note = searched.note;
    listings = searched.listings;
    if (searched.listingsError) {
      return stellantisHuntResult({
        provider,
        note,
        listingsError: true,
        originZip: zip,
        radiusMiles,
        candidatesConsidered: 0,
        stickersFetched: 0,
        matches: [],
        dropped: [],
      });
    }
  } else {
    provider = "demo";
    note = "Using provided candidate list.";
  }

  listings = (listings || [])
    .filter((l) => listingMatchesSubjectModel(l, subject.model))
    .filter((l) => listingMatchesSubjectTrim(l, subject.trim));
  if (listings.length === 0 && provider === "demo") {
    return stellantisHuntResult({
      provider: "demo",
      note: demoStellantisListingsNote(subject.model),
      originZip: zip,
      radiusMiles,
      candidatesConsidered: 0,
      stickersFetched: 0,
      matches: [],
      dropped: [],
    });
  }

  const fetchSticker =
    opts.fetchSticker || (provider === "demo" ? fetchStellantisStickerPreferDemoFixture : getStellantisSticker);

  const dropped: StellantisSearchDropped[] = [];
  const candidates = listings.filter((l) => l.vin.toUpperCase() !== opts.subjectVin.toUpperCase());
  const capped = candidates.slice(0, MAX_STICKER_CANDIDATES);
  const matches: StellantisMatchCard[] = [];

  await mapPool(capped, 4, async (listing) => {
    try {
      const sticker = await fetchSticker(listing.vin);
      if (sticker.status === "unreleased") {
        dropped.push({ vin: listing.vin, reason: "unreleased", dealerName: listing.dealerName });
        return;
      }
      if (sticker.status !== "released") {
        dropped.push({ vin: listing.vin, reason: "sticker_error", dealerName: listing.dealerName });
        return;
      }
      const check = confirmStellantisMustHavesFromSticker(sticker, mustHaves);
      if (!check.pass) {
        dropped.push({
          vin: listing.vin,
          reason: "missing_must_have",
          missing: check.missing,
          dealerName: listing.dealerName,
        });
        return;
      }
      const matchedNice = niceHaves.filter((line) => stickerHasMustHave(sticker, line));
      const factoryOptions = stellantisFactoryOptionBreakout(sticker);
      const dealer = {
        city: listing.city || sticker.dealerSoldTo?.city || "",
        state: listing.state || sticker.dealerSoldTo?.state || "",
        lat: listing.lat,
        lng: listing.lng,
      };
      let distanceMiles: number | null = null;
      if (dealer.city || dealer.state || dealer.lat) {
        distanceMiles = calculateDistanceMiles(zip, dealer);
      }
      if (distanceMiles == null || distanceMiles > radiusMiles) {
        dropped.push({
          vin: listing.vin,
          reason: "outside_radius",
          dealerName: listing.dealerName,
          distanceMiles,
        });
        return;
      }
      matches.push({
        vin: listing.vin,
        year: sticker.year || listing.year,
        make: sticker.make || listing.make,
        model: sticker.model || listing.model,
        trim: sticker.trim || listing.trim,
        engine: sticker.engine,
        exteriorColor: sticker.exteriorColor || listing.exteriorColor,
        dealerId: listing.dealerId,
        dealerName: listing.dealerName || sticker.dealerSoldTo?.name || "Unknown dealer",
        city: dealer.city,
        state: dealer.state,
        zip: listing.zip || sticker.dealerSoldTo?.zip,
        distanceMiles,
        listingPrice: listing.listingPrice,
        listingPriceSource: listing.listingPrice && listing.listingPrice > 0 ? "listing" : "unconfirmed",
        msrp: sticker.msrp,
        msrpSource: sticker.msrp != null ? "sticker" : "unconfirmed",
        dealerUrl: listing.dealerUrl || null,
        pdfUrl: stellantisStickerPdfUrl(listing.vin),
        matchedMustHaves: check.matched,
        matchedNiceToHaves: matchedNice,
        stickerStatus: sticker.status,
        factoryOptions,
        factoryOptionsStatus: factoryOptions.length > 0 ? "ok" : "unavailable",
        daysOnMarket: listing.daysOnMarket ?? null,
        priceChangeHint: listing.priceChangeHint ?? null,
      });
    } catch {
      dropped.push({ vin: listing.vin, reason: "sticker_error", dealerName: listing.dealerName });
    }
  });

  const ranked = await enrichMatchListingPrices(
    selectCompetitionSlots(rankFordMatches(matches)),
    opts.fetchVdpPrice
  );
  if (ranked.length === 0) {
    note = composeEmptyHuntNote({
      zip,
      radiusMiles,
      provider,
      existingNote: note,
      dropped,
      subjectModel: subject.model,
      candidateCount: listings.length,
      demoNoteForModel: demoStellantisListingsNote,
    });
  }

  return stellantisHuntResult({
    provider,
    note,
    originZip: zip,
    radiusMiles,
    candidatesConsidered: listings.length,
    stickersFetched: capped.length,
    matches: ranked,
    dropped,
  });
}
