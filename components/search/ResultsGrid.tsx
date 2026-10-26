"use client";

// The /search results as a spreadsheet-style grid (desktop) or a list of cards (phone). Every column header has a sort toggle and a small filter
// popover (ColumnFilterPanel). Paging is infinite scroll over pages of 24 from the deals-api, so only the pages asked for are ever in the browser.
// Presentation only: BuyerSearchView owns the filters, the requests and the picks.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowDown, ArrowUp, Filter } from "lucide-react";
import { activeSort, ariaSortFor, type SortableColumn } from "@/lib/buyerSort";
import { toPick, vehicleKey, type PickedVehicle } from "@/lib/buyerPicks";
import { cellText, columnOf, money, paidOptionsOf, type GridColumnKey, type GridRow } from "@/lib/searchGrid";
import { ColumnFilterPanel, type ColumnPanel } from "./ColumnFilterPanel";

export interface GridVehicle extends GridRow {
  vin: string; dealerId?: string | null; dealerName: string; dealerState: string | null; year: number | null; make: string | null; model: string | null;
  trim: string | null; mileage: number | null; price: number | null; vdpUrl: string | null; distanceMiles: number | null; rfqEligible?: boolean;
}

export interface GridProps<T extends GridVehicle> {
  columns: GridColumnKey[];
  rows: T[];
  sort: string;
  onSort: (column: SortableColumn) => void;
  sortBusy: boolean;
  /** The filter of each column the box can serve now. A column without one has no filter button. */
  panels: Partial<Record<GridColumnKey, ColumnPanel>>;
  isActive: (key: GridColumnKey) => boolean;
  /** Changes whenever a fresh search starts: the list scrolls back to the top. */
  resetKey: unknown;
  hasMore: boolean; loadingMore: boolean; moreError: boolean; onLoadMore: () => void;
  dimmed: boolean;
  picks: PickedVehicle[]; viewed: Set<string>; onTogglePick: (p: PickedVehicle) => void; onView: (key: string) => void;
  showDistance: boolean;
  /** Shown in place of the rows when there are none. */
  emptyMessage?: string;
}

const ROW_H = 34;
const HEAD_H = 40;

/** Closes on Escape and on a click outside `refs`. */
function useDismiss(open: boolean, close: () => void, refs: Array<React.RefObject<HTMLElement | null>>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!refs.some((r) => r.current?.contains(e.target as Node))) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** A popover fixed under its trigger (portalled, so the grid's scroll area cannot clip it). */
function Popover({ anchor, onClose, children, label }: { anchor: React.RefObject<HTMLElement | null>; onClose: () => void; children: React.ReactNode; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const width = 288;
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 4 });
    };
    place();
    // The popover belongs to a header that moves with the grid's sideways scroll: close it rather than leave it hanging where the header was.
    const onScroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
  useDismiss(true, onClose, [box, anchor]);
  if (!pos || typeof document === "undefined") return null;
  return createPortal(
    <div ref={box} role="dialog" aria-label={`${label} filter`} className="fixed z-50 w-72 rounded-xl border border-border-strong bg-surface-elevated p-3 shadow-2xl" style={{ left: pos.left, top: pos.top }}>
      {children}
    </div>,
    document.body,
  );
}

