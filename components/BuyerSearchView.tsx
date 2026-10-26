"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { NO_PAID_FACTORY_OPTIONS, optionsPaidOnlyEnabled } from "@/lib/optionsPaidOnly";
import type { DropdownOption } from "./search/SearchableDropdown";
import { SearchFilterBar } from "./search/SearchFilterBar";
import { useBuyerSearchState } from "./search/useBuyerSearchState";
import { MAX_PICKS, toPick, vehicleKey, type PickedVehicle } from "@/lib/buyerPicks";
import { SORT_TIMEOUT_NOTE, activeSort, ariaSortFor, isSortableColumn, nextSort, parseSort, sortBlockedReason, type SortableColumn } from "@/lib/buyerSort";
import { writeQuoteSeed } from "@/lib/quoteSeed";
import { contactFilterEnabled } from "@/lib/contactFilterFlag";
import { lastSeenLabel } from "@/lib/lastConfirmed";
import { useRouter } from "next/navigation";
import { facetCount, hasNonFacetFilter, isExcluded, needsServerCount, parseExclude } from "@/lib/searchLive";
import { filtersFromSearchParams, urlWithFilters } from "@/lib/searchUrlState";
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
  /** Last night the crawl saw this car; shown as "Last confirmed <date>" once 48+ hours old. */
  lastConfirmedAt?: string | null;
}

interface SearchResults {
  total: number;
  /** True when `total` is a floor ("1,000+") — the box stopped counting at its cap. */
  totalCapped?: boolean;
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
  /** Keyword-exclude words (comma separated). Client-side only: never sent to the box, applied to the cars on screen. */
  exclude: string;
}

const EMPTY_FILTERS: Filters = {
  state: "", make: "", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "",
  exteriorColor: "", interiorColor: "", optionKeys: [],
  possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "",
};

// A "More" filter is anything not always visible in the primary row — its own count so the
// trigger can say "3 more filters" instead of a generic icon with no idea how many are hiding.
function countMoreFilters(f: Filters): number {
  return (
    [f.cond, f.priceMin, f.priceMax, f.yearMin, f.yearMax, f.odometerMax, f.exteriorColor, f.interiorColor, f.zip, f.radiusMiles].filter(Boolean).length +
    (f.possibleDemo ? 1 : 0) +
    (f.contactOnFile ? 1 : 0)
  );
}

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
  if (f.exteriorColor) sp.set("exteriorColor", f.exteriorColor);
  if (f.interiorColor) sp.set("interiorColor", f.interiorColor);
  if (f.optionKeys.length) sp.set("optionKeys", f.optionKeys.join(","));
  if (f.possibleDemo) sp.set("possibleDemo", "1");
  if (f.contactOnFile) sp.set("contactOnFile", "1");
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

