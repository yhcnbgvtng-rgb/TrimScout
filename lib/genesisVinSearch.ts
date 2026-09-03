/**
 * Coarse similar-car search + Genesis-sticker must-have filter.
 *
 * Mirrors lib/vinSearch.ts's Ford hunt and lib/stellantisVinSearch.ts's
 * Stellantis hunt, reusing the same OEM-agnostic pieces (searchCoarseListings,
 * rankFordMatches, enrichMatchListingPrices, selectCompetitionSlots,
 * composeEmptyHuntNote, mapPool) with Genesis-specific sticker parsing and
 * must-have matching swapped in.
 *
 * Like GM/Stellantis's hunts (and unlike Ford's), this compares trim: a
 * Genesis trim (Prestige, Sport Prestige...) is itself the spec a buyer is
 * comparing against, not just an optional add-on. No engine-prefix exclusion
 * step — same reasoning as GM/Stellantis's hunts.
 */

import fs from "node:fs";
import path from "node:path";
import { calculateDistanceMiles } from "./otdCalculator";
import {
  confirmGenesisMustHavesFromSticker,
  genesisFactoryOptionBreakout,
  genesisStickerPdfUrl,
  getGenesisSticker,
  parseGenesisStickerText,
  stickerHasMustHave,
  type GenesisSticker,
} from "./genesisSticker";
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

export interface GenesisMatchCard {
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
  stickerStatus: GenesisSticker["status"];
  /** Full optional-equipment list from this VIN's Genesis sticker. Never invented. */
  factoryOptions: FordFactoryOptionLine[];
  factoryOptionsStatus: "ok" | "unavailable";
  /** Days the listing has been active, straight off the search row — no extra call. */
  daysOnMarket: number | null;
  /** Free proxy for motivation from the same search row; not a true price-change count. */
  priceChangeHint: number | null;
}

export interface GenesisSearchDropped {
  vin: string;
  reason: "unreleased" | "missing_must_have" | "sticker_error" | "outside_radius";
  missing?: string[];
  dealerName?: string;
  distanceMiles?: number | null;
}

export interface GenesisSearchResult {
  provider: ListingsProvider;
  note: string;
  listingsError?: boolean;
  needsLocation?: boolean;
  originZip?: string;
  radiusMiles?: number;
  candidatesConsidered: number;
  stickersFetched: number;
  matches: GenesisMatchCard[];
  dropped: GenesisSearchDropped[];
  hasListingsKey: boolean;
}

function genesisHuntResult(partial: Omit<GenesisSearchResult, "hasListingsKey">): GenesisSearchResult {
  return { ...partial, hasListingsKey: hasListingsApiKey() };
}

