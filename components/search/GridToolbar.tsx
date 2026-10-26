"use client";

// Above the grid: the big live count, the active filters as removable pills (with Clear all), the "Leave out" keyword box, the Columns menu and a
// small "More" menu (ZIP, demo, contact). On a phone the Filter button opens FilterSheet: every column's filter in a bottom sheet with a
// "Show N vehicles" button. Presentation only; BuyerSearchView owns the state.

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, SlidersHorizontal, X } from "lucide-react";
import { columnActive, columnOf, GRID_COLUMNS, type GridColumnKey, type Pill } from "@/lib/searchGrid";
import type { UrlFilters } from "@/lib/searchUrlState";
import { ColumnFilterPanel, type ColumnPanel } from "./ColumnFilterPanel";
import { LiveCount, type LiveCountProps } from "./LiveCount";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-ink-light hover:border-border-strong hover:text-white focus-visible:outline-2 focus-visible:outline-brand-500";

function Menu({ label, icon, badge, children }: { label: string; icon: React.ReactNode; badge?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" className={BTN}>
        {icon}{label}{badge ? <span className="rounded-full bg-brand-500 px-1.5 text-[10px] text-black">{badge}</span> : null}
      </button>
      {open && <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-border-strong bg-surface-elevated p-3 shadow-2xl">{children}</div>}
    </div>
  );
}

export interface GridToolbarProps {
  live: LiveCountProps;
  filters: UrlFilters;
  pills: Pill[];
  onPill: (p: Pill) => void;
  onClearAll: () => void;
  setFilters: (fn: (f: UrlFilters) => UrlFilters) => void;
  /** Columns the box sends (the Columns menu lists only these) and which of them are shown. */
  available: GridColumnKey[];
  visible: GridColumnKey[];
  onVisible: (next: GridColumnKey[]) => void;
  contactFilterOn: boolean;
  excludedHidden: number;
  onOpenSheet: () => void;
  blockedReason: string | null;
}

export function GridToolbar(p: GridToolbarProps) {
  const exId = useId();
  const [exclude, setExclude] = useState(p.filters.exclude);
  // The box is edited as you type, but a request goes out only 400 ms after the last keystroke.
  useEffect(() => { setExclude(p.filters.exclude); }, [p.filters.exclude]);
  useEffect(() => {
    if (exclude === p.filters.exclude) return;
    const t = setTimeout(() => p.setFilters((f) => ({ ...f, exclude })), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exclude]);
  const toggleCol = (k: GridColumnKey) => p.onVisible(p.visible.includes(k) ? p.visible.filter((x) => x !== k) : GRID_COLUMNS.map((c) => c.key).filter((x) => x === k || p.visible.includes(x)));
  return (
    <section aria-label="Search summary" className="mb-4">
      <LiveCount {...p.live} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={p.onOpenSheet} className={`${BTN} md:hidden`} data-testid="open-filter-sheet"><SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />Filters{p.pills.length ? <span className="rounded-full bg-brand-500 px-1.5 text-[10px] text-black">{p.pills.length}</span> : null}</button>
        <div className="flex min-w-[10rem] flex-1 items-center gap-2 md:max-w-xs">
          <label htmlFor={exId} className="sr-only">Leave out words</label>
          <input id={exId} value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="Leave out: demo, loaner…" disabled={!p.filters.make}
            title={p.filters.make ? undefined : "Pick a make first"} className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-white placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50" />
        </div>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Menu label="More" icon={<SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />}><MoreBody {...p} /></Menu>
          <Menu label="Columns" icon={<Columns3 aria-hidden className="h-3.5 w-3.5" />}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Show columns</p>
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {p.available.map((k) => (
                <li key={k}><label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-ink-light hover:bg-surface"><input type="checkbox" checked={p.visible.includes(k)} onChange={() => toggleCol(k)} className="h-3.5 w-3.5 accent-brand-500" />{columnOf(k).label}</label></li>
              ))}
            </ul>
          </Menu>
        </div>
      </div>
      {p.pills.length > 0 && (
        <ul aria-label="Active filters" className="mt-3 flex flex-wrap items-center gap-2">
          {p.pills.map((pill) => (
            <li key={pill.id} className="flex max-w-full items-center gap-1 rounded-full border border-brand-500/40 bg-brand-500/10 py-1 pl-3 pr-1.5 text-[11px] text-brand-200">
              <span className="truncate">{pill.label}</span>
              <button type="button" onClick={() => p.onPill(pill)} aria-label={`Remove ${pill.label}`} className="rounded-full p-0.5 text-brand-300/70 hover:text-white"><X className="h-3 w-3" /></button>
            </li>
          ))}
          <li><button type="button" onClick={p.onClearAll} className="text-xs font-bold text-ink-muted underline-offset-2 hover:text-white hover:underline">Clear all</button></li>
        </ul>
      )}
      {p.excludedHidden > 0 && <p className="mt-2 text-[11px] text-ink-faint">{p.excludedHidden} on screen hidden by your leave-out words.</p>}
    </section>
  );
}

/** ZIP + radius, possible-demo and dealer-contact: filters that are not columns. */
function MoreBody(p: GridToolbarProps) {
  const f = p.filters;
  const set = (patch: Partial<UrlFilters>) => p.setFilters((x) => ({ ...x, ...patch }));
  return (
    <div className="space-y-3 text-xs text-ink-light">
      <div className="flex gap-2">
        <label className="flex-1 text-[11px] font-semibold text-ink-muted">ZIP<input inputMode="numeric" value={f.zip} onChange={(e) => set({ zip: e.target.value.replace(/\D/g, "").slice(0, 5) })} className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-normal text-white" /></label>
        <label className="flex-1 text-[11px] font-semibold text-ink-muted">Miles
          <select value={f.radiusMiles} onChange={(e) => set({ radiusMiles: e.target.value })} className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-normal text-white">
            <option value="">Any</option>{[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.possibleDemo} onChange={(e) => set({ possibleDemo: e.target.checked })} className="h-3.5 w-3.5 accent-brand-500" />Possible demo or loaner only</label>
      {p.contactFilterOn && <label className="flex items-center gap-2"><input type="checkbox" checked={f.contactOnFile} onChange={(e) => set({ contactOnFile: e.target.checked })} className="h-3.5 w-3.5 accent-brand-500" />Dealer contact on file</label>}
      {p.blockedReason && <p className="text-[11px] text-ink-faint">{p.blockedReason}</p>}
    </div>
  );
}

/** Phone: every column's filter in one bottom sheet, with a button that shows the count it will give. */
export function FilterSheet({ open, onClose, panels, filters, available, count, countPending, onClearAll, blockedReason }: {
  open: boolean; onClose: () => void; panels: Partial<Record<GridColumnKey, ColumnPanel>>; filters: UrlFilters; available: GridColumnKey[];
  count: number | null; countPending: boolean; onClearAll: () => void; blockedReason: string | null;
}) {
  const [openKey, setOpenKey] = useState<GridColumnKey | null>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  const keys = GRID_COLUMNS.map((c) => c.key).filter((k) => available.includes(k) && panels[k]);
  return createPortal(
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Filters">
      <button type="button" aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-border-strong bg-surface-elevated" data-testid="filter-sheet">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-base font-bold text-white">Filters</h2>
          <button type="button" onClick={onClearAll} className="text-xs font-bold text-ink-muted hover:text-white">Clear all</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-3">
          {blockedReason && <p className="mb-3 rounded-lg border border-border bg-surface p-3 text-xs text-ink-muted">{blockedReason}</p>}
          {keys.map((k) => {
            const c = columnOf(k);
            const isOpen = openKey === k;
            return (
              <div key={k} className="border-b border-border/60">
                <button type="button" onClick={() => setOpenKey(isOpen ? null : k)} aria-expanded={isOpen} className="flex w-full items-center justify-between py-3 text-sm font-semibold text-white">
                  <span>{c.label}{columnActive(k, filters) && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-brand-400 align-middle" />}</span>
                  <span aria-hidden className="text-ink-faint">{isOpen ? "–" : "+"}</span>
                </button>
                {isOpen && <div className="pb-3"><ColumnFilterPanel panel={panels[k]!} label={c.label} /></div>}
              </div>
            );
          })}
        </div>
        <div className="border-t border-border bg-surface-elevated p-4">
          <button type="button" onClick={onClose} data-testid="show-n" className="w-full rounded-xl bg-brand-500 py-3 text-sm font-extrabold text-black hover:bg-brand-400">
            {count == null ? "Show vehicles" : `Show ${count.toLocaleString("en-US")} vehicle${count === 1 ? "" : "s"}`}{countPending ? "…" : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
