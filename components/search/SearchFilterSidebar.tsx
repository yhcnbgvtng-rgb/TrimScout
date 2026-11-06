"use client";

// The filters on /search: one left-hand FILTERS accordion (Condition, Location, Make, Model, Trim, Year, Price, Odometer, Color,
// Factory options, Other). Desktop: a fixed ~300px column that sticks under the site header. Phone: a slide-over drawer opened from
// the "Filters" button above the results. It is the same component in both places (one DOM instance, moved with CSS), so the form
// controls exist once.
// Presentation only - BuyerSearchView owns every piece of state, every handler and every request; this file receives them as props.

import React, { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { optionPriceText, optionsPaidOnlyEnabled } from "@/lib/optionsPaidOnly";
import { parseExclude } from "@/lib/searchLive";
import type { PillOption as DropdownOption } from "../admin/FilterPill";
import type { CatalogOption, Filters } from "../BuyerSearchView";
import { LiveCount, type LiveCountProps } from "./LiveCount";
import { PriceRange } from "./PriceRange";

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const RING = "focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-brand-400";

export interface SearchFilterSidebarProps {
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
  clearAll: () => void;
  contactFilterOn: boolean;
  blockedReason: string | null;
  /** A VIN lookup is showing in place of the filter results: the "pick a make" / "filters changed" hint is about those results, so it is hidden. */
  hintHidden?: boolean;
  dirty: boolean;
  searchLoading: boolean;
  submitSearch: () => void;
  /** The headline count (see LiveCount) and where the shopper is in "Show N vehicles". */
  live: LiveCountProps;
  /** Cars on screen hidden by the keyword-exclude field. */
  excludedHidden: number;
  /** Phone drawer state. On desktop the column is always showing and these are ignored. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const money = (n: string) => `$${Number(n).toLocaleString()}`;
const COND_LABEL: Record<string, string> = { new: "New", used: "Used", cpo: "Certified" };
const TOP_MAKES = 6;
/** A picked color always stays selectable, even before (or after) the scoped list loads, so the dropdown never shows blank for an active filter. */
export const withPicked = (list: string[], picked: string): string[] => (picked && !list.includes(picked) ? [picked, ...list] : list);

const SECTION_IDS =["condition", "location", "make", "model", "trim", "year", "price", "odometer", "color", "options", "other"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Section({ id, title, badge, open, onToggle, children }: { id: string; title: string; badge?: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-b border-border">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className={`flex w-full items-center justify-between px-4 py-3 text-left ${RING}`}>
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          {title}
          {!!badge && <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-bold leading-4 text-black">{badge}</span>}
        </span>
        <Chevron open={open} />
      </button>
      {open && <div id={id} className="px-4 pb-4">{children}</div>}
    </div>
  );
}

const pill = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${RING} ${on ? "border-brand-500 bg-brand-500/15 text-brand-300" : "border-border-strong bg-surface-elevated text-ink-light hover:text-white"}`;
const field = `w-full rounded-lg border border-border-strong bg-surface-elevated px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:border-brand-500 focus:outline-none [color-scheme:dark] disabled:opacity-40 ${RING}`;
const fieldLabel = "mb-1 block text-xs text-ink-muted";

/** Pills for one list of facet options (value + live count). Zero-count options are dropped; a picked option always stays. */
function PillList({ options, selected, onToggle, label }: { options: DropdownOption[]; selected: string[]; onToggle: (value: string) => void; label: string }) {
  const visible = options.filter((o) => o.count == null || o.count > 0 || selected.includes(o.value));
  if (!visible.length) return <p className="text-xs text-ink-faint">No {label.toLowerCase()} to show for these filters.</p>;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {visible.map((o) => {
        const on = selected.includes(o.value);
        return (
          <li key={o.value}>
            <button type="button" onClick={() => onToggle(o.value)} aria-pressed={on} className={pill(on)}>
              {o.label}
              {o.count != null && <span className={`ml-1.5 font-normal tabular-nums ${on ? "text-brand-300" : "text-ink-faint"}`}>{o.count.toLocaleString()}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function SearchFilterSidebar(p: SearchFilterSidebarProps) {
  const { filters, setFilters } = p;
  const uid = useId();
  const paidOnly = optionsPaidOnlyEnabled();
  const panelRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<Record<SectionId, boolean>>({ condition: true, location: true, make: true, model: true, trim: false, year: false, price: false, odometer: false, color: false, options: false, other: false });
  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  // A section a shopper cannot use yet (Model before a make) opens as soon as it can be used, and any section with a value stays openable.
  const [q, setQ] = useState({ make: "", model: "", trim: "", options: "" });
  const [allMakes, setAllMakes] = useState(false);
  const match = <T extends { label: string }>(items: T[], text: string) => {
    const t = text.trim().toLowerCase();
    return t ? items.filter((i) => i.label.toLowerCase().includes(t)) : items;
  };
  // Make: the six biggest (by the existing vehicle counts) show by default; a search always runs over the FULL list, and a picked make stays visible.
  const makeSearching = q.make.trim() !== "";
  const makeRanked = useMemo(
    () => p.makeOptions.map((o, i) => ({ o, i })).filter(({ o }) => o.count == null || o.count > 0 || o.value === filters.make)
      .sort((a, b) => (b.o.count ?? 0) - (a.o.count ?? 0) || a.i - b.i).map(({ o }) => o),
    [p.makeOptions, filters.make]);
  const makeHidden = Math.max(0, makeRanked.length - TOP_MAKES);
  const makeShown = makeSearching ? match(p.makeOptions, q.make)
    : allMakes ? makeRanked
    : makeRanked.filter((o, i) => i < TOP_MAKES || o.value === filters.make);
  const typeBox = (key: keyof typeof q, placeholder: string) => (
    <input
      type="search" value={q[key]} onChange={(e) => setQ((s) => ({ ...s, [key]: e.target.value }))} placeholder={placeholder} aria-label={placeholder} autoComplete="off"
      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} // Enter in a type-to-filter box must not run the search
      className={`${field} mb-2`} />
  );

  // ---- phone drawer: Escape closes, Tab stays inside, the page behind does not scroll ----
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const drawer = narrow && p.drawerOpen;
  const closeRef = useRef(p.setDrawerOpen);
  closeRef.current = p.setDrawerOpen;
  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(false); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [drawer]);

  // ---- selected-filter chips (same set the old bar showed) ----
  const labelOf = (key: string) => p.catalogOptions.find((o) => o.key === key)?.label ?? key;
  const chips: Array<{ id: string; text: string; remove: () => void }> = [];
  if (filters.cond) chips.push({ id: "cond", text: COND_LABEL[filters.cond] ?? filters.cond, remove: () => setFilters((f) => ({ ...f, cond: "" })) });
  if (filters.state) chips.push({ id: "state", text: `Location: ${filters.state}`, remove: () => setFilters((f) => ({ ...f, state: "" })) });
  if (filters.zip || filters.radiusMiles) chips.push({ id: "near", text: `Near ${filters.zip || "ZIP"}${filters.radiusMiles ? ` · ${filters.radiusMiles} mi` : ""}`, remove: () => setFilters((f) => ({ ...f, zip: "", radiusMiles: "", sort: f.sort === "distance" ? "" : f.sort })) });
  if (filters.make) chips.push({ id: "make", text: filters.make, remove: () => p.setMake("") });
  if (filters.model) chips.push({ id: "model", text: filters.model, remove: () => p.setModel("") });
  if (filters.trim) chips.push({ id: "trim", text: filters.trim, remove: () => setFilters((f) => ({ ...f, trim: "" })) });
  if (filters.yearMin || filters.yearMax) chips.push({ id: "year", text: `Year ${filters.yearMin || "any"} – ${filters.yearMax || "any"}`, remove: () => setFilters((f) => ({ ...f, yearMin: "", yearMax: "" })) });
  if (filters.priceMin || filters.priceMax) chips.push({ id: "price", text: `Price ${filters.priceMin ? money(filters.priceMin) : "any"} – ${filters.priceMax ? money(filters.priceMax) : "any"}`, remove: () => setFilters((f) => ({ ...f, priceMin: "", priceMax: "" })) });
  if (filters.odometerMax) chips.push({ id: "odo", text: `Up to ${Number(filters.odometerMax).toLocaleString()} mi`, remove: () => setFilters((f) => ({ ...f, odometerMax: "" })) });
  if (filters.exteriorColor) chips.push({ id: "ext", text: `Exterior: ${filters.exteriorColor}`, remove: () => setFilters((f) => ({ ...f, exteriorColor: "" })) });
  if (filters.interiorColor) chips.push({ id: "int", text: `Interior: ${filters.interiorColor}`, remove: () => setFilters((f) => ({ ...f, interiorColor: "" })) });
  for (const k of filters.optionKeys) chips.push({ id: `opt-${k}`, text: labelOf(k), remove: () => setFilters((f) => ({ ...f, optionKeys: f.optionKeys.filter((x) => x !== k) })) });
  if (filters.possibleDemo) chips.push({ id: "demo", text: "Includes demo/loaner", remove: () => setFilters((f) => ({ ...f, possibleDemo: false })) });
  if (filters.contactOnFile) chips.push({ id: "contact", text: "Dealer contact on file", remove: () => setFilters((f) => ({ ...f, contactOnFile: false })) });
  const excludeTerms = parseExclude(filters.exclude);
  if (excludeTerms.length) chips.push({ id: "exclude", text: `Without: ${excludeTerms.join(", ")}`, remove: () => setFilters((f) => ({ ...f, exclude: "" })) });

  // ---- data for the sections ----
  const countsOff = p.facetsLoading || p.facetsFailed;
  const listedOptions = useMemo(() => (paidOnly ? p.catalogOptions.filter((o) => optionPriceText(o.minPrice, o.maxPrice)) : p.catalogOptions), [paidOnly, p.catalogOptions]);
  const optionRows = listedOptions.map((o) => ({
    key: o.key, label: o.label, count: o.vehicleCount,
    // Paid-only: a row with no paid price never lists; flag off, or no paid price in the data: no price slot.
    detail: paidOnly ? optionPriceText(o.minPrice, o.maxPrice, true) || undefined : undefined,
  }));
  const toggleOption = (key: string) => setFilters((f) => ({ ...f, optionKeys: f.optionKeys.includes(key) ? f.optionKeys.filter((x) => x !== key) : [...f.optionKeys, key] }));
  const toggleIn = (key: "cond", value: string) => setFilters((f) => ({ ...f, [key]: f[key] === value ? "" : value }));
  const colorCount = (filters.exteriorColor ? 1 : 0) + (filters.interiorColor ? 1 : 0);
  const locationCount = (filters.state ? 1 : 0) + (filters.zip ? 1 : 0);
  const otherCount = (filters.exclude ? 1 : 0) + (filters.possibleDemo ? 1 : 0) + (filters.contactOnFile ? 1 : 0);
  const countLabel = p.searchLoading ? "Searching…" : p.live.value == null ? "Search" : `Show ${p.live.value.toLocaleString()}${p.live.capped ? "+" : ""} vehicle${p.live.value === 1 && !p.live.capped ? "" : "s"}`;
  const id = (s: SectionId) => `${uid}-${s}`;
  const needMake = <p className="text-xs text-ink-faint">Pick a make first.</p>;

  const panel = (
    <aside
      ref={panelRef} aria-label="Search filters" data-testid="filters-sidebar" role={drawer ? "dialog" : undefined} aria-modal={drawer ? true : undefined}
      className={[
        "flex flex-col border-r border-border bg-surface text-white [color-scheme:dark]",
        // phone: a drawer that slides in from the left; md and up: a sticky column under the 3.5rem site header and above the picks bar
        "fixed inset-y-0 left-0 z-50 w-[88%] max-w-sm transition-transform duration-200",
        p.drawerOpen ? "translate-x-0" : "-translate-x-full",
        "md:sticky md:top-14 md:z-10 md:h-[calc(100dvh-3.5rem-var(--picks-bar-h,0px))] md:w-[300px] md:max-w-none md:shrink-0 md:translate-x-0 md:transition-none",
      ].join(" ")}
      // A drawer that is slid off-screen must not be reachable by Tab or a screen reader.
      {...(narrow && !p.drawerOpen ? ({ inert: "" } as Record<string, string>) : {})}
      style={{ fontFamily: FONT }}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); p.submitSearch(); p.setDrawerOpen(false); }} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-white">Filters</h2>
          <div className="flex items-center gap-3">
            <button type="button" onClick={p.clearAll} className={`text-xs font-semibold text-brand-300 hover:text-brand-200 ${RING}`}>Clear all</button>
            <button type="button" onClick={() => p.setDrawerOpen(false)} aria-label="Close filters" className={`text-ink-light hover:text-white md:hidden ${RING}`}>
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>

        <div className="border-b border-border px-4 pb-3">
          <LiveCount {...p.live} compact />
          {chips.length > 0 && (
            <ul data-testid="selected-bar" aria-label="Active filters" className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={c.remove} aria-label={`Remove ${c.text}`} className={`inline-flex items-center gap-1 rounded-full border border-brand-500/50 bg-brand-500/10 py-1 pl-2.5 pr-2 text-[11px] font-semibold text-brand-300 hover:bg-brand-500/20 ${RING}`}>
                    {c.text}
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M3 3l6 6M9 3L3 9" strokeLinecap="round" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 space-y-1 text-[11px] text-ink-muted empty:hidden">
            {p.facetsFailed && !p.facetsLoading && <p role="status" className="text-amber-300">Couldn&apos;t refresh the counts just now, so they&apos;re hidden. Change a filter to try again.</p>}
            {!p.hintHidden && (p.blockedReason || p.dirty) && <p>{p.blockedReason ?? "Filters changed — press the green button to update the results."}</p>}
            {p.excludedHidden > 0 && <p data-testid="excluded-note">{p.excludedHidden.toLocaleString()} car{p.excludedHidden === 1 ? "" : "s"} hidden by &ldquo;Leave out&rdquo;.</p>}
          </div>
        </div>

        <div role="group" aria-label="Filters" className="min-h-0 flex-1 overflow-y-auto">
          <Section id={id("condition")} title="Condition" badge={filters.cond ? 1 : 0} open={open.condition} onToggle={() => toggle("condition")}>
            <div className="flex gap-2">
              {(["new", "used", "cpo"] as const).map((v) => (
                <button key={v} type="button" onClick={() => toggleIn("cond", v)} aria-pressed={filters.cond === v} className={`${pill(filters.cond === v)} flex-1`}>{COND_LABEL[v]}</button>
              ))}
            </div>
          </Section>

          <Section id={id("location")} title="Location" badge={locationCount} open={open.location} onToggle={() => toggle("location")}>
            <p className="mb-2 text-xs text-ink-faint">Pick a state, or enter a ZIP and radius to search near you.</p>
            <label htmlFor={`${uid}-state`} className="sr-only">State</label>
            <select id={`${uid}-state`} value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))} className={`${field} mb-2`}>
              <option value="">All states</option>
              {p.stateOptions.filter((o) => o.count == null || o.count > 0 || o.value === filters.state).map((o) => (
                <option key={o.value} value={o.value}>{o.label}{o.count != null ? ` · ${o.count.toLocaleString()}` : ""}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${uid}-zip`} className="sr-only">ZIP code</label>
                <input id={`${uid}-zip`} type="text" inputMode="numeric" value={filters.zip} onChange={(e) => setFilters((f) => ({ ...f, zip: e.target.value }))} placeholder="ZIP code" className={field} />
              </div>
              <div className="w-28 shrink-0">
                <label htmlFor={`${uid}-rad`} className="sr-only">Radius in miles</label>
                <input id={`${uid}-rad`} type="number" inputMode="numeric" value={filters.radiusMiles} onChange={(e) => setFilters((f) => ({ ...f, radiusMiles: e.target.value }))} placeholder="Miles"
                  disabled={!filters.make || !filters.zip} title={!filters.zip ? "Enter a ZIP code to search within a radius" : !filters.make ? "Pick a make to search within a radius" : undefined} className={field} />
              </div>
            </div>
            {filters.radiusMiles && (!filters.make || !filters.zip) && (
              <p className="mt-1 text-xs text-ink-muted">{!filters.zip ? "Enter a ZIP code" : "Pick a make"} to search within a distance.</p>
            )}
          </Section>

          <Section id={id("make")} title="Make" badge={filters.make ? 1 : 0} open={open.make} onToggle={() => toggle("make")}>
            {p.facetsLoading && !p.makeOptions.length ? <p className="text-xs text-ink-faint">Loading makes…</p> : (
              <>
                {typeBox("make", "Search makes")}
                <PillList label="Makes" options={makeShown} selected={filters.make ? [filters.make] : []} onToggle={(v) => p.setMake(filters.make === v ? "" : v)} />
                {!makeSearching && makeHidden > 0 && (
                  <button type="button" onClick={() => setAllMakes((v) => !v)} aria-expanded={allMakes} className={`mt-2 text-xs font-semibold text-brand-300 hover:text-white ${RING}`}>
                    {allMakes ? "Show fewer" : "Show all makes"}
                  </button>
                )}
              </>
            )}
          </Section>

          <Section id={id("model")} title="Model" badge={filters.model ? 1 : 0} open={open.model} onToggle={() => toggle("model")}>
            {!filters.make ? needMake : (
              <>
                {typeBox("model", "Search models")}
                <PillList label="Models" options={match(p.modelOptions, q.model)} selected={filters.model ? [filters.model] : []} onToggle={(v) => p.setModel(filters.model === v ? "" : v)} />
              </>
            )}
          </Section>

          <Section id={id("trim")} title="Trim" badge={filters.trim ? 1 : 0} open={open.trim} onToggle={() => toggle("trim")}>
            {!filters.make ? needMake : (
              <>
                {typeBox("trim", "Search trims")}
                <PillList label="Trims" options={match(p.trimOptions, q.trim)} selected={filters.trim ? [filters.trim] : []} onToggle={(v) => setFilters((f) => ({ ...f, trim: f.trim === v ? "" : v }))} />
              </>
            )}
          </Section>

          <Section id={id("year")} title="Year" badge={filters.yearMin || filters.yearMax ? 1 : 0} open={open.year} onToggle={() => toggle("year")}>
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor={`${uid}-ymin`} className={fieldLabel}>From</label><input id={`${uid}-ymin`} type="number" inputMode="numeric" value={filters.yearMin} onChange={(e) => setFilters((f) => ({ ...f, yearMin: e.target.value }))} className={field} /></div>
              <div><label htmlFor={`${uid}-ymax`} className={fieldLabel}>To</label><input id={`${uid}-ymax`} type="number" inputMode="numeric" value={filters.yearMax} onChange={(e) => setFilters((f) => ({ ...f, yearMax: e.target.value }))} className={field} /></div>
            </div>
          </Section>

          <Section id={id("price")} title="Price" badge={filters.priceMin || filters.priceMax ? 1 : 0} open={open.price} onToggle={() => toggle("price")}>
            <PriceRange min={filters.priceMin} max={filters.priceMax} onChange={(priceMin, priceMax) => setFilters((f) => ({ ...f, priceMin, priceMax }))} />
          </Section>

          <Section id={id("odometer")} title="Odometer" badge={filters.odometerMax ? 1 : 0} open={open.odometer} onToggle={() => toggle("odometer")}>
            <label htmlFor={`${uid}-odo`} className={fieldLabel}>Max odometer (miles)</label>
            <input id={`${uid}-odo`} type="number" inputMode="numeric" value={filters.odometerMax} onChange={(e) => setFilters((f) => ({ ...f, odometerMax: e.target.value }))} className={field} />
          </Section>

          <Section id={id("color")} title="Color" badge={colorCount} open={open.color} onToggle={() => toggle("color")}>
            <div className="space-y-3">
              <div>
                <label htmlFor={`${uid}-ext`} className={fieldLabel}>Exterior color</label>
                <select id={`${uid}-ext`} value={filters.exteriorColor} onChange={(e) => setFilters((f) => ({ ...f, exteriorColor: e.target.value }))} className={field}>
                  <option value="">Any</option>{withPicked(p.exteriorColors, filters.exteriorColor).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-int`} className={fieldLabel}>Interior color</label>
                <select id={`${uid}-int`} value={filters.interiorColor} onChange={(e) => setFilters((f) => ({ ...f, interiorColor: e.target.value }))} className={field}>
                  <option value="">Any</option>{withPicked(p.interiorColors, filters.interiorColor).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </Section>

          <Section id={id("options")} title={paidOnly ? "Paid factory options" : "Factory options"} badge={filters.optionKeys.length} open={open.options} onToggle={() => toggle("options")}>
            {!filters.make ? needMake : p.catalogOptionsLoading ? <p className="text-xs text-ink-faint">Loading options…</p> : optionRows.length === 0 && !filters.optionKeys.length ? (
              <p className="text-xs text-ink-faint">{p.optionsEmptyMessage}</p>
            ) : (
              <>
                {typeBox("options", "Search options")}
                <ul aria-label="Factory options" className="space-y-1.5">
                  {match(optionRows, q.options).filter((o) => o.count == null || o.count > 0 || filters.optionKeys.includes(o.key)).map((o) => (
                    <li key={o.key}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-light hover:text-white">
                        <input type="checkbox" checked={filters.optionKeys.includes(o.key)} onChange={() => toggleOption(o.key)} className={`h-4 w-4 accent-brand-500 ${RING}`} />
                        <span className="min-w-0 flex-1">{o.label}{o.detail && <span className="ml-1.5 text-xs tabular-nums text-ink-muted">{o.detail}</span>}</span>
                        {o.count != null && <span className="text-xs tabular-nums text-ink-faint">{o.count.toLocaleString()}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section id={id("other")} title="Other" badge={otherCount} open={open.other} onToggle={() => toggle("other")}>
            <div className="space-y-3">
              <div>
                <label htmlFor={`${uid}-excl`} className={fieldLabel}>Leave out</label>
                <input id={`${uid}-excl`} type="text" value={filters.exclude} onChange={(e) => setFilters((f) => ({ ...f, exclude: e.target.value }))} placeholder="Words to hide, e.g. black, sport" autoComplete="off" className={field} />
              </div>
              {p.contactFilterOn && (
                <label className="flex items-center gap-2 text-sm text-ink-light" title="Only cars whose dealer has a valid sales email on file with us">
                  <input type="checkbox" checked={filters.contactOnFile} onChange={(e) => setFilters((f) => ({ ...f, contactOnFile: e.target.checked }))} className={`h-4 w-4 accent-brand-500 ${RING}`} />
                  Dealer contact on file
                </label>
              )}
              <label className="flex items-center gap-2 text-sm text-ink-light">
                <input type="checkbox" checked={filters.possibleDemo} onChange={(e) => setFilters((f) => ({ ...f, possibleDemo: e.target.checked }))} className={`h-4 w-4 accent-brand-500 ${RING}`} />
                Include likely demo/loaner vehicles
              </label>
              <div>
                <label htmlFor={`${uid}-sort`} className={fieldLabel}>Sort</label>
                <select id={`${uid}-sort`} value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))} className={field}>
                  <option value="">Best match</option><option value="price:asc">Price: low to high</option><option value="price:desc">Price: high to low</option>
                  <option value="mileage:asc">Mileage: low to high</option><option value="days:asc">Newest to lot</option>
                  {filters.zip && <option value="distance">Distance</option>}
                </select>
              </div>
            </div>
          </Section>
        </div>

        <div className="border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="submit" disabled={Boolean(p.blockedReason) || p.searchLoading} title={p.blockedReason ?? undefined}
            className={`h-11 w-full rounded-lg bg-brand-500 text-sm font-bold text-black hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40 ${RING}`}>
            {countLabel}
          </button>
        </div>
      </form>
    </aside>
  );

  return (
    <>
      {drawer && <div data-testid="filters-backdrop" className="fixed inset-0 z-40 bg-black/60 md:hidden" aria-hidden onClick={() => p.setDrawerOpen(false)} />}
      {panel}
    </>
  );
}

/** The phone-only button above the results that opens the drawer. */
export function FiltersDrawerButton({ count, onOpen, expanded }: { count: number; onOpen: () => void; expanded: boolean }) {
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" aria-expanded={expanded}
      className={`mb-4 flex h-11 w-full items-center justify-between rounded-xl border border-border bg-surface-elevated px-4 text-sm font-semibold text-white md:hidden ${RING}`}>
      <span>Filters{count > 0 ? ` (${count})` : ""}</span>
      <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 5h14M6 10h8M9 15h2" strokeLinecap="round" /></svg>
    </button>
  );
}
