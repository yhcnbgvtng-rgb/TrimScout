"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapPin, SlidersHorizontal, X } from "lucide-react";
import SearchableDropdown, { type DropdownOption } from "./search/SearchableDropdown";

interface BuyerVehicle {
  vin: string;
  dealerName: string;
  dealerCity: string | null;
  dealerState: string | null;
  condition: "new" | "used" | "cpo" | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  mileage: number | null;
  price: number | null;
  msrp: number | null;
  vdpUrl: string | null;
  imageUrl: string | null;
  daysOnLot: number | null;
  priceDiff: number | null;
  distanceMiles: number | null;
}

interface SearchResults {
  total: number;
  limit: number;
  offset: number;
  vehicles: BuyerVehicle[];
}

interface CatalogOption {
  key: string;
  label: string;
  vehicleCount: number;
}

interface Filters {
  state: string;
  make: string;
  model: string;
  trim: string;
  cond: string;
  priceMin: string;
  priceMax: string;
  yearMin: string;
  yearMax: string;
  odometerMax: string;
  exteriorColor: string;
  interiorColor: string;
  optionKeys: string[];
  possibleDemo: boolean;
  zip: string;
  radiusMiles: string;
  sort: string;
}

const EMPTY_FILTERS: Filters = {
  state: "", make: "", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "",
  exteriorColor: "", interiorColor: "", optionKeys: [],
  possibleDemo: false, zip: "", radiusMiles: "", sort: "",
};

// A "More" filter is anything not always visible in the primary row — its own count so the
// trigger can say "3 more filters" instead of a generic icon with no idea how many are hiding.
function countMoreFilters(f: Filters): number {
  return (
    [f.cond, f.priceMin, f.priceMax, f.yearMin, f.yearMax, f.odometerMax, f.exteriorColor, f.interiorColor, f.zip, f.radiusMiles, f.sort].filter(Boolean).length +
    (f.possibleDemo ? 1 : 0)
  );
}

function filtersToQueryString(f: Filters, extra: { limit?: number; offset?: number } = {}): string {
  const sp = new URLSearchParams();
  if (f.state) sp.set("state", f.state);
  if (f.make) sp.set("make", f.make);
  if (f.model) sp.set("model", f.model);
  if (f.trim) sp.set("trim", f.trim);
  if (f.cond) sp.set("cond", f.cond);
  if (f.priceMin) sp.set("priceMin", f.priceMin);
  if (f.priceMax) sp.set("priceMax", f.priceMax);
  if (f.yearMin) sp.set("yearMin", f.yearMin);
  if (f.yearMax) sp.set("yearMax", f.yearMax);
  if (f.odometerMax) sp.set("odometerMax", f.odometerMax);
  if (f.exteriorColor) sp.set("exteriorColor", f.exteriorColor);
  if (f.interiorColor) sp.set("interiorColor", f.interiorColor);
  if (f.optionKeys.length) sp.set("optionKeys", f.optionKeys.join(","));
  if (f.possibleDemo) sp.set("possibleDemo", "1");
  if (f.zip) sp.set("zip", f.zip);
  if (f.radiusMiles && f.make && f.zip) sp.set("radiusMiles", f.radiusMiles);
  if (f.sort) sp.set("sort", f.sort);
  if (extra.limit) sp.set("limit", String(extra.limit));
  if (extra.offset) sp.set("offset", String(extra.offset));
  return sp.toString();
}

const RESULTS_PAGE_SIZE = 24;
// Filter changes fire a new search on a short debounce so a burst of rapid dropdown clicks (or
// typing in a "More" number field) collapses into one request instead of one per keystroke/click.
const SEARCH_DEBOUNCE_MS = 300;

function toOptions<T>(rows: T[], valueKey: keyof T, countKey: keyof T, labelFor?: (r: T) => string): DropdownOption[] {
  return rows.map((r) => ({
    value: String(r[valueKey]),
    label: labelFor ? labelFor(r) : String(r[valueKey]),
    count: Number(r[countKey]) || 0,
  }));
}

