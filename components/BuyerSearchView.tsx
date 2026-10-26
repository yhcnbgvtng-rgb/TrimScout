"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { NO_PAID_FACTORY_OPTIONS, optionPriceText, optionsPaidOnlyEnabled } from "@/lib/optionsPaidOnly";
import type { DropdownOption } from "./search/SearchableDropdown";
import { ResultCards, ResultsGrid } from "./search/ResultsGrid";
import { FilterSheet, GridToolbar } from "./search/GridToolbar";
import type { ColumnPanel, ListRow } from "./search/ColumnFilterPanel";
import { useBuyerSearchState } from "./search/useBuyerSearchState";
import { MAX_PICKS, type PickedVehicle } from "@/lib/buyerPicks";
import { SORT_TIMEOUT_NOTE, nextSort, parseSort, sortBlockedReason, type SortableColumn } from "@/lib/buyerSort";
import { writeQuoteSeed } from "@/lib/quoteSeed";
import { contactFilterEnabled } from "@/lib/contactFilterFlag";
import { useRouter } from "next/navigation";
import { facetCount, hasNonFacetFilter, isExcluded, needsServerCount, parseExclude } from "@/lib/searchLive";
import type { FacetCountsResult, PriceHistogram } from "@/lib/inventoryApi";
import { DRIVETRAIN_CHOICES, FUEL_CHOICES, TRANSMISSION_CHOICES, vinPatternUsable, cleanVinPattern, type FilterChoice } from "@/lib/searchFilters";
import { filtersFromSearchParams, urlWithFilters, urlWithParam } from "@/lib/searchUrlState";
import { PRICE_SLIDER } from "@/lib/searchLive";
import { buildPills, columnActive, columnOf, columnSent, GRID_COLUMNS, visibleColumnsFromParam, visibleColumnsToParam, type GridColumnKey, type Pill } from "@/lib/searchGrid";
import type { LiveCountProps } from "./search/LiveCount";

interface BuyerVehicle {
  vehicleId?: number | null;
  vin: string;
  dealerId?: string | null;
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
  daysOnLot: number | null;
  priceDiff: number | null;
  distanceMiles: number | null;
  dealerHasContact?: boolean | null;
  bodyStyle?: string | null;
  engine?: string | null;
  transmission?: string | null;
  options?: Array<{ code: string | null; name: string | null; price: number | null; kind: "factory" | "dealer" }> | null;
  /** False when the car is too long unconfirmed to quote; the checkbox is disabled. */
  rfqEligible?: boolean;
}

interface SearchResults {
  total: number;
  /** True when `total` is a floor ("1,000+") — the box stopped counting at its cap. */
  totalCapped?: boolean;
  /** The Leave-out words the box applied. Absent: the box ignored them (an older box), so the page hides matching cars itself. */
  excludeApplied?: string[];
  /** The newer filter params the box honoured (odometerMin, bodyStyle, fuel, ...). Absent: an older box that ignores them. */
  filtersApplied?: string[];
  /** How many vehicles the most recent page returned — a full page is how "Load more" knows there may be another. */
  lastPageCount?: number;
  limit: number;
  offset: number;
  vehicles: BuyerVehicle[];
}

export interface CatalogOption {
  key: string;
  label: string;
  vehicleCount: number;
  minPrice?: number;
  maxPrice?: number;
}

export interface Filters {
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
  /** Only cars whose dealer has a contact on file. Lives in the page URL as contactOnFile=1. */
  contactOnFile: boolean;
  zip: string;
  radiusMiles: string;
  sort: string;
  /** "Leave out" words (comma separated). Sent to the box as exclude= (it only counts them with a make); an older box ignores them and the page hides matching cars itself. */
  exclude: string;
  odometerMin: string;
  /** The "More filters" lists: dealer body-style words, inferred fuel / drivetrain, grouped transmission, the box's store ids. */
  bodyStyle: string[];
  fuel: string[];
  drivetrain: string[];
  transmission: string[];
  dealerIds: string[];
  /** Days on market, inclusive whole-day bounds. */
  daysMin: string;
  daysMax: string;
  /** A VIN pattern with ? and * (lib/searchFilters.ts). */
  vinPattern: string;
}

const EMPTY_FILTERS: Filters = {
  state: "", make: "", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "",
  exteriorColor: "", interiorColor: "", optionKeys: [],
  possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "",
  odometerMin: "", bodyStyle: [], fuel: [], drivetrain: [], transmission: [], dealerIds: [], daysMin: "", daysMax: "", vinPattern: "",
};

export function filtersToQueryString(f: Filters, extra: { limit?: number; offset?: number } = {}): string {
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
  if (f.odometerMin) sp.set("odometerMin", f.odometerMin);
  for (const v of f.bodyStyle) sp.append("bodyStyle", v);
  for (const v of f.fuel) sp.append("fuel", v);
  for (const v of f.drivetrain) sp.append("drivetrain", v);
  for (const v of f.transmission) sp.append("transmission", v);
  for (const v of f.dealerIds) sp.append("dealerId", v);
  if (f.daysMin) sp.set("minDays", f.daysMin);
  if (f.daysMax) sp.set("maxDays", f.daysMax);
  if (f.make && vinPatternUsable(f.vinPattern, true)) sp.set("vinPattern", cleanVinPattern(f.vinPattern));
  if (f.exteriorColor) sp.set("exteriorColor", f.exteriorColor);
  if (f.interiorColor) sp.set("interiorColor", f.interiorColor);
  if (f.optionKeys.length) sp.set("optionKeys", f.optionKeys.join(","));
  if (f.possibleDemo) sp.set("possibleDemo", "1");
  if (f.contactOnFile) sp.set("contactOnFile", "1");
  // "Leave out" words go to the box as repeated exclude= params (it only honours them with a make); an older box ignores them and the page falls back to hiding cars it already has.
  if (f.make) for (const w of parseExclude(f.exclude)) sp.append("exclude", w);
  if (f.zip) sp.set("zip", f.zip);
  if (f.radiusMiles && f.make && f.zip) sp.set("radiusMiles", f.radiusMiles);
  if (f.sort) {
    sp.set("sort", f.sort);
    // Blank values after every real value in both directions (see lib/buyerSort.ts). Not sent without a sort: the default order's plan is tuned and must not change.
    if (parseSort(f.sort)?.key !== "distance") sp.set("nullsLast", "1");
  }
  if (extra.limit) sp.set("limit", String(extra.limit));
  if (extra.offset) sp.set("offset", String(extra.offset));
  return sp.toString();
}