function normalizeModelName(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeTrimName(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Mirrors gmVinSearch.ts's/stellantisVinSearch.ts's listingMatchesSubjectTrim
 * — a G80 Sport Prestige buyer shouldn't see base-trim G80 suggestions any
 * more than a Silverado LT should surface RST. Missing trim data on either
 * side passes rather than excludes. */
function listingMatchesSubjectTrim(listing: { trim?: string }, subjectTrim?: string): boolean {
  const want = normalizeTrimName(subjectTrim);
  const got = normalizeTrimName(listing.trim);
  if (!want || !got) return true;
  return want === got;
}

/**
 * Real sticker fixtures (lib/testdata/genesis-stickers/) — a 2024 Genesis G90
 * 3.5T E-Supercharger AWD and a 2023 Genesis G80 AWD 2.5T Sport Prestige.
 * Different models, so this pool naturally only self-matches by model, same
 * as DEMO_COMPARABLE_LISTINGS/DEMO_GM_COMPARABLE_LISTINGS/DEMO_STELLANTIS_COMPARABLE_LISTINGS.
 */
export const DEMO_GENESIS_COMPARABLE_LISTINGS: ListingCandidate[] = [
  {
    vin: "KMTFC4SD2RU039916",
    year: 2024,
    make: "Genesis",
    model: "G90",
    trim: undefined,
    dealerName: "Genesis of Laguna Niguel",
    city: "Laguna Niguel",
    state: "CA",
    zip: "92677",
    dealerUrl: null,
    listingPrice: null,
    lat: 33.523,
    lng: -117.707,
  },
  {
    vin: "KMTGA4SC4PU151020",
    year: 2023,
    make: "Genesis",
    model: "G80",
    trim: "Sport Prestige",
    dealerName: "Genesis of Cherry Hill",
    city: "Marlton",
    state: "NJ",
    zip: "08053",
    dealerUrl: null,
    listingPrice: null,
    lat: 39.893,
    lng: -74.925,
  },
];

function demoGenesisListingsForModel(model?: string): ListingCandidate[] {
  const want = normalizeModelName(model);
  if (!want) return [];
  return DEMO_GENESIS_COMPARABLE_LISTINGS.filter((l) => listingMatchesSubjectModel(l, model));
}

export function demoGenesisListingsNote(model?: string): string {
  const matched = demoGenesisListingsForModel(model);
  if (matched.length === 0) {
    return `Demo listings are limited to a G90 and a G80 and do not apply to ${
      model || "this vehicle"
    }. Other lots were not added.`;
  }
  return "No listings API key configured. Demo comparables use known Genesis VINs plus factory build data.";
}

function genesisDemoFixturePaths(vin: string): string[] {
  const file = `${vin.trim().toUpperCase()}.txt`;
  const paths = [path.join(process.cwd(), "lib/testdata/genesis-stickers", file)];
  try {
    paths.unshift(path.join(import.meta.dirname, "testdata/genesis-stickers", file));
  } catch {
    // import.meta.dirname is unavailable in some bundles
  }
  return paths;
}

/** Bundled demo stickers — no live Genesis round-trip. */
export function stickerFromGenesisDemoFixture(vin: string): GenesisSticker | null {
  for (const filePath of genesisDemoFixturePaths(vin)) {
    try {
      if (!fs.existsSync(filePath)) continue;
      return parseGenesisStickerText(vin, fs.readFileSync(filePath, "utf8"));
    } catch {
      // try next path
    }
  }
  return null;
}

async function fetchGenesisStickerPreferDemoFixture(vin: string): Promise<GenesisSticker> {
  const local = stickerFromGenesisDemoFixture(vin);
  if (local) return local;
  return getGenesisSticker(vin);
}

export async function findSimilarGenesisVehicles(opts: {
  subjectVin: string;
  subject?: GenesisSticker;
  mustHaveLines: string[];
  niceToHaveLines?: string[];
  zip?: string;
  radiusMiles?: number;
  listings?: ListingCandidate[];
  fetchSticker?: (vin: string) => Promise<GenesisSticker>;
  fetchVdpPrice?: (url: string) => Promise<number | null>;
  /** The favorite vehicle's own listing price, if known — ranks a comparable that sits just under it ahead of one that doesn't. A boost, never a filter. */
  subjectListingPrice?: number | null;
}): Promise<GenesisSearchResult> {
  const zip = (opts.zip || "").trim();
  const radius = opts.radiusMiles;
  if (!isUsableHuntLocation(zip, radius)) {
    return genesisHuntResult({
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
  const subject = opts.subject || (await getGenesisSticker(opts.subjectVin));
  const mustHaves = opts.mustHaveLines.filter(Boolean);
  const niceHaves = opts.niceToHaveLines || [];

  let provider: ListingsProvider = "demo";
  let note = "";
  let listings = opts.listings;
  if (!listings) {
    const searched = await searchCoarseListings(
      {
        year: subject.year && subject.year >= 1990 && subject.year <= 2035 ? subject.year : undefined,
        make: subject.make || "Genesis",
        model: subject.model,
        trim: subject.trim,
        zip,
        radiusMiles,
      },
      { listingsForModel: demoGenesisListingsForModel, noteForModel: demoGenesisListingsNote }
    );
    provider = searched.provider;
    note = searched.note;
    listings = searched.listings;
    if (searched.listingsError) {
      return genesisHuntResult({
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
    return genesisHuntResult({
      provider: "demo",
      note: demoGenesisListingsNote(subject.model),
      originZip: zip,
      radiusMiles,
      candidatesConsidered: 0,
      stickersFetched: 0,
      matches: [],
      dropped: [],
    });
  }

  const fetchSticker =
    opts.fetchSticker || (provider === "demo" ? fetchGenesisStickerPreferDemoFixture : getGenesisSticker);

  const dropped: GenesisSearchDropped[] = [];
  const candidates = listings.filter((l) => l.vin.toUpperCase() !== opts.subjectVin.toUpperCase());
  const capped = candidates.slice(0, MAX_STICKER_CANDIDATES);
  const matches: GenesisMatchCard[] = [];

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
      const check = confirmGenesisMustHavesFromSticker(sticker, mustHaves);
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
      const factoryOptions = genesisFactoryOptionBreakout(sticker);
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
        make: sticker.make || listing.make || "Genesis",
        model: sticker.model || listing.model,
        trim: sticker.trim || listing.trim,
        engine: sticker.engine,
        exteriorColor: sticker.exteriorColor || listing.exteriorColor,
        dealerId: listing.dealerId,
        dealerName: listing.dealerName || sticker.dealerSoldTo?.name || "Genesis dealer",
        city: dealer.city,
        state: dealer.state,
        zip: listing.zip || sticker.dealerSoldTo?.zip,
        distanceMiles,
        listingPrice: listing.listingPrice,
        listingPriceSource: listing.listingPrice && listing.listingPrice > 0 ? "listing" : "unconfirmed",
        msrp: sticker.msrp,
        msrpSource: sticker.msrp != null ? "sticker" : "unconfirmed",
        dealerUrl: listing.dealerUrl || null,
        pdfUrl: genesisStickerPdfUrl(listing.vin),
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
    selectCompetitionSlots(rankFordMatches(matches, opts.subjectListingPrice)),
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
      demoNoteForModel: demoGenesisListingsNote,
    });
  }

  return genesisHuntResult({
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
