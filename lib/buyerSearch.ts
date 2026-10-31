import { searchInventory, catalogOptions, InventoryApiError, type InventoryVehicle, type BuyerSearchQuery } from "./inventoryApi";
import type { ParsedBuyerSearch } from "./buyerSearchQuery";
import { haversineMiles, makeDealerLocator, roundMiles, zipLatLng } from "./dealerGeo";
import { isReachableState } from "./dealerContactLookup";
import { contactStateFor, loadContactIndex, type ContactIndex } from "./dealerContactIndex";
import type { ContactState } from "./dealerContactLookup";
import { contactOnFileDealerIds } from "./contactFilter";
import { parseSort, sortByDistance, type Sort } from "./buyerSort";
import { isRfqEligible } from "./lastConfirmed";
import { collapseByVin } from "./onePerVin";
import { BUYER_COUNT_CAP } from "./buyerSearchQuery";
import { normalizeColorFacets, rawsForColor, type ColorFacets } from "./colorFacets";

/** A price below this, or above PRICE_MAX_MSRP_MULTIPLE x the MSRP, is a data error (the $37 Teslas), not an offer. */
export const PRICE_FLOOR = 1000;
export const PRICE_MAX_MSRP_MULTIPLE = 5;

export function isSuspectPrice(price: number | null | undefined, msrp: number | null | undefined): boolean {
  if (price == null) return false;
  if (price < PRICE_FLOOR) return true;
  return msrp != null && msrp > 0 && price > msrp * PRICE_MAX_MSRP_MULTIPLE;
}

// Dealer phone numbers and addresses ride along in free text (option lists, colour fields). They never reach a buyer.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b|\b\d{10}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CALL_TO_ACTION_RE = /\b(?:please\s+)?(?:call|text|email|contact|ask for)\b/i;
const hasContactInfo = (t: string) => { PHONE_RE.lastIndex = 0; EMAIL_RE.lastIndex = 0; return PHONE_RE.test(t) || EMAIL_RE.test(t) || CALL_TO_ACTION_RE.test(t); };
/** Free text with any phone or email pattern removed. */
export function stripContactInfo(t: string): string {
  return t.replace(EMAIL_RE, "").replace(PHONE_RE, "").replace(/\s{2,}/g, " ").trim();
}
const scrub = (t: string | null | undefined): string | null => (t == null ? null : stripContactInfo(t) || null);

export type BuyerOption = { code: string | null; name: string | null; price: number | null; kind: "factory" };

/** Factory options only; a "dealer" add-on, or any entry whose text carries a phone, email or "please call ..." line, is dropped. */
function buyerOptions(options: InventoryVehicle["options"]): BuyerOption[] | null {
  if (!options) return null;
  return options
    .filter((o) => o.kind === "factory" && !hasContactInfo(`${o.name ?? ""} ${o.code ?? ""}`))
    .map((o) => ({ code: o.code, name: o.name, price: o.price, kind: "factory" as const }));
}

/**
 * What a buyer sees of a car. An explicit allow-list: a field the box adds later stays private until it is listed here. Left out on
 * purpose: crawl provenance (sourceBox, crawlFirstSeen, firstSeenAt, lastSeenAt), removedAt, daysOnLot, changeType, priceHistory.
 */
export type BuyerVehicle = Pick<InventoryVehicle,
  | "vehicleId" | "vin" | "dealerId" | "dealerName" | "dealerCity" | "dealerState" | "condition" | "year" | "make" | "model" | "trim" | "bodyStyle"
  | "exteriorColor" | "interiorColor" | "mileage" | "price" | "msrp" | "stockNumber" | "vdpUrl" | "imageUrl" | "source" | "windowStickerUrl"
  | "engine" | "transmission" | "oldPrice" | "priceDiff" | "priceChangeType" | "optionsTotal" | "baseMsrp"> & {
  options: BuyerOption[] | null;
  /** True when the listed price failed the sanity guard (under $1,000, or over 5x MSRP): price is then null and the UI should say "price not available". */
  priceSuspect: boolean;
  distanceMiles: number | null;
  /** Does this dealership have a contact (email) on file? null = unknown (directory unavailable / no dealer id). */
  dealerHasContact: boolean | null;
  /** The shared contact state behind dealerHasContact; "unverified" is shown as "Unverified email", never as on file. null = unknown. */
  dealerContactState: ContactState | null;
  /** False when the crawl last saw the car more than RFQ_MAX_AGE_DAYS ago: it cannot be picked for a quote. The date itself never reaches buyers. */
  rfqEligible: boolean;
};