export interface CatalogExtras {
  exteriorColorCounts?: Array<{ color: string; n: number }>;
  interiorColorCounts?: Array<{ color: string; n: number }>;
  conditionCounts?: { new: number; used: number; cpo: number };
  priceHistogram?: PriceHistogram;
}

/** The filter params only a patched box honours; it lists the ones it applied in `filtersApplied`, so a missing one means "this filter did nothing". */
const NEWER_FILTER_KEYS = ["odometerMin", "bodyStyle", "fuel", "drivetrain", "transmission", "dealerId", "vinPattern"] as const;
const FILTER_LABEL: Record<string, string> = { odometerMin: "Minimum mileage", bodyStyle: "Body style", fuel: "Fuel type", drivetrain: "Drivetrain", transmission: "Transmission", dealerId: "Dealer", vinPattern: "VIN pattern" };
/** Which of the newer filters a query string asks for that the box did not apply. */
export function unappliedFilters(qs: string, applied: string[] | undefined): string[] {
  const asked = new URLSearchParams(qs);
  return NEWER_FILTER_KEYS.filter((k) => asked.has(k) && !applied?.includes(k));
}

const RESULTS_PAGE_SIZE = 24;
const COUNT_DEBOUNCE_MS = 250;
const APPLY_DEBOUNCE_MS = 300;

/**
 * Why Search is disabled, or null when it can run. Mirrors the server's gates
 * (lib/buyerSearchQuery.ts) so a shopper is told what to pick instead of getting a 400 — a search
 * with no make is an unbounded scan of the whole inventory, and factory options need a model.
 */
function searchBlockedReason(f: Filters): string | null {
  if (!f.make) return "Pick a make to search.";
  if (f.optionKeys.length > 0 && !f.model) return "Pick a model to filter by factory options.";
  return null;
}

function toOptions<T>(rows: T[], valueKey: keyof T, countKey: keyof T, labelFor?: (r: T) => string): DropdownOption[] {
  return rows.map((r) => ({
    value: String(r[valueKey]),
    label: labelFor ? labelFor(r) : String(r[valueKey]),
    count: Number(r[countKey]) || 0,
  }));
}

