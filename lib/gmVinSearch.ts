/**
 * Coarse similar-car search + GM-sticker must-have filter.
 *
 * Mirrors lib/vinSearch.ts's Ford hunt, reusing its OEM-agnostic pieces
 * (searchCoarseListings, rankFordMatches, enrichMatchListingPrices,
 * selectCompetitionSlots, composeEmptyHuntNote, mapPool) with GM-specific
 * sticker parsing and must-have matching swapped in.
 *
 * Unlike Ford's hunt, this has no engine-prefix exclusion step: Ford's
 * shouldExcludeByEnginePrefix is hardcoded to the 2026 Explorer's two
 * EcoBoost VIN-prefix variants specifically — there is no generalized
 * "engine family from VIN" concept to extend for GM trims (gas vs.
 * Duramax, etc.). A must-have line naming an engine still filters
 * correctly via stickerHasMustHave.
 */

import fs from "node:fs";
import path from "node:path";
import { calculateDistanceMiles } from "./otdCalculator";
import {
  confirmGmMustHavesFromSticker,
  gmFactoryOptionBreakout,
  gmStickerPdfUrl,
  getGmSticker,
  parseGmStickerText,
  stickerHasMustHave,
  type GmSticker,
} from "./gmSticker";
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

export interface GmMatchCard {
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
  stickerStatus: GmSticker["status"];
  /** Full optional-equipment list from this VIN's GM sticker. Never invented. */
  factoryOptions: FordFactoryOptionLine[];
  factoryOptionsStatus: "ok" | "unavailable";
  /** Days the listing has been active, straight off the search row — no extra call. */
  daysOnMarket: number | null;
  /** Free proxy for motivation from the same search row; not a true price-change count. */
  priceChangeHint: number | null;
}

export interface GmSearchDropped {
  vin: string;
  reason: "unreleased" | "missing_must_have" | "sticker_error" | "outside_radius";
  missing?: string[];
  dealerName?: string;
  distanceMiles?: number | null;
}

export interface GmSearchResult {
  provider: ListingsProvider;
  note: string;
  listingsError?: boolean;
  needsLocation?: boolean;
  originZip?: string;
  radiusMiles?: number;
  candidatesConsidered: number;
  stickersFetched: number;
  matches: GmMatchCard[];
  dropped: GmSearchDropped[];
  hasListingsKey: boolean;
}

function gmHuntResult(partial: Omit<GmSearchResult, "hasListingsKey">): GmSearchResult {
  return { ...partial, hasListingsKey: hasListingsApiKey() };
}