function HeaderCell({ column, sort, onSort, sortBusy, panel, active }: {
  column: GridColumnKey; sort: string; onSort: (c: SortableColumn) => void; sortBusy: boolean; panel?: ColumnPanel; active: boolean;
}) {
  const c = columnOf(column);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cur = c.sort ? activeSort(sort) : null;
  const here = c.sort && cur?.column === c.sort ? cur : null;
  return (
    <div role="columnheader" aria-sort={c.sort ? ariaSortFor(sort, c.sort) : undefined} data-testid={`col-${c.key}`}
      className="flex shrink-0 items-center border-r border-border/60 text-[10.5px] font-bold uppercase tracking-wider text-ink-light" style={{ width: c.width, height: HEAD_H }}>
      {c.sort ? (
        <button type="button" onClick={() => onSort(c.sort!)} disabled={sortBusy} title={`Sort by ${c.label} — click for ${here ? (here.dir === "asc" ? "descending" : "no sort") : "ascending"}`}
          className={`flex h-full min-w-0 flex-1 items-center gap-1 px-2.5 uppercase tracking-wider hover:bg-white/5 disabled:cursor-wait ${c.right ? "justify-end" : ""}`}>
          <span className="truncate">{c.label}</span>
          {here && (here.dir === "asc" ? <ArrowUp aria-hidden className="h-3 w-3 shrink-0 text-brand-400" data-testid="sort-arrow-asc" /> : <ArrowDown aria-hidden className="h-3 w-3 shrink-0 text-brand-400" data-testid="sort-arrow-desc" />)}
        </button>
      ) : (
        <span className={`flex min-w-0 flex-1 items-center truncate px-2.5 ${c.right ? "justify-end" : ""}`}>{c.label}</span>
      )}
      {panel && (
        <>
          <button ref={trigger} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label={`Filter ${c.label}${active ? " (active)" : ""}`}
            className={`relative mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/10 ${active ? "text-brand-400" : "text-ink-faint"}`}>
            <Filter aria-hidden className="h-3.5 w-3.5" fill={active ? "currentColor" : "none"} />
          </button>
          {open && <Popover anchor={trigger} onClose={() => setOpen(false)} label={c.label}><ColumnFilterPanel panel={panel} label={c.label} /></Popover>}
        </>
      )}
    </div>
  );
}

/** The paid-options count; hover or focus lists each paid option with its price. */
function PaidOptionsCell({ row }: { row: GridRow }) {
  const paid = paidOptionsOf(row);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  if (!paid.length) return <span className="text-ink-faint">—</span>;
  const show = () => { const r = anchor.current?.getBoundingClientRect(); if (r) setPos({ left: Math.max(8, Math.min(r.right - 280, window.innerWidth - 288)), top: r.bottom + 4 }); };
  return (
    <span ref={anchor} tabIndex={0} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} data-testid="paid-count"
      className="cursor-help rounded px-1.5 font-semibold tabular-nums text-brand-300 underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-500">
      {paid.length}
      {pos && createPortal(
        <div role="tooltip" data-testid="paid-list" className="pointer-events-none fixed z-50 w-72 rounded-lg border border-border-strong bg-surface-elevated p-2.5 text-left text-[11px] normal-case tracking-normal shadow-2xl" style={{ left: pos.left, top: pos.top }}>
          <p className="mb-1 font-bold text-white">Paid factory options</p>
          <ul className="space-y-0.5">{paid.map((o, i) => <li key={`${o.name}-${i}`} className="flex justify-between gap-3 text-ink-light"><span className="min-w-0 flex-1">{o.name}</span><span className="shrink-0 tabular-nums text-ink-muted">{o.priceLabel}</span></li>)}</ul>
        </div>,
        document.body,
      )}
    </span>
  );
}

