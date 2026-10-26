// Pure helpers behind the live /search filters: where the headline count comes from, when it needs the box, and the keyword-exclude rule.
// Client-safe (no node imports) and free of React so it can be unit tested directly.

export interface LiveFilterShape {
  state: string; make: string; model: string; trim: string; cond: string;
  priceMin: string; priceMax: string; yearMin: string; yearMax: string; odometerMax: string;
  exteriorColor: string; interiorColor: string; optionKeys: string[];
  possibleDemo: boolean; contactOnFile: boolean; zip: string; radiusMiles: string;
}

export interface FacetLists {
  states: Array<{ value: string; count: number }>;
  makes: Array<{ value: string; count: number }>;
  models: Array<{ value: string; count: number }>;
  trims: Array<{ value: string; count: number }>;
}

/** Everything the catalog-facets lists cannot narrow by: any of these set means the count has to come from a real (limit=1) search. */
export function hasNonFacetFilter(f: LiveFilterShape): boolean {
  return Boolean(
    f.cond || f.priceMin || f.priceMax || f.yearMin || f.yearMax || f.odometerMax || f.exteriorColor || f.interiorColor ||
    f.optionKeys.length || f.possibleDemo || (f.zip && f.radiusMiles),
  );
}

const sum = (rows: Array<{ count: number }>) => rows.reduce((s, r) => s + (Number.isFinite(r.count) ? r.count : 0), 0);

/**
 * The count the facet lists already hold, with no extra request: the deepest picked level (trim, then model, then make, then location),
 * or the whole inventory when nothing is picked. The lists are cross-scoped by the picks above them, so the number is exact for the
 * state/make/model/trim combination. Returns null when the picked value is not in its list (lists still loading), so the caller waits
 * instead of showing a wrong number.
 */
export function facetCount(f: LiveFilterShape, facets: FacetLists): number | null {
  const find = (rows: FacetLists["states"], value: string) => rows.find((r) => r.value === value)?.count ?? null;
  if (f.trim) return find(facets.trims, f.trim);
  if (f.model) return find(facets.models, f.model);
  if (f.make) return find(facets.makes, f.make);
  if (f.state) return find(facets.states, f.state);
  return facets.makes.length ? sum(facets.makes) : null;
}

/** The count comes from a limit=1 search only when a filter the facets cannot see is set and the server will accept the query (it needs a make, and options need a model). */
export function needsServerCount(f: LiveFilterShape): boolean {
  if (!hasNonFacetFilter(f) || !f.make) return false;
  if (f.optionKeys.length && !f.model) return false;
  return true;
}

/** "demo, loaner  lease" -> ["demo","loaner","lease"], lower-cased, de-duplicated, capped so a paste cannot become a huge scan. */
export function parseExclude(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.toLowerCase().split(/[,;\n]+/)) {
    const t = part.trim().replace(/\s+/g, " ");
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

interface Excludable {
  year?: number | null; make?: string | null; model?: string | null; trim?: string | null;
  exteriorColor?: string | null; interiorColor?: string | null;
}

/** True when any exclude word appears in the car's year / make / model / trim / colours. Whole-text match, case-insensitive. */
export function isExcluded(v: Excludable, terms: string[]): boolean {
  if (!terms.length) return false;
  const hay = [v.year, v.make, v.model, v.trim, v.exteriorColor, v.interiorColor].filter((x) => x != null && x !== "").join(" ").toLowerCase();
  return terms.some((t) => hay.includes(t));
}

export const PRICE_SLIDER = { min: 0, max: 150000, step: 1000 } as const;

/** "$32k", "$150k+" for the slider's readout. */
export function sliderMoney(n: number, atMax = false): string {
  const k = n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
  return `$${k}${atMax ? "+" : ""}`;
}
