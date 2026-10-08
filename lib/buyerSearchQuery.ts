import type { BuyerSearchQuery } from "./inventoryApi";
import { formatSort, parseSort, type SortDir } from "./buyerSort";

export class BuyerSearchParamsError extends Error {}

export interface ParsedBuyerSearch {
  query: BuyerSearchQuery;
  zip?: string;
  radiusMiles?: number;
  sortDistance: boolean;
  /** Direction of the in-memory distance sort (distance has no database column). */
  distanceDir: SortDir;
}

const MAX_LIMIT = 100;
const MAX_OPTION_KEYS = 8;
/** Buyer searches never pay for an exact COUNT(*) past this — the UI shows "1,000+ vehicles". */
export const BUYER_COUNT_CAP = 1000;

/**
 * Pure param parsing + validation for GET /api/vehicles/search, pulled out of the route so the
 * query gates (make required; optionKeys need a model) and the sort=distance handling (both easy to silently
 * regress) have real test coverage without spinning up a Next.js request.
 */
export function parseBuyerSearchParams(sp: URLSearchParams): ParsedBuyerSearch {
  const zip = sp.get("zip") || undefined;
  const radiusMiles = sp.get("radiusMiles") ? Number(sp.get("radiusMiles")) : undefined;
  const make = sp.get("make") || undefined;

  // Query gates: a search with no make is an unbounded scan of every in-stock vehicle nationwide.
  // Measured live (2026-09-30): bare searches 503 at the 20s max_statement_time, and four of them
  // at once left three timeouts — the box can't afford even one. make= is what keeps this a
  // bounded, indexed query (see inventoryListQuery.js's make= index hints), so it is required
  // outright rather than silently ignoring a missing one or raising a timeout to paper over it.
  // (This also subsumes the old "radiusMiles requires make" rule.)
  if (!make && zip && radiusMiles !== undefined) {
    throw new BuyerSearchParamsError("radiusMiles requires make to also be set.");
  }
  if (!make) {
    throw new BuyerSearchParamsError("Pick a make to search — searching all of inventory at once is too slow. Add a model to narrow it further.");
  }
  // The option JOIN's derived table scans every vehicle nationally that has the option, whatever
  // the outer make= filter says — only a model keeps that bounded to something a shopper means.
  const optionKeys = (sp.get("optionKeys") || "").split(",").map((c) => c.trim()).filter(Boolean);
  if (optionKeys.length && !sp.get("model")) {
    throw new BuyerSearchParamsError("Pick a model before filtering by factory options.");
  }
  if (optionKeys.length > MAX_OPTION_KEYS) {
    throw new BuyerSearchParamsError(`Pick at most ${MAX_OPTION_KEYS} factory options at a time.`);
  }

  // sort= is whitelisted (an unknown or malformed value is ignored, never forwarded). Distance has no database column: it sorts
  // in memory in runBuyerSearch, so the box gets no sort for it.
  const sortSpec = parseSort(sp.get("sort"));
  const sortDistance = sortSpec?.key === "distance";
  const boxSort = sortSpec && !sortDistance ? formatSort(sortSpec) : undefined;
  const query: BuyerSearchQuery = {
    state: sp.get("state") || undefined,
    make,
    model: sp.get("model") || undefined,
    trim: sp.get("trim") || undefined,
    cond: sp.get("cond") || undefined,
    q: sp.get("q") || undefined,
    priceMin: sp.get("priceMin") ? Number(sp.get("priceMin")) : undefined,
    priceMax: sp.get("priceMax") ? Number(sp.get("priceMax")) : undefined,
    yearMin: sp.get("yearMin") ? Number(sp.get("yearMin")) : undefined,
    yearMax: sp.get("yearMax") ? Number(sp.get("yearMax")) : undefined,
    minDays: sp.get("minDays") ? Number(sp.get("minDays")) : undefined,
    maxDays: sp.get("maxDays") ? Number(sp.get("maxDays")) : undefined,
    odometerMax: sp.get("odometerMax") ? Number(sp.get("odometerMax")) : undefined,
    minPriceChanges: sp.get("minPriceChanges") ? Number(sp.get("minPriceChanges")) : undefined,
    exteriorColor: sp.get("exteriorColor") || undefined,
    interiorColor: sp.get("interiorColor") || undefined,
    optionKeys: optionKeys.length ? optionKeys : undefined,
    possibleDemo: sp.get("possibleDemo") === "1",
    // No explicit sort: the one order the make-scoped index serves with no filesort — trim for
    // make+model (idx_inv_stock_make_model_trim), model for make+state (idx_inv_facet_make_state_model);
    // make alone keeps the box's dealer default (idx_inv_stock_make_dealer). See inventoryListQuery.js.
    // nullsLast only rides along with an explicit sort; the default order's plan must not change.
    sort: boxSort || (sortDistance ? undefined : sp.get("model") ? "trim:asc" : sp.get("state") ? "model:asc" : undefined),
    nullsLast: boxSort && sp.get("nullsLast") === "1" ? true : undefined,
    countCap: BUYER_COUNT_CAP,
    limit: Math.min(Number(sp.get("limit")) || 50, MAX_LIMIT),
    offset: Number(sp.get("offset")) || 0,
  };
  return { query, zip, radiusMiles, sortDistance, distanceDir: sortSpec?.dir ?? "asc" };
}
