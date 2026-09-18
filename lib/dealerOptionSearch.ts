/**
 * Search/filter by a *dealer-listed* factory option — real, Dealer.com
 * structured data (a package/option with its own code and, often, a real
 * price), never a window sticker. This is deliberately separate from
 * lib/factoryOptionCatalogStore.ts's searchFactoryOptions(): that catalog
 * only ever holds factory_verified sticker data (Ford/GM/Genesis/Hyundai/
 * Stellantis); this one is dealer-reported data for any brand, sourced
 * from the Lightsail crawl box's `vehicle_options` table
 * (scrapers/lightsail-crawler/src/standalone.js's Strategy 1 DDC
 * extraction), never labeled factory_verified.
 *
 * Deliberately does NOT cover DealerOn's free-text feature mentions
 * (parseFeaturesFromDescription() in standalone.js) — those have no
 * stable per-item code (they all share the literal code "FEATURE"), so
 * the box's option facet can't distinguish one feature name from another
 * in aggregate. Searching those needs a box-side change; see
 * docs/DEALER_LISTED_OPTION_SEARCH.md.
 */
import { fetchFacetsFromBox, fetchVehiclesFromBox, type BoxVehicle } from "./lightsailClient";
import { normalizeOptionKey } from "./factoryOptionCatalog";

/** The shared placeholder code every DealerOn free-text feature line gets — never a real, searchable option. */
export const UNCODED_FEATURE_PLACEHOLDER = "FEATURE";

export interface DealerOptionMatch {
  code: string;
  name: string;
  /** How many active vehicles (of this brand) carry this option, per the box's facet count. */
  count: number;
  brand: string;
}

export interface DealerOptionSearchDeps {
  fetchFacets?: typeof fetchFacetsFromBox;
}

/**
 * Searches the box's per-brand option facet (name + code + count, real
 * Dealer.com data) for a name match. Returns null only when the box
 * itself couldn't be reached — never confuse that with "no matches"
 * (which is an empty array).
 */
export async function searchDealerListedOptions(
  query: string,
  brand: string,
  deps: DealerOptionSearchDeps = {}
): Promise<DealerOptionMatch[] | null> {
  const q = normalizeOptionKey(query);
  if (!q) return [];

  const fetchFacets = deps.fetchFacets || fetchFacetsFromBox;
  const res = await fetchFacets({ brand });
  if (!res) return null;

  const optionCodeFacet = res.facets?.optionCode || [];
  return optionCodeFacet
    .filter((f) => f.value !== UNCODED_FEATURE_PLACEHOLDER && f.label && normalizeOptionKey(f.label).includes(q))
    .map((f) => ({ code: f.value, name: f.label as string, count: f.count, brand }));
}

export interface ListVehiclesDeps {
  fetchVehicles?: typeof fetchVehiclesFromBox;
}

/** Lists the actual vehicles carrying a matched option code, for a given brand. */
export async function listVehiclesWithDealerOption(
  brand: string,
  code: string,
  opts: { pageSize?: number } = {},
  deps: ListVehiclesDeps = {}
): Promise<BoxVehicle[] | null> {
  const fetchVehicles = deps.fetchVehicles || fetchVehiclesFromBox;
  const res = await fetchVehicles({ brand, optionCode: code, pageSize: opts.pageSize ?? 50 });
  return res ? res.vehicles : null;
}