export function ResultsGrid<T extends GridVehicle>(p: GridProps<T>) {
  const cols = p.columns.map(columnOf);
  const fixedLead = 40, fixedTail = 130;
  const distance = p.showDistance ? 80 : 0;
  const totalW = fixedLead + cols.reduce((s, c) => s + c.width, 0) + distance + fixedTail;
  const picked = new Set(p.picks.map((x) => x.key));
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
  const sentinel = useRef<HTMLDivElement>(null);
  const loadRef = useRef(p.onLoadMore);
  loadRef.current = p.onLoadMore;
  useEffect(() => { scroller.current?.scrollTo?.({ top: 0 }); }, [p.resetKey]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !p.hasMore || p.moreError || p.loadingMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadRef.current(); }, { root: scroller.current, rootMargin: "0px 0px 300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [p.hasMore, p.moreError, p.loadingMore, p.rows.length]);
  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-surface transition-opacity ${p.dimmed ? "opacity-60" : ""}`}>
      <div ref={scroller} data-testid="results-scroller" className="overflow-x-auto overflow-y-auto overscroll-x-contain" style={{ maxHeight: "max(260px, calc(100dvh - var(--table-top, 300px) - var(--picks-bar-h, 7rem) - 1.25rem))", minHeight: 160 }}>
        <div style={{ width: totalW, minWidth: "100%" }}>
          <div role="row" className="sticky top-0 z-20 flex border-b border-border bg-surface-elevated" style={{ height: HEAD_H }}>
            <div className="shrink-0 border-r border-border/60" style={{ width: fixedLead }} />
            {cols.map((c) => <HeaderCell key={c.key} column={c.key} sort={p.sort} onSort={p.onSort} sortBusy={p.sortBusy} panel={p.panels[c.key]} active={p.isActive(c.key)} />)}
            {p.showDistance && <div role="columnheader" className="flex shrink-0 items-center justify-end border-r border-border/60 px-2.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-light" style={{ width: distance }}>Distance</div>}
            <div role="columnheader" className="flex shrink-0 items-center px-2.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-light" style={{ width: fixedTail }}>Listing</div>
          </div>
          {p.rows.map((v, idx) => {
            const key = vehicleKey(v);
            const isViewed = p.viewed.has(key);
            return (
              <div key={key} role="row" onClick={() => p.onView(key)} className={`flex cursor-default border-b border-border/40 text-[12px] ${idx % 2 ? "bg-surface" : "bg-surface-elevated/40"} hover:bg-brand-500/5`} style={{ height: ROW_H }}>
                <div className="flex shrink-0 items-center justify-center border-r border-border/40" style={{ width: fixedLead }}>
                  <input type="checkbox" checked={picked.has(key)} disabled={v.rfqEligible === false && !picked.has(key)} title={v.rfqEligible === false && !picked.has(key) ? "Not available for a quote request right now" : undefined}
                    onClick={(e) => e.stopPropagation()} onChange={() => p.onTogglePick(toPick(v as never))}
                    aria-label={`Pick ${[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin} for a quote`} className="h-3.5 w-3.5 accent-brand-500" />
                </div>
                {cols.map((c) => {
                  const text = cellText(c.key, v);
                  const tone = isViewed ? "text-ink-faint" : c.key === "dealer" ? "font-semibold text-white" : c.key === "vin" ? "font-mono text-ink-light" : "text-ink-light";
                  return (
                    <div key={c.key} role="cell" className={`flex shrink-0 items-center overflow-hidden whitespace-nowrap border-r border-border/40 px-2.5 ${c.right ? "justify-end tabular-nums" : ""} ${tone}`} style={{ width: c.width }} title={c.key === "paid" ? undefined : text || undefined}>
                      {c.key === "paid" ? <PaidOptionsCell row={v} /> : <span className="truncate">{text}</span>}
                    </div>
                  );
                })}
                {p.showDistance && <div className="flex shrink-0 items-center justify-end border-r border-border/40 px-2.5 tabular-nums text-ink-light" style={{ width: distance }}>{v.distanceMiles == null ? "" : `${Math.round(v.distanceMiles)} mi`}</div>}
                <div className="flex shrink-0 items-center px-2.5" style={{ width: fixedTail }}>
                  {v.vdpUrl ? <Link href={v.vdpUrl} target="_blank" rel="noopener noreferrer" onClick={() => p.onView(key)} className="truncate text-brand-400 hover:underline">View at dealer ↗</Link> : <span className="truncate text-ink-faint">No link</span>}
                </div>
              </div>
            );
          })}
          {!p.rows.length && <div data-testid="grid-empty" className="px-4 py-14 text-center text-sm text-ink-faint">{p.emptyMessage}</div>}
          <GridFooter {...p} sentinel={sentinel} />
        </div>
      </div>
    </div>
  );
}

function GridFooter<T extends GridVehicle>(p: GridProps<T> & { sentinel: React.RefObject<HTMLDivElement | null> }) {
  return (
    <>
      {p.hasMore && !p.moreError && <div ref={p.sentinel} data-testid="results-sentinel" aria-hidden style={{ height: 1 }} />}
      {p.hasMore && p.loadingMore && !p.moreError && (
        <div role="status" data-testid="results-loading-more" className="flex items-center justify-center gap-2 py-3 text-[11px] text-ink-faint">
          <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-faint border-t-transparent" /> Loading more vehicles…
        </div>
      )}
      {p.moreError && (
        <div role="alert" data-testid="results-more-error" className="flex items-center justify-center gap-2 py-3 text-[11px] text-amber-300">
          Couldn&apos;t load more —<button type="button" onClick={p.onLoadMore} className="font-bold underline hover:text-white">retry</button>
        </div>
      )}
      {p.hasMore && !p.moreError && !p.loadingMore && <button type="button" onClick={p.onLoadMore} className="sr-only focus:not-sr-only focus:m-2 focus:rounded focus:border focus:border-border focus:px-2 focus:py-1 focus:text-[11px] focus:text-ink-light">Load more vehicles</button>}
      {!p.hasMore && p.rows.length > 0 && <div data-testid="results-end" className="py-3 text-center text-[11px] text-ink-faint">All {p.rows.length.toLocaleString()} vehicles shown.</div>}
      <div aria-hidden style={{ height: 10 }} />
    </>
  );
}

/** Phone layout: one card per vehicle, the same fields as the grid's visible columns, page scroll with the same load-more sentinel. */
export function ResultCards<T extends GridVehicle>(p: GridProps<T>) {
  const picked = new Set(p.picks.map((x) => x.key));
  const sentinel = useRef<HTMLDivElement>(null);
  const loadRef = useRef(p.onLoadMore);
  loadRef.current = p.onLoadMore;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !p.hasMore || p.moreError || p.loadingMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadRef.current(); }, { rootMargin: "0px 0px 400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [p.hasMore, p.moreError, p.loadingMore, p.rows.length]);
  const facts = p.columns.filter((k) => !["year", "make", "model", "trim", "price", "dealer", "state"].includes(k));
  return (
    <div data-testid="result-cards" className={`space-y-3 transition-opacity ${p.dimmed ? "opacity-60" : ""}`}>
      {p.rows.map((v) => {
        const key = vehicleKey(v);
        const title = [v.year, v.make, v.model].filter(Boolean).join(" ") || v.vin;
        return (
          <article key={key} onClick={() => p.onView(key)} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={picked.has(key)} disabled={v.rfqEligible === false && !picked.has(key)} onClick={(e) => e.stopPropagation()} onChange={() => p.onTogglePick(toPick(v as never))}
                aria-label={`Pick ${title} for a quote`} className="mt-1 h-5 w-5 shrink-0 accent-brand-500" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-bold text-white">{title}</h3>
                {v.trim && <p className="truncate text-sm text-ink-muted">{v.trim}</p>}
              </div>
              <p className="shrink-0 text-lg font-bold tabular-nums text-white">{v.price != null ? money(v.price) : ""}</p>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {facts.map((k) => {
                const text = cellText(k, v);
                if (!text) return null;
                const c = columnOf(k);
                return (
                  <div key={k} className="min-w-0">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{c.label}</dt>
                    <dd className="truncate text-ink-light">{k === "paid" ? <PaidOptionsCell row={v} /> : k === "days" ? `${text} days` : k === "mileage" ? `${text} mi` : text}</dd>
                  </div>
                );
              })}
            </dl>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs">
              <p className="min-w-0 truncate text-ink-muted">{v.dealerName}{v.dealerState ? ` · ${v.dealerState}` : ""}{p.showDistance && v.distanceMiles != null ? ` · ${Math.round(v.distanceMiles)} mi` : ""}</p>
              {v.vdpUrl && <Link href={v.vdpUrl} target="_blank" rel="noopener noreferrer" onClick={() => p.onView(key)} className="shrink-0 font-semibold text-brand-400">View at dealer ↗</Link>}
            </div>
          </article>
        );
      })}
      {!p.rows.length && <div data-testid="grid-empty" className="rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-12 text-center text-sm text-ink-faint">{p.emptyMessage}</div>}
      <GridFooter {...p} sentinel={sentinel} />
    </div>
  );
}

