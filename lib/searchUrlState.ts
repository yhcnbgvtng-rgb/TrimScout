// /search filter state <-> the page URL, so a search can be shared and survives a reload. Pure, client-safe.
// Param names match /api/vehicles/search (state, make, model, trim, cond, priceMin, ...), plus `exclude` (client-side keyword filter).

export interface UrlFilters {
  state: string; make: string; model: string; trim: string; cond: string;
  priceMin: string; priceMax: string; yearMin: string; yearMax: string; odometerMax: string;
  exteriorColor: string; interiorColor: string; optionKeys: string[];
  possibleDemo: boolean; contactOnFile: boolean; zip: string; radiusMiles: string; sort: string; exclude: string;
}

const TEXT_KEYS = ["state", "make", "model", "trim", "cond", "priceMin", "priceMax", "yearMin", "yearMax", "odometerMax", "exteriorColor", "interiorColor", "zip", "radiusMiles", "sort", "exclude"] as const;
const NUMERIC = new Set(["priceMin", "priceMax", "yearMin", "yearMax", "odometerMax", "radiusMiles"]);

export function filtersToSearchParams(f: UrlFilters): URLSearchParams {
  const sp = new URLSearchParams();
  for (const k of TEXT_KEYS) if (f[k]) sp.set(k, f[k]);
  if (f.optionKeys.length) sp.set("optionKeys", f.optionKeys.join(","));
  if (f.possibleDemo) sp.set("possibleDemo", "1");
  if (f.contactOnFile) sp.set("contactOnFile", "1");
  return sp;
}

/** Reads a (possibly hand-edited) query string. Unknown params are ignored, numeric ones must be plain digits, a model needs its make. */
export function filtersFromSearchParams(sp: URLSearchParams, base: UrlFilters): UrlFilters {
  const next: UrlFilters = { ...base, optionKeys: [] };
  for (const k of TEXT_KEYS) {
    const raw = (sp.get(k) ?? "").trim().slice(0, 120);
    if (!raw) continue;
    if (NUMERIC.has(k) && !/^\d{1,7}$/.test(raw)) continue;
    next[k] = raw;
  }
  if (!["", "new", "used", "cpo"].includes(next.cond)) next.cond = "";
  const keys = (sp.get("optionKeys") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  next.optionKeys = keys;
  next.possibleDemo = sp.get("possibleDemo") === "1";
  next.contactOnFile = sp.get("contactOnFile") === "1";
  // The same dependencies the page enforces when a shopper picks by hand.
  if (!next.make) { next.model = ""; next.trim = ""; next.optionKeys = []; }
  if (!next.model) { next.trim = ""; next.optionKeys = []; }
  return next;
}

/** Same URL with the filter params replaced (other params, the path and the hash are kept). */
export function urlWithFilters(href: string, f: UrlFilters): string {
  const url = new URL(href);
  for (const k of [...TEXT_KEYS, "optionKeys", "possibleDemo", "contactOnFile"]) url.searchParams.delete(k);
  for (const [k, v] of filtersToSearchParams(f)) url.searchParams.set(k, v);
  return url.toString();
}
