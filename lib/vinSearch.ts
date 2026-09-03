/**
 * Coarse similar-car search + Ford-sticker must-have filter.
 *
 * Listings API (MarketCheck) can filter year/make/model/zip/radius. This
 * hunt does not send a trim filter —
 * they cannot filter Ultimate / BlueCruise / keypad anyway. We take the
 * first 25–50 candidate VINs, fetch each Ford sticker, and DROP any VIN
 * missing a must-have option line.
 *
 * Without a listings API key, demo comparables use bundled sticker fixtures
 * for the known Explorer Tremor example VINs (no live PDF round-trip, so the
 * hunt cannot hang). Other models get an empty result plus an Explorer-only note.
 * If a listings key is configured, never fall back to that demo pool — return
 * the live provider with empty listings and a generic shopper-facing note.
 * Provider name, HTTP status, and raw provider messages stay in server logs.
 */

import fs from "node:fs";
import path from "node:path";
import { calculateDistanceMiles } from "./otdCalculator";
import {
  confirmFordMustHavesFromSticker,
  engineFamilyFromVin,
  extractVinFromDealerPage,
  factoryOptionBreakout,
  factoryOptionCode,
  fordStickerPdfUrl,
  getFordSticker,
  isStandardKeylessLine,
  parseFordStickerText,
  shouldExcludeByEnginePrefix,
  stickerHasMustHave,
  type FordFactoryOptionLine,
  type FordSticker,
} from "./fordSticker";
import {
  FORD_LISTINGS_LOAD_FAILED,
  FORD_LISTINGS_RADIUS_CAP,
  FORD_LISTINGS_RATE_LIMIT,
  listingDealerId,
  selectCompetitionSlots,
} from "./fordCompetitionUi";
import {
  hasListingsApiKey,
  resolveListingsProvider,
  type ListingsProvider,
} from "./listingsProvider";
import type { CurrentDealerLookup } from "./listingSheet";
import type { Vehicle } from "./types";

export {
  dealerIdentity,
  listingDealerId,
  sameRooftop,
  selectCompetitionSlots,
} from "./fordCompetitionUi";
export type { CompetitionLotIdentity } from "./fordCompetitionUi";
export { hasListingsApiKey, resolveListingsProvider };
export type { ListingsProvider };

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

export function demoListingsNote(model?: string): string {
  const matched = demoListingsForModel(model);
  if (matched.length === 0) {
    return `Demo listings are Explorer Tremor only and do not apply to ${
      model || "this vehicle"
    }. Other lots were not added.`;
  }
  return "No listings API key configured. Demo comparables use known Explorer Tremor VINs plus factory build data.";
}

export function composeEmptyHuntNote<D extends { reason: string }>(opts: {
  zip: string;
  radiusMiles: number;
  provider: ListingsProvider;
  existingNote: string;
  dropped: D[];
  subjectModel?: string;
  candidateCount: number;
  /** Defaults to the Ford Explorer-demo note; GM's hunt passes its own. */
  demoNoteForModel?: (model?: string) => string;
}): string {
  if (opts.provider === "demo" && opts.candidateCount === 0) {
    return (opts.demoNoteForModel || demoListingsNote)(opts.subjectModel);
  }
  const outside = opts.dropped.filter((d) => d.reason === "outside_radius").length;
  const missing = opts.dropped.filter((d) => d.reason === "missing_must_have").length;
  const parts = [
    `No matching lots within ${opts.radiusMiles} miles of ${opts.zip}. Farther lots are not shown.`,
  ];
  if (outside > 0) {
    parts.push(
      `${outside} matching lot${outside === 1 ? " was" : "s were"} outside your radius.`
    );
  }
  if (missing > 0) {
    parts.push(
      `${missing} lot${missing === 1 ? " was" : "s were"} dropped because a must-have was missing from the factory build.`
    );
  }
  if (opts.existingNote) parts.push(opts.existingNote);
  return parts.join(" ");
}

export type PriceFact = "listing" | "sticker" | "unconfirmed";