const RESULTS_PAGE_SIZE = 24;

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
  const [moreOpen, setMoreOpen] = useState(false);

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
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setCatalogOptionsFailed(true);
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
  const submitSearch = () => {
    if (blockedReason) return;
    setMoreOpen(false);
    setSortNote(null);
    // A fresh object every time, so pressing Search again re-runs the same filters on purpose.
    setApplied({ ...filters });
  };
  // Filters edited since the last Search — the results on screen no longer match the panel.
  const dirty = applied !== null && JSON.stringify(applied) !== JSON.stringify(filters);

  // Clicking a column header: ascending, then descending, then cleared. It re-runs the search already on screen (the applied filters,
  // not unapplied edits in the panel) with the new sort, and the server orders the WHOLE result set. One click = one request: clicks
  // are ignored while a search is loading, so a burst cannot become a burst of box queries.
  const onSort = (column: SortableColumn) => {
    if (!applied || searchLoading) return;
    const label = TABLE_COLUMNS.find((c) => c.key === column)?.label || column;
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

  const moreCount = countMoreFilters(filters);
  const clearMore = () =>
    setFilters((f) => ({
      ...f, cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "",
      // The header sort is kept (it is not a filter); only a Distance sort goes, because clearing the ZIP removes that column.
      exteriorColor: "", interiorColor: "", possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: parseSort(f.sort)?.key === "distance" ? "" : f.sort,
    }));

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
  const COUNT_DEBOUNCE_MS = 250;
  const serverMode = needsServerCount(filters);
  const countQs = useMemo(() => (serverMode ? filtersToQueryString({ ...filters, sort: "" }, { limit: 1 }) : ""), [serverMode, filters]);
  const countCache = useRef(new Map<string, { total: number; capped: boolean }>());
  const [serverCount, setServerCount] = useState<{ qs: string; total: number; capped: boolean } | null>(null);
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
          const entry = { total: json.total, capped: Boolean(json.totalCapped) };
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
    countCache.current.set(key, { total: results.total, capped: Boolean(results.totalCapped) });
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
  const shownVehicles = useMemo(() => (results && excludeTerms.length ? results.vehicles.filter((v) => !isExcluded(v, excludeTerms)) : results?.vehicles ?? []), [results, excludeTerms]);
  const excludedHidden = results ? results.vehicles.length - shownVehicles.length : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 accent-brand-500 sm:px-6 lg:px-8 [&_*:focus-visible]:outline-brand-500" style={{ paddingBottom: "calc(var(--picks-bar-h, 7rem) + 1.5rem)" }}>
      <SearchFilterBar
        filters={filters} setFilters={setFilters} setMake={setMake} setModel={setModel}
        stateOptions={shownCounts(stateOptions)} makeOptions={shownCounts(makeOptions)} modelOptions={shownCounts(modelOptions)} trimOptions={shownCounts(trimOptions)}
        facetsFailed={facetsFailed} facetsLoading={facetsLoading}
        catalogOptions={catalogOptions} catalogOptionsLoading={catalogOptionsLoading}
        optionsEmptyMessage={catalogOptionsFailed ? "Couldn't load factory options right now — try again in a moment." : paidOnly ? NO_PAID_FACTORY_OPTIONS : "No factory options in inventory for this make/model yet."}
        exteriorColors={exteriorColors} interiorColors={interiorColors}
        moreOpen={moreOpen} setMoreOpen={setMoreOpen} moreCount={moreCount} clearMore={clearMore} clearAll={clearAll}
        contactFilterOn={contactFilterEnabled()} blockedReason={blockedReason} dirty={dirty} searchLoading={searchLoading} submitSearch={submitSearch}
        live={live} excludedHidden={excludedHidden}
      />

      <div>
        <p className="mb-3 text-xs font-semibold text-ink-muted">
          {results ? `${results.total.toLocaleString()}${results.totalCapped ? "+" : ""} vehicle${results.total === 1 && !results.totalCapped ? "" : "s"} found` : searchLoading ? "Searching…" : " "}
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
            Pick a make (add a model to narrow it further), then press the green button.
          </div>
        )}

        {!searchError && results && (
          <>
            {sortNote && <p role="status" data-testid="sort-note" className="mb-2 text-[11px] font-semibold text-amber-300">{sortNote}</p>}
            {results.vehicles.length > 0 && <VehicleTable resetKey={applied} hasMore={hasMore} loadingMore={searchLoading} moreError={moreError} onLoadMore={loadMore} sort={applied?.sort ?? ""} onSort={onSort} sortBusy={searchLoading} vehicles={shownVehicles} dimmed={dirty} picks={picksState.picks} viewed={viewedSet} onTogglePick={picksState.togglePicked} onView={picksState.markViewed} />}
            {results.vehicles.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-16 text-center text-sm text-ink-faint">
                No vehicles match these filters — try widening them.
              </div>
            )}
          </>
        )}
      </div>
      <PicksBar state={picksState} />
    </div>
  );
}

const money = (n: number | null) => (n == null ? "" : `$${n.toLocaleString()}`);
const condLabel = (c: BuyerVehicle["condition"]) => (c ? ({ new: "New", used: "Used", cpo: "Certified" } as const)[c] : "");