export function BuyerSearchView() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // The page URL carries every filter (make=Toyota&model=RAV4&priceMax=40000 ...), so a search can be shared and survives a reload.
  // A link with a make runs its search on arrival. `urlReady` keeps the write-back from wiping the URL before it has been read.
  const urlReady = useRef(false);
  useEffect(() => {
    try {
      const parsed = filtersFromSearchParams(new URLSearchParams(window.location.search), EMPTY_FILTERS);
      if (!contactFilterEnabled()) parsed.contactOnFile = false;
      if (JSON.stringify(parsed) !== JSON.stringify(EMPTY_FILTERS)) {
        setFilters(parsed);
        if (parsed.make) setApplied({ ...parsed });
      }
    } catch { /* no URL access: the page just starts empty */ }
  }, []);
  useEffect(() => {
    // Not before the first real change (or the parsed URL landing): the first run sees the empty defaults and must not erase the link.
    if (!urlReady.current) { if (filters === EMPTY_FILTERS) return; urlReady.current = true; }
    try {
      const next = urlWithFilters(window.location.href, filters);
      if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
    } catch { /* ignore */ }
  }, [filters]);
  const picksState = useBuyerSearchState();
  const viewedSet = useMemo(() => new Set(picksState.viewed), [picksState.viewed]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Columns turned on or off (relative to the defaults), kept in the page URL as cols=-year,+vin.
  const [visibleCols, setVisibleCols] = useState<GridColumnKey[]>(() => visibleColumnsFromParam(null));
  const colsReady = useRef(false);
  useEffect(() => {
    try { setVisibleCols(visibleColumnsFromParam(new URLSearchParams(window.location.search).get("cols"))); } catch { /* defaults */ }
    colsReady.current = true;
  }, []);
  const changeVisibleCols = (next: GridColumnKey[]) => {
    setVisibleCols(next);
    try {
      const url = urlWithParam(window.location.href, "cols", visibleColumnsToParam(next));
      if (url !== window.location.href) window.history.replaceState(window.history.state, "", url);
    } catch { /* ignore */ }
  };
  // Phone layout below Tailwind's md breakpoint. Desktop until the browser says otherwise, so the server render matches.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const [stateOptions, setStateOptions] = useState<DropdownOption[]>([]);
  const [makeOptions, setMakeOptions] = useState<DropdownOption[]>([]);
  const [modelOptions, setModelOptions] = useState<DropdownOption[]>([]);
  const [trimOptions, setTrimOptions] = useState<DropdownOption[]>([]);
  const [facetsLoading, setFacetsLoading] = useState(false);
  // The last facet refresh failed: the numbers on screen are for an earlier pick, so they are hidden, not shown stale.
  const [facetsFailed, setFacetsFailed] = useState(false);

  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [exteriorColors, setExteriorColors] = useState<string[]>([]);
  const [interiorColors, setInteriorColors] = useState<string[]>([]);
  // Per-colour / per-condition counts and the price histogram for the picked make/model/trim. Absent when the box does not send them (the chips then show no number).
  const [catalogExtras, setCatalogExtras] = useState<CatalogExtras>({});
  const [catalogOptionsLoading, setCatalogOptionsLoading] = useState(false);
  const [catalogOptionsFailed, setCatalogOptionsFailed] = useState(false);

  // `filters` is the draft the shopper is editing; `applied` is what the last Search actually ran.
  // Nothing fires on a filter change — only Search (or Enter in a field) commits the draft, so a
  // burst of clicks or keystrokes can never turn into a burst of expensive box queries.
  const [applied, setApplied] = useState<Filters | null>(null);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  // A failed "next page" fetch: the rows already on screen stay, a retry row shows, and nothing auto-retries.
  const [moreError, setMoreError] = useState(false);
  const pageInFlightRef = useRef(false); // set synchronously, so two sentinel hits in one tick can't both fetch
  const [searchError, setSearchError] = useState<string | null>(null);
  // A header sort that could not be applied (too slow for this many vehicles) or is not offered yet — shown above the table.
  const [sortNote, setSortNote] = useState<string | null>(null);
  // The sort a header click is waiting on: if its request fails the previous sort comes back and the old results stay on screen.
  const sortAttemptRef = useRef<{ prev: string; label: string } | null>(null);

  // State + Make counts, cross-scoped by each other — always fetched (they're always visible).
  // Model/trim counts ride along on the same call whenever make/model are set; the box only
  // computes what it can scope (see lib/inventoryApi.ts's inventoryFacets).
  useEffect(() => {
    const controller = new AbortController();
    // Counts are pending the instant a pick changes them — the old numbers are hidden until the new ones arrive.
    setFacetsLoading(true);
    const sp = new URLSearchParams();
    if (filters.state) sp.set("state", filters.state);
    if (filters.make) sp.set("make", filters.make);
    if (filters.model) sp.set("model", filters.model);
    if (filters.contactOnFile) sp.set("contactOnFile", "1");
    fetch(`/api/catalog/facets?${sp}`, { signal: controller.signal })
      .then((r) => {
        // An error body ({error}) used to be read as "no states/makes/…" and blank every list.
        if (!r.ok) throw new Error(`facets ${r.status}`);
        return r.json();
      })
      .then((json) => {
        setFacetsFailed(false);
        setStateOptions(toOptions(json?.states || [], "state", "n"));
        setMakeOptions(toOptions(json?.makes || [], "make", "n"));
        setModelOptions(toOptions(json?.models || [], "model", "n"));
        setTrimOptions(toOptions(json?.trims || [], "trim", "n"));
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        // Keep the choices (never wipe the dropdowns mid-selection) but stop showing their counts: they belong to the
        // previous pick. The next pick retries.
        setFacetsFailed(true);
      })
      .finally(() => setFacetsLoading(false));
    return () => controller.abort();
  }, [filters.state, filters.make, filters.model, filters.contactOnFile]);

  // Factory options + colors, scoped to make/model/trim — unchanged from the pre-redesign panel.
  useEffect(() => {
    const controller = new AbortController();
    const sp = new URLSearchParams();
    if (filters.make) sp.set("make", filters.make);
    if (filters.model) sp.set("model", filters.model);
    if (filters.trim) sp.set("trim", filters.trim);
    setCatalogOptionsLoading(true);
    setCatalogOptionsFailed(false);
    fetch(`/api/catalog/options${sp.toString() ? `?${sp}` : ""}`, { signal: controller.signal })
      .then(async (r) => {
        // A timeout/503 must not be shown as "no factory options" — that claims the data doesn't
        // exist when it just didn't load (confirmed live 2026-09-28 for Ford F-150 and Toyota RAV4).
        if (!r.ok) throw new Error(`options ${r.status}`);
        return r.json();
      })
      .then((json) => {
        setCatalogOptions(Array.isArray(json?.options) ? json.options : []);
        setExteriorColors(Array.isArray(json?.exteriorColors) ? json.exteriorColors : []);
        setInteriorColors(Array.isArray(json?.interiorColors) ? json.interiorColors : []);
        setCatalogExtras({
          exteriorColorCounts: Array.isArray(json?.exteriorColorCounts) ? json.exteriorColorCounts : undefined,
          interiorColorCounts: Array.isArray(json?.interiorColorCounts) ? json.interiorColorCounts : undefined,
          conditionCounts: json?.conditionCounts && typeof json.conditionCounts === "object" ? json.conditionCounts : undefined,
          priceHistogram: Array.isArray(json?.priceHistogram?.all) && json.priceHistogram.all.length === 31 ? json.priceHistogram : undefined,
        });
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setCatalogOptionsFailed(true);
        setCatalogOptions([]);
        setExteriorColors([]);
        setInteriorColors([]);
        setCatalogExtras({});
      })
      .finally(() => setCatalogOptionsLoading(false));
    return () => controller.abort();
  }, [filters.make, filters.model, filters.trim]);

  // Counts for the "More filters" chips (year, mileage, body style, fuel, drivetrain, transmission, days on market, dealer). One request, 250 ms after the
  // last change, the previous one aborted, each answer remembered per query. Needs a make (the same gate as the search) and never runs with the
  // contact filter on (the box cannot count that set). A box without the endpoint answers supported:false and the groups stay hidden.
  const fcQs = useMemo(() => {
    if (!filters.make || filters.contactOnFile) return "";
    const qs = new URLSearchParams(filtersToQueryString({ ...filters, sort: "" }));
    return qs.toString();
  }, [filters]);
  const fcCache = useRef(new Map<string, FacetCountsResult>());
  const [facetCountsState, setFacetCountsState] = useState<{ qs: string; make: string; result: FacetCountsResult } | null>(null);
  const [facetCountsFailed, setFacetCountsFailed] = useState(false);
  useEffect(() => {
    if (!fcQs) { setFacetCountsState(null); setFacetCountsFailed(false); return; }
    const hit = fcCache.current.get(fcQs);
    if (hit) { setFacetCountsState({ qs: fcQs, make: filters.make, result: hit }); setFacetCountsFailed(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/vehicles/facet-counts?${fcQs}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`facet-counts ${r.status}`))))
        .then((json: FacetCountsResult) => {
          if (!json || typeof json !== "object" || typeof (json as { supported?: unknown }).supported !== "boolean") throw new Error("facet-counts shape");
          fcCache.current.set(fcQs, json);
          setFacetCountsState({ qs: fcQs, make: filters.make, result: json });
          setFacetCountsFailed(false);
        })
        .catch((e) => { if (e?.name !== "AbortError") setFacetCountsFailed(true); });
    }, COUNT_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fcQs, filters.make]);

  // Clearing make clears model/trim/options; clearing model clears trim/options — the box has
  // nothing to scope them by otherwise, and stale selections from a different make/model would
  // silently narrow a search the shopper never asked for.
  const setMake = (make: string) => setFilters((f) => ({ ...f, make, model: "", trim: "", optionKeys: [] }));
  const setModel = (model: string) => setFilters((f) => ({ ...f, model, trim: "", optionKeys: [] }));

  // The one AbortController for search requests: starting a new search (or page) cancels whatever
  // is still in flight, and requestId guards against a cancelled response that lands anyway.
  const runSearchRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const runSearch = useCallback(async (f: Filters, offset: number) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const signal = controller.signal;
    const requestId = ++runSearchRef.current;
    setSearchLoading(true);
    pageInFlightRef.current = offset > 0;
    setMoreError(false);
    if (offset === 0) setSearchError(null);
    try {
      const qs = filtersToQueryString(f, { limit: RESULTS_PAGE_SIZE, offset });
      const res = await fetch(`/api/vehicles/search${qs ? `?${qs}` : ""}`, { signal });
      if (requestId !== runSearchRef.current) return; // a newer request has since superseded this one
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        const attempt = sortAttemptRef.current;
        if (attempt && offset === 0) {
          // A header sort that failed or timed out: put the previous sort back, keep the results on screen, say why.
          sortAttemptRef.current = null;
          setFilters((fl) => ({ ...fl, sort: attempt.prev }));
          setApplied((a) => (a ? { ...a, sort: attempt.prev } : a));
          setSortNote(SORT_TIMEOUT_NOTE(attempt.label));
          setSearchError(null);
          return;
        }
        if (offset > 0) { setMoreError(true); return; }
        setSearchError(typeof json?.error === "string" ? json.error : "Could not search inventory.");
        setResults(null);
        return;
      }
      sortAttemptRef.current = null;
      setSearchError(null);
      const lastPageCount = Array.isArray(json.vehicles) ? json.vehicles.length : 0;
      setResults((prev) => (offset > 0 && prev ? { ...json, lastPageCount, vehicles: [...prev.vehicles, ...json.vehicles] } : { ...json, lastPageCount }));
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (requestId !== runSearchRef.current) return;
      const attempt = sortAttemptRef.current;
      if (attempt && offset === 0) {
        sortAttemptRef.current = null;
        setFilters((fl) => ({ ...fl, sort: attempt.prev }));
        setApplied((a) => (a ? { ...a, sort: attempt.prev } : a));
        setSortNote(SORT_TIMEOUT_NOTE(attempt.label));
        return;
      }
      if (offset > 0) { setMoreError(true); return; }
      setSearchError("Could not reach the search service.");
      setResults(null);
    } finally {
      if (requestId === runSearchRef.current) { setSearchLoading(false); pageInFlightRef.current = false; }
    }
  }, []);

  // Runs the search for whatever Search last committed. Unmount cancels anything in flight.
  useEffect(() => {
    if (!applied) return;
    void runSearch(applied, 0);
  }, [applied, runSearch]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const blockedReason = searchBlockedReason(filters);
  // Every filter change searches by itself: the draft becomes the applied search 300 ms after the last change (a burst of clicks is one request,
  // the previous one aborted). No make = nothing to search; the headline count and the column lists still work from the facets.
  useEffect(() => {
    if (blockedReason) { setApplied(null); setResults(null); setSearchError(null); return; }
    const t = setTimeout(() => {
      setSortNote(null);
      setApplied((prev) => (prev && JSON.stringify(prev) === JSON.stringify(filters) ? prev : { ...filters }));
    }, APPLY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filters, blockedReason]);
  // Filters edited since the last request went out — the rows on screen are about to be replaced.
  const dirty = applied !== null && JSON.stringify(applied) !== JSON.stringify(filters);

  // Clicking a column header: ascending, then descending, then cleared. It re-runs the search already on screen (the applied filters,
  // not unapplied edits in the panel) with the new sort, and the server orders the WHOLE result set. One click = one request: clicks
  // are ignored while a search is loading, so a burst cannot become a burst of box queries.
  const onSort = (column: SortableColumn) => {
    if (!applied || searchLoading) return;
    const label = GRID_COLUMNS.find((c) => c.sort === column)?.label || column;
    const next = nextSort(applied.sort, column);
    if (next) {
      const why = sortBlockedReason(column, Boolean(applied.model), label);
      if (why) { setSortNote(why); return; }
    }
    setSortNote(null);
    sortAttemptRef.current = next ? { prev: applied.sort, label } : null; // clearing back to the default order never needs a revert
    setFilters((f) => ({ ...f, sort: next }));
    setApplied((a) => (a ? { ...a, sort: next } : a));
  };

  const toggleOptionKey = (key: string) => {
    setFilters((f) => ({ ...f, optionKeys: f.optionKeys.includes(key) ? f.optionKeys.filter((k) => k !== key) : [...f.optionKeys, key] }));
  };

  // Infinite scroll: one page at a time, never while another request (page or search) is running.
  const loadMore = useCallback(() => {
    if (!results || !applied || searchLoading || pageInFlightRef.current) return;
    pageInFlightRef.current = true;
    void runSearch(applied, results.vehicles.length);
  }, [results, applied, searchLoading, runSearch]);
  // A capped total is a floor, so "more" is known only from the last page having been full.
  const hasMore = results ? (results.totalCapped ? (results.lastPageCount ?? 0) >= RESULTS_PAGE_SIZE : results.vehicles.length < results.total) : false;

  // "Clear all": every filter back to empty. The header sort is kept (it is not a filter), except a Distance sort, which goes with the ZIP.
  const clearAll = () => setFilters((f) => ({ ...EMPTY_FILTERS, sort: parseSort(f.sort)?.key === "distance" ? "" : f.sort }));

  // Counts are hidden while the facet request is in flight or has failed, so a stale number is never shown (#389).
  const countsHidden = facetsLoading || facetsFailed;
  const shownCounts = (opts: DropdownOption[]) => (countsHidden ? opts.map((o) => ({ ...o, count: undefined })) : opts);

  const paidOnly = optionsPaidOnlyEnabled();

  // ---- headline count ----
  // From the facet lists when they can answer (state/make/model/trim are exact and free). Only when a filter the lists cannot see is set
  // (condition, price, year, mileage, colour, options, demo, radius) and a make is picked does it ask the box: one limit=1 search, 250 ms
  // after the last change, the previous one aborted, and each answer remembered so toggling back is instant.
  const serverMode = needsServerCount(filters);
  const countQs = useMemo(() => (serverMode ? filtersToQueryString({ ...filters, sort: "" }, { limit: 1 }) : ""), [serverMode, filters]);
  const countCache = useRef(new Map<string, { total: number; capped: boolean; excl: boolean; fa?: string[] }>());
  const [serverCount, setServerCount] = useState<{ qs: string; total: number; capped: boolean; excl: boolean; fa?: string[] } | null>(null);
  const [serverCountFailed, setServerCountFailed] = useState(false);
  useEffect(() => {
    if (!countQs) return;
    const hit = countCache.current.get(countQs);
    if (hit) { setServerCount({ qs: countQs, ...hit }); setServerCountFailed(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const late = countCache.current.get(countQs); // the search itself may have answered while this waited
      if (late) { setServerCount({ qs: countQs, ...late }); setServerCountFailed(false); return; }
      fetch(`/api/vehicles/search?${countQs}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`count ${r.status}`))))
        .then((json) => {
          if (typeof json?.total !== "number") throw new Error("count shape");
          const entry = { total: json.total, capped: Boolean(json.totalCapped), excl: Array.isArray(json.excludeApplied) && json.excludeApplied.length > 0, fa: Array.isArray(json.filtersApplied) ? json.filtersApplied : undefined };
          countCache.current.set(countQs, entry);
          setServerCount({ qs: countQs, ...entry });
          setServerCountFailed(false);
        })
        .catch((e) => { if (e?.name !== "AbortError") setServerCountFailed(true); });
    }, COUNT_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [countQs]);
  // The search that just ran already knows its own total: remember it so the matching count request never goes to the box.
  useEffect(() => {
    if (!results || !applied || results.offset !== 0) return;
    const key = filtersToQueryString({ ...applied, sort: "" }, { limit: 1 });
    countCache.current.set(key, { total: results.total, capped: Boolean(results.totalCapped), excl: Boolean(results.excludeApplied?.length), fa: results.filtersApplied });
  }, [results, applied]);
  const facetLists = useMemo(() => {
    const rows = (o: DropdownOption[]) => o.map((x) => ({ value: x.value, count: x.count ?? 0 }));
    return { states: rows(stateOptions), makes: rows(makeOptions), models: rows(modelOptions), trims: rows(trimOptions) };
  }, [stateOptions, makeOptions, modelOptions, trimOptions]);
  const lastShown = useRef<{ value: number; capped: boolean } | null>(null);
  const live: LiveCountProps = (() => {
    let value: number | null = null, capped = false, pending = false, note: string | null = null;
    if (serverMode) {
      const fresh = serverCount && serverCount.qs === countQs ? serverCount : null;
      value = fresh ? fresh.total : lastShown.current?.value ?? null;
      capped = fresh ? fresh.capped : lastShown.current?.capped ?? false;
      pending = !fresh && !serverCountFailed;
      if (serverCountFailed && !fresh) note = "Couldn't refresh the count just now.";
      else if (fresh && unappliedFilters(countQs, fresh.fa).length) note = `${unappliedFilters(countQs, fresh.fa).map((k) => FILTER_LABEL[k]).join(", ")} can't be applied by the search service yet, so ${unappliedFilters(countQs, fresh.fa).length === 1 ? "it isn't" : "they aren't"} counted.`;
      else if (fresh && parseExclude(filters.exclude).length && !fresh.excl) note = "Leave-out words are not counted yet; they hide cars once results are shown.";
      else if (filters.zip && filters.radiusMiles) note = "Distance isn't counted: dealer locations are only known by state, so it trims the cars on screen, not this number.";
    } else {
      const fc = countsHidden ? null : facetCount(filters, facetLists);
      value = fc ?? lastShown.current?.value ?? null;
      pending = fc == null && (facetsLoading || value != null);
      if (facetsFailed && fc == null) note = "Couldn't refresh the count just now.";
      else if (hasNonFacetFilter(filters) && !filters.make) note = "Counts for these filters start once you pick a make.";
      else if (filters.optionKeys.length && !filters.model) note = "Pick a model to count factory options.";
    }
    if (value != null && !pending) lastShown.current = { value, capped };
    return { value, capped, pending, note };
  })();
  const excludeTerms = useMemo(() => parseExclude(filters.exclude), [filters.exclude]);
  const shownVehicles = useMemo(() => (results && excludeTerms.length && !results.excludeApplied?.length ? results.vehicles.filter((v) => !isExcluded(v, excludeTerms)) : results?.vehicles ?? []), [results, excludeTerms]);
  const excludedHidden = results ? results.vehicles.length - shownVehicles.length : 0;
  // A shared link (or an older box) can carry filters this box does not apply: say so instead of showing unfiltered cars under a filter pill.
  const resultsUnapplied = results && applied ? unappliedFilters(filtersToQueryString(applied), results.filtersApplied) : [];

  // ---- the grid: which columns the box can serve, and each column's filter ----
  const fcResult = facetCountsState && facetCountsState.make === filters.make ? facetCountsState.result : null;
  const fcPending = Boolean(fcQs) && !(facetCountsState && facetCountsState.qs === fcQs) && !facetCountsFailed;
  // Every box that answers facet-counts also applies odometerMin and the other filter-panel params (one install), so a supported answer is the proof.
  const [panelSupported, setPanelSupported] = useState<boolean | null>(null);
  useEffect(() => { if (fcResult) setPanelSupported(fcResult.supported); }, [fcResult]);
  const dims = fcResult && fcResult.supported && !fcResult.tooBroad ? fcResult.dims : null;
  const tooBroad = Boolean(fcResult && fcResult.supported && fcResult.tooBroad);
  const needMake = "Pick a make first.";
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const rowsOf = (o: Array<Omit<DropdownOption, "count"> & { count?: number }>): ListRow[] => o.map((x) => ({ value: x.value, label: x.label, count: x.count }));
  const choiceRows = (choices: FilterChoice[], counts?: Array<{ v: string; n: number }>): ListRow[] =>
    counts ? choices.map((c) => ({ value: c.value, label: c.label, count: counts.find((x) => x.v === c.value)?.n ?? 0 })) : choices.map((c) => ({ value: c.value, label: c.label }));
  const countsRows = (rows?: Array<{ color: string; n: number }>, plain?: string[]): ListRow[] =>
    rows ? rows.map((r) => ({ value: r.color, label: r.color, count: r.n })) : (plain ?? []).map((c) => ({ value: c, label: c }));
  const currentYear = new Date().getFullYear();
  const yearTrack = dims?.year?.length ? { min: Math.min(...dims.year.map((y) => y.v)), max: Math.max(...dims.year.map((y) => y.v)), step: 1 } : { min: currentYear - 15, max: currentYear + 1, step: 1 };
  const yearHist = dims?.year?.length ? Array.from({ length: yearTrack.max - yearTrack.min + 1 }, (_, i) => dims.year!.find((y) => y.v === yearTrack.min + i)?.n ?? 0) : undefined;
  const histFor = catalogExtras.priceHistogram ? (filters.cond === "new" ? catalogExtras.priceHistogram.new : filters.cond === "used" ? catalogExtras.priceHistogram.used : filters.cond === "cpo" ? catalogExtras.priceHistogram.cpo : catalogExtras.priceHistogram.all) : undefined;
  const optionRows: ListRow[] = catalogOptions.filter((o) => typeof o.minPrice === "number" && o.minPrice > 0).map((o) => ({ value: o.key, label: o.label, hint: optionPriceText(o.minPrice, o.maxPrice), count: o.vehicleCount }));
  const paidReady = paidOnly && catalogOptions.some((o) => typeof o.minPrice === "number");
  const panels = useMemo(() => {
    const out: Partial<Record<GridColumnKey, ColumnPanel>> = {};
    const single = (key: string, rows: ListRow[], empty: string, extra: Partial<Extract<ColumnPanel, { kind: "list" }>> = {}) =>
      ({ kind: "list", single: true, rows, picked: key ? [key] : [], empty, ...extra }) as Extract<ColumnPanel, { kind: "list" }>;
    const lists = (rows: ListRow[], picked: string[], onChange: (n: string[]) => void, empty: string, extra: Partial<Extract<ColumnPanel, { kind: "list" }>> = {}) =>
      ({ kind: "list", rows, picked, onChange, empty, ...extra }) as Extract<ColumnPanel, { kind: "list" }>;
    const hide = (o: DropdownOption[]): Array<Omit<DropdownOption, "count"> & { count?: number }> => (countsHidden ? o.map((x) => ({ ...x, count: undefined })) : o);
    out.make = { ...single(filters.make, rowsOf(hide(makeOptions)), "No makes in stock.", { pending: countsHidden }), onChange: (v: string[]) => setMake(v[0] ?? "") };
    out.model = { ...single(filters.model, filters.make ? rowsOf(hide(modelOptions)) : [], filters.make ? "No models listed." : needMake, { pending: countsHidden }), onChange: (v: string[]) => setModel(v[0] ?? "") };
    out.trim = { ...single(filters.trim, filters.model ? rowsOf(hide(trimOptions)) : [], filters.model ? "No trims listed." : "Pick a model first.", { pending: countsHidden }), onChange: (v: string[]) => set({ trim: v[0] ?? "" }) };
    out.state = { ...single(filters.state, rowsOf(hide(stateOptions)), "No states.", { pending: countsHidden }), onChange: (v: string[]) => set({ state: v[0] ?? "" }) };
    out.condition = { ...single(filters.cond, choiceRows([{ value: "new", label: "New" }, { value: "used", label: "Used" }, { value: "cpo", label: "Certified" }], catalogExtras.conditionCounts ? Object.entries(catalogExtras.conditionCounts).map(([v, n]) => ({ v, n })) : undefined), "", { searchable: false, note: catalogExtras.conditionCounts ? undefined : "Counts appear once the search service sends them." }), onChange: (v: string[]) => set({ cond: v[0] ?? "" }) };
    out.ext = { ...single(filters.exteriorColor, filters.make ? countsRows(catalogExtras.exteriorColorCounts, exteriorColors) : [], filters.make ? "No colors listed." : needMake), onChange: (v: string[]) => set({ exteriorColor: v[0] ?? "" }) };
    out.int = { ...single(filters.interiorColor, filters.make ? countsRows(catalogExtras.interiorColorCounts, interiorColors) : [], filters.make ? "No colors listed." : needMake), onChange: (v: string[]) => set({ interiorColor: v[0] ?? "" }) };
    out.year = { kind: "range", min: filters.yearMin, max: filters.yearMax, onChange: (a, b) => set({ yearMin: a, yearMax: b }), track: yearTrack, unit: "year", hist: yearHist };
    out.mileage = { kind: "range", min: filters.odometerMin, max: filters.odometerMax, onChange: (a, b) => set({ odometerMin: a, odometerMax: b }), track: { min: 0, max: 150000, step: 5000 }, unit: "miles", hist: dims?.mileage?.hist, maxOnly: panelSupported !== true };
    out.price = { kind: "range", min: filters.priceMin, max: filters.priceMax, onChange: (a, b) => set({ priceMin: a, priceMax: b }), track: PRICE_SLIDER, unit: "money", hist: histFor && histFor.length === 31 ? histFor : undefined };
    out.days = { kind: "range", min: filters.daysMin, max: filters.daysMax, onChange: (a, b) => set({ daysMin: a, daysMax: b }), track: { min: 0, max: 180, step: 5 }, unit: "days" };
    if (paidReady) out.paid = lists(optionRows, filters.optionKeys, (n) => set({ optionKeys: n.slice(0, 8) }), filters.model ? (catalogOptionsFailed ? "Couldn't load factory options right now — try again in a moment." : paidOnly ? NO_PAID_FACTORY_OPTIONS : "No factory options in inventory for this make/model yet.") : "Pick a model to filter by paid options.", { pending: catalogOptionsLoading, note: filters.model ? "Paid factory options only, with the price on the sticker." : undefined });
    if (dims?.bodyStyle) out.body = lists(dims.bodyStyle.map((b) => ({ value: b.v, label: b.v, count: b.n })), filters.bodyStyle, (n) => set({ bodyStyle: n }), "No body styles.", { pending: fcPending });
    const fixed = (choices: FilterChoice[], list: Array<{ v: string; n: number }> | undefined, picked: string[], key: "fuel" | "drivetrain" | "transmission") =>
      dims && list ? lists(choiceRows(choices, list), picked, (n) => set({ [key]: n } as Partial<Filters>), "None in this set.", { pending: fcPending, searchable: false })
      : tooBroad ? lists(choiceRows(choices), picked, (n) => set({ [key]: n } as Partial<Filters>), "", { searchable: false, note: "Pick a model for a number on each choice." }) : null;
    const fuel = fixed(FUEL_CHOICES, dims?.fuel, filters.fuel, "fuel"); if (fuel) out.fuel = fuel;
    const drive = fixed(DRIVETRAIN_CHOICES, dims?.drivetrain, filters.drivetrain, "drivetrain"); if (drive) out.drive = drive;
    const trans = fixed(TRANSMISSION_CHOICES, dims?.transmission, filters.transmission, "transmission"); if (trans) out.trans = trans;
    if (dims?.dealer) out.dealer = lists(dims.dealer.map((d) => ({ value: d.id, label: d.name, count: d.n })), filters.dealerIds, (n) => set({ dealerIds: n }), "No dealers.", { pending: fcPending, note: "The dealers with the most cars in this set." });
    if (panelSupported === true) out.vin = { kind: "pattern", value: filters.vinPattern, onChange: (v: string) => set({ vinPattern: v }) };
    // Without a make nothing but Make / State can count anything (the box needs a make for every other list).
    if (!filters.make) for (const k of ["year", "mileage", "price", "days", "condition", "paid", "body", "fuel", "drive", "trans", "dealer", "vin"] as GridColumnKey[]) if (k !== "paid") delete out[k];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, makeOptions, modelOptions, trimOptions, stateOptions, countsHidden, catalogOptions, catalogExtras, exteriorColors, interiorColors, dims, tooBroad, fcPending, panelSupported, paidReady, catalogOptionsLoading, catalogOptionsFailed]);

  const rowsSent = shownVehicles;
  const available = GRID_COLUMNS.map((c) => c.key).filter((k) => columnSent(k, rowsSent) && (k !== "paid" || paidReady || rowsSent.some((r) => r.options != null)));
  const shownColumns = available.filter((k) => visibleCols.includes(k));
  const pillNames = useMemo(() => ({
    dealers: Object.fromEntries((dims?.dealer ?? []).map((d) => [d.id, d.name])),
    options: Object.fromEntries(catalogOptions.map((o) => [o.key, o.label])),
  }), [dims, catalogOptions]);
  const pills = useMemo(() => buildPills(filters, pillNames), [filters, pillNames]);
  const removePill = (pill: Pill) => setFilters((f) => pill.clear(f));
  const gridProps = {
    columns: shownColumns, rows: shownVehicles, sort: applied?.sort ?? filters.sort, onSort, sortBusy: searchLoading, panels,
    isActive: (k: GridColumnKey) => columnActive(k, filters), resetKey: applied, hasMore, loadingMore: searchLoading, moreError, onLoadMore: loadMore, dimmed: dirty,
    picks: picksState.picks, viewed: viewedSet, onTogglePick: picksState.togglePicked, onView: picksState.markViewed, showDistance: shownVehicles.some((v) => v.distanceMiles != null),
    emptyMessage: searchError ? "No results to show right now — try again, or narrow your filters." : blockedReason ? `${blockedReason} Use the Make filter in the header${isDesktop ? "" : " (Filters)"}.` : searchLoading && !results ? "Searching…" : "No vehicles match these filters — try widening them.",
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 accent-brand-500 sm:px-6 lg:px-8 [&_*:focus-visible]:outline-brand-500" style={{ paddingBottom: "calc(var(--picks-bar-h, 7rem) + 1.5rem)" }}>
      <GridToolbar
        live={live} filters={filters} pills={pills} onPill={removePill} onClearAll={clearAll} setFilters={setFilters}
        available={available} visible={shownColumns} onVisible={changeVisibleCols}
        contactFilterOn={contactFilterEnabled()} excludedHidden={excludedHidden} onOpenSheet={() => setSheetOpen(true)} blockedReason={blockedReason}
      />
      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} panels={panels} filters={filters} available={available} count={live.value} countPending={Boolean(live.pending)} onClearAll={clearAll} blockedReason={blockedReason} />

      <div>
        {searchError && <div role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{searchError}</div>}
        {resultsUnapplied.length > 0 && <p role="status" data-testid="unapplied-note" className="mb-2 text-[11px] font-semibold text-amber-300">{resultsUnapplied.map((k) => FILTER_LABEL[k]).join(", ")} can&apos;t be applied by the search service yet, so {resultsUnapplied.length === 1 ? "it was" : "they were"} left out of these results.</p>}
        {sortNote && <p role="status" data-testid="sort-note" className="mb-2 text-[11px] font-semibold text-amber-300">{sortNote}</p>}
        {isDesktop ? <ResultsGrid {...gridProps} /> : <ResultCards {...gridProps} />}
      </div>
      <PicksBar state={picksState} />
    </div>
  );
}

const pickLabel = (p: PickedVehicle) => [p.year, p.make, p.model, p.trim].filter(Boolean).join(" ") || p.vin;

/** Fixed bar at the bottom of the page: the ticked vehicles (max 3), a save control, and the limit notice. */
function PicksBar({ state }: { state: ReturnType<typeof useBuyerSearchState> }) {
  const router = useRouter();
  // Publish the bar's real height (it grows when it wraps on a phone or shows a note) as --picks-bar-h, so the page's bottom
  // padding and the results scroller can stay clear of it.
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--picks-bar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    ro?.observe(el);
    window.addEventListener("resize", publish);
    return () => { ro?.disconnect(); window.removeEventListener("resize", publish); root.style.removeProperty("--picks-bar-h"); };
  }, []);
  // Explicit click only: hand the picked VINs + listing links to step 1 of Request a quote, then open it. Nothing is sent.
  const requestQuote = () => {
    writeQuoteSeed(window.sessionStorage, state.picks);
    router.push("/?quote=1");
  };
  const { picks, limitNotice, saveStatus, dirty, signedIn, atLimit, notice, hasAnyPicks } = state;
  const status =
    saveStatus === "saving" ? "Saving…"
    : saveStatus === "saved" ? (signedIn ? "Saved to your account for 7 days" : "Saved on this device for 7 days")
    : saveStatus === "saved-local" ? "Saved on this device"
    : saveStatus === "cleared" ? "Picks cleared"
    : dirty && picks.length > 0 ? "Not saved yet" : "";
  return (
    <div ref={bar} className="fixed inset-x-0 bottom-0 z-40 border-t border-border-strong bg-surface-elevated/95 backdrop-blur" role="region" aria-label="Picked vehicles">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        {notice && (
          <p role="status" aria-live="polite" data-testid="picks-notice" className="basis-full text-[11px] font-semibold text-amber-300">{notice}</p>
        )}
        <span className="text-xs font-bold text-white tabular-nums">Picked {picks.length} of {MAX_PICKS}</span>
        {picks.length === 0 ? (
          <span className="text-xs text-ink-faint">Tick up to 3 vehicles to use in a quote. They stay here while you search again.</span>
        ) : (
          <ul className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-2">
            {picks.map((p) => (
              <li key={p.key} className="flex min-w-0 max-w-full items-center gap-1.5 sm:max-w-xs rounded-full border border-brand-500/40 bg-brand-500/10 py-1 pl-3 pr-1.5 text-[11px] text-brand-200">
                <span className="truncate" title={`${pickLabel(p)} · ${p.dealerName}${p.price != null ? ` · $${p.price.toLocaleString()}` : ""}`}>{pickLabel(p)}<span className="text-brand-300/60"> · {p.dealerName}</span>{p.price != null && <span> · ${p.price.toLocaleString()}</span>}</span>
                <button type="button" onClick={() => void state.removePick(p.key)} aria-label={`Remove ${pickLabel(p)}`} className="rounded-full p-0.5 text-brand-300/70 hover:text-white"><X className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span role="status" aria-live="polite" className={`text-[11px] ${limitNotice ? "font-semibold text-amber-300" : "text-ink-faint"}`}>
            {limitNotice ? "You can pick up to 3 vehicles. Remove one to add another." : status || (atLimit ? "3 of 3 picked" : "")}
          </span>
          <button type="button" onClick={requestQuote} disabled={picks.length === 0} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-extrabold text-black hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40">Request a quote{picks.length > 1 ? ` (${picks.length})` : ""}</button>
          <button type="button" onClick={() => void state.save()} disabled={picks.length === 0 || !dirty || saveStatus === "saving"} className="text-sm font-extrabold text-brand-400 hover:text-brand-300 disabled:cursor-not-allowed disabled:opacity-40">Save picks</button>
          <button type="button" onClick={() => void state.clearPicks()} disabled={!hasAnyPicks} className="text-sm font-bold text-ink-muted hover:text-white disabled:cursor-not-allowed disabled:opacity-40">Clear picks</button>
        </div>
      </div>
    </div>
  );
}
