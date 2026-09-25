import type { BuyerSearchQuery } from "./inventoryApi";

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