// Same order, density and type style as the admin Vehicles table (app/admin/crawl/VehiclesSheet.tsx), limited to
// what the public search returns. Distance only appears when the search was by ZIP.
const TABLE_COLUMNS: Array<{ key: string; label: string; w: number; right?: boolean; show?: (v: BuyerVehicle) => string }> = [
  { key: "pick", label: "", w: 40 },
  { key: "days", label: "Days on market", w: 110, right: true, show: (v) => (v.daysOnLot == null ? "" : String(v.daysOnLot)) },
  { key: "vehicleId", label: "Vehicle ID", w: 90, show: (v) => (v.vehicleId == null ? "" : String(v.vehicleId)) },
  { key: "vin", label: "VIN", w: 170, show: (v) => v.vin },
  { key: "year", label: "Year", w: 64, show: (v) => (v.year == null ? "" : String(v.year)) },
  { key: "make", label: "Make", w: 110, show: (v) => v.make ?? "" },
  { key: "model", label: "Model", w: 130, show: (v) => v.model ?? "" },
  { key: "trim", label: "Trim", w: 190, show: (v) => v.trim ?? "" },
  { key: "ext", label: "Exterior color", w: 170, show: (v) => v.exteriorColor ?? "" },
  { key: "int", label: "Interior color", w: 150, show: (v) => v.interiorColor ?? "" },
  { key: "mileage", label: "Mileage", w: 90, right: true, show: (v) => (v.mileage == null ? "" : v.mileage.toLocaleString()) },
  { key: "price", label: "Price", w: 100, right: true, show: (v) => money(v.price) },
  { key: "dealer", label: "Dealer", w: 340, show: (v) => v.dealerName },
  { key: "state", label: "State", w: 60, show: (v) => v.dealerState ?? "" },
  { key: "contact", label: "Contact on file", w: 110, show: (v) => (v.dealerHasContact == null ? "" : v.dealerHasContact ? "Yes" : "No") },
  { key: "listing", label: "Listing link", w: 170 },
  // Only when the search was by ZIP — after the fixed fields so their order never moves.
  { key: "distance", label: "Distance", w: 80, right: true, show: (v) => (v.distanceMiles == null ? "" : `${Math.round(v.distanceMiles)} mi`) },
];
const ROW_H = 32;