export interface ListingCandidate {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  /** MarketCheck dealer.id (or equivalent) when the listings provider supplies one. */
  dealerId?: string;
  dealerName?: string;
  city?: string;
  state?: string;
  zip?: string;
  dealerUrl?: string | null;
  listingPrice: number | null;
  lat?: number;
  lng?: number;
  exteriorColor?: string;
  /** Days the listing has been active, straight off the search row — no extra call. */
  daysOnMarket?: number | null;
  /**
   * Signed dollar delta from the listing provider's own "has this price
   * moved" field on the same search row (negative = a cut). This is a free
   * proxy for motivation, not a true count of how many times the price has
   * changed — that requires a separate per-VIN history call and is only
   * worth spending on a vehicle the buyer has actually chosen to look at
   * (see enrichMatchListingPrices's sibling in the compare-page flow).
   */
  priceChangeHint?: number | null;
}

export interface FordMatchCard {
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
  stickerStatus: FordSticker["status"];
  /** Full optional-equipment list from this VIN's Ford sticker. Never invented. */
  factoryOptions: FordFactoryOptionLine[];
  factoryOptionsStatus: "ok" | "unavailable";
  /** Days the listing has been active, straight off the search row — no extra call. */
  daysOnMarket: number | null;
  /** Free proxy for motivation from the same search row; not a true price-change count. */
  priceChangeHint: number | null;
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
  /** True when the listings provider failed; shopper `note` is generic. */
  listingsError?: boolean;
  needsLocation?: boolean;
  originZip?: string;
  radiusMiles?: number;
  candidatesConsidered: number;
  stickersFetched: number;
  matches: FordMatchCard[];
  dropped: FordSearchDropped[];
  /** True iff MARKETCHECK_API_KEY is non-empty after trim. Boolean only. */
  hasListingsKey: boolean;
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
    listingPrice: 58372,
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

function demoFixturePaths(vin: string): string[] {
  const file = `${vin.trim().toUpperCase()}.txt`;
  const paths = [path.join(process.cwd(), "lib/testdata/ford-stickers", file)];
  try {
    paths.unshift(path.join(import.meta.dirname, "testdata/ford-stickers", file));
  } catch {
    // import.meta.dirname is unavailable in some bundles
  }
  return paths;
}

/** Bundled Explorer demo stickers — no live Ford Direct round-trip. */
export function stickerFromDemoFixture(vin: string): FordSticker | null {
  for (const filePath of demoFixturePaths(vin)) {
    try {
      if (!fs.existsSync(filePath)) continue;
      return parseFordStickerText(vin, fs.readFileSync(filePath, "utf8"));
    } catch {
      // try next path
    }
  }
  return null;
}

async function fetchStickerPreferDemoFixture(vin: string): Promise<FordSticker> {
  const local = stickerFromDemoFixture(vin);
  if (local) return local;
  return getFordSticker(vin);
}

export function formatListingPrice(amount: number | null | undefined): string {
  if (amount == null || amount <= 0) return "unconfirmed";
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

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseFloat(value.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asNonNegativeInt(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null || n < 0) return null;
  return Math.round(n);
}

/** MarketCheck dealer.latitude / longitude are documented as strings. */
function asFiniteCoord(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function huntResult(partial: Omit<FordSearchResult, "hasListingsKey">): FordSearchResult {
  return { ...partial, hasListingsKey: hasListingsApiKey() };
}

function parseRetryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

function sanitizeListingsNote(raw: string): string {
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key[=:]\s*\S+/gi, "api_key=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull MarketCheck `{ code, message }` / `{ message }` out of an error body — logs only. */
function providerMessageFromBody(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        return sanitizeListingsNote(value).slice(0, 160);
      }
    }
  } catch {
    if (trimmed.startsWith("<")) return null;
    return sanitizeListingsNote(trimmed).slice(0, 160);
  }
  return null;
}

function shopperNoteForListingsHttp(status: number, providerMessage: string | null): string {
  if (status === 429) return FORD_LISTINGS_RATE_LIMIT;
  if (status === 422) return FORD_LISTINGS_RADIUS_CAP;
  if ((status === 400 || status === 403) && providerMessage && /radius/i.test(providerMessage)) {
    return FORD_LISTINGS_RADIUS_CAP;
  }
  return FORD_LISTINGS_LOAD_FAILED;
}

class ListingsProviderError extends Error {
  shopperNote: string;
  constructor(logDetail: string, shopperNote: string) {
    super(logDetail);
    this.name = "ListingsProviderError";
    this.shopperNote = shopperNote;
  }
}

async function listingsHttpFailure(label: string, res: Response): Promise<ListingsProviderError> {
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    bodyText = "";
  }
  const providerMessage = providerMessageFromBody(bodyText);
  let logDetail = `${label} listings HTTP ${res.status}`;
  if (providerMessage) logDetail += `: ${providerMessage}`;
  if (res.status === 429) {
    const seconds = parseRetryAfterSeconds(res.headers.get("Retry-After"));
    if (seconds != null) logDetail += `. Rate limited; retry after ${seconds} seconds.`;
    else logDetail += ". Rate limited; try again later.";
  }
  return new ListingsProviderError(
    sanitizeListingsNote(logDetail),
    shopperNoteForListingsHttp(res.status, providerMessage)
  );
}

