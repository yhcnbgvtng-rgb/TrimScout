/**
 * Search/filter by a dealer-listed factory option or DealerOn free-text feature mention —
 * real, dealer-reported data (never a window sticker, never factory_verified), sourced from
 * the live dealer_inventory pipeline (deals box `dealer_inventory_options` table — see
 * lib/inventoryApi.ts and scrapers/lightsail-crawler/src/deals_api_server.js's
 * handleInventoryOptionFacet). Deliberately separate from
 * lib/factoryOptionCatalogStore.ts's searchFactoryOptions(): that catalog only ever holds
 * factory_verified sticker data (Ford/GM/Genesis/Hyundai/Stellantis); this one is
 * dealer-reported data for any make.
 *
 * Two distinct sources feed two distinct facets — see docs/DEALER_LISTED_OPTION_SEARCH.md:
 *   - "coded": a real per-item code (Dealer.com structured packages/options, or any other
 *     source that supplies one) — searchDealerListedOptions() / listVehiclesWithDealerOption().
 *   - "feature": DealerOn's free-text feature mentions (parseFeaturesFromDescription() in
 *     standalone.js), which have no real code and all share one placeholder,
 *     UNCODED_FEATURE_PLACEHOLDER — searchDealerFeatureText() / listVehiclesWithDealerFeature().
 *     Grouping those by code the way "coded" does would collapse every DealerOn feature
 *     mention on every vehicle of a make into one meaningless bucket, so the box facets them
 *     by name instead.
 */
import { inventoryOptionFacet, listInventory, type InventoryVehicle } from "./inventoryApi";
import { normalizeOptionKey } from "./factoryOptionCatalog";

/** The shared placeholder code every DealerOn free-text feature line gets — never a real, searchable option. */
export const UNCODED_FEATURE_PLACEHOLDER = "FEATURE";

export interface DealerOptionMatch {
  code: string;
  name: string;
  /** How many in-stock vehicles of this make carry this option, per the box's facet count. */
  count: number;
  make: string;
}

export interface DealerOptionSearchDeps {
  fetchFacet?: typeof inventoryOptionFacet;
}

/**
 * Searches the live "coded" option facet (real per-item codes) for a name match. Returns null
 * only when the box itself couldn't be reached — never confuse that with "no matches" (an
 * empty array).
 */
export async function searchDealerListedOptions(
  query: string,
  make: string,
  deps: DealerOptionSearchDeps = {}
): Promise<DealerOptionMatch[] | null> {
  const q = normalizeOptionKey(query);
  if (!q) return [];

  const fetchFacet = deps.fetchFacet || inventoryOptionFacet;
  let res;
  try {
    res = await fetchFacet(make, "coded");
  } catch {
    return null;
  }

  return res.facet
    .filter((f) => f.label && normalizeOptionKey(f.label).includes(q))
    .map((f) => ({ code: f.value, name: f.label as string, count: f.count, make }));
}

export interface ListVehiclesDeps {
  fetchVehicles?: typeof listInventory;
}

/** Lists the actual vehicles carrying a matched option code, for a given make. */
export async function listVehiclesWithDealerOption(
  make: string,
  code: string,
  opts: { pageSize?: number } = {},
  deps: ListVehiclesDeps = {}
): Promise<InventoryVehicle[] | null> {
  const fetchVehicles = deps.fetchVehicles || listInventory;
  try {
    const res = await fetchVehicles({ make, optionCode: code, inStock: true, limit: opts.pageSize ?? 50 });
    return res.vehicles;
  } catch {
    return null;
  }
}

export interface DealerFeatureMatch {
  /** The free-text feature name exactly as the dealer wrote it (e.g. "Panoramic Sunroof"). No `code` field — unlike a coded option, these have none worth surfacing. */
  name: string;
  /** How many in-stock vehicles of this make mention this feature, per the box's `feature` facet count. */
  count: number;
  make: string;
}

/**
 * Searches the live "feature" facet (DealerOn free-text mentions, grouped by name) for a name
 * match. Same null/[] contract as searchDealerListedOptions(): null only when the box itself
 * couldn't be reached, never confused with an empty "no matches" array.
 */
export async function searchDealerFeatureText(
  query: string,
  make: string,
  deps: DealerOptionSearchDeps = {}
): Promise<DealerFeatureMatch[] | null> {
  const q = normalizeOptionKey(query);
  if (!q) return [];

  const fetchFacet = deps.fetchFacet || inventoryOptionFacet;
  let res;
  try {
    res = await fetchFacet(make, "feature");
  } catch {
    return null;
  }

  return res.facet
    .filter((f) => f.label && normalizeOptionKey(f.label).includes(q))
    .map((f) => ({ name: f.label as string, count: f.count, make }));
}

/** Lists the actual vehicles carrying a matched free-text feature name, for a given make. */
export async function listVehiclesWithDealerFeature(
  make: string,
  featureName: string,
  opts: { pageSize?: number } = {},
  deps: ListVehiclesDeps = {}
): Promise<InventoryVehicle[] | null> {
  const fetchVehicles = deps.fetchVehicles || listInventory;
  try {
    const res = await fetchVehicles({ make, featureText: featureName, inStock: true, limit: opts.pageSize ?? 50 });
    return res.vehicles;
  } catch {
    return null;
  }
}