function VehicleTable({ resetKey, hasMore, loadingMore, moreError, onLoadMore, vehicles, dimmed, picks, viewed, onTogglePick, onView, sort, onSort, sortBusy }: {
  /** Changes (new object) whenever a fresh search starts — the list scrolls back to the top. */
  resetKey: unknown; hasMore: boolean; loadingMore: boolean; moreError: boolean; onLoadMore: () => void;
  vehicles: BuyerVehicle[]; dimmed: boolean; picks: PickedVehicle[]; viewed: Set<string>;
  onTogglePick: (p: PickedVehicle) => void; onView: (key: string) => void;
  /** The applied sort string (e.g. "price:desc"), the click handler, and whether a request is already running. */
  sort: string; onSort: (column: SortableColumn) => void; sortBusy: boolean;
}) {
  const cols = TABLE_COLUMNS.filter((c) => c.key !== "distance" || vehicles.some((v) => v.distanceMiles != null));
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const picked = new Set(picks.map((p) => p.key));
  // The scroller's own bottom edge — and with it the horizontal scrollbar and the last rows — must stay above the fixed picks bar.
  // Its top moves with the filters above it, so measure it and cap the height at: viewport − its top − the bar's height (--picks-bar-h,
  // published by PicksBar) − a margin. The page also pads its bottom by the bar's height, so everything stays reachable by scrolling.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => el.style.setProperty("--table-top", `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`);
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(document.body);
    return () => { window.removeEventListener("resize", measure); ro?.disconnect(); };
  });
  // Infinite scroll: a sentinel row after the last vehicle, watched inside the scroller with a 300px lead. The observer is
  // re-created after every page so a sentinel that is still in view (short pages, tall window) asks for the next one.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadRef = useRef(onLoadMore);
  loadRef.current = onLoadMore;
  useEffect(() => { scroller.current?.scrollTo?.({ top: 0 }); }, [resetKey]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || moreError || loadingMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadRef.current(); }, { root: scroller.current, rootMargin: "0px 0px 300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, moreError, loadingMore, vehicles.length]);
  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-surface transition-opacity ${dimmed ? "opacity-60" : ""}`}>
      <div ref={scroller} data-testid="results-scroller" className="overflow-x-auto overflow-y-auto overscroll-x-contain" style={{ maxHeight: "max(240px, calc(100dvh - var(--table-top, 260px) - var(--picks-bar-h, 7rem) - 1.25rem))", minHeight: 120 }}>
        <div style={{ width: totalW, minWidth: "100%" }}>
          <div className="sticky top-0 z-20 flex border-b border-gray-300 bg-gray-100" style={{ height: ROW_H }}>
            {cols.map((c) => {
              const sortable = isSortableColumn(c.key);
              const active = activeSort(sort);
              const here = sortable && active?.column === c.key ? active : null;
              return (
                <div key={c.key} role="columnheader" aria-sort={sortable ? ariaSortFor(sort, c.key) : undefined} className={`flex shrink-0 items-center border-r border-gray-300 text-[10.5px] font-black uppercase tracking-wider text-gray-900 ${c.right ? "justify-end" : ""}`} style={{ width: c.w }}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key as SortableColumn)}
                      disabled={sortBusy}
                      title={`Sort by ${c.label} — click for ${here ? (here.dir === "asc" ? "descending" : "no sort") : "ascending"}`}
                      className={`flex h-full w-full min-w-0 items-center gap-1 px-2.5 uppercase tracking-wider hover:bg-gray-200 focus-visible:outline-2 disabled:cursor-wait ${c.right ? "justify-end" : ""}`}
                    >
                      <span className="truncate">{c.label}</span>
                      {here && (here.dir === "asc" ? <ArrowUp aria-hidden className="h-3 w-3 shrink-0" data-testid="sort-arrow-asc" /> : <ArrowDown aria-hidden className="h-3 w-3 shrink-0" data-testid="sort-arrow-desc" />)}
                    </button>
                  ) : (
                    <span className="truncate px-2.5">{c.label}</span>
                  )}
                </div>
              );
            })}
          </div>
          {vehicles.map((v, idx) => {
            const key = vehicleKey(v);
            const isViewed = viewed.has(key);
            return (
              <div key={key} onClick={() => onView(key)} className={`flex cursor-default border-b border-border/40 text-[11.5px] ${idx % 2 ? "bg-surface" : "bg-surface-elevated/40"} hover:bg-brand-500/5`} style={{ height: ROW_H }}>
                {cols.map((c) => {
                  const text = c.show ? c.show(v) : "";
                  const tone = isViewed ? "text-ink-faint" : c.key === "dealer" ? "font-semibold text-white"
                    : c.key === "vin" || c.key === "vehicleId" ? "font-mono text-ink-light"
                    : c.right ? "tabular-nums text-ink-light" : "text-ink-light";
                  return (
                    <div key={c.key} className={`flex shrink-0 items-center overflow-hidden whitespace-nowrap border-r border-border/40 px-2.5 ${c.right ? "justify-end" : ""} ${tone}`} style={{ width: c.w }} title={c.key === "pick" ? undefined : text || undefined}>
                      {c.key === "pick" ? (
                        <input
                          type="checkbox"
                          checked={picked.has(key)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => onTogglePick(toPick(v))}
                          aria-label={`Pick ${[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin} for a quote`}
                          className="h-3.5 w-3.5 accent-brand-500"
                        />
                      ) : c.key === "listing" ? (
                        <span className="flex min-w-0 items-center gap-2">
                          {v.vdpUrl ? (
                            <Link href={v.vdpUrl} target="_blank" rel="noopener noreferrer" onClick={() => onView(key)} className="truncate text-brand-400 hover:underline">View at dealer ↗</Link>
                          ) : (
                            <span className="truncate text-ink-faint">No link</span>
                          )}
                          {isViewed && <span className="shrink-0 text-[10.5px] text-ink-faint">Viewed</span>}
                        </span>
                      ) : c.key === "dealer" ? (
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="truncate">{text}</span>
                          {(() => { const seen = lastSeenLabel(v.lastConfirmedAt); return seen ? <span className="shrink-0 text-[10px] font-normal text-ink-faint">{seen}</span> : null; })()}
                        </span>
                      ) : (
                        <span className="truncate">{text}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {hasMore && !moreError && <div ref={sentinel} data-testid="results-sentinel" aria-hidden style={{ height: 1 }} />}
          {hasMore && loadingMore && !moreError && (
            <div role="status" data-testid="results-loading-more" className="flex items-center justify-center gap-2 py-3 text-[11px] text-ink-faint">
              <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-faint border-t-transparent" /> Loading more vehicles…
            </div>
          )}
          {moreError && (
            <div role="alert" data-testid="results-more-error" className="flex items-center justify-center gap-2 py-3 text-[11px] text-amber-300">
              Couldn&apos;t load more —
              <button type="button" onClick={onLoadMore} className="font-bold underline hover:text-white">retry</button>
            </div>
          )}
          {/* Keyboard / screen-reader fallback: reachable by Tab, visually hidden until focused. */}
          {hasMore && !moreError && !loadingMore && (
            <button type="button" onClick={onLoadMore} className="sr-only focus:not-sr-only focus:m-2 focus:rounded focus:border focus:border-border focus:px-2 focus:py-1 focus:text-[11px] focus:text-ink-light">Load more vehicles</button>
          )}
          {!hasMore && vehicles.length > 0 && (
            <div data-testid="results-end" className="py-3 text-center text-[11px] text-ink-faint">All {vehicles.length.toLocaleString()} vehicles shown.</div>
          )}
          <div aria-hidden style={{ height: 10 }} />
        </div>
      </div>
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
