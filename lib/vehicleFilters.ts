/**
 * Client-safe filter model for the admin Vehicles sheet (app/admin/crawl/VehiclesSheet.tsx).
 *
 * The sheet keeps TWO copies of the filters: a DRAFT the admin is editing and the APPLIED set the table was
 * last loaded with. Only applying (Apply / Enter in search / Load all / a movement tile) copies draft -> applied
 * and fetches; editing the draft never does. Everything here is pure so those rules can be tested.
 */

export type Movement = "" | "arrivals" | "drops" | "increases" | "removed";
export type SortKey = "dealer" | "year" | "make" | "model" | "price" | "mileage" | "seen" | "days" | "pricediff" | "msrp";
export interface VehicleSort { key: SortKey; dir: "asc" | "desc" }

export interface VehicleFilters {
  q: string;
  /** state / make / model / trim / cond are multi-select: OR within a field, AND across fields. */
  states: string[];
  makes: string[];
  models: string[];
  trims: string[];
  conds: string[];
  inStock: boolean;
  movement: Movement;
  hasSticker: boolean;
  possibleDemo: boolean;
  minDays: string;
}

export const EMPTY_FILTERS: VehicleFilters = {
  q: "", states: [], makes: [], models: [], trims: [], conds: [], inStock: true, movement: "", hasSticker: false, possibleDemo: false, minDays: "",
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sorted = (a: string[]) => [...a].sort();

/** True when every field matches (list order ignored — the same picks in another click order are the same filter). */
export function filtersEqual(a: VehicleFilters, b: VehicleFilters): boolean {
  return a.q.trim() === b.q.trim()
    && sameList(sorted(a.states), sorted(b.states)) && sameList(sorted(a.makes), sorted(b.makes))
    && sameList(sorted(a.models), sorted(b.models)) && sameList(sorted(a.trims), sorted(b.trims)) && sameList(sorted(a.conds), sorted(b.conds))
    && a.inStock === b.inStock && a.movement === b.movement && a.hasSticker === b.hasSticker && a.possibleDemo === b.possibleDemo
    && a.minDays.trim() === b.minDays.trim();
}

/** Anything set beyond the empty default. (Unchecking "In stock only" counts: it widens the list to sold vehicles.) */
export function hasAnyFilter(f: VehicleFilters): boolean {
  return !filtersEqual(f, EMPTY_FILTERS);
}

/** Number of distinct active filters, for the Clear button / badge. Each selected value is not counted separately. */
export function activeFilterCount(f: VehicleFilters): number {
  return [f.q.trim(), f.states.length, f.makes.length, f.models.length, f.trims.length, f.conds.length, f.movement, f.minDays.trim()].filter(Boolean).length
    + (f.inStock ? 0 : 1) + (f.hasSticker ? 1 : 0) + (f.possibleDemo ? 1 : 0);
}

/** "Load all": no dropdown/search/toggle filters — the only thing carried over is the current "In stock only" checkbox. */
export function loadAllFilters(draft: Pick<VehicleFilters, "inStock">): VehicleFilters {
  return { ...EMPTY_FILTERS, inStock: draft.inStock };
}

/** The list/export query string for a set of filters. Multi-select fields repeat their key (state=FL&state=GA). */
export function buildVehicleQuery(f: VehicleFilters, sort: VehicleSort): URLSearchParams {
  const p = new URLSearchParams();
  for (const v of f.states) p.append("state", v);
  for (const v of f.makes) p.append("make", v);
  for (const v of f.models) p.append("model", v);
  for (const v of f.trims) p.append("trim", v);
  for (const v of f.conds) p.append("cond", v);
  // A "Sold" vehicle is by definition not in stock (removed_at IS NOT NULL) — sending both would always
  // return zero rows, so the in-stock checkbox is ignored (not unchecked, just not sent) while that movement
  // is selected, rather than fighting the admin's own checkbox state.
  if (f.inStock && f.movement !== "removed") p.set("inStock", "1");
  if (f.movement === "arrivals") p.set("changeType", "NEW_ARRIVAL");
  if (f.movement === "drops") p.set("priceChange", "drop");
  if (f.movement === "increases") p.set("priceChange", "increase");
  if (f.movement === "removed") p.set("removed", "1");
  if (f.hasSticker) p.set("hasSticker", "1");
  if (f.possibleDemo) p.set("possibleDemo", "1");
  if (f.minDays.trim() && Number(f.minDays) > 0) p.set("minDays", String(Number(f.minDays)));
  if (f.q.trim()) p.set("q", f.q.trim());
  p.set("sort", `${sort.key}:${sort.dir}`);
  return p;
}

/** The State/Make/Model selections the facet counts are scoped by — the only filters the box's facet indexes can honour. */
export function facetParams(f: Pick<VehicleFilters, "states" | "makes" | "models">): URLSearchParams {
  const p = new URLSearchParams({ facets: "1" });
  for (const v of f.states) p.append("state", v);
  for (const v of f.makes) p.append("make", v);
  // Models only scope anything once a make is picked (the box ignores them otherwise).
  if (f.makes.length) for (const v of f.models) p.append("model", v);
  return p;
}

/** Stable identity of a facet scope: same selections in any click order = same key (so no refetch). */
export function facetKey(f: Pick<VehicleFilters, "states" | "makes" | "models">): string {
  return JSON.stringify([sorted(f.states), sorted(f.makes), f.makes.length ? sorted(f.models) : []]);
}

/**
 * Parent-field cascade: model/trim have nothing to scope by without a make/model. Emptying a parent clears its
 * children; shrinking a non-empty parent leaves them (they are pruned against fresh facet options afterwards).
 */
export function cascadeCleared(f: VehicleFilters): VehicleFilters {
  let next = f;
  if (!next.makes.length && (next.models.length || next.trims.length)) next = { ...next, models: [], trims: [] };
  if (!next.models.length && next.trims.length) next = { ...next, trims: [] };
  return next;
}

/** Drops selected models/trims that the fresh, correctly-scoped facet lists no longer offer. */
export function pruneToOptions(f: VehicleFilters, modelValues: string[], trimValues: string[]): VehicleFilters {
  const models = f.models.filter((m) => modelValues.includes(m));
  const trims = f.trims.filter((t) => trimValues.includes(t));
  return models.length === f.models.length && trims.length === f.trims.length ? f : { ...f, models, trims };
}
