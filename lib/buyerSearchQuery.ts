import type { BuyerSearchQuery } from "./inventoryApi";
import type { ParsedSearchFilters } from "./searchParse";

export class BuyerSearchParamsError extends Error {}

export interface ParsedBuyerSearch {
  query: BuyerSearchQuery;
  zip?: string;
  radiusMiles?: number;
  sortDistance: boolean;
}

const MAX_LIMIT = 100;

/**
 * Pure param parsing + validation for GET /api/vehicles/search, pulled out of the route so the
 * "radiusMiles requires make" guardrail and the sort=distance handling (both easy to silently
 * regress) have real test coverage without spinning up a Next.js request.
 */
export function parseBuyerSearchParams(sp: URLSearchParams): ParsedBuyerSearch {
  const zip = sp.get("zip") || undefined;
  const radiusMiles = sp.get("radiusMiles") ? Number(sp.get("radiusMiles")) : undefined;
  const make = sp.get("make") || undefined;

  // A radius search with no make is an unbounded scan of every in-stock vehicle nationwide just
  // to compute distance on each one — make= is what keeps this a bounded, indexed query (see
  // inventoryListQuery.js's make= index hint). Required rather than silently ignoring radius.
  if (zip && radiusMiles !== undefined && !make) {
    throw new BuyerSearchParamsError("radiusMiles requires make to also be set.");
  }

  const optionCodes = (sp.get("optionCodes") || "").split(",").map((c) => c.trim()).filter(Boolean);
  const sortDistance = sp.get("sort") === "distance";
  const query: BuyerSearchQuery = {
    state: sp.get("state") || undefined,
    make,
    model: sp.get("model") || undefined,
    trim: sp.get("trim") || undefined,
    cond: sp.get("cond") || undefined,
    q: sp.get("q") || undefined,
    priceMin: sp.get("priceMin") ? Number(sp.get("priceMin")) : undefined,
    priceMax: sp.get("priceMax") ? Number(sp.get("priceMax")) : undefined,
    minDays: sp.get("minDays") ? Number(sp.get("minDays")) : undefined,
    maxDays: sp.get("maxDays") ? Number(sp.get("maxDays")) : undefined,
    odometerMax: sp.get("odometerMax") ? Number(sp.get("odometerMax")) : undefined,
    minPriceChanges: sp.get("minPriceChanges") ? Number(sp.get("minPriceChanges")) : undefined,
    exteriorColor: sp.get("exteriorColor") || undefined,
    interiorColor: sp.get("interiorColor") || undefined,
    optionCodes: optionCodes.length ? optionCodes : undefined,
    possibleDemo: sp.get("possibleDemo") === "1",
    // "distance" isn't a box-side sort key (inventoryListQuery.js falls back to dealer:asc for
    // an unknown key) — distance sort happens in-memory on the fetched page, in the route.
    sort: sortDistance ? undefined : sp.get("sort") || undefined,
    limit: Math.min(Number(sp.get("limit")) || 50, MAX_LIMIT),
    offset: Number(sp.get("offset")) || 0,
  };
  return { query, zip, radiusMiles, sortDistance };
}

/**
 * Converts Gemini's parsed filters (lib/searchParse.ts) into the same URLSearchParams shape
 * parseBuyerSearchParams() expects, so /api/search/parse runs the identical deterministic search
 * /api/vehicles/search does. Unlike that route, an NL search never fails on the "radiusMiles
 * requires make" guardrail — dropping the radius and saying so via `clarifications` is a much
 * better shopper experience than a 502 over an internal query-cost rule the shopper never asked
 * about; pushes the dropped clarification into the `clarifications` array passed in.
 */
export function parsedSearchFiltersToParams(filters: ParsedSearchFilters, clarifications: string[]): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.make) sp.set("make", filters.make);
  if (filters.model) sp.set("model", filters.model);
  if (filters.trim) sp.set("trim", filters.trim);
  if (filters.priceMin != null) sp.set("priceMin", String(filters.priceMin));
  if (filters.priceMax != null) sp.set("priceMax", String(filters.priceMax));
  if (filters.odometerMax != null) sp.set("odometerMax", String(filters.odometerMax));
  if (filters.minDays != null) sp.set("minDays", String(filters.minDays));
  if (filters.maxDays != null) sp.set("maxDays", String(filters.maxDays));
  if (filters.exteriorColor) sp.set("exteriorColor", filters.exteriorColor);
  if (filters.interiorColor) sp.set("interiorColor", filters.interiorColor);
  if (filters.optionCodes?.length) sp.set("optionCodes", filters.optionCodes.join(","));
  if (filters.possibleDemo) sp.set("possibleDemo", "1");
  if (filters.zip) sp.set("zip", filters.zip);
  if (filters.radiusMiles != null) {
    if (filters.make) sp.set("radiusMiles", String(filters.radiusMiles));
    else clarifications.push("Add a make to search within a specific distance — showing results without a distance limit for now.");
  }
  return sp;
}