export function toBuyerVehicle(v: InventoryVehicle, distanceMiles: number | null, contacts: ContactIndex | null): BuyerVehicle {
  const dealerContactState = contactStateFor(contacts, v);
  const suspect = isSuspectPrice(v.price, v.msrp);
  return {
    vehicleId: v.vehicleId ?? null, vin: v.vin, dealerId: v.dealerId ?? null, dealerName: scrub(v.dealerName) ?? "", dealerCity: v.dealerCity ?? null, dealerState: v.dealerState ?? null,
    condition: v.condition ?? null, year: v.year ?? null, make: v.make ?? null, model: v.model ?? null, trim: scrub(v.trim), bodyStyle: v.bodyStyle ?? null,
    exteriorColor: scrub(v.exteriorColor), interiorColor: scrub(v.interiorColor), mileage: v.mileage ?? null,
    price: suspect ? null : v.price ?? null, msrp: v.msrp ?? null, stockNumber: v.stockNumber ?? null, vdpUrl: v.vdpUrl ?? null, imageUrl: v.imageUrl ?? null,
    source: v.source ?? null, windowStickerUrl: v.windowStickerUrl ?? null, engine: scrub(v.engine), transmission: scrub(v.transmission),
    oldPrice: suspect ? null : v.oldPrice ?? null, priceDiff: suspect ? null : v.priceDiff ?? null, priceChangeType: suspect ? null : v.priceChangeType ?? null,
    options: buyerOptions(v.options), optionsTotal: v.optionsTotal ?? null, baseMsrp: v.baseMsrp ?? null,
    priceSuspect: suspect,
    distanceMiles, dealerHasContact: dealerContactState == null ? null : isReachableState(dealerContactState), dealerContactState, rfqEligible: isRfqEligible(v.lastSeenAt),
  };
}

export interface BuyerSearchResult {
  /** The one authoritative count: cars matching EVERY active filter (radius, colours, contact, price...). Exact unless totalCapped. */
  total: number;
  /** true = `total` is a floor ("1,000+"): more matched than the search is willing to count. */
  totalCapped: boolean;
  limit: number;
  offset: number;
  /** Offset for the next page, or null when this page reached the end. From the same query and count as `total`. */
  nextOffset: number | null;
  vehicles: BuyerVehicle[];
}

/** Rows per box call while a scan walks a whole result set (the route's own page ceiling), and how many calls run at once. */
const SCAN_PAGE = 100;
const SCAN_CONCURRENCY = 3;
const MAX_COLOR_VARIANTS = 12;

const nextOffsetOf = (from: number, shown: number, total: number): number | null => (shown > 0 && from + shown < total ? from + shown : null);

// Clean colour value -> raw values, per make/model/trim scope. The catalog call is the same one the filter panel makes.
const facetCache = new Map<string, { at: number; ext: ColorFacets; int: ColorFacets }>();
const FACET_TTL_MS = 5 * 60 * 1000;
async function colorFacetsFor(q: BuyerSearchQuery): Promise<{ ext: ColorFacets; int: ColorFacets } | null> {
  const key = [q.make, q.model, q.trim].join("|");
  const hit = facetCache.get(key);
  if (hit && Date.now() - hit.at < FACET_TTL_MS) return hit;
  try {
    const one = (x: string | string[] | undefined) => (Array.isArray(x) ? (x.length === 1 ? x[0] : undefined) : x);
    const cat = await catalogOptions({ make: one(q.make), model: one(q.model), trim: one(q.trim) });
    const entry = { at: Date.now(), ext: normalizeColorFacets(cat.exteriorColors ?? []), int: normalizeColorFacets(cat.interiorColors ?? []) };
    facetCache.set(key, entry);
    return entry;
  } catch {
    return null; // the colour is then sent as chosen; a clean value that is also a stored value still matches
  }
}
export function clearColorFacetCache() { facetCache.clear(); }

/** The box filters a colour by exact stored text, so a clean value that merges several stored values becomes one query per combination. */
async function colorVariants(query: BuyerSearchQuery): Promise<BuyerSearchQuery[]> {
  if (!query.exteriorColor && !query.interiorColor) return [query];
  const f = await colorFacetsFor(query);
  const ext = query.exteriorColor ? rawsForColor(f?.ext ?? null, query.exteriorColor) : [undefined];
  const int = query.interiorColor ? rawsForColor(f?.int ?? null, query.interiorColor) : [undefined];
  const out: BuyerSearchQuery[] = [];
  for (const e of ext) for (const i of int) out.push({ ...query, exteriorColor: e, interiorColor: i });
  return out.slice(0, MAX_COLOR_VARIANTS);
}

const SORT_FIELD: Partial<Record<Sort["key"], (v: InventoryVehicle) => string | number | null>> = {
  year: (v) => v.year, make: (v) => v.make?.toLowerCase() ?? null, model: (v) => v.model?.toLowerCase() ?? null, trim: (v) => v.trim?.toLowerCase() ?? null,
  ext: (v) => v.exteriorColor?.toLowerCase() ?? null, int: (v) => v.interiorColor?.toLowerCase() ?? null, mileage: (v) => v.mileage, price: (v) => v.price,
  dealer: (v) => v.dealerName?.toLowerCase() ?? null, state: (v) => v.dealerState, vin: (v) => v.vin, days: (v) => v.daysOnLot, vehicleid: (v) => v.vehicleId ?? null,
};
/** The box's ORDER BY for rows merged from several queries (blank values last, ties keep their order). */
function sortLikeBox<T extends InventoryVehicle>(rows: T[], sortStr: string | undefined): T[] {
  const sort = parseSort(sortStr);
  const field = sort && SORT_FIELD[sort.key];
  if (!sort || !field) return rows;
  const sign = sort.dir === "desc" ? -1 : 1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = field(a.r), y = field(b.r);
    if (x == null && y == null) return a.i - b.i;
    if (x == null) return 1;
    if (y == null) return -1;
    return x === y ? a.i - b.i : (x < y ? -1 : 1) * sign;
  }).map((e) => e.r);
}