export function BuyerSearchView() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const [stateOptions, setStateOptions] = useState<DropdownOption[]>([]);
  const [makeOptions, setMakeOptions] = useState<DropdownOption[]>([]);
  const [modelOptions, setModelOptions] = useState<DropdownOption[]>([]);
  const [trimOptions, setTrimOptions] = useState<DropdownOption[]>([]);
  const [facetsLoading, setFacetsLoading] = useState(false);

  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [exteriorColors, setExteriorColors] = useState<string[]>([]);
  const [interiorColors, setInteriorColors] = useState<string[]>([]);
  const [catalogOptionsLoading, setCatalogOptionsLoading] = useState(false);

  const [results, setResults] = useState<SearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Close the "More" popover on an outside click, same convention as SearchableDropdown.
  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [moreOpen]);

  // State + Make counts, cross-scoped by each other — always fetched (they're always visible).
  // Model/trim counts ride along on the same call whenever make/model are set; the box only
  // computes what it can scope (see lib/inventoryApi.ts's inventoryFacets).
  useEffect(() => {
    const controller = new AbortController();
    setFacetsLoading(true);
    const sp = new URLSearchParams();
    if (filters.state) sp.set("state", filters.state);
    if (filters.make) sp.set("make", filters.make);
    if (filters.model) sp.set("model", filters.model);
    fetch(`/api/catalog/facets?${sp}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        setStateOptions(toOptions(json?.states || [], "state", "n"));
        setMakeOptions(toOptions(json?.makes || [], "make", "n"));
        setModelOptions(toOptions(json?.models || [], "model", "n"));
        setTrimOptions(toOptions(json?.trims || [], "trim", "n"));
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        // Soft-fail: keep whatever counts we already had rather than wiping the dropdowns out
        // from under someone mid-selection — never block the UI on this.
      })
      .finally(() => setFacetsLoading(false));
    return () => controller.abort();
  }, [filters.state, filters.make, filters.model]);

  // Factory options + colors, scoped to make/model/trim — unchanged from the pre-redesign panel.
  useEffect(() => {
    const controller = new AbortController();
    const sp = new URLSearchParams();
    if (filters.make) sp.set("make", filters.make);
    if (filters.model) sp.set("model", filters.model);
    if (filters.trim) sp.set("trim", filters.trim);
    setCatalogOptionsLoading(true);
    fetch(`/api/catalog/options${sp.toString() ? `?${sp}` : ""}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        setCatalogOptions(Array.isArray(json?.options) ? json.options : []);
        setExteriorColors(Array.isArray(json?.exteriorColors) ? json.exteriorColors : []);
        setInteriorColors(Array.isArray(json?.interiorColors) ? json.interiorColors : []);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setCatalogOptions([]);
        setExteriorColors([]);
        setInteriorColors([]);
      })
      .finally(() => setCatalogOptionsLoading(false));
    return () => controller.abort();
  }, [filters.make, filters.model, filters.trim]);

  // Clearing make clears model/trim/options; clearing model clears trim/options — the box has
  // nothing to scope them by otherwise, and stale selections from a different make/model would
  // silently narrow a search the shopper never asked for.
  const setMake = (make: string) => setFilters((f) => ({ ...f, make, model: "", trim: "", optionKeys: [] }));
  const setModel = (model: string) => setFilters((f) => ({ ...f, model, trim: "", optionKeys: [] }));

  const runSearchRef = useRef(0);
  const runSearch = useCallback(async (f: Filters, offset: number, signal: AbortSignal) => {
    const requestId = ++runSearchRef.current;
    setSearchLoading(true);
    if (offset === 0) setSearchError(null);
    try {
      const qs = filtersToQueryString(f, { limit: RESULTS_PAGE_SIZE, offset });
      const res = await fetch(`/api/vehicles/search${qs ? `?${qs}` : ""}`, { signal });
      if (requestId !== runSearchRef.current) return; // a newer request has since superseded this one
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        setSearchError(typeof json?.error === "string" ? json.error : "Could not search inventory.");
        if (offset === 0) setResults(null);
        return;
      }
      setSearchError(null);
      setResults((prev) => (offset > 0 && prev ? { ...json, vehicles: [...prev.vehicles, ...json.vehicles] } : json));
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (requestId !== runSearchRef.current) return;
      setSearchError("Could not reach the search service.");
      if (offset === 0) setResults(null);
    } finally {
      if (requestId === runSearchRef.current) setSearchLoading(false);
    }
  }, []);

  // Live total: any filter change re-runs the search on a short debounce, cancelling whatever
  // request was still in flight — never lets a slow earlier response overwrite a faster later one
  // (the exact race this page had no guard against before this redesign).
  useEffect(() => {
    const hasAnyFilter = filters.make || filters.state;
    if (!hasAnyFilter) {
      setResults(null);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => void runSearch(filters, 0, controller.signal), SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.state, filters.make, filters.model, filters.trim, filters.cond, filters.priceMin, filters.priceMax,
    filters.yearMin, filters.yearMax, filters.odometerMax, filters.exteriorColor,
    filters.interiorColor, filters.optionKeys, filters.possibleDemo, filters.zip, filters.radiusMiles, filters.sort,
  ]);

  const toggleOptionKey = (key: string) => {
    setFilters((f) => ({ ...f, optionKeys: f.optionKeys.includes(key) ? f.optionKeys.filter((k) => k !== key) : [...f.optionKeys, key] }));
  };

  const loadMore = () => {
    if (!results) return;
    const controller = new AbortController();
    void runSearch(filters, results.offset + results.vehicles.length, controller.signal);
  };

  const moreCount = countMoreFilters(filters);
  const clearMore = () =>
    setFilters((f) => ({
      ...f, cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "",
      exteriorColor: "", interiorColor: "", possibleDemo: false, zip: "", radiusMiles: "", sort: "",
    }));

  const modelDisabledHint = !filters.make ? "Pick a make first" : undefined;
  const trimDisabledHint = !filters.model ? "Pick a model first" : undefined;
  const optionsDisabledHint = !filters.make || !filters.model ? "Pick a make and model first" : undefined;
  const optionDropdownOptions = useMemo(() => toOptions(catalogOptions, "key", "vehicleCount", (o) => o.label), [catalogOptions]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Search real dealer inventory</h1>
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-surface p-4 shadow-lg">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <SearchableDropdown label="State" placeholder="All states" options={stateOptions} value={filters.state} loading={facetsLoading} onChange={(state) => setFilters((f) => ({ ...f, state }))} />
          </div>
          <div className="w-48">
            <SearchableDropdown label="Make" placeholder="All makes" options={makeOptions} value={filters.make} loading={facetsLoading} onChange={setMake} />
          </div>
          <div className="w-48">
            <SearchableDropdown label="Model" placeholder="All models" options={modelOptions} value={filters.model} loading={facetsLoading} onChange={setModel} disabledHint={modelDisabledHint} />
          </div>
          <div className="w-48">
            <SearchableDropdown label="Trim" placeholder="Any trim" options={trimOptions} value={filters.trim} loading={facetsLoading} onChange={(trim) => setFilters((f) => ({ ...f, trim }))} disabledHint={trimDisabledHint} />
          </div>
          <div className="w-56">
            <SearchableDropdown
              multi
              label="Factory options"
              placeholder="Any options"
              options={optionDropdownOptions}
              value={filters.optionKeys}
              onChange={(optionKeys) => setFilters((f) => ({ ...f, optionKeys }))}
              disabledHint={optionsDisabledHint}
              loading={catalogOptionsLoading}
              emptyMessage="No factory options in inventory for this make/model yet."
            />
          </div>

          <div ref={moreRef} className="relative flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">&nbsp;</span>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
                moreCount > 0 ? "border-sky-500/50 bg-sky-950/20 text-sky-300" : "border-border bg-surface-elevated text-ink-light hover:border-border-strong"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              More{moreCount > 0 ? ` · ${moreCount}` : ""}
            </button>

            {moreOpen && (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-80 max-w-[92vw] space-y-3 rounded-xl border border-border-strong bg-surface-elevated p-3 shadow-2xl">
                <div>
                  <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Condition</label>
                  <select value={filters.cond} onChange={(e) => setFilters((f) => ({ ...f, cond: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white focus:border-sky-500/50 focus:outline-none">
                    <option value="">New + used</option>
                    <option value="new">New</option>
                    <option value="used">Used</option>
                    <option value="cpo">Certified</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Price min</label>
                    <input type="number" value={filters.priceMin} onChange={(e) => setFilters((f) => ({ ...f, priceMin: e.target.value }))} placeholder="$0" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-sky-500/50 focus:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Price max</label>
                    <input type="number" value={filters.priceMax} onChange={(e) => setFilters((f) => ({ ...f, priceMax: e.target.value }))} placeholder="No max" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-sky-500/50 focus:outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Year min</label>
                    <input type="number" value={filters.yearMin} onChange={(e) => setFilters((f) => ({ ...f, yearMin: e.target.value }))} placeholder="Any" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-sky-500/50 focus:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Year max</label>
                    <input type="number" value={filters.yearMax} onChange={(e) => setFilters((f) => ({ ...f, yearMax: e.target.value }))} placeholder="Any" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-sky-500/50 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Max odometer</label>
                  <input type="number" value={filters.odometerMax} onChange={(e) => setFilters((f) => ({ ...f, odometerMax: e.target.value }))} placeholder="Any mileage" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-sky-500/50 focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Exterior</label>
                    <select value={filters.exteriorColor} onChange={(e) => setFilters((f) => ({ ...f, exteriorColor: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white focus:border-sky-500/50 focus:outline-none">
                      <option value="">Any</option>
                      {exteriorColors.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Interior</label>
                    <select value={filters.interiorColor} onChange={(e) => setFilters((f) => ({ ...f, interiorColor: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white focus:border-sky-500/50 focus:outline-none">
                      <option value="">Any</option>
                      {interiorColors.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-light">
                  <input type="checkbox" checked={filters.possibleDemo} onChange={(e) => setFilters((f) => ({ ...f, possibleDemo: e.target.checked }))} className="h-3.5 w-3.5 rounded border-border accent-sky-500" />
                  Include likely demo/loaner vehicles
                </label>
                <div className="border-t border-border pt-3">
                  <label className="mb-1 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">
                    <MapPin className="h-3 w-3" /> Near
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={filters.zip} onChange={(e) => setFilters((f) => ({ ...f, zip: e.target.value }))} placeholder="ZIP code" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-sky-500/50 focus:outline-none" />
                    <input
                      type="number" value={filters.radiusMiles} onChange={(e) => setFilters((f) => ({ ...f, radiusMiles: e.target.value }))} placeholder="Radius (mi)"
                      disabled={!filters.make || !filters.zip} title={!filters.zip ? "Enter a ZIP code to search within a radius" : !filters.make ? "Pick a make to search within a radius" : undefined}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-sky-500/50 focus:outline-none disabled:opacity-40"
                    />
                  </div>
                  {filters.radiusMiles && (!filters.make || !filters.zip) && (
                    <p className="mt-1 text-[11px] text-ink-faint">{!filters.zip ? "Enter a ZIP code" : "Pick a make"} to search within a distance.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Sort</label>
                  <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white focus:border-sky-500/50 focus:outline-none">
                    <option value="">Best match</option>
                    <option value="price:asc">Price: low to high</option>
                    <option value="price:desc">Price: high to low</option>
                    <option value="mileage:asc">Mileage: low to high</option>
                    <option value="days:asc">Newest to lot</option>
                    {filters.zip && <option value="distance">Distance</option>}
                  </select>
                </div>
                {moreCount > 0 && (
                  <button type="button" onClick={clearMore} className="flex w-full items-center justify-center gap-1 rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-1.5 text-[11px] font-bold text-rose-300 hover:text-white">
                    <X className="h-3 w-3" /> Clear {moreCount} more filter{moreCount === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold text-ink-muted">
          {results ? `${results.total.toLocaleString()} vehicle${results.total === 1 ? "" : "s"} found` : searchLoading ? "Searching…" : " "}
        </p>

        {searchError && (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{searchError}</div>
        )}

        {searchError && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-16 text-center text-sm text-ink-faint">
            No results to show right now — try again, or narrow your filters.
          </div>
        )}

        {!searchError && !results && !searchLoading && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-16 text-center text-sm text-ink-faint">
            Choose a make (and state if you want) to see in-stock vehicles.
          </div>
        )}

        {!searchError && results && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.vehicles.map((v) => (
                <VehicleCard key={`${v.vin}-${v.dealerName}`} vehicle={v} />
              ))}
            </div>
            {results.vehicles.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-16 text-center text-sm text-ink-faint">
                No vehicles match these filters — try widening them.
              </div>
            )}
            {results.vehicles.length < results.total && (
              <div className="mt-6 flex justify-center">
                <button type="button" onClick={loadMore} disabled={searchLoading} className="rounded-xl border border-border bg-surface-elevated px-5 py-2.5 text-xs font-bold text-ink-light hover:border-sky-500/50 hover:text-white disabled:opacity-50">
                  {searchLoading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function VehicleCard({ vehicle: v }: { vehicle: BuyerVehicle }) {
  const title = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
      <div className="h-40 w-full bg-surface-elevated">
        {v.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.imageUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink-faint">No photo</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="text-sm font-bold text-white">{title || "Vehicle"}</h3>
        <p className="text-lg font-extrabold text-emerald-400">
          {v.price != null ? `$${v.price.toLocaleString()}` : "Call for price"}
          {v.priceDiff != null && v.priceDiff < 0 && (
            <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              ${Math.abs(v.priceDiff).toLocaleString()} price drop
            </span>
          )}
        </p>
        <p className="text-xs text-ink-muted">
          {v.mileage != null ? `${v.mileage.toLocaleString()} mi` : "Mileage n/a"}
          {v.exteriorColor ? ` • ${v.exteriorColor}` : ""}
          {v.condition ? ` • ${v.condition}` : ""}
        </p>
        <p className="text-xs text-ink-faint">
          {v.dealerName}
          {v.dealerCity ? `, ${v.dealerCity}` : ""}
          {v.dealerState ? `, ${v.dealerState}` : ""}
          {v.distanceMiles != null ? ` • ${Math.round(v.distanceMiles)} mi away` : ""}
        </p>
        <div className="mt-auto pt-2">
          {v.vdpUrl ? (
            <Link
              href={v.vdpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-bold text-ink-light hover:border-sky-500/50 hover:text-white"
            >
              View at dealer
            </Link>
          ) : (
            <span className="block text-center text-[11px] text-ink-faint">No listing link available</span>
          )}
        </div>
      </div>
    </article>
  );
}