function shopperNoteFromListingsError(err: unknown): string {
  if (err instanceof ListingsProviderError) return err.shopperNote;
  return FORD_LISTINGS_LOAD_FAILED;
}

function listingsErrorLogDetail(err: unknown, label: string): string {
  const raw = err instanceof Error ? err.message : "unknown error";
  return sanitizeListingsNote(raw).slice(0, 220) || `${label} listings failed`;
}

/**
 * One GET /v2/search/car/active per hunt.
 * Do not persist this response — MarketCheck developer ToS (v2) forbids
 * caching listings beyond what is needed to serve a single end-user request.
 * Transient in-memory data for this request is fine. Ford sticker PDFs are
 * fetched from Ford Direct and may still be cached.
 */
async function searchMarketCheck(
  key: string,
  q: {
    year?: number;
    make: string;
    model?: string;
    zip: string;
    radiusMiles: number;
  }
): Promise<ListingCandidate[]> {
  const url = new URL("https://api.marketcheck.com/v2/search/car/active");
  url.searchParams.set("api_key", key);
  url.searchParams.set("append_api_key", "false");
  if (q.year) url.searchParams.set("year", String(q.year));
  url.searchParams.set("make", q.make);
  if (q.model) url.searchParams.set("model", q.model);
  // Coarse hunt: no trim. Ford sticker matching is downstream.
  url.searchParams.set("car_type", "new");
  url.searchParams.set("zip", q.zip);
  // Pass the user radius as-is. Do not clamp to the free-tier 100-mile cap —
  // log MarketCheck's rejection (HTTP + message) and return a generic shopper note.
  url.searchParams.set("radius", String(q.radiusMiles));
  url.searchParams.set("rows", "50");

  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) {
    throw await listingsHttpFailure("MarketCheck", res);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ListingsProviderError("MarketCheck listings parse error", FORD_LISTINGS_LOAD_FAILED);
  }
  const rows: unknown[] =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { listings?: unknown }).listings)
      ? ((payload as { listings: unknown[] }).listings)
      : [];
  const out: ListingCandidate[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const dealer =
      r.dealer && typeof r.dealer === "object" ? (r.dealer as Record<string, unknown>) : {};
    const build =
      r.build && typeof r.build === "object" ? (r.build as Record<string, unknown>) : {};
    const vin = String(r.vin || "").toUpperCase();
    if (vin.length !== 17) continue;
    const year =
      typeof build.year === "number"
        ? build.year
        : typeof r.year === "number"
          ? r.year
          : undefined;
    out.push({
      vin,
      year,
      make: String(build.make || r.make || q.make),
      model: String(build.model || r.model || q.model || ""),
      trim: String(build.trim || r.trim || ""),
      dealerId: listingDealerId(dealer.id, dealer.dealer_id, r.dealer_id, r.dealerId),
      dealerName: String(dealer.name || "Unknown dealer"),
      city: String(dealer.city || ""),
      state: String(dealer.state || ""),
      zip: dealer.zip ? String(dealer.zip) : undefined,
      dealerUrl: typeof r.vdp_url === "string" ? r.vdp_url : null,
      listingPrice: asFinitePrice(r.price),
      lat: asFiniteCoord(dealer.latitude),
      lng: asFiniteCoord(dealer.longitude),
      exteriorColor: typeof r.exterior_color === "string" ? r.exterior_color : undefined,
      daysOnMarket: asNonNegativeInt(r.dom),
      priceChangeHint: asFiniteNumber(r.price_change),
    });
  }
  return out;
}