/** The actual box call + distance post-processing behind GET /api/vehicles/search. */
export async function runBuyerSearch(parsed: ParsedBuyerSearch): Promise<BuyerSearchResult> {
  const { query, zip, radiusMiles, sortDistance, distanceDir, contactOnFile } = parsed;
  const contacts = await loadContactIndex();
  // No directory = no way to say who has a contact: refuse, never fall back to the unfiltered list under a checked box.
  if (contactOnFile && !contacts) throw new InventoryApiError("Dealer contacts are unavailable right now, so the contact filter cannot run.", 503);
  const fetchPage = (q: BuyerSearchQuery) => searchInventory(q, contactOnFile && contacts ? { dealerIds: contactOnFileDealerIds(contacts) } : undefined);

  // Real distances: the buyer's ZIP and the dealer's directory ZIP both come from the Census ZCTA table. A dealer we cannot place has
  // NO distance (null) — never a state centroid — and a radius never cuts it, because a made-up number would be the same for every such dealer.
  const buyerAt = zip ? zipLatLng(zip) : null;
  const locate = makeDealerLocator(contacts);
  const distanceTo = (v: InventoryVehicle): number | null => {
    if (!buyerAt) return null;
    const at = locate(v);
    return at ? roundMiles(haversineMiles(buyerAt, at)) : null;
  };
  // The one radius rule. The count and the list both come from the rows it keeps, so they cannot disagree.
  const useRadius = Boolean(zip && radiusMiles !== undefined && buyerAt);
  const insideRadius = (v: { distanceMiles: number | null }) => v.distanceMiles === null || v.distanceMiles <= (radiusMiles as number);

  const variants = await colorVariants(query);
  const limit = query.limit ?? 50, from = query.offset ?? 0;

  // The box has no dealer lat/lng, so a radius (and a colour that merges several stored values) is applied here over the WHOLE box result
  // set (the box's own count cap bounds it): count, page and "load more" then all come from one filtered set.
  if (useRadius || variants.length > 1) {
    const all: InventoryVehicle[] = [];
    let truncated = false;
    for (const variant of variants) {
      const first = await fetchPage({ ...variant, limit: SCAN_PAGE, offset: 0 });
      const rows = [...first.vehicles];
      const reachable = Math.min(first.total, BUYER_COUNT_CAP);
      const offsets: number[] = [];
      for (let o = SCAN_PAGE; o < reachable; o += SCAN_PAGE) offsets.push(o);
      for (let i = 0; i < offsets.length; i += SCAN_CONCURRENCY) {
        const pages = await Promise.all(offsets.slice(i, i + SCAN_CONCURRENCY).map((o) => fetchPage({ ...variant, limit: SCAN_PAGE, offset: o })));
        for (const p of pages) rows.push(...p.vehicles);
      }
      // Rows past the cap were never read: the count is then a floor, shown as "N+".
      if (first.totalCapped || rows.length < first.total) truncated = true;
      all.push(...rows);
    }
    const merged = variants.length > 1 && !sortDistance ? sortLikeBox(all, query.sort) : all;
    let near = collapseByVin(merged, zip ? distanceTo : null).rows.map((v) => toBuyerVehicle(v, distanceTo(v), contacts));
    if (useRadius) near = near.filter(insideRadius);
    const ordered = sortDistance ? sortByDistance(near, distanceDir) : near;
    const page = ordered.slice(from, from + limit);
    return { total: near.length, totalCapped: truncated, limit, offset: from, nextOffset: nextOffsetOf(from, page.length, near.length), vehicles: page };
  }

  const result = await fetchPage(variants[0]);
  // One listing per VIN. A patched box already did it (rows, total, facets); this breaks the ties it leaves for a known location, and
  // collapses the page itself for a box that has not been patched yet (its total is then lowered by what this page dropped).
  const collapsed = collapseByVin(result.vehicles, zip ? distanceTo : null);
  const total = Math.max(result.total - collapsed.dropped, collapsed.rows.length + result.offset);
  let vehicles: BuyerVehicle[] = collapsed.rows.map((v) => toBuyerVehicle(v, distanceTo(v), contacts));
  if (zip && sortDistance) {
    vehicles = sortByDistance(vehicles, distanceDir);
  }
  const capped = Boolean(result.totalCapped);
  // A capped total is a floor: a full page may still have more behind it.
  const nextOffset = result.vehicles.length > 0 && (result.offset + result.vehicles.length < total || (capped && result.vehicles.length >= result.limit)) ? result.offset + result.vehicles.length : null;
  return { total, totalCapped: capped, limit: result.limit, offset: result.offset, nextOffset, vehicles };
}