function normalizeModelName(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeTrimName(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Unlike Ford's hunt, GM's does compare trim: a GM trim (LT, RST, Z71...) is
 * itself the spec a buyer is comparing against, not just an optional add-on
 * a factory-sticker must-have could independently confirm. Missing trim data
 * on either side passes rather than excludes — never drop a real candidate
 * just because a field wasn't populated.
 */
function listingMatchesSubjectTrim(listing: { trim?: string }, subjectTrim?: string): boolean {
  const want = normalizeTrimName(subjectTrim);
  const got = normalizeTrimName(listing.trim);
  if (!want || !got) return true;
  return want === got;
}

/** Real GM sticker fixtures already used for must-have-matching tests in gmSticker.test.ts. */
export const DEMO_GM_COMPARABLE_LISTINGS: ListingCandidate[] = [
  {
    vin: "1GCUKDED8TZ200011",
    year: 2026,
    make: "Chevrolet",
    model: "Silverado 1500",
    trim: "LT",
    dealerName: "Ditschman Flemington Chevrolet",
    city: "Flemington",
    state: "NJ",
    zip: "08822",
    dealerUrl: null,
    listingPrice: null,
    lat: 40.513,
    lng: -74.859,
  },
  {
    vin: "1GCUKDED2TZ200022",
    year: 2026,
    make: "Chevrolet",
    model: "Silverado 1500",
    trim: "LT",
    dealerName: "Ciocca Chevrolet of Allentown",
    city: "Allentown",
    state: "PA",
    zip: "18103",
    dealerUrl: null,
    listingPrice: null,
    lat: 40.567,
    lng: -75.475,
  },
  {
    vin: "1GCUKDED7TZ200033",
    year: 2026,
    make: "Chevrolet",
    model: "Silverado 1500",
    trim: "LT",
    dealerName: "Bowser Chevrolet",
    city: "Monroeville",
    state: "PA",
    zip: "15146",
    dealerUrl: null,
    listingPrice: null,
    lat: 40.4215,
    lng: -79.7889,
  },
  {
    vin: "1GCUKDED1TZ200044",
    year: 2026,
    make: "Chevrolet",
    model: "Silverado 1500",
    trim: "LT",
    dealerName: "Lilliston Chevrolet",
    city: "Vineland",
    state: "NJ",
    zip: "08360",
    dealerUrl: null,
    listingPrice: null,
    lat: 39.4863,
    lng: -75.0257,
  },
];

function demoGmListingsForModel(model?: string): ListingCandidate[] {
  const want = normalizeModelName(model);
  if (!want) return [];
  return DEMO_GM_COMPARABLE_LISTINGS.filter((l) => listingMatchesSubjectModel(l, model));
}

export function demoGmListingsNote(model?: string): string {
  const matched = demoGmListingsForModel(model);
  if (matched.length === 0) {
    return `Demo listings are Silverado 1500 only and do not apply to ${
      model || "this vehicle"
    }. Other lots were not added.`;
  }
  return "No listings API key configured. Demo comparables use known Silverado 1500 VINs plus factory build data.";
}

function gmDemoFixturePaths(vin: string): string[] {
  const file = `${vin.trim().toUpperCase()}.txt`;
  const paths = [path.join(process.cwd(), "lib/testdata/gm-stickers", file)];
  try {
    paths.unshift(path.join(import.meta.dirname, "testdata/gm-stickers", file));
  } catch {
    // import.meta.dirname is unavailable in some bundles
  }
  return paths;
}

/** Bundled Silverado demo stickers — no live GM CWS round-trip. */
export function stickerFromGmDemoFixture(vin: string): GmSticker | null {
  for (const filePath of gmDemoFixturePaths(vin)) {
    try {
      if (!fs.existsSync(filePath)) continue;
      return parseGmStickerText(vin, fs.readFileSync(filePath, "utf8"));
    } catch {
      // try next path
    }
  }
  return null;
}

async function fetchGmStickerPreferDemoFixture(vin: string): Promise<GmSticker> {
  const local = stickerFromGmDemoFixture(vin);
  if (local) return local;
  return getGmSticker(vin);
}

export async function findSimilarGmVehicles(opts: {
  subjectVin: string;
  subject?: GmSticker;
  mustHaveLines: string[];
  niceToHaveLines?: string[];
  zip?: string;
  radiusMiles?: number;
  listings?: ListingCandidate[];
  fetchSticker?: (vin: string) => Promise<GmSticker>;
  fetchVdpPrice?: (url: string) => Promise<number | null>;
}): Promise<GmSearchResult> {
  const zip = (opts.zip || "").trim();
  const radius = opts.radiusMiles;
  if (!isUsableHuntLocation(zip, radius)) {
    return gmHuntResult({
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
  const subject = opts.subject || (await getGmSticker(opts.subjectVin));
  const mustHaves = opts.mustHaveLines.filter(Boolean);
  const niceHaves = opts.niceToHaveLines || [];

  let provider: ListingsProvider = "demo";
  let note = "";
  let listings = opts.listings;
  if (!listings) {
    const searched = await searchCoarseListings(
      {
        year: subject.year && subject.year >= 1990 && subject.year <= 2035 ? subject.year : undefined,
        make: subject.make || "Chevrolet",
        model: subject.model,
        trim: subject.trim,
        zip,
        radiusMiles,
      },
      { listingsForModel: demoGmListingsForModel, noteForModel: demoGmListingsNote }
    );
    provider = searched.provider;
    note = searched.note;
    listings = searched.listings;
    if (searched.listingsError) {
      return gmHuntResult({
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
    return gmHuntResult({
      provider: "demo",
      note: demoGmListingsNote(subject.model),
      originZip: zip,
      radiusMiles,
      candidatesConsidered: 0,
      stickersFetched: 0,
      matches: [],
      dropped: [],
    });
  }

  const fetchSticker =
    opts.fetchSticker || (provider === "demo" ? fetchGmStickerPreferDemoFixture : getGmSticker);

  const dropped: GmSearchDropped[] = [];
  const candidates = listings.filter((l) => l.vin.toUpperCase() !== opts.subjectVin.toUpperCase());
  const capped = candidates.slice(0, MAX_STICKER_CANDIDATES);
  const matches: GmMatchCard[] = [];

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
      const check = confirmGmMustHavesFromSticker(sticker, mustHaves);
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
      const factoryOptions = gmFactoryOptionBreakout(sticker);
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
        make: sticker.make || listing.make || "Chevrolet",
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
        pdfUrl: gmStickerPdfUrl(listing.vin),
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
      demoNoteForModel: demoGmListingsNote,
    });
  }

  return gmHuntResult({
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