export async function searchCoarseListings(
  q: {
    year?: number;
    make: string;
    model?: string;
    trim?: string;
    zip: string;
    radiusMiles: number;
  },
  /** Defaults to the Ford Explorer demo pool; GM's hunt passes its own. */
  demo?: {
    listingsForModel: (model?: string) => ListingCandidate[];
    noteForModel: (model?: string) => string;
  }
): Promise<{
  provider: ListingsProvider;
  listings: ListingCandidate[];
  note: string;
  listingsError?: boolean;
}> {
  const { provider, key } = resolveListingsProvider();
  if (provider === "marketcheck" && key) {
    try {
      const listings = await searchMarketCheck(key, q);
      return {
        provider: "marketcheck",
        listings,
        note: "Factory options come only from the factory build.",
      };
    } catch (err) {
      const logDetail = listingsErrorLogDetail(err, "MarketCheck");
      console.error("MarketCheck listings failed:", logDetail);
      return {
        provider: "marketcheck",
        listings: [],
        note: shopperNoteFromListingsError(err),
        listingsError: true,
      };
    }
  }
  const listingsForModel = demo?.listingsForModel || demoListingsForModel;
  const noteForModel = demo?.noteForModel || demoListingsNote;
  return {
    provider: "demo",
    listings: listingsForModel(q.model),
    note: noteForModel(q.model),
  };
}

/**
 * Ranks by free "dealer motivation" signals already on the search row — most
 * days on market first, then a real price cut (a deeper cut ahead of a
 * shallower one — the closest free proxy for "changes price often" this data
 * supports; a positive move is never treated as a cut), then how close a
 * listing sits just under the subject's own listing price (a sort boost,
 * never a filter — an at/above-price or unpriced listing just falls back to
 * the remaining tiebreakers instead of being dropped), then distance. No
 * history call is made to produce this order. Generic over any match-card
 * shape (Ford, GM, or Stellantis) carrying these fields — the name is
 * historical.
 */
export function rankFordMatches<
  T extends {
    priceChangeHint?: number | null;
    daysOnMarket?: number | null;
    distanceMiles: number | null;
    listingPrice?: number | null;
    vin: string;
  }
>(matches: T[], subjectListingPrice?: number | null): T[] {
  const subjectPrice =
    typeof subjectListingPrice === "number" && subjectListingPrice > 0 ? subjectListingPrice : null;

  // [0, gap] when confirmed under the subject's price (smaller gap — closer
  // to, but still under, the subject's price — sorts first); [1, 0] for
  // everything else (unknown price, or at/above the subject's price).
  function priceBandRank(price: number | null | undefined): [number, number] {
    if (!subjectPrice || typeof price !== "number" || price <= 0 || price >= subjectPrice) {
      return [1, 0];
    }
    return [0, subjectPrice - price];
  }

  return [...matches].sort((a, b) => {
    const aDom = a.daysOnMarket ?? -1;
    const bDom = b.daysOnMarket ?? -1;
    if (aDom !== bDom) return bDom - aDom;

    const aCut = typeof a.priceChangeHint === "number" && a.priceChangeHint < 0;
    const bCut = typeof b.priceChangeHint === "number" && b.priceChangeHint < 0;
    if (aCut !== bCut) return aCut ? -1 : 1;
    if (aCut && bCut) {
      const depthDiff = (a.priceChangeHint as number) - (b.priceChangeHint as number);
      if (depthDiff !== 0) return depthDiff; // more negative (deeper cut) sorts first
    }

    const [aBand, aGap] = priceBandRank(a.listingPrice);
    const [bBand, bGap] = priceBandRank(b.listingPrice);
    if (aBand !== bBand) return aBand - bBand;
    if (aBand === 0 && aGap !== bGap) return aGap - bGap;

    const aDist = a.distanceMiles ?? Number.POSITIVE_INFINITY;
    const bDist = b.distanceMiles ?? Number.POSITIVE_INFINITY;
    if (aDist !== bDist) return aDist - bDist;
    return a.vin.localeCompare(b.vin);
  });
}

