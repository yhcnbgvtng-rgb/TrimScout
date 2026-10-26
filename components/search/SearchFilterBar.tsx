"use client";

// The top of /search: a large live count, a quick-find input, filter chips with live counts (condition, make, model, trim, exterior colour,
// paid factory options), a price range, a keyword-exclude field, and a sticky row of the selected filters as removable pills.
// Presentation only - BuyerSearchView owns every piece of state, every handler and every request; this file receives them as props.
// "More" (year, mileage, interior colour, ZIP, sort, demo/contact) opens as a light popover on desktop and as a bottom sheet on a phone.

import React, { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { optionPriceText, optionsPaidOnlyEnabled } from "@/lib/optionsPaidOnly";
import { parseExclude } from "@/lib/searchLive";
import { DAYS_BANDS, DRIVETRAIN_CHOICES, FUEL_CHOICES, labelOf as choiceLabel, TRANSMISSION_CHOICES, type FilterChoice } from "@/lib/searchFilters";
import type { FacetCountDims, FacetCountsResult } from "@/lib/inventoryApi";
import type { PillOption as DropdownOption } from "../admin/FilterPill";
import type { CatalogExtras, CatalogOption, Filters } from "../BuyerSearchView";
import { FacetChips, type Chip } from "./FacetChips";
import { LiveCount, type LiveCountProps } from "./LiveCount";
import { PriceRange } from "./PriceRange";
import { RangeFilter } from "./RangeFilter";

const ACCENT = "#3D9474"; // brand-500: the one green (checkbox accent); buttons use bg-brand-500 with black text like the rest of the site
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const RING = "focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-brand-400";

export interface SearchFilterBarProps {
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  setMake: (make: string) => void;
  setModel: (model: string) => void;
  stateOptions: DropdownOption[];
  makeOptions: DropdownOption[];
  modelOptions: DropdownOption[];
  trimOptions: DropdownOption[];
  facetsFailed: boolean;
  facetsLoading: boolean;
  catalogOptions: CatalogOption[];
  catalogOptionsLoading: boolean;
  /** The message shown when there are no factory options to list (failed load, or none for this make/model). */
  optionsEmptyMessage: string;
  exteriorColors: string[];
  interiorColors: string[];
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  moreCount: number;
  clearMore: () => void;
  clearAll: () => void;
  contactFilterOn: boolean;
  blockedReason: string | null;
  dirty: boolean;
  searchLoading: boolean;
  submitSearch: () => void;
  /** The headline count (see LiveCount) and where the shopper is in "Show N vehicles". */
  live: LiveCountProps;
  /** Cars on screen hidden by the keyword-exclude field (only when the box did not apply the words itself). */
  excludedHidden: number;
  /** Colour / condition counts and the price histogram from the catalog call; empty when the box does not send them. */
  extras: CatalogExtras;
  /** Counts for the "More filters" chips; null until they arrive (or with no make). `supported: false` = this box cannot count them, so those groups stay hidden. */
  facetCounts: FacetCountsResult | null;
  facetCountsPending: boolean;
  facetCountsFailed: boolean;
}

const THIS_YEAR = new Date().getFullYear();
const DEFAULT_YEARS = { min: 2015, max: THIS_YEAR + 1 };
const MILEAGE = { min: 0, max: 150000, step: 5000, bucket: 10000 } as const;
const miles = (n: number, open: boolean) => `${n >= 1000 ? `${Math.round(n / 1000)}k` : n}${open ? "+" : ""} mi`;

const money = (n: string) => `$${Number(n).toLocaleString()}`;
const COND_LABEL: Record<string, string> = { new: "New", used: "Used", cpo: "Certified" };

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return; // no media queries (an old browser, or a test DOM): the desktop popover
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return mobile;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** A popover under its trigger on desktop, a bottom sheet on a phone. Escape closes, Tab stays inside, focus returns to the trigger. */
function Panel({ open, onClose, anchorRef, title, width = 320, showLabel = "Show results", onShowResults, children }: {
  open: boolean; onClose: () => void; anchorRef: RefObject<HTMLElement | null>; title: string; width?: number; showLabel?: string; onShowResults: () => void; children: ReactNode;
}) {
  const mobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // The parent passes a fresh onClose every render; the effect below must not restart (and steal focus) because of that.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || mobile || !anchorRef.current) return;
    const place = () => {
      const r = anchorRef.current!.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - width - 8));
      setPos({ top: r.bottom + window.scrollY + 8, left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, mobile, anchorRef, width]);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !anchor?.contains(t)) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    const scrollLock = mobile ? document.body.style.overflow : null;
    if (mobile) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      if (mobile) document.body.style.overflow = scrollLock ?? "";
      anchor?.focus();
    };
  }, [open, mobile, anchorRef]);

  if (!open || typeof document === "undefined") return null;
  if (mobile) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-end" style={{ fontFamily: FONT }}>
        <div className="absolute inset-0 bg-black/60" aria-hidden onClick={onClose} />
        <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl border-t border-border bg-surface-elevated text-white shadow-2xl outline-none [color-scheme:dark]">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="text-sm font-semibold">{title}</span>
            <button type="button" onClick={onClose} className={`rounded px-2 py-1 text-sm text-ink-muted ${RING}`}>Close</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          <div className="border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={onShowResults} className={`h-11 w-full rounded-md bg-brand-500 text-sm font-semibold text-black hover:bg-brand-400 ${RING}`}>{showLabel}</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div ref={ref} role="dialog" aria-label={title} tabIndex={-1} className="absolute z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface-elevated p-4 text-white shadow-2xl outline-none [color-scheme:dark]" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, fontFamily: FONT }}>
      {children}
    </div>,
    document.body,
  );
}

