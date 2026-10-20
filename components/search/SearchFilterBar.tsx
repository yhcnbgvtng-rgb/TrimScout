"use client";

// The top of /search: a quick-find input + Search button, one row of plain text dropdowns (Location, Make, Model, Trim, Factory options, More),
// and the active filters as removable chips. Presentation only - BuyerSearchView owns every piece of state, every handler and every request;
// this file receives them as props and calls the same setters the old pill row called, so the filters, query params and URLs are unchanged.
// Factory options and More open as a light popover on desktop and as a bottom sheet (with "Show results") on a phone.

import React, { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { optionPriceText } from "@/lib/optionsPaidOnly";
import type { PillOption as DropdownOption } from "../admin/FilterPill";
import type { CatalogOption, Filters } from "../BuyerSearchView";

const ACCENT = "#3D9474"; // brand-500: the one green (checkbox accent); buttons use bg-brand-500 with black text like the rest of the site
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const RING = "focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-brand-400";
const SELECT_ARROW = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%239CA3AF' stroke-width='1.5'%3E%3Cpath d='m1 1 4 4 4-4'/%3E%3C/svg%3E\")";

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
}

const optLabel = (o: DropdownOption) => (o.count == null ? o.label : `${o.label} (${o.count.toLocaleString()})`);
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
function Panel({ open, onClose, anchorRef, title, width = 320, onShowResults, children }: {
  open: boolean; onClose: () => void; anchorRef: RefObject<HTMLElement | null>; title: string; width?: number; onShowResults: () => void; children: ReactNode;
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
            <button type="button" onClick={onShowResults} className={`h-11 w-full rounded-md bg-brand-500 text-sm font-semibold text-black hover:bg-brand-400 ${RING}`}>Show results</button>
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

function TriggerButton({ innerRef, label, summary, open, disabledHint, onClick, panelId }: {
  innerRef: RefObject<HTMLButtonElement | null>; label: string; summary?: string; open: boolean; disabledHint?: string; onClick: () => void; panelId: string;
}) {
  const disabled = Boolean(disabledHint);
  return (
    <button ref={innerRef} type="button" disabled={disabled} title={disabledHint} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={onClick}
      className={`flex h-9 shrink-0 items-center gap-1.5 border-b bg-transparent pb-0.5 pr-1 text-sm ${open ? "border-white" : "border-border-strong"} ${summary ? "font-medium text-white" : "text-ink-muted"} ${disabled ? "cursor-not-allowed opacity-40" : "hover:border-ink-faint"} ${RING}`}>
      <span>{label}</span>
      {summary && <span className="text-brand-400">{summary}</span>}
      <svg aria-hidden width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="#9CA3AF" strokeWidth="1.5"><path d="m1 1 4 4 4-4" /></svg>
    </button>
  );
}

function FilterSelect({ label, value, options, onChange, disabledHint }: { label: string; value: string; options: DropdownOption[]; onChange: (v: string) => void; disabledHint?: string }) {
  const id = useId();
  const disabled = Boolean(disabledHint);
  // A picked value that is not in the (still loading) list stays visible instead of snapping back to the placeholder.
  const hasValue = !value || options.some((o) => o.value === value);
  return (
    <div className="shrink-0">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={value} disabled={disabled} title={disabledHint} onChange={(e) => onChange(e.target.value)}
        className={`h-9 max-w-[11rem] cursor-pointer appearance-none truncate border-0 border-b bg-transparent bg-no-repeat [color-scheme:dark] pb-0.5 pr-5 text-sm ${value ? "border-ink-muted font-medium text-white" : "border-border-strong text-ink-muted"} ${disabled ? "cursor-not-allowed opacity-40" : "hover:border-ink-faint"} rounded-none ${RING}`}
        style={{ backgroundImage: SELECT_ARROW, backgroundPosition: "right 2px center" }}>
        <option value="">{label}</option>
        {!hasValue && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{optLabel(o)}</option>)}
      </select>
    </div>
  );
}

const fieldLabel = "mb-1 block text-xs text-ink-muted";
const fieldBox = "h-9 w-full rounded-md border border-border-strong bg-background [color-scheme:dark] px-2.5 text-sm text-white placeholder:text-ink-faint disabled:opacity-40";

export function SearchFilterBar(p: SearchFilterBarProps) {
  const { filters, setFilters } = p;
  const mobile = useIsMobile();
  const optionsAnchor = useRef<HTMLButtonElement>(null);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsPanelId = useId();
  const morePanelId = useId();
  const closeOptions = React.useCallback(() => setOptionsOpen(false), []);
  const closeMore = React.useCallback(() => p.setMoreOpen(false), [p]);

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

  const modelHint = !filters.make ? "Pick a make first" : undefined;
  const trimHint = !filters.model ? "Pick a model first" : undefined;
  const optionsHint = !filters.make || !filters.model ? "Pick a make and model first" : undefined;
  const optionsSummary = filters.optionKeys.length ? String(filters.optionKeys.length) : undefined;

  const showResults = (close: () => void) => () => { close(); p.submitSearch(); };

  // ---- chips ----
  const labelOf = (key: string) => p.catalogOptions.find((o) => o.key === key)?.label ?? key;
  const chips: Array<{ id: string; text: string; remove: () => void }> = [];
  if (filters.state) chips.push({ id: "state", text: `Location: ${filters.state}`, remove: () => setFilters((f) => ({ ...f, state: "" })) });
  if (filters.make) chips.push({ id: "make", text: `Make: ${filters.make}`, remove: () => p.setMake("") });
  if (filters.model) chips.push({ id: "model", text: `Model: ${filters.model}`, remove: () => p.setModel("") });
  if (filters.trim) chips.push({ id: "trim", text: `Trim: ${filters.trim}`, remove: () => setFilters((f) => ({ ...f, trim: "" })) });
  for (const k of filters.optionKeys) chips.push({ id: `opt-${k}`, text: labelOf(k), remove: () => setFilters((f) => ({ ...f, optionKeys: f.optionKeys.filter((x) => x !== k) })) });
  if (filters.cond) chips.push({ id: "cond", text: COND_LABEL[filters.cond] ?? filters.cond, remove: () => setFilters((f) => ({ ...f, cond: "" })) });
  if (filters.priceMin || filters.priceMax) chips.push({ id: "price", text: `Price ${filters.priceMin ? money(filters.priceMin) : "any"} – ${filters.priceMax ? money(filters.priceMax) : "any"}`, remove: () => setFilters((f) => ({ ...f, priceMin: "", priceMax: "" })) });
  if (filters.yearMin || filters.yearMax) chips.push({ id: "year", text: `Year ${filters.yearMin || "any"} – ${filters.yearMax || "any"}`, remove: () => setFilters((f) => ({ ...f, yearMin: "", yearMax: "" })) });
  if (filters.odometerMax) chips.push({ id: "odo", text: `Up to ${Number(filters.odometerMax).toLocaleString()} mi`, remove: () => setFilters((f) => ({ ...f, odometerMax: "" })) });
  if (filters.exteriorColor) chips.push({ id: "ext", text: `Exterior: ${filters.exteriorColor}`, remove: () => setFilters((f) => ({ ...f, exteriorColor: "" })) });
  if (filters.interiorColor) chips.push({ id: "int", text: `Interior: ${filters.interiorColor}`, remove: () => setFilters((f) => ({ ...f, interiorColor: "" })) });
  if (filters.possibleDemo) chips.push({ id: "demo", text: "Includes demo/loaner", remove: () => setFilters((f) => ({ ...f, possibleDemo: false })) });
  if (filters.contactOnFile) chips.push({ id: "contact", text: "Dealer contact on file", remove: () => setFilters((f) => ({ ...f, contactOnFile: false })) });
  if (filters.zip || filters.radiusMiles) chips.push({ id: "near", text: `Near ${filters.zip || "ZIP"}${filters.radiusMiles ? ` · ${filters.radiusMiles} mi` : ""}`, remove: () => setFilters((f) => ({ ...f, zip: "", radiusMiles: "", sort: f.sort === "distance" ? "" : f.sort })) });

  // ---- factory options list ----
  const [optionFilter, setOptionFilter] = useState("");
  const shownOptions = p.catalogOptions.filter((o) => !optionFilter.trim() || o.label.toLowerCase().includes(optionFilter.trim().toLowerCase()));
  const toggleKey = (key: string) => setFilters((f) => ({ ...f, optionKeys: f.optionKeys.includes(key) ? f.optionKeys.filter((k) => k !== key) : [...f.optionKeys, key] }));

  return (
    <section aria-label="Search filters" className="mx-auto mb-8 w-full max-w-[960px] px-1 py-6 text-white sm:py-10" style={{ fontFamily: FONT }}>
      <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight sm:text-3xl">Search real dealer inventory</h1>

      <form role="search" onSubmit={(e) => { e.preventDefault(); p.submitSearch(); }} className="mx-auto flex max-w-[720px] items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${listId}-input`} className="sr-only">Find a make, model or trim</label>
          <input
            id={`${listId}-input`} type="text" role="combobox" aria-expanded={findOpen && suggestions.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off"
            value={query} placeholder="Search make, model or trim"
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
          className={`h-11 shrink-0 rounded-md bg-brand-500 px-5 text-sm font-semibold text-black hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40 ${RING}`}>
          {p.searchLoading ? "Searching…" : "Search"}
        </button>
      </form>

      <div role="group" aria-label="Filters" className="relative mt-7 flex items-end justify-start gap-7 overflow-x-auto px-1 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden">
        <FilterSelect label="Location" value={filters.state} options={p.stateOptions} onChange={(state) => setFilters((f) => ({ ...f, state }))} />
        <FilterSelect label="Make" value={filters.make} options={p.makeOptions} onChange={p.setMake} />
        <FilterSelect label="Model" value={filters.model} options={p.modelOptions} onChange={p.setModel} disabledHint={modelHint} />
        <FilterSelect label="Trim" value={filters.trim} options={p.trimOptions} onChange={(trim) => setFilters((f) => ({ ...f, trim }))} disabledHint={trimHint} />
        <TriggerButton innerRef={optionsAnchor} label="Factory options" summary={optionsSummary} open={optionsOpen} disabledHint={optionsHint} panelId={optionsPanelId} onClick={() => { p.setMoreOpen(false); setOptionsOpen((o) => !o); }} />
        <TriggerButton innerRef={moreAnchor} label="More" summary={p.moreCount > 0 ? String(p.moreCount) : undefined} open={p.moreOpen} panelId={morePanelId} onClick={() => { setOptionsOpen(false); p.setMoreOpen(!p.moreOpen); }} />
      </div>

      <Panel open={optionsOpen} onClose={closeOptions} anchorRef={optionsAnchor} title="Factory options" width={340} onShowResults={showResults(closeOptions)}>
        <div id={optionsPanelId}>
          {p.catalogOptions.length > 8 && (
            <div className="mb-3">
              <label htmlFor={`${optionsPanelId}-filter`} className="sr-only">Filter factory options</label>
              <input id={`${optionsPanelId}-filter`} type="text" value={optionFilter} onChange={(e) => setOptionFilter(e.target.value)} placeholder="Filter options" className={`${fieldBox} ${RING}`} />
            </div>
          )}
          {p.catalogOptionsLoading && p.catalogOptions.length === 0 ? (
            <p role="status" className="py-2 text-sm text-ink-muted">Loading…</p>
          ) : p.catalogOptions.length === 0 ? (
            <p className="py-2 text-sm text-ink-muted">{p.optionsEmptyMessage}</p>
          ) : (
            <ul className="-mx-1">
              {shownOptions.map((o) => {
                const price = optionPriceText(o.minPrice, o.maxPrice); // empty when the data has no price: the slot is not rendered
                const id = `${optionsPanelId}-${o.key}`;
                return (
                  <li key={o.key}>
                    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded px-1 py-2 text-sm hover:bg-surface">
                      <input id={id} type="checkbox" checked={filters.optionKeys.includes(o.key)} onChange={() => toggleKey(o.key)} className={`h-4 w-4 shrink-0 ${RING}`} style={{ accentColor: ACCENT }} />
                      <span className="min-w-0 flex-1">{o.label}</span>
                      {price && <span className="shrink-0 tabular-nums text-ink-muted">{price}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {filters.optionKeys.length > 0 && (
            <button type="button" onClick={() => setFilters((f) => ({ ...f, optionKeys: [] }))} className={`mt-2 text-sm text-ink-muted underline underline-offset-2 hover:text-white ${RING}`}>Clear factory options</button>
          )}
        </div>
      </Panel>

      <Panel open={p.moreOpen} onClose={closeMore} anchorRef={moreAnchor} title="More filters" width={360} onShowResults={showResults(closeMore)}>
        <div
          id={morePanelId}
          onKeyDown={(e) => {
            const t = e.target as HTMLElement;
            if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox") { e.preventDefault(); p.submitSearch(); }
          }}
          className="space-y-4">
          <div>
            <label htmlFor={`${morePanelId}-cond`} className={fieldLabel}>Condition</label>
            <select id={`${morePanelId}-cond`} value={filters.cond} onChange={(e) => setFilters((f) => ({ ...f, cond: e.target.value }))} className={`${fieldBox} ${RING}`}>
              <option value="">New + used</option><option value="new">New</option><option value="used">Used</option><option value="cpo">Certified</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor={`${morePanelId}-pmin`} className={fieldLabel}>Price min</label><input id={`${morePanelId}-pmin`} type="number" inputMode="numeric" value={filters.priceMin} onChange={(e) => setFilters((f) => ({ ...f, priceMin: e.target.value }))} placeholder="$0" className={`${fieldBox} ${RING}`} /></div>
            <div><label htmlFor={`${morePanelId}-pmax`} className={fieldLabel}>Price max</label><input id={`${morePanelId}-pmax`} type="number" inputMode="numeric" value={filters.priceMax} onChange={(e) => setFilters((f) => ({ ...f, priceMax: e.target.value }))} placeholder="No max" className={`${fieldBox} ${RING}`} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor={`${morePanelId}-ymin`} className={fieldLabel}>Year min</label><input id={`${morePanelId}-ymin`} type="number" inputMode="numeric" value={filters.yearMin} onChange={(e) => setFilters((f) => ({ ...f, yearMin: e.target.value }))} placeholder="Any" className={`${fieldBox} ${RING}`} /></div>
            <div><label htmlFor={`${morePanelId}-ymax`} className={fieldLabel}>Year max</label><input id={`${morePanelId}-ymax`} type="number" inputMode="numeric" value={filters.yearMax} onChange={(e) => setFilters((f) => ({ ...f, yearMax: e.target.value }))} placeholder="Any" className={`${fieldBox} ${RING}`} /></div>
          </div>
          <div><label htmlFor={`${morePanelId}-odo`} className={fieldLabel}>Max odometer</label><input id={`${morePanelId}-odo`} type="number" inputMode="numeric" value={filters.odometerMax} onChange={(e) => setFilters((f) => ({ ...f, odometerMax: e.target.value }))} placeholder="Any mileage" className={`${fieldBox} ${RING}`} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${morePanelId}-ext`} className={fieldLabel}>Exterior color</label>
              <select id={`${morePanelId}-ext`} value={filters.exteriorColor} onChange={(e) => setFilters((f) => ({ ...f, exteriorColor: e.target.value }))} className={`${fieldBox} ${RING}`}>
                <option value="">Any</option>{p.exteriorColors.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${morePanelId}-int`} className={fieldLabel}>Interior color</label>
              <select id={`${morePanelId}-int`} value={filters.interiorColor} onChange={(e) => setFilters((f) => ({ ...f, interiorColor: e.target.value }))} className={`${fieldBox} ${RING}`}>
                <option value="">Any</option>{p.interiorColors.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
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
              <div><label htmlFor={`${morePanelId}-zip`} className="sr-only">ZIP code</label><input id={`${morePanelId}-zip`} type="text" inputMode="numeric" value={filters.zip} onChange={(e) => setFilters((f) => ({ ...f, zip: e.target.value }))} placeholder="ZIP code" className={`${fieldBox} ${RING}`} /></div>
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

      {chips.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <ul aria-label="Active filters" className="flex flex-wrap items-center justify-center gap-2">
            {chips.map((c) => (
              <li key={c.id} className="flex items-center gap-1 rounded-full border border-border bg-surface-elevated py-1 pl-3 pr-1 text-xs text-ink-light">
                <span>{c.text}</span>
                <button type="button" onClick={c.remove} aria-label={`Remove ${c.text}`} className={`flex h-5 w-5 items-center justify-center rounded-full text-ink-muted hover:bg-border-strong hover:text-white ${RING}`}>
                  <svg aria-hidden width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5"><path d="m1 1 6 6M7 1 1 7" /></svg>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={p.clearAll} className={`ml-1 text-xs text-ink-muted underline underline-offset-2 hover:text-white ${RING}`}>Clear all</button>
        </div>
      )}

      <div className="mt-4 min-h-[1rem] text-center text-xs text-ink-muted">
        {p.facetsFailed && !p.facetsLoading && <p role="status" className="text-amber-300">Couldn&apos;t refresh the counts just now, so they&apos;re hidden. Change a filter to try again.</p>}
        {(p.blockedReason || p.dirty) && <p>{p.blockedReason ?? "Filters changed — press Search to update the results."}</p>}
      </div>
    </section>
  );
}