function asPositivePrice(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Comp price: listings API if present; else that lot's VDP sale price; else
 * leave null so the UI shows the factory sticker's total price. Never "call
 * dealer". Only the ranked slots are fetched — not the full candidate list.
 * Generic over any match-card shape (Ford or GM) — the name is historical.
 */
export async function enrichMatchListingPrices<
  T extends { listingPrice: number | null; listingPriceSource: PriceFact; dealerUrl: string | null }
>(matches: T[], fetchVdpPrice?: (url: string) => Promise<number | null>): Promise<T[]> {
  return Promise.all(
    matches.map(async (match) => {
      const fromApi = asPositivePrice(match.listingPrice);
      if (fromApi) {
        return { ...match, listingPrice: fromApi, listingPriceSource: "listing" as const };
      }
      const url = match.dealerUrl;
      if (!url || !/^https?:\/\//i.test(url)) {
        return { ...match, listingPrice: null, listingPriceSource: "unconfirmed" as const };
      }
      try {
        const scraped = fetchVdpPrice
          ? await fetchVdpPrice(url)
          : ((await extractVinFromDealerPage(url)).listingPrice ?? null);
        const fromVdp = asPositivePrice(scraped);
        if (fromVdp) {
          return { ...match, listingPrice: fromVdp, listingPriceSource: "listing" as const };
        }
      } catch {
        // 403 / timeout — sticker MSRP remains the display fallback
      }
      return { ...match, listingPrice: null, listingPriceSource: "unconfirmed" as const };
    })
  );
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
  /** Optional VDP price fetch for tests; production uses extractVinFromDealerPage. */
  fetchVdpPrice?: (url: string) => Promise<number | null>;
  /** The favorite vehicle's own listing price, if known — ranks a comparable that sits just under it ahead of one that doesn't. A boost, never a filter. */
  subjectListingPrice?: number | null;
}): Promise<FordSearchResult> {
  const zip = (opts.zip || "").trim();
  const radius = opts.radiusMiles;
  if (!isUsableHuntLocation(zip, radius)) {
    return huntResult({
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
  const subject = opts.subject || (await getFordSticker(opts.subjectVin));
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
      zip,
      radiusMiles,
    });
    provider = searched.provider;
    note = searched.note;
    listings = searched.listings;
    if (searched.listingsError) {
      return huntResult({
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

  listings = (listings || []).filter((l) => listingMatchesSubjectModel(l, subject.model));
  if (listings.length === 0 && provider === "demo") {
    // Do not score Explorer demo VINs for a Bronco Sport (or any other model).
    return huntResult({
      provider: "demo",
      note: demoListingsNote(subject.model),
      originZip: zip,
      radiusMiles,
      candidatesConsidered: 0,
      stickersFetched: 0,
      matches: [],
      dropped: [],
    });
  }

  const fetchSticker =
    opts.fetchSticker || (provider === "demo" ? fetchStickerPreferDemoFixture : getFordSticker);

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
      const factoryOptions = factoryOptionBreakout(sticker);
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
        pdfUrl: fordStickerPdfUrl(listing.vin),
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
    });
  }

  return huntResult({
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
    packages: match.factoryOptions
      .filter((o) => !o.isPackageChild)
      .map((o) => o.description),
    options: match.factoryOptions.map((o) => ({
      code: o.code || "",
      name: o.description,
      price: o.price || 0,
      category: o.isPackageChild ? ("standalone" as const) : ("package" as const),
    })),
    imageUrl: "",
    mileage: 0,
    dealerUrl: match.dealerUrl || undefined,
    oemBuildSheetUrl: match.pdfUrl,
  };
}

export function stickerToVehicle(
  sticker: FordSticker,
  listingUrl?: string | null,
  listingPrice?: number | null,
  currentDealer?: CurrentDealerLookup | null
): Vehicle {
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
    dealerPrice: listingPrice && listingPrice > 0 ? listingPrice : 0,
    daysOnLot: 0,
    status: "on_lot",
    condition: "new",
    location: currentDealer
      ? {
          dealerName: currentDealer.dealerName,
          city: currentDealer.dealerCity,
          state: currentDealer.dealerState,
          zip: currentDealer.dealerZip || undefined,
          distanceMiles: 0,
          dealerConfirmed: true,
        }
      : {
          dealerName: sticker.dealerSoldTo?.name || "Ford dealer",
          city: sticker.dealerSoldTo?.city || "",
          state: sticker.dealerSoldTo?.state || "",
          zip: sticker.dealerSoldTo?.zip,
          distanceMiles: 0,
          dealerConfirmed: false,
        },
    packages: sticker.options
      .filter((o) => !o.isStandard && !o.isPackageChild)
      .map((o) => o.name),
    options: sticker.options
      .filter((o) => !o.isStandard)
      .map((o) => ({
        code: factoryOptionCode(o.name) || "",
        name: o.name,
        price: o.price || 0,
        category: o.isPackageChild ? ("standalone" as const) : ("package" as const),
      })),
    imageUrl: "",
    mileage: 0,
    dealerUrl: listingUrl || currentDealer?.vdpUrl || undefined,
    oemBuildSheetUrl: sticker.pdfUrl,
  };
}
