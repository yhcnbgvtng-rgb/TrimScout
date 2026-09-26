"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, Sparkles, X, MapPin, Loader2 } from "lucide-react";

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
  make: string;
  model: string;
  trim: string;
  priceMin: string;
  priceMax: string;
  yearMin: string;
  yearMax: string;
  odometerMax: string;
  minDays: string;
  maxDays: string;
  exteriorColor: string;
  interiorColor: string;
  optionKeys: string[];
  possibleDemo: boolean;
  zip: string;
  radiusMiles: string;
  sort: string;
}

const EMPTY_FILTERS: Filters = {
  make: "", model: "", trim: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "",
  minDays: "", maxDays: "", exteriorColor: "", interiorColor: "", optionKeys: [],
  possibleDemo: false, zip: "", radiusMiles: "", sort: "",
};

function filtersToQueryString(f: Filters, extra: { limit?: number; offset?: number } = {}): string {
  const sp = new URLSearchParams();
  if (f.make) sp.set("make", f.make);
  if (f.model) sp.set("model", f.model);
  if (f.trim) sp.set("trim", f.trim);
  if (f.priceMin) sp.set("priceMin", f.priceMin);
  if (f.priceMax) sp.set("priceMax", f.priceMax);
  if (f.yearMin) sp.set("yearMin", f.yearMin);
  if (f.yearMax) sp.set("yearMax", f.yearMax);
  if (f.odometerMax) sp.set("odometerMax", f.odometerMax);
  if (f.minDays) sp.set("minDays", f.minDays);
  if (f.maxDays) sp.set("maxDays", f.maxDays);
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

export function BuyerSearchView() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [exteriorColors, setExteriorColors] = useState<string[]>([]);
  const [interiorColors, setInteriorColors] = useState<string[]>([]);
  const [makes, setMakes] = useState<string[]>([]);

  const [nlQuery, setNlQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<string[]>([]);
  const [displayChips, setDisplayChips] = useState<Array<{ field: string; label: string }>>([]);

  const [results, setResults] = useState<SearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Makes list loads once; the catalog's options/colors are scoped to make/model/trim (PR 2's
  // rule: never offer a combination that returns zero results) so they refetch whenever those
  // change.
  useEffect(() => {
    fetch("/api/catalog/makes")
      .then((r) => r.json())
      .then((json) => setMakes(Array.isArray(json?.makes) ? json.makes : []))
      .catch(() => setMakes([]));
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (filters.make) sp.set("make", filters.make);
    if (filters.model) sp.set("model", filters.model);
    if (filters.trim) sp.set("trim", filters.trim);
    fetch(`/api/catalog/options${sp.toString() ? `?${sp}` : ""}`)
      .then((r) => r.json())
      .then((json) => {
        setCatalogOptions(Array.isArray(json?.options) ? json.options : []);
        setExteriorColors(Array.isArray(json?.exteriorColors) ? json.exteriorColors : []);
        setInteriorColors(Array.isArray(json?.interiorColors) ? json.interiorColors : []);
      })
      .catch(() => {
        setCatalogOptions([]);
        setExteriorColors([]);
        setInteriorColors([]);
      });
  }, [filters.make, filters.model, filters.trim]);

  const runFilterSearch = useCallback(async (f: Filters, offset = 0) => {
    setSearchLoading(true);
    setSearchError(null);
    try {
      const qs = filtersToQueryString(f, { limit: RESULTS_PAGE_SIZE, offset });
      const res = await fetch(`/api/vehicles/search${qs ? `?${qs}` : ""}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        setSearchError(typeof json?.error === "string" ? json.error : "Could not search inventory.");
        if (offset === 0) setResults(null);
        return;
      }
      setResults((prev) =>
        offset > 0 && prev
          ? { ...json, vehicles: [...prev.vehicles, ...json.vehicles] }
          : json
      );
    } catch {
      setSearchError("Could not reach the search service.");
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleFilterSearch = useCallback(() => {
    setAiAvailable(null);
    setAiMessage(null);
    setClarifications([]);
    setDisplayChips([]);
    void runFilterSearch(filters, 0);
  }, [filters, runFilterSearch]);

  const handleAiSearch = useCallback(async () => {
    const q = nlQuery.trim();
    if (!q) return;
    setAiLoading(true);
    setSearchError(null);
    setAiMessage(null);
    try {
      const res = await fetch("/api/search/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, zip: filters.zip || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        setSearchError(typeof json?.error === "string" ? json.error : "AI search failed.");
        return;
      }
      if (json.available === false) {
        setAiAvailable(false);
        setAiMessage(typeof json.message === "string" ? json.message : "AI search is not configured.");
        return;
      }
      setAiAvailable(true);
      setClarifications(Array.isArray(json.clarifications) ? json.clarifications : []);
      setDisplayChips(Array.isArray(json.displayChips) ? json.displayChips : []);
      const pf = json.filters || {};
      const nextFilters: Filters = {
        make: pf.make || "",
        model: pf.model || "",
        trim: pf.trim || "",
        priceMin: pf.priceMin != null ? String(pf.priceMin) : "",
        priceMax: pf.priceMax != null ? String(pf.priceMax) : "",
        yearMin: pf.yearMin != null ? String(pf.yearMin) : "",
        yearMax: pf.yearMax != null ? String(pf.yearMax) : "",
        odometerMax: pf.odometerMax != null ? String(pf.odometerMax) : "",
        minDays: pf.minDays != null ? String(pf.minDays) : "",
        maxDays: pf.maxDays != null ? String(pf.maxDays) : "",
        exteriorColor: pf.exteriorColor || "",
        interiorColor: pf.interiorColor || "",
        optionKeys: Array.isArray(pf.optionKeys) ? pf.optionKeys : [],
        possibleDemo: !!pf.possibleDemo,
        zip: pf.zip || filters.zip || "",
        radiusMiles: pf.radiusMiles != null ? String(pf.radiusMiles) : "",
        sort: "",
      };
      setFilters(nextFilters);
      setResults(json.results || null);
    } catch {
      setSearchError("Could not reach the AI search service.");
    } finally {
      setAiLoading(false);
    }
  }, [nlQuery, filters.zip]);

  // Editing a chip (removing that one filter) only re-runs the deterministic search — never a
  // second Gemini call, per this series' scope.
  const clearFilterField = useCallback(
    (field: keyof Filters) => {
      const next: Filters = { ...filters, [field]: field === "optionKeys" ? [] : field === "possibleDemo" ? false : "" };
      setFilters(next);
      setDisplayChips((chips) => chips.filter((c) => c.field !== field));
      void runFilterSearch(next, 0);
    },
    [filters, runFilterSearch]
  );

  const toggleOptionKey = (key: string) => {
    setFilters((f) => ({
      ...f,
      optionKeys: f.optionKeys.includes(key) ? f.optionKeys.filter((k) => k !== key) : [...f.optionKeys, key],
    }));
  };

  const loadMore = () => {
    if (!results) return;
    void runFilterSearch(filters, results.offset + results.vehicles.length);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Search real dealer inventory</h1>
      </div>

      {/* NL search box */}
      <div className="mb-6 rounded-2xl border border-border bg-surface p-4 shadow-lg sm:p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-400">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Search with AI</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAiSearch()}
            placeholder="e.g. black 4Runner under 40k with a moonroof near 07601"
            className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAiSearch}
            disabled={aiLoading || !nlQuery.trim()}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span>Search with AI</span>
          </button>
        </div>
        {aiAvailable === false && aiMessage && (
          <p className="mt-2 text-xs text-ink-faint">{aiMessage}</p>
        )}
        {clarifications.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-300/90">
            {clarifications.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        )}
        {displayChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {displayChips.map((chip) => (
              <span
                key={chip.field}
                className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={() => clearFilterField(chip.field as keyof Filters)}
                  aria-label={`Remove ${chip.label}`}
                  className="text-emerald-400/70 hover:text-emerald-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Generic filter panel — always usable, works with zero AI */}
        <aside className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-lg lg:sticky lg:top-20 lg:self-start">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Make</label>
            <select
              value={filters.make}
              onChange={(e) => setFilters((f) => ({ ...f, make: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white focus:border-emerald-500/60 focus:outline-none"
            >
              <option value="">Any make</option>
              {makes.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Model</label>
              <input
                type="text"
                value={filters.model}
                onChange={(e) => setFilters((f) => ({ ...f, model: e.target.value }))}
                placeholder="Any"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Trim</label>
              <input
                type="text"
                value={filters.trim}
                onChange={(e) => setFilters((f) => ({ ...f, trim: e.target.value }))}
                placeholder="Any"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Price min</label>
              <input
                type="number"
                value={filters.priceMin}
                onChange={(e) => setFilters((f) => ({ ...f, priceMin: e.target.value }))}
                placeholder="$0"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Price max</label>
              <input
                type="number"
                value={filters.priceMax}
                onChange={(e) => setFilters((f) => ({ ...f, priceMax: e.target.value }))}
                placeholder="No max"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Year min</label>
              <input
                type="number"
                value={filters.yearMin}
                onChange={(e) => setFilters((f) => ({ ...f, yearMin: e.target.value }))}
                placeholder="Any"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Year max</label>
              <input
                type="number"
                value={filters.yearMax}
                onChange={(e) => setFilters((f) => ({ ...f, yearMax: e.target.value }))}
                placeholder="Any"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Max odometer</label>
            <input
              type="number"
              value={filters.odometerMax}
              onChange={(e) => setFilters((f) => ({ ...f, odometerMax: e.target.value }))}
              placeholder="Any mileage"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Exterior</label>
              <select
                value={filters.exteriorColor}
                onChange={(e) => setFilters((f) => ({ ...f, exteriorColor: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white focus:border-emerald-500/60 focus:outline-none"
              >
                <option value="">Any</option>
                {exteriorColors.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Interior</label>
              <select
                value={filters.interiorColor}
                onChange={(e) => setFilters((f) => ({ ...f, interiorColor: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white focus:border-emerald-500/60 focus:outline-none"
              >
                <option value="">Any</option>
                {interiorColors.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {catalogOptions.length > 0 && (
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Must-have options</label>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {catalogOptions.map((o) => (
                  <label key={o.key} className="flex items-center gap-2 text-xs text-ink-light">
                    <input
                      type="checkbox"
                      checked={filters.optionKeys.includes(o.key)}
                      onChange={() => toggleOptionKey(o.key)}
                      className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
                    />
                    <span className="flex-1 truncate">{o.label}</span>
                    <span className="text-ink-faint">{o.vehicleCount}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-ink-light">
            <input
              type="checkbox"
              checked={filters.possibleDemo}
              onChange={(e) => setFilters((f) => ({ ...f, possibleDemo: e.target.checked }))}
              className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
            />
            Include likely demo/loaner vehicles
          </label>

          <div className="border-t border-border pt-3">
            <label className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              <MapPin className="h-3 w-3" /> Near
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={filters.zip}
                onChange={(e) => setFilters((f) => ({ ...f, zip: e.target.value }))}
                placeholder="ZIP code"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none"
              />
              <input
                type="number"
                value={filters.radiusMiles}
                onChange={(e) => setFilters((f) => ({ ...f, radiusMiles: e.target.value }))}
                placeholder="Radius (mi)"
                disabled={!filters.make || !filters.zip}
                title={!filters.zip ? "Enter a ZIP code to search within a radius" : !filters.make ? "Pick a make to search within a radius" : undefined}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-emerald-500/60 focus:outline-none disabled:opacity-40"
              />
            </div>
            {filters.radiusMiles && (!filters.make || !filters.zip) && (
              <p className="mt-1 text-[11px] text-ink-faint">
                {!filters.zip ? "Enter a ZIP code" : "Pick a make"} to search within a distance.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">Sort</label>
            <select
              value={filters.sort}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white focus:border-emerald-500/60 focus:outline-none"
            >
              <option value="">Best match</option>
              <option value="price:asc">Price: low to high</option>
              <option value="price:desc">Price: high to low</option>
              <option value="mileage:asc">Mileage: low to high</option>
              <option value="days:asc">Newest to lot</option>
              {filters.zip && <option value="distance">Distance</option>}
            </select>
          </div>

          <button
            type="button"
            onClick={handleFilterSearch}
            disabled={searchLoading}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-xs font-extrabold text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            <span>Search</span>
          </button>
        </aside>

        {/* Shared results */}
        <div>
          {searchError && (
            <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{searchError}</div>
          )}

          {!results && !searchLoading && !searchError && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-16 text-center text-sm text-ink-faint">
              Use the AI search or the filters to see real, in-stock vehicles.
            </div>
          )}

          {results && (
            <>
              <p className="mb-3 text-xs font-semibold text-ink-muted">{results.total.toLocaleString()} vehicle{results.total === 1 ? "" : "s"} found</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {results.vehicles.map((v) => (
                  <VehicleCard key={`${v.vin}-${v.dealerName}`} vehicle={v} />
                ))}
              </div>
              {results.vehicles.length < results.total && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={searchLoading}
                    className="rounded-xl border border-border bg-surface-elevated px-5 py-2.5 text-xs font-bold text-ink-light hover:border-emerald-500/50 hover:text-white disabled:opacity-50"
                  >
                    {searchLoading ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
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
              className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-bold text-ink-light hover:border-emerald-500/50 hover:text-white"
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
