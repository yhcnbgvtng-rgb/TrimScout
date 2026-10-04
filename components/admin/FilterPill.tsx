"use client";

// Filter "pills" for the admin Vehicles filter bar: a rounded button that shows what is selected
// ("State · FL, GA") and opens a small popover. PillShell is the button + popover frame (closes on outside
// click / Escape); MultiPill puts a searchable checklist with optional counts inside it. Nothing here knows
// about vehicles — VehiclesSheet owns the filter state and passes plain values in and out.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";

export interface PillOption {
  value: string;
  label: string;
  /** Hit count shown at the right of the row; omit for options that have none (e.g. condition). */
  count?: number;
}

/** "FL, GA" for one or two picks, "FL +2" beyond that. */
export function pickSummary(values: string[]): string {
  if (values.length <= 2) return values.join(", ");
  return `${values[0]} +${values.length - 1}`;
}

export function PillShell({ label, summary, active, disabledHint, onOpen, width = "w-64", children }: {
  label: string;
  /** Text after the label when something is set, e.g. "FL, GA". */
  summary?: string;
  /** Green when something is selected. */
  active?: boolean;
  /** When set the pill is inert and this is its tooltip ("Pick a make first"). */
  disabledHint?: string;
  onOpen?: () => void;
  width?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (disabledHint) {
    return (
      <span title={disabledHint} aria-disabled="true" className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-ink-faint">
        {label}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => { if (!open) onOpen?.(); setOpen((o) => !o); }}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-border-strong text-ink-light hover:text-white"}`}
      >
        <span>{label}{summary ? <span className="font-bold"> · {summary}</span> : null}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={popId} role="dialog" aria-label={label} className={`absolute left-0 top-full z-30 mt-1.5 max-w-[90vw] rounded-xl border border-border-strong bg-surface-elevated shadow-2xl ${width}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MultiPill({ label, options, value, onChange, loading, emptyMessage, disabledHint, onOpen, searchable = true }: {
  label: string;
  options: PillOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** A refresh in flight. Only shows "Loading…" when there is nothing to show yet — otherwise the current options stay clickable while counts refresh. */
  loading?: boolean;
  /** Shown when there are no options and nothing is loading (e.g. the facet request failed). */
  emptyMessage?: string;
  disabledHint?: string;
  onOpen?: () => void;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const selected = new Set(value);
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <PillShell label={label} summary={value.length ? pickSummary(value.map((v) => options.find((x) => x.value === v)?.label ?? v)) : undefined} active={value.length > 0} disabledHint={disabledHint} onOpen={() => { setQuery(""); onOpen?.(); }}>
      {() => (
        <div className="py-1">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} className="w-full bg-transparent text-xs text-white placeholder:text-ink-faint focus:outline-none" />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto" role="listbox" aria-multiselectable="true" aria-label={label}>
            {loading && options.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-faint">Loading…</div>
            ) : options.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-faint">{emptyMessage || "No options."}</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-faint">No matches.</div>
            ) : (
              filtered.map((o) => {
                const on = selected.has(o.value);
                return (
                  <button key={o.value} type="button" role="option" aria-selected={on} onClick={() => toggle(o.value)} className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-surface ${on ? "text-emerald-300" : "text-ink-light"}`}>
                    <span className="flex items-center gap-2 truncate">
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-emerald-400 bg-emerald-500/30" : "border-border"}`}>{on && <span className="h-1.5 w-1.5 rounded-sm bg-emerald-300" />}</span>
                      <span className="truncate">{o.label}</span>
                    </span>
                    {o.count != null && <span className="shrink-0 tabular-nums text-ink-faint">{o.count.toLocaleString()}</span>}
                  </button>
                );
              })
            )}
          </div>
          {value.length > 0 && (
            <div className="border-t border-border px-3 py-1.5">
              <button type="button" onClick={() => onChange([])} className="text-[11px] font-medium text-ink-faint hover:text-white">Clear {label.toLowerCase()}</button>
            </div>
          )}
        </div>
      )}
    </PillShell>
  );
}
