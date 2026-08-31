/**
 * Coarse similar-car search + Ford-sticker must-have filter.
 *
 * Listings APIs (Auto.dev / MarketCheck) can filter year/make/model/trim/
 * engine/color/zip. They cannot filter Ultimate / BlueCruise / keypad.
 * We take the first 25–50 candidate VINs, fetch each Ford sticker, and
 * DROP any VIN missing a must-have option line.
 *
 * Without a listings API key, demo comparables mode still hits Ford Direct
 * live for the known worked-example VINs.
 */

import { calculateDistanceMiles } from "./otdCalculator";
import {
  confirmFordMustHavesFromSticker,
  engineFamilyFromVin,
  fordStickerPdfUrl,
  getFordSticker,
  isStandardKeylessLine,
  shouldExcludeByEnginePrefix,
  stickerHasMustHave,
  type FordSticker,
} from "./fordSticker";
import type { Vehicle } from "./types";

export const MAX_STICKER_CANDIDATES = 50;
export const MAX_FORD_RECS = 2;

function normalizeModelName(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function listingMatchesSubjectModel(listing: { model?: string }, subjectModel?: string): boolean {
  const want = normalizeModelName(subjectModel);
  const got = normalizeModelName(listing.model);
  if (!want) return true;
  if (!got) return true;
  return want === got;
}

function demoListingsForModel(model?: string): ListingCandidate[] {
  const want = normalizeModelName(model);
  if (!want) return [];
  return DEMO_COMPARABLE_LISTINGS.filter((l) => listingMatchesSubjectModel(l, model));
}

function demoListingsNote(model?: string): string {
  const matched = demoListingsForModel(model);
  if (matched.length === 0) {
    return `No listings API key configured. Demo similar lots are Explorer Tremor examples and do not apply to ${
      model || "this vehicle"
    }. Increase Competition was left empty. Set AUTO_DEV_API_KEY or MARKETCHECK_API_KEY for nationwide search.`;
  }
  return "No listings API key configured. Demo comparables use known VINs plus live Ford Direct stickers. Set AUTO_DEV_API_KEY or MARKETCHECK_API_KEY for nationwide search.";
}

export type ListingsProvider = "auto.dev" | "marketcheck" | "demo";
export type PriceFact = "listing" | "sticker" | "unconfirmed";

export interface ListingCandidate {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  dealerName?: string;
  city?: string;
  state?: string;
  zip?: string;
  dealerUrl?: string | null;
  listingPrice: number | null;
  lat?: number;
  lng?: number;
  exteriorColor?: string;
}

export interface FordMatchCard {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  exteriorColor?: string;
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
  stickerStatus: FordSticker["status"];
}

export interface FordSearchDropped {
  vin: string;
  reason: "engine_prefix" | "unreleased" | "missing_must_have" | "sticker_error" | "outside_radius";
  missing?: string[];
  dealerName?: string;
  distanceMiles?: number | null;
}

export interface FordSearchResult {
  provider: ListingsProvider;
  note: string;
  needsLocation?: boolean;
  originZip?: string;
  radiusMiles?: number;
  candidatesConsidered: number;
  stickersFetched: number;
  matches: FordMatchCard[];
  dropped: FordSearchDropped[];
}

export function isUsableHuntLocation(zip?: string, radiusMiles?: number): boolean {
  const z = (zip || "").trim();
  return /^\d{5}$/.test(z) && typeof radiusMiles === "number" && Number.isFinite(radiusMiles) && radiusMiles > 0;
}

export const DEMO_COMPARABLE_LISTINGS: ListingCandidate[] = [
  {
    vin: "1FMWK8JC7TGB81309",
    year: 2026,
    make: "Ford",
    model: "Explorer",
    trim: "Tremor",
    dealerName: "Jim Shorkey Ford",
    city: "White Oak",
    state: "PA",
    zip: "15131",
    dealerUrl:
      "https://www.jimshorkey.com/new-Pittsburgh-2026-Ford-Explorer-Tremor+Ultimate+Package-1FMWK8JC7TGB81309",
    listingPrice: null,
    lat: 40.341,
    lng: -79.807,
    exteriorColor: "Star White",
  },
  {
    vin: "1FMWK8JC1TGB69561",
    year: 2026,
    make: "Ford",
    model: "Explorer",
    trim: "Tremor",
    dealerName: "Battlefield Ford",
    city: "Culpeper",
    state: "VA",
    zip: "22701",
    dealerUrl: null,
    listingPrice: null,
    lat: 38.473,
    lng: -77.996,
  },
  {
    vin: "1FMWK8JC7TGA20216",
    year: 2026,
    make: "Ford",
    model: "Explorer",
    trim: "Tremor",
    dealerName: "Mall of Georgia Ford",
    city: "Buford",
    state: "GA",
    zip: "30518",
    dealerUrl: null,
    listingPrice: null,
    lat: 34.121,
    lng: -84.004,
  },
  {
    vin: "1FMWK8JC2TGB72467",
    year: 2026,
    make: "Ford",
    model: "Explorer",
    trim: "Tremor",
    dealerName: "Lilliston Ford",
    city: "Vineland",
    state: "NJ",
    zip: "08360",
    dealerUrl: null,
    listingPrice: null,
    lat: 39.486,
    lng: -75.026,
  },
  {
    vin: "1FMWK8JC5TGA02149",
    year: 2026,
    make: "Ford",
    model: "Explorer",
    trim: "Tremor",
    dealerName: "Larson Ford",
    city: "Lakewood",
    state: "NJ",
    zip: "08701",
    dealerUrl: null,
    listingPrice: null,
    lat: 40.098,
    lng: -74.218,
  },
  {
    vin: "1FMUK8JH8TGB25138",
    year: 2026,
    make: "Ford",
    model: "Explorer",
    trim: "Tremor",
    dealerName: "All American Ford of Old Bridge",
    city: "Old Bridge",
    state: "NJ",
    zip: "08857",
    dealerUrl: null,
    listingPrice: null,
    lat: 40.414,
    lng: -74.365,
  },
];

export function formatListingPrice(amount: number | null | undefined): string {
  if (amount == null || amount <= 0) return "call dealer";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatStickerMsrp(amount: number | null | undefined): string {
  if (amount == null || amount <= 0) return "unconfirmed";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function asFinitePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/[$,]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function listingsProvider(): { provider: ListingsProvider; key: string | null } {
  const autoDev = process.env.AUTO_DEV_API_KEY?.trim();
  if (autoDev) return { provider: "auto.dev", key: autoDev };
  const marketcheck = process.env.MARKETCHECK_API_KEY?.trim();
  if (marketcheck) return { provider: "marketcheck", key: marketcheck };
  return { provider: "demo", key: null };
}

async function searchAutoDev(
  key: string,
  q: {
    year?: number;
    make: string;
    model?: string;
    trim?: string;
    zip: string;
    radiusMiles: number;
  }
): Promise<ListingCandidate[]> {
  const url = new URL("https://api.auto.dev/listings");
  url.searchParams.set("vehicle.make", q.make);
  if (q.model) url.searchParams.set("vehicle.model", q.model);
  if (q.year) url.searchParams.set("vehicle.year", String(q.year));
  if (q.trim) url.searchParams.set("vehicle.trim", q.trim);
  url.searchParams.set("zip", q.zip);
  url.searchParams.set("distance", String(q.radiusMiles));
  url.searchParams.set("retailListing.used", "false");
  url.searchParams.set("includeUnpriced", "true");
  url.searchParams.set("limit", "50");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Auto.dev listings HTTP ${res.status}`);
  }
  const json = await res.json();
  const rows: unknown[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const out: ListingCandidate[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const vehicle = (r.vehicle as Record<string, unknown>) || {};
    const retail = (r.retailListing as Record<string, unknown>) || {};
    const vin = String(r.vin || vehicle.vin || "").toUpperCase();
    if (vin.length !== 17) continue;
    const loc = Array.isArray(r.location) ? (r.location as number[]) : [];
    out.push({
      vin,
      year: typeof vehicle.year === "number" ? vehicle.year : undefined,
      make: typeof vehicle.make === "string" ? vehicle.make : q.make,
      model: typeof vehicle.model === "string" ? vehicle.model : q.model,
      trim: typeof vehicle.trim === "string" ? vehicle.trim : q.trim,
      dealerName: String(retail.dealer || retail.dealerName || r.dealerName || "Unknown dealer"),
      city: String(retail.city || r.city || ""),
      state: String(retail.state || r.state || ""),
      zip: retail.zip ? String(retail.zip) : undefined,
      dealerUrl: typeof retail.vdp === "string" ? retail.vdp : typeof retail.url === "string" ? retail.url : null,
      listingPrice: asFinitePrice(retail.price) ?? asFinitePrice(r.price),
      lng: typeof loc[0] === "number" ? loc[0] : undefined,
      lat: typeof loc[1] === "number" ? loc[1] : undefined,
      exteriorColor: typeof vehicle.color === "string" ? vehicle.color : undefined,
    });
  }
  return out;
}

async function searchMarketCheck(
  key: string,
  q: {
    year?: number;
    make: string;
    model?: string;
    trim?: string;
    zip: string;
    radiusMiles: number;
  }
): Promise<ListingCandidate[]> {
  const url = new URL("https://api.marketcheck.com/v2/search/car/active");
  url.searchParams.set("api_key", key);
  if (q.year) url.searchParams.set("year", String(q.year));
  url.searchParams.set("make", q.make);
  if (q.model) url.searchParams.set("model", q.model);
  if (q.trim) url.searchParams.set("trim", q.trim);
  url.searchParams.set("car_type", "new");
  url.searchParams.set("zip", q.zip);
  url.searchParams.set("radius", String(q.radiusMiles));
  url.searchParams.set("rows", "50");

  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`MarketCheck HTTP ${res.status}`);
  const json = await res.json();
  const rows: unknown[] = Array.isArray(json?.listings) ? json.listings : [];
  const out: ListingCandidate[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const dealer = (r.dealer as Record<string, unknown>) || {};
    const build = (r.build as Record<string, unknown>) || {};
    const vin = String(r.vin || "").toUpperCase();
    if (vin.length !== 17) continue;
    out.push({
      vin,
      year: typeof r.year === "number" ? r.year : typeof build.year === "number" ? build.year : undefined,
      make: String(r.make || build.make || q.make),
      model: String(r.model || build.model || q.model),
      trim: String(r.trim || build.trim || q.trim || ""),
      dealerName: String(dealer.name || "Unknown dealer"),
      city: String(dealer.city || ""),
      state: String(dealer.state || ""),
      zip: dealer.zip ? String(dealer.zip) : undefined,
      dealerUrl: typeof r.vdp_url === "string" ? r.vdp_url : null,
      listingPrice: asFinitePrice(r.price),
      lat: typeof dealer.latitude === "number" ? dealer.latitude : undefined,
      lng: typeof dealer.longitude === "number" ? dealer.longitude : undefined,
      exteriorColor: typeof r.exterior_color === "string" ? r.exterior_color : undefined,
    });
  }
  return out;
}

export async function searchCoarseListings(q: {
  year?: number;
  make: string;
  model?: string;
  trim?: string;
  zip: string;
  radiusMiles: number;
}): Promise<{ provider: ListingsProvider; listings: ListingCandidate[]; note: string }> {
  const { provider, key } = listingsProvider();
  if (provider === "auto.dev" && key) {
    try {
      const listings = await searchAutoDev(key, q);
      return {
        provider,
        listings,
        note: "Live listings from Auto.dev; factory options come only from the Ford window sticker.",
      };
    } catch (err) {
      console.error("Auto.dev listings failed, falling back to demo comparables:", err);
    }
  }
  if ((provider === "marketcheck" || provider === "auto.dev") && process.env.MARKETCHECK_API_KEY) {
    try {
      const listings = await searchMarketCheck(process.env.MARKETCHECK_API_KEY, q);
      return {
        provider: "marketcheck",
        listings,
        note: "Live listings from MarketCheck; factory options come only from the Ford window sticker.",
      };
    } catch (err) {
      console.error("MarketCheck listings failed, falling back to demo comparables:", err);
    }
  }
  return {
    provider: "demo",
    listings: demoListingsForModel(q.model),
    note: demoListingsNote(q.model),
  };
}

export function rankFordMatches(matches: FordMatchCard[]): FordMatchCard[] {
  return [...matches].sort((a, b) => {
    if (b.matchedNiceToHaves.length !== a.matchedNiceToHaves.length) {
      return b.matchedNiceToHaves.length - a.matchedNiceToHaves.length;
    }
    const aPrice = a.listingPrice && a.listingPrice > 0 ? a.listingPrice : Number.POSITIVE_INFINITY;
    const bPrice = b.listingPrice && b.listingPrice > 0 ? b.listingPrice : Number.POSITIVE_INFINITY;
    if (aPrice !== bPrice) return aPrice - bPrice;
    const aMsrp = a.msrp && a.msrp > 0 ? a.msrp : Number.POSITIVE_INFINITY;
    const bMsrp = b.msrp && b.msrp > 0 ? b.msrp : Number.POSITIVE_INFINITY;
    if (aMsrp !== bMsrp) return aMsrp - bMsrp;
    const aDist = a.distanceMiles ?? Number.POSITIVE_INFINITY;
    const bDist = b.distanceMiles ?? Number.POSITIVE_INFINITY;
    return aDist - bDist;
  });
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export async function findSimilarFordVehicles(opts: {
  subjectVin: string;
  subject?: FordSticker;
  mustHaveLines: string[];
  niceToHaveLines?: string[];
  zip?: string;
  radiusMiles?: number;
  listings?: ListingCandidate[];
  fetchSticker?: (vin: string) => Promise<FordSticker>;
}): Promise<FordSearchResult> {
  const zip = (opts.zip || "").trim();
  const radius = opts.radiusMiles;
  if (!isUsableHuntLocation(zip, radius)) {
    return {
      provider: "demo",
      note: "Enter a 5-digit ZIP and a search radius in miles to see two sticker-matched lots in range.",
      needsLocation: true,
      candidatesConsidered: 0,
      stickersFetched: 0,
      matches: [],
      dropped: [],
    };
  }
  const radiusMiles = radius as number;
  const subject = opts.subject || (await getFordSticker(opts.subjectVin));
  const fetchSticker = opts.fetchSticker || getFordSticker;
  const mustHaves = opts.mustHaveLines.filter(Boolean);
  const niceHaves = (opts.niceToHaveLines || []).filter((n) => !isStandardKeylessLine(n));

  let provider: ListingsProvider = "demo";
  let note = "";
  let listings = opts.listings;
  if (!listings) {
    const searched = await searchCoarseListings({
      year: subject.year && subject.year >= 1990 && subject.year <= 2035 ? subject.year : undefined,
      make: subject.make || "Ford",
      model: subject.model,
      trim: subject.trim,
      zip,
      radiusMiles,
    });
    provider = searched.provider;
    note = searched.note;
    listings = searched.listings;
  } else {
    provider = "demo";
    note = "Using provided candidate list.";
  }

  listings = (listings || []).filter((l) => listingMatchesSubjectModel(l, subject.model));
  if (listings.length === 0 && provider === "demo") {
    note = demoListingsNote(subject.model);
  }

  const dropped: FordSearchDropped[] = [];
  const prefixPassed: ListingCandidate[] = [];
  for (const listing of listings) {
    if (listing.vin.toUpperCase() === opts.subjectVin.toUpperCase()) continue;
    if (shouldExcludeByEnginePrefix(opts.subjectVin, listing.vin)) {
      dropped.push({
        vin: listing.vin,
        reason: "engine_prefix",
        dealerName: listing.dealerName,
      });
      continue;
    }
    prefixPassed.push(listing);
  }

  const capped = prefixPassed.slice(0, MAX_STICKER_CANDIDATES);
  const matches: FordMatchCard[] = [];

  await mapPool(capped, 4, async (listing) => {
    try {
      const sticker = await fetchSticker(listing.vin);
      if (sticker.status === "unreleased") {
        dropped.push({
          vin: listing.vin,
          reason: "unreleased",
          dealerName: listing.dealerName,
        });
        return;
      }
      if (sticker.status !== "released") {
        dropped.push({ vin: listing.vin, reason: "sticker_error", dealerName: listing.dealerName });
        return;
      }
      const check = confirmFordMustHavesFromSticker(sticker, mustHaves);
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
        make: sticker.make || listing.make || "Ford",
        model: sticker.model || listing.model,
        trim: sticker.trim || listing.trim,
        engine: sticker.engine,
        exteriorColor: sticker.exteriorColor || listing.exteriorColor,
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
        pdfUrl: fordStickerPdfUrl(listing.vin),
        matchedMustHaves: check.matched,
        matchedNiceToHaves: matchedNice,
        stickerStatus: sticker.status,
      });
    } catch {
      dropped.push({ vin: listing.vin, reason: "sticker_error", dealerName: listing.dealerName });
    }
  });

  const ranked = rankFordMatches(matches).slice(0, MAX_FORD_RECS);
  if (ranked.length === 0) {
    note = `No sticker-confirmed matches within ${radiusMiles} miles of ${zip}. Farther lots are not shown.${
      note ? ` ${note}` : ""
    }`;
  }

  return {
    provider,
    note,
    originZip: zip,
    radiusMiles,
    candidatesConsidered: listings.length,
    stickersFetched: capped.length,
    matches: ranked,
    dropped,
  };
}

export function fordMatchToVehicle(match: FordMatchCard): Vehicle {
  return {
    id: `ford-${match.vin}`,
    vin: match.vin,
    year: match.year || 0,
    make: match.make || "Ford",
    model: match.model || "",
    trim: match.trim || "",
    bodyType: "SUV",
    engine: match.engine || "",
    drivetrain: engineFamilyFromVin(match.vin) === "3.0" ? "4WD" : "",
    transmission: "",
    exteriorColor: match.exteriorColor || "",
    interiorColor: "",
    msrp: match.msrp || 0,
    dealerPrice: match.listingPrice || 0,
    daysOnLot: 0,
    status: "on_lot",
    condition: "new",
    location: {
      dealerName: match.dealerName,
      city: match.city,
      state: match.state,
      zip: match.zip,
      distanceMiles: match.distanceMiles || 0,
    },
    packages: [...match.matchedMustHaves, ...match.matchedNiceToHaves],
    options: match.matchedMustHaves.map((name) => ({
      code: name,
      name,
      price: 0,
      category: "package" as const,
    })),
    imageUrl: "",
    mileage: 0,
    dealerUrl: match.dealerUrl || undefined,
    oemBuildSheetUrl: match.pdfUrl,
  };
}

export function stickerToVehicle(sticker: FordSticker, listingUrl?: string | null): Vehicle {
  return {
    id: `ford-${sticker.vin}`,
    vin: sticker.vin,
    year: sticker.year || 0,
    make: sticker.make || "Ford",
    model: sticker.model || "",
    trim: sticker.trim || "",
    bodyType: "SUV",
    engine: sticker.engine || "",
    drivetrain: sticker.drivetrain || "",
    transmission: sticker.transmission || "",
    exteriorColor: sticker.exteriorColor || "",
    interiorColor: sticker.interiorColor || "",
    msrp: sticker.msrp || 0,
    dealerPrice: 0,
    daysOnLot: 0,
    status: "on_lot",
    condition: "new",
    location: {
      dealerName: sticker.dealerSoldTo?.name || "Ford dealer",
      city: sticker.dealerSoldTo?.city || "",
      state: sticker.dealerSoldTo?.state || "",
      zip: sticker.dealerSoldTo?.zip,
      distanceMiles: 0,
    },
    packages: sticker.options
      .filter((o) => !o.isStandard && !o.isPackageChild)
      .map((o) => o.name),
    options: sticker.options
      .filter((o) => !o.isStandard)
      .map((o) => ({
        code: o.name,
        name: o.name,
        price: o.price || 0,
        category: o.isPackageChild ? ("standalone" as const) : ("package" as const),
      })),
    imageUrl: "",
    mileage: 0,
    dealerUrl: listingUrl || undefined,
    oemBuildSheetUrl: sticker.pdfUrl,
  };
}