const fieldLabel = "mb-1 block text-xs text-ink-muted";
const fieldBox = "h-9 w-full rounded-md border border-border-strong bg-background [color-scheme:dark] px-2.5 text-sm text-white placeholder:text-ink-faint disabled:opacity-40";

function NumField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>{label}</label>
      <input id={id} type="number" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldBox} ${RING}`} />
    </div>
  );
}

export function SearchFilterBar(p: SearchFilterBarProps) {
  const { filters, setFilters } = p;
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const morePanelId = useId();
  const closeMore = React.useCallback(() => p.setMoreOpen(false), [p]);
  const paidOnly = optionsPaidOnlyEnabled();

  // ---- the "More filters" counts (see BuyerSearchView): per-chip numbers when the box sent them, plain choices when the set was too broad to count ----
  const fcOk = p.facetCounts && p.facetCounts.supported ? p.facetCounts : null;
  const fcDims: FacetCountDims | null = fcOk && !fcOk.tooBroad ? fcOk.dims : null;
  const tooBroad = Boolean(fcOk && fcOk.tooBroad);
  // While a newer count is on its way the previous lists stay (no flicker) but their numbers are hidden: a stale number is never shown.
  const stale = p.facetCountsPending;
  const dealerNames = useRef(new Map<string, string>());
  for (const d of fcDims?.dealer ?? []) dealerNames.current.set(d.id, d.name);
  const dealerName = (id: string) => dealerNames.current.get(id) ?? `Dealer #${id}`;

  // ---- quick find: type a make (then a model, then a trim) and pick it; fills the same Make / Model / Trim filters ----
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [findOpen, setFindOpen] = useState(false);
  const listId = useId();
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Array<{ kind: "Make" | "Model" | "Trim"; opt: DropdownOption }>;
    const pick = (kind: "Make" | "Model" | "Trim", list: DropdownOption[]) => list.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 5).map((opt) => ({ kind, opt }));
    return [...pick("Make", p.makeOptions), ...(filters.make ? pick("Model", p.modelOptions) : []), ...(filters.model ? pick("Trim", p.trimOptions) : [])].slice(0, 8);
  }, [query, filters.make, filters.model, p.makeOptions, p.modelOptions, p.trimOptions]);
  const choose = (s: { kind: "Make" | "Model" | "Trim"; opt: DropdownOption }) => {
    if (s.kind === "Make") p.setMake(s.opt.value);
    else if (s.kind === "Model") p.setModel(s.opt.value);
    else setFilters((f) => ({ ...f, trim: s.opt.value }));
    setQuery(""); setActive(-1); setFindOpen(false);
  };

  // ---- selected-filter pills ----
  const labelOf = (key: string) => p.catalogOptions.find((o) => o.key === key)?.label ?? key;
  const chips: Array<{ id: string; text: string; remove: () => void }> = [];
  if (filters.state) chips.push({ id: "state", text: `Location: ${filters.state}`, remove: () => setFilters((f) => ({ ...f, state: "" })) });
  if (filters.make) chips.push({ id: "make", text: filters.make, remove: () => p.setMake("") });
  if (filters.model) chips.push({ id: "model", text: filters.model, remove: () => p.setModel("") });
  if (filters.trim) chips.push({ id: "trim", text: filters.trim, remove: () => setFilters((f) => ({ ...f, trim: "" })) });
  for (const k of filters.optionKeys) chips.push({ id: `opt-${k}`, text: labelOf(k), remove: () => setFilters((f) => ({ ...f, optionKeys: f.optionKeys.filter((x) => x !== k) })) });
  if (filters.cond) chips.push({ id: "cond", text: COND_LABEL[filters.cond] ?? filters.cond, remove: () => setFilters((f) => ({ ...f, cond: "" })) });
  if (filters.priceMin || filters.priceMax) chips.push({ id: "price", text: `Price ${filters.priceMin ? money(filters.priceMin) : "any"} – ${filters.priceMax ? money(filters.priceMax) : "any"}`, remove: () => setFilters((f) => ({ ...f, priceMin: "", priceMax: "" })) });
  if (filters.yearMin || filters.yearMax) chips.push({ id: "year", text: `Year ${filters.yearMin || "any"} – ${filters.yearMax || "any"}`, remove: () => setFilters((f) => ({ ...f, yearMin: "", yearMax: "" })) });
  if (filters.odometerMin || filters.odometerMax) chips.push({ id: "odo", text: `Mileage ${filters.odometerMin ? Number(filters.odometerMin).toLocaleString() : "0"} – ${filters.odometerMax ? `${Number(filters.odometerMax).toLocaleString()} mi` : "any"}`, remove: () => setFilters((f) => ({ ...f, odometerMin: "", odometerMax: "" })) });
  const listPill = (key: "bodyStyle" | "fuel" | "drivetrain" | "transmission" | "dealerIds", value: string, text: string) =>
    chips.push({ id: `${key}-${value}`, text, remove: () => setFilters((f) => ({ ...f, [key]: f[key].filter((x) => x !== value) })) });
  for (const v of filters.bodyStyle) listPill("bodyStyle", v, v);
  for (const v of filters.fuel) listPill("fuel", v, choiceLabel(FUEL_CHOICES, v));
  for (const v of filters.drivetrain) listPill("drivetrain", v, choiceLabel(DRIVETRAIN_CHOICES, v));
  for (const v of filters.transmission) listPill("transmission", v, choiceLabel(TRANSMISSION_CHOICES, v));
  for (const v of filters.dealerIds) listPill("dealerIds", v, dealerName(v));
  if (filters.days) chips.push({ id: "days", text: `On lot: ${choiceLabel(DAYS_BANDS, filters.days)}`, remove: () => setFilters((f) => ({ ...f, days: "" })) });
  if (filters.vinPattern) chips.push({ id: "vin", text: `VIN ${filters.vinPattern}`, remove: () => setFilters((f) => ({ ...f, vinPattern: "" })) });
  if (filters.exteriorColor) chips.push({ id: "ext", text: `Exterior: ${filters.exteriorColor}`, remove: () => setFilters((f) => ({ ...f, exteriorColor: "" })) });
  if (filters.interiorColor) chips.push({ id: "int", text: `Interior: ${filters.interiorColor}`, remove: () => setFilters((f) => ({ ...f, interiorColor: "" })) });
  if (filters.possibleDemo) chips.push({ id: "demo", text: "Includes demo/loaner", remove: () => setFilters((f) => ({ ...f, possibleDemo: false })) });
  if (filters.contactOnFile) chips.push({ id: "contact", text: "Dealer contact on file", remove: () => setFilters((f) => ({ ...f, contactOnFile: false })) });
  if (filters.zip || filters.radiusMiles) chips.push({ id: "near", text: `Near ${filters.zip || "ZIP"}${filters.radiusMiles ? ` · ${filters.radiusMiles} mi` : ""}`, remove: () => setFilters((f) => ({ ...f, zip: "", radiusMiles: "", sort: f.sort === "distance" ? "" : f.sort })) });
  const excludeTerms = parseExclude(filters.exclude);
  if (excludeTerms.length) chips.push({ id: "exclude", text: `Without: ${excludeTerms.join(", ")}`, remove: () => setFilters((f) => ({ ...f, exclude: "" })) });

  // ---- chip groups (counts come from the catalog-facets data the page already loads; zero-count chips are dropped by FacetChips) ----
  const toChips = (opts: DropdownOption[]): Chip[] => opts.map((o) => ({ value: o.value, label: o.label, count: o.count }));
  const toggleOne = (key: "state" | "cond" | "exteriorColor", value: string) => setFilters((f) => ({ ...f, [key]: f[key] === value ? "" : value }));
  const optionChips: Chip[] = p.catalogOptions.map((o) => ({
    value: o.key, label: o.label, count: o.vehicleCount,
    detail: paidOnly ? optionPriceText(o.minPrice, o.maxPrice, true) || undefined : undefined, // flag off, or no paid price in the data: no price slot
  }));
  // Exterior colour chips: with counts (most cars first) when the box sends them, else the plain alphabetical names.
  const exteriorChips: Chip[] = p.extras.exteriorColorCounts?.length
    ? p.extras.exteriorColorCounts.map((c) => ({ value: c.color, label: c.color, count: c.n }))
    : p.exteriorColors.map((c) => ({ value: c, label: c }));
  // The sparkline follows the condition picked (all cars when none).
  const hist = p.extras.priceHistogram;
  const histogram = hist ? (filters.cond === "new" || filters.cond === "used" || filters.cond === "cpo" ? hist[filters.cond] : hist.all) : undefined;
  const countMap = (list?: Array<{ v: string | number; n: number }>) => new Map((list ?? []).map((x) => [String(x.v), x.n]));
  const fixedChips = (choices: FilterChoice[], list?: Array<{ v: string | number; n: number }>): Chip[] => {
    const m = countMap(list);
    return choices.map((c) => ({ value: c.value, label: c.label, count: fcDims && !stale ? m.get(c.value) ?? 0 : undefined })).filter((c) => !fcDims || (m.get(c.value) ?? 0) > 0 || filters.fuel.includes(c.value) || filters.drivetrain.includes(c.value) || filters.transmission.includes(c.value) || filters.days === c.value);
  };
  const toggleList = (key: "bodyStyle" | "fuel" | "drivetrain" | "transmission" | "dealerIds") => (v: string) =>
    setFilters((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }));
  const bodyChips: Chip[] = (fcDims?.bodyStyle ?? []).map((b) => ({ value: b.v, label: b.v, count: stale ? undefined : b.n }));
  const dealerChips: Chip[] = (fcDims?.dealer ?? []).map((d) => ({ value: d.id, label: d.name, count: stale ? undefined : d.n }));
  for (const id of filters.dealerIds) if (!dealerChips.some((c) => c.value === id)) dealerChips.push({ value: id, label: dealerName(id) });
  const interiorChips: Chip[] = p.extras.interiorColorCounts?.length
    ? p.extras.interiorColorCounts.map((c) => ({ value: c.color, label: c.color, count: c.n }))
    : p.interiorColors.map((c) => ({ value: c, label: c }));
  // Year: the slider spans the model years the cars in this set actually have (the plain recent range until the counts arrive); counts follow every other filter.
  const yearRows = fcDims?.year ?? [];
  const yearNums = yearRows.map((r) => Number(r.v)).filter((n) => n >= 1990 && n <= THIS_YEAR + 2);
  const picked = [filters.yearMin, filters.yearMax].map(Number).filter((n) => n > 0);
  let yMin = Math.min(...(yearNums.length ? yearNums : [DEFAULT_YEARS.min]), ...picked), yMax = Math.max(...(yearNums.length ? yearNums : [DEFAULT_YEARS.max]), ...picked);
  if (yMax - yMin < 2) { yMin -= 1; yMax += 1; }
  const yearHist = yearNums.length ? Array.from({ length: yMax - yMin + 1 }, (_, i) => Number(yearRows.find((r) => Number(r.v) === yMin + i)?.n ?? 0)) : undefined;
  const mileHist = fcDims?.mileage?.hist;
  const showResults = (close: () => void) => () => { close(); p.submitSearch(); };
  const countLabel = p.live.value == null ? "Search" : `Show ${p.live.value.toLocaleString()}${p.live.capped ? "+" : ""} vehicle${p.live.value === 1 && !p.live.capped ? "" : "s"}`;

  return (
    <section aria-label="Search filters" className="mx-auto mb-6 w-full max-w-[960px] px-1 pt-6 text-white sm:pt-10" style={{ fontFamily: FONT }}>
      <h1 className="mb-5 text-center text-lg font-medium tracking-tight text-ink-muted sm:text-xl">Search real dealer inventory</h1>
      <LiveCount {...p.live} />

      <form role="search" onSubmit={(e) => { e.preventDefault(); p.submitSearch(); }} className="mx-auto mt-6 flex max-w-[720px] items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${listId}-input`} className="sr-only">Find a make, model or trim</label>
          <input
            id={`${listId}-input`} type="text" role="combobox" aria-expanded={findOpen && suggestions.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off"
            value={query} placeholder="Find a make, model or trim"
            onChange={(e) => { setQuery(e.target.value); setActive(-1); setFindOpen(true); }}
            onBlur={() => setFindOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && suggestions.length) { e.preventDefault(); setFindOpen(true); setActive((a) => (a + 1) % suggestions.length); }
              else if (e.key === "ArrowUp" && suggestions.length) { e.preventDefault(); setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1)); }
              else if (e.key === "Enter" && findOpen && active >= 0 && suggestions[active]) { e.preventDefault(); choose(suggestions[active]); }
              else if (e.key === "Escape") { setFindOpen(false); setActive(-1); }
            }}
            className={`h-11 w-full rounded-md border border-border-strong bg-surface px-3.5 text-[15px] text-white placeholder:text-ink-faint ${RING}`} />
          {findOpen && suggestions.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Suggestions" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-surface-elevated py-1 shadow-2xl">
              {suggestions.map((s, i) => (
                <li key={`${s.kind}-${s.opt.value}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); choose(s); }}
                  className={`flex cursor-pointer items-center justify-between px-3.5 py-2 text-sm ${i === active ? "bg-border" : ""}`}>
                  <span>{s.opt.label}</span><span className="text-xs text-ink-muted">{s.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" disabled={Boolean(p.blockedReason) || p.searchLoading} title={p.blockedReason ?? undefined}
          className={`h-11 shrink-0 rounded-md bg-brand-500 px-4 text-sm font-semibold text-black hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40 ${RING}`}>
          {p.searchLoading ? "Searching…" : countLabel}
        </button>
      </form>

      {/* Sticky: stays under the site header while the results scroll, so the active filters are always one tap from removal. */}
      {chips.length > 0 && (
        <div data-testid="selected-bar" className="sticky top-14 z-20 -mx-1 mt-5 border-b border-border/60 bg-background/90 px-1 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <ul aria-label="Active filters" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
              {chips.map((c) => (
                <li key={c.id} className="flex shrink-0 items-center gap-1 rounded-full border border-brand-500/50 bg-brand-500/10 py-1 pl-3 pr-1 text-xs text-white">
                  <span>{c.text}</span>
                  <button type="button" onClick={c.remove} aria-label={`Remove ${c.text}`} className={`flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-border-strong hover:text-white ${RING}`}>
                    <svg aria-hidden width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5"><path d="m1 1 6 6M7 1 1 7" /></svg>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={p.clearAll} className={`shrink-0 text-xs text-ink-muted underline underline-offset-2 hover:text-white ${RING}`}>Clear all</button>
          </div>
        </div>
      )}

      <div role="group" aria-label="Filters" className="mt-3 divide-y divide-border/40">
        <FacetChips label="Condition" selected={filters.cond ? [filters.cond] : []} onToggle={(v) => toggleOne("cond", v)}
          chips={[{ value: "new", label: "New" }, { value: "used", label: "Used" }, { value: "cpo", label: "Certified" }].map((c) => ({ ...c, count: filters.make ? p.extras.conditionCounts?.[c.value as "new" | "used" | "cpo"] : undefined }))} />
        <FacetChips label="Location" selected={filters.state ? [filters.state] : []} onToggle={(v) => toggleOne("state", v)} chips={toChips(p.stateOptions)} limit={10} loading={p.facetsLoading} />
        <FacetChips label="Make" selected={filters.make ? [filters.make] : []} onToggle={(v) => p.setMake(filters.make === v ? "" : v)} chips={toChips(p.makeOptions)} limit={14} loading={p.facetsLoading} emptyText="No makes to show right now." />
        {filters.make && <FacetChips label="Model" selected={filters.model ? [filters.model] : []} onToggle={(v) => p.setModel(filters.model === v ? "" : v)} chips={toChips(p.modelOptions)} limit={14} loading={p.facetsLoading} />}
        {filters.model && <FacetChips label="Trim" selected={filters.trim ? [filters.trim] : []} onToggle={(v) => setFilters((f) => ({ ...f, trim: f.trim === v ? "" : v }))} chips={toChips(p.trimOptions)} limit={14} loading={p.facetsLoading} />}
        {filters.make && (p.exteriorColors.length > 0 || p.catalogOptionsLoading) && (
          <FacetChips label="Exterior colour" selected={filters.exteriorColor ? [filters.exteriorColor] : []} onToggle={(v) => toggleOne("exteriorColor", v)}
            chips={exteriorChips} limit={12} loading={p.catalogOptionsLoading} />
        )}
        {filters.model && (
          <FacetChips label={paidOnly ? "Paid factory options" : "Factory options"} selected={filters.optionKeys}
            onToggle={(k) => setFilters((f) => ({ ...f, optionKeys: f.optionKeys.includes(k) ? f.optionKeys.filter((x) => x !== k) : [...f.optionKeys, k] }))}
            chips={optionChips} limit={12} loading={p.catalogOptionsLoading} emptyText={p.optionsEmptyMessage} />
        )}
        <PriceRange min={filters.priceMin} max={filters.priceMax} histogram={histogram} onChange={(priceMin, priceMax) => setFilters((f) => ({ ...f, priceMin, priceMax }))} />
        <RangeFilter label="Year" testId="year" min={filters.yearMin} max={filters.yearMax} domainMin={yMin} domainMax={yMax} step={1}
          format={(n, open) => (open ? "Newest" : n <= yMin ? "Oldest" : String(n))} onChange={(yearMin, yearMax) => setFilters((f) => ({ ...f, yearMin, yearMax }))}
          histogram={yearHist} bucketWidth={1} discrete />
        <div className="py-2">
          <label htmlFor={`${listId}-exclude`} className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-muted">Leave out</label>
          <input id={`${listId}-exclude`} type="text" value={filters.exclude} onChange={(e) => setFilters((f) => ({ ...f, exclude: e.target.value }))}
            placeholder="Words to hide, e.g. black, sport" autoComplete="off" className={`${fieldBox} sm:max-w-sm ${RING}`} />
          <p className="mt-1 text-xs text-ink-faint">Hides cars whose year, model, trim or colour contains any of these words.</p>
        </div>
        <div className="flex items-center justify-between py-2">
          <button ref={moreAnchor} type="button" aria-haspopup="dialog" aria-expanded={p.moreOpen} aria-controls={p.moreOpen ? morePanelId : undefined}
            onClick={() => p.setMoreOpen(!p.moreOpen)} className={`text-sm text-ink-light underline underline-offset-2 hover:text-white ${RING}`}>
            More filters{p.moreCount > 0 ? ` (${p.moreCount})` : ""}
          </button>
        </div>
      </div>

      <Panel open={p.moreOpen} onClose={closeMore} anchorRef={moreAnchor} title="More filters" width={440} showLabel={countLabel} onShowResults={showResults(closeMore)}>
        <div
          id={morePanelId}
          onKeyDown={(e) => {
            const t = e.target as HTMLElement;
            if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox") { e.preventDefault(); p.submitSearch(); }
          }}
          className="space-y-4">
          {(() => {
            const msg = !filters.make ? "Pick a make to count these filters." : p.facetCountsFailed ? "Couldn't load the counts just now, so the numbers are hidden." : p.facetCountsPending ? "Updating counts…" : tooBroad ? "Pick a model for a number on each choice." : "";
            return msg ? <p role="status" className="text-xs text-ink-muted">{msg}</p> : null;
          })()}
          <div className="divide-y divide-border/40">
            <RangeFilter label="Mileage" testId="mileage" min={filters.odometerMin} max={filters.odometerMax} domainMin={MILEAGE.min} domainMax={MILEAGE.max} step={MILEAGE.step}
              format={miles} onChange={(odometerMin, odometerMax) => setFilters((f) => ({ ...f, odometerMin, odometerMax }))}
              histogram={mileHist} bucketWidth={fcDims?.mileage?.width ?? MILEAGE.bucket} lastOpen />
            <FacetChips label="Days on market" selected={filters.days ? [filters.days] : []} onToggle={(v) => setFilters((f) => ({ ...f, days: f.days === v ? "" : v }))} chips={fixedChips(DAYS_BANDS, fcDims?.days)} />
            {fcDims && bodyChips.length > 0 && <FacetChips label="Body style" selected={filters.bodyStyle} onToggle={toggleList("bodyStyle")} chips={bodyChips} limit={10} />}
            {fcOk && <FacetChips label="Fuel type" selected={filters.fuel} onToggle={toggleList("fuel")} chips={fixedChips(FUEL_CHOICES, fcDims?.fuel)} />}
            {fcOk && <FacetChips label="Drivetrain" selected={filters.drivetrain} onToggle={toggleList("drivetrain")} chips={fixedChips(DRIVETRAIN_CHOICES, fcDims?.drivetrain)} />}
            {fcOk && <FacetChips label="Transmission" selected={filters.transmission} onToggle={toggleList("transmission")} chips={fixedChips(TRANSMISSION_CHOICES, fcDims?.transmission)} />}
            {interiorChips.length > 0 && (
              <FacetChips label="Interior colour" selected={filters.interiorColor ? [filters.interiorColor] : []} onToggle={(v) => setFilters((f) => ({ ...f, interiorColor: f.interiorColor === v ? "" : v }))} chips={interiorChips} limit={10} />
            )}
            {fcDims && dealerChips.length > 0 && <FacetChips label="Dealer" selected={filters.dealerIds} onToggle={toggleList("dealerIds")} chips={dealerChips} limit={8} />}
          </div>
          {p.contactFilterOn && (
            <label className="flex items-center gap-2 text-sm text-ink-light" title="Only cars whose dealer has a named sales contact on file with us">
              <input type="checkbox" checked={filters.contactOnFile} onChange={(e) => setFilters((f) => ({ ...f, contactOnFile: e.target.checked }))} className={`h-4 w-4 ${RING}`} style={{ accentColor: ACCENT }} />
              Dealer contact on file
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-ink-light">
            <input type="checkbox" checked={filters.possibleDemo} onChange={(e) => setFilters((f) => ({ ...f, possibleDemo: e.target.checked }))} className={`h-4 w-4 ${RING}`} style={{ accentColor: ACCENT }} />
            Include likely demo/loaner vehicles
          </label>
          <div className="border-t border-border pt-4">
            <span className={fieldLabel}>Near</span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${morePanelId}-zip`} className="sr-only">ZIP code</label>
                <input id={`${morePanelId}-zip`} type="text" inputMode="numeric" value={filters.zip} onChange={(e) => setFilters((f) => ({ ...f, zip: e.target.value }))} placeholder="ZIP code" className={`${fieldBox} ${RING}`} />
              </div>
              <div>
                <label htmlFor={`${morePanelId}-rad`} className="sr-only">Radius in miles</label>
                <input id={`${morePanelId}-rad`} type="number" inputMode="numeric" value={filters.radiusMiles} onChange={(e) => setFilters((f) => ({ ...f, radiusMiles: e.target.value }))} placeholder="Radius (mi)"
                  disabled={!filters.make || !filters.zip} title={!filters.zip ? "Enter a ZIP code to search within a radius" : !filters.make ? "Pick a make to search within a radius" : undefined} className={`${fieldBox} ${RING}`} />
              </div>
            </div>
            {filters.radiusMiles && (!filters.make || !filters.zip) && (
              <p className="mt-1 text-xs text-ink-muted">{!filters.zip ? "Enter a ZIP code" : "Pick a make"} to search within a distance.</p>
            )}
          </div>
          {fcOk && (
            <div className="border-t border-border pt-4">
              <label htmlFor={`${morePanelId}-vin`} className={fieldLabel}>VIN pattern</label>
              <input id={`${morePanelId}-vin`} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={filters.vinPattern} maxLength={17}
                onChange={(e) => setFilters((f) => ({ ...f, vinPattern: e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9*?]/g, "") }))}
                placeholder="1HGCM* or *123456 or ????????5*" className={`${fieldBox} font-mono ${RING}`} />
              <p className="mt-1 text-xs text-ink-faint">Use ? for one unknown character and * for any run. At least three real characters.</p>
            </div>
          )}
          <div>
            <label htmlFor={`${morePanelId}-sort`} className={fieldLabel}>Sort</label>
            <select id={`${morePanelId}-sort`} value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))} className={`${fieldBox} ${RING}`}>
              <option value="">Best match</option><option value="price:asc">Price: low to high</option><option value="price:desc">Price: high to low</option>
              <option value="mileage:asc">Mileage: low to high</option><option value="days:asc">Newest to lot</option>
              {filters.zip && <option value="distance">Distance</option>}
            </select>
          </div>
          {p.moreCount > 0 && (
            <button type="button" onClick={p.clearMore} className={`text-sm text-ink-muted underline underline-offset-2 hover:text-white ${RING}`}>Clear {p.moreCount} more filter{p.moreCount === 1 ? "" : "s"}</button>
          )}
        </div>
      </Panel>

      <div className="mt-3 min-h-[1rem] text-center text-xs text-ink-muted">
        {p.facetsFailed && !p.facetsLoading && <p role="status" className="text-amber-300">Couldn&apos;t refresh the counts just now, so they&apos;re hidden. Change a filter to try again.</p>}
        {(p.blockedReason || p.dirty) && <p>{p.blockedReason ?? "Filters changed — press the green button to update the results."}</p>}
        {p.excludedHidden > 0 && <p data-testid="excluded-note">{p.excludedHidden.toLocaleString()} car{p.excludedHidden === 1 ? "" : "s"} hidden by &ldquo;Leave out&rdquo;.</p>}
      </div>
    </section>
  );
}
