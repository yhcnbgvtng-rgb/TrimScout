"use client";

// The body of one column's filter: a searchable checkbox list with live counts, a min/max + slider range, or a VIN pattern box.
// Shown in a popover under the column header on a desktop and as a section of the bottom sheet on a phone. Presentation only: the page builds
// the `ColumnPanel` (values, counts, what is picked) from the deals-api answers and receives every change through `onChange`.

import React, { useId, useState } from "react";
import { filterListRows, money, rangeFromSlider, sliderValue } from "@/lib/searchGrid";

export interface ListRow { value: string; label: string; count?: number; /** Small text after the label, e.g. an option's price. */ hint?: string }

export type ColumnPanel =
  | {
      kind: "list"; rows: ListRow[]; picked: string[]; onChange: (next: string[]) => void;
      /** One value at a time (make, model, ...): ticking another replaces the pick, and there is no Select all. */
      single?: boolean; searchable?: boolean;
      /** Counts for this list are on their way: they are hidden, not shown stale. */
      pending?: boolean; empty: string; note?: string;
    }
  | {
      kind: "range"; min: string; max: string; onChange: (min: string, max: string) => void;
      track: { min: number; max: number; step: number }; unit: "money" | "miles" | "days" | "year";
      /** Cars per bucket across the track (any number of buckets of equal width), drawn as bars behind the slider. */
      hist?: number[]; note?: string;
      /** The box cannot apply a minimum yet (mileage before the filter-panel install): only the maximum is offered. */
      maxOnly?: boolean;
    }
  | { kind: "pattern"; value: string; onChange: (v: string) => void; note?: string };

const fmtUnit = (unit: "money" | "miles" | "days" | "year", n: number) =>
  unit === "money" ? money(n) : unit === "year" ? String(n) : n.toLocaleString("en-US");

export function ColumnFilterPanel({ panel, label }: { panel: ColumnPanel; label: string }) {
  if (panel.kind === "list") return <ListPanel panel={panel} label={label} />;
  if (panel.kind === "range") return <RangePanel panel={panel} label={label} />;
  return <PatternPanel panel={panel} label={label} />;
}

