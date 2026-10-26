// /search filter state <-> the page URL, so a search can be shared and survives a reload. Pure, client-safe.
import { cleanBodyStyle, cleanDealerId, cleanDrivetrain, cleanFuel, cleanTransmission, cleanVinPattern, daysBandRange, MAX_BODY_STYLES, MAX_DEALERS } from "./searchFilters";

// Param names match /api/vehicles/search (state, make, model, trim, cond, priceMin, ...), plus `exclude` (client-side keyword filter).

export interface UrlFilters {
  state: string; make: string; model: string; trim: string; cond: string;
  priceMin: string; priceMax: string; yearMin: string; yearMax: string; odometerMax: string;
  exteriorColor: string; interiorColor: string; optionKeys: string[];
  possibleDemo: boolean; contactOnFile: boolean; zip: string; radiusMiles: string; sort: string; exclude: string;
  odometerMin: string; bodyStyle: string[]; fuel: string[]; drivetrain: string[]; transmission: string[]; dealerIds: string[];
  /** Days on market, inclusive bounds in whole days (either may be empty). An old `days=8-30` link is read into these. */
  daysMin: string; daysMax: string;
  vinPattern: string;
}

const TEXT_KEYS = ["state", "make", "model", "trim", "cond", "priceMin", "priceMax", "yearMin", "yearMax", "odometerMax", "odometerMin", "exteriorColor", "interiorColor", "zip", "radiusMiles", "sort", "exclude", "daysMin", "daysMax", "vinPattern"] as const;
const NUMERIC = new Set(["priceMin", "priceMax", "yearMin", "yearMax", "odometerMax", "odometerMin", "radiusMiles", "daysMin", "daysMax"]);
/** Repeated page-URL params of the list filters (dealerId carries the box's own store ids). */
const LIST_PARAMS = ["bodyStyle", "fuel", "drivetrain", "transmission", "dealerId"] as const;

export function filtersToSearchParams(f: UrlFilters): URLSearchParams {
  const sp = new URLSearchParams();
  for (const k of TEXT_KEYS) if (f[k]) sp.set(k, f[k]);
  if (f.optionKeys.length) sp.set("optionKeys", f.optionKeys.join(","));
  for (const v of f.bodyStyle) sp.append("bodyStyle", v);
  for (const v of f.fuel) sp.append("fuel", v);
  for (const v of f.drivetrain) sp.append("drivetrain", v);
  for (const v of f.transmission) sp.append("transmission", v);
  for (const v of f.dealerIds) sp.append("dealerId", v);
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
  const many = (key: string, clean: (v: string) => string, max: number) => {
    const out: string[] = [];
    for (const raw of sp.getAll(key)) { const v = clean(raw.slice(0, 60)); if (v && !out.includes(v)) out.push(v); if (out.length >= max) break; }
    return out;
  };
  next.bodyStyle = many("bodyStyle", cleanBodyStyle, MAX_BODY_STYLES);
  next.fuel = cleanFuel(sp.getAll("fuel"));
  next.drivetrain = cleanDrivetrain(sp.getAll("drivetrain"));
  next.transmission = cleanTransmission(sp.getAll("transmission"));
  next.dealerIds = many("dealerId", cleanDealerId, MAX_DEALERS);
  // Links made before days became a free range carried one band key (days=8-30): read it into the bounds, unless the bounds are given.
  const band = daysBandRange((sp.get("days") ?? "").trim());
  if (band && !next.daysMin && !next.daysMax) { next.daysMin = band.min != null ? String(band.min) : ""; next.daysMax = band.max != null ? String(band.max) : ""; }
  next.vinPattern = cleanVinPattern(next.vinPattern);
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
  for (const k of [...TEXT_KEYS, ...LIST_PARAMS, "days", "optionKeys", "possibleDemo", "contactOnFile"]) url.searchParams.delete(k);
  for (const [k, v] of filtersToSearchParams(f)) url.searchParams.append(k, v);
  return url.toString();
}

/** Same URL with one param set (or removed when the value is empty): used for the visible-columns param, which is view state, not a filter. */
export function urlWithParam(href: string, key: string, value: string): string {
  const url = new URL(href);
  if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  return url.toString();
}