function ListPanel({ panel, label }: { panel: Extract<ColumnPanel, { kind: "list" }>; label: string }) {
  const [q, setQ] = useState("");
  const id = useId();
  const rows = filterListRows(panel.rows, q, panel.picked);
  const picked = new Set(panel.picked);
  const toggle = (value: string) => {
    if (panel.single) panel.onChange(picked.has(value) ? [] : [value]);
    else panel.onChange(picked.has(value) ? panel.picked.filter((v) => v !== value) : [...panel.picked, value]);
  };
  const visible = rows.map((r) => r.value);
  return (
    <div data-testid={`filter-${label}`}>
      {panel.searchable !== false && panel.rows.length > 6 && (
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`}
          className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-white placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-brand-500"
        />
      )}
      {!panel.single && (
        <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
          <button type="button" onClick={() => panel.onChange(Array.from(new Set([...panel.picked, ...visible])))} disabled={!visible.length} className="text-brand-400 hover:text-brand-300 disabled:opacity-40">Select all</button>
          <button type="button" onClick={() => panel.onChange([])} disabled={!panel.picked.length} className="text-ink-muted hover:text-white disabled:opacity-40">Clear</button>
        </div>
      )}
      {panel.single && panel.picked.length > 0 && (
        <div className="mb-1 text-right text-[11px] font-semibold"><button type="button" onClick={() => panel.onChange([])} className="text-ink-muted hover:text-white">Clear</button></div>
      )}
      <ul className="max-h-60 overflow-y-auto pr-1" role="group" aria-label={label}>
        {rows.map((r, i) => (
          <li key={r.value}>
            <label htmlFor={`${id}-${i}`} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-ink-light hover:bg-surface-elevated">
              <input id={`${id}-${i}`} type="checkbox" checked={picked.has(r.value)} onChange={() => toggle(r.value)} className="h-3.5 w-3.5 shrink-0 accent-brand-500" />
              <span className="min-w-0 flex-1 truncate" title={r.label}>{r.label}{r.hint && <span className="ml-1 text-ink-faint">{r.hint}</span>}</span>
              {r.count != null && !panel.pending && <span className="shrink-0 tabular-nums text-[11px] text-ink-faint">{r.count.toLocaleString("en-US")}</span>}
            </label>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="px-1 py-2 text-xs text-ink-faint">{q ? "Nothing matches that search." : panel.empty}</p>}
      {panel.note && <p className="mt-2 text-[11px] text-ink-faint">{panel.note}</p>}
    </div>
  );
}

function RangePanel({ panel, label }: { panel: Extract<ColumnPanel, { kind: "range" }>; label: string }) {
  const { track, unit } = panel;
  const lo = sliderValue(panel.min, track.min), hi = sliderValue(panel.max, track.max);
  const pct = (n: number) => `${((Math.min(Math.max(n, track.min), track.max) - track.min) / (track.max - track.min)) * 100}%`;
  const top = Math.max(1, ...(panel.hist ?? [0]));
  const slide = (nextLo: number, nextHi: number) => { const r = rangeFromSlider(Math.min(nextLo, nextHi), Math.max(nextLo, nextHi), track); panel.onChange(panel.maxOnly ? "" : r.min, r.max); };
  const digits = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 7);
  return (
    <div data-testid={`filter-${label}`}>
      <div className="flex items-center gap-2">
        {!panel.maxOnly && (
          <label className="flex-1 text-[11px] font-semibold text-ink-muted">Min
            <input inputMode="numeric" value={panel.min} onChange={(e) => panel.onChange(digits(e.target.value), panel.max)} placeholder={fmtUnit(unit, track.min)} aria-label={`${label} minimum`}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-normal text-white tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500" />
          </label>
        )}
        <label className="flex-1 text-[11px] font-semibold text-ink-muted">{panel.maxOnly ? "Up to" : "Max"}
          <input inputMode="numeric" value={panel.max} onChange={(e) => panel.onChange(panel.maxOnly ? "" : panel.min, digits(e.target.value))} placeholder={`${fmtUnit(unit, track.max)}+`} aria-label={`${label} maximum`}
            className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-normal text-white tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500" />
        </label>
      </div>
      <div className="relative mt-3 h-12">
        {panel.hist && panel.hist.length > 0 && (
          <div aria-hidden data-testid="range-hist" className="absolute inset-x-0 bottom-5 flex h-7 items-end gap-px">
            {panel.hist.map((n, i) => <span key={i} className="flex-1 rounded-t-sm bg-brand-500/30" style={{ height: `${Math.max(n ? 8 : 0, (n / top) * 100)}%` }} />)}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-2 h-1 rounded bg-border" />
        <div className="absolute bottom-2 h-1 rounded bg-brand-500" style={{ left: pct(panel.maxOnly ? track.min : lo), right: `calc(100% - ${pct(hi)})` }} />
        {!panel.maxOnly && <input type="range" min={track.min} max={track.max} step={track.step} value={lo} onChange={(e) => slide(Number(e.target.value), hi)} aria-label={`${label} minimum slider`} className="price-range !bottom-0 !top-auto" />}
        <input type="range" min={track.min} max={track.max} step={track.step} value={hi} onChange={(e) => slide(panel.maxOnly ? track.min : lo, Number(e.target.value))} aria-label={`${label} maximum slider`} className="price-range !bottom-0 !top-auto" />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-ink-faint"><span>{fmtUnit(unit, track.min)}</span><span>{fmtUnit(unit, track.max)}+</span></div>
      {(panel.min || panel.max) && <button type="button" onClick={() => panel.onChange("", "")} className="mt-2 text-[11px] font-semibold text-ink-muted hover:text-white">Clear</button>}
      {panel.note && <p className="mt-2 text-[11px] text-ink-faint">{panel.note}</p>}
    </div>
  );
}

function PatternPanel({ panel, label }: { panel: Extract<ColumnPanel, { kind: "pattern" }>; label: string }) {
  return (
    <div data-testid={`filter-${label}`}>
      <input value={panel.value} onChange={(e) => panel.onChange(e.target.value)} placeholder="1HGCM*   or   ????????5*" aria-label="VIN pattern"
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs uppercase text-white placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-brand-500" />
      <p className="mt-2 text-[11px] text-ink-faint">? is one unknown character, * is any run. Needs at least three real characters.</p>
      {panel.value && <button type="button" onClick={() => panel.onChange("")} className="mt-2 text-[11px] font-semibold text-ink-muted hover:text-white">Clear</button>}
      {panel.note && <p className="mt-2 text-[11px] text-ink-faint">{panel.note}</p>}
    </div>
  );
}
