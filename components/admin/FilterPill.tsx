"use client";

// Filter "pills" for the admin Vehicles filter bar: a rounded button that shows what is selected
// ("State · FL, GA") and opens a small popover. PillShell is the button + popover frame (closes on outside
// click / Escape); MultiPill puts a searchable checklist with optional counts inside it. Nothing here knows
// about vehicles — VehiclesSheet owns the filter state and passes plain values in and out.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";

export type PillAccent = "brand" | "sky";
const ACCENT = {
  brand: { on: "border-brand-500/50 bg-brand-500/10 text-brand-300", row: "text-brand-300", box: "border-brand-400 bg-brand-500/30", dot: "bg-brand-300" },
  sky: { on: "border-sky-500/50 bg-sky-500/10 text-sky-300", row: "text-sky-300", box: "border-sky-400 bg-sky-500/30", dot: "bg-sky-300" },
} as const;

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

export function PillShell({ label, summary, active, disabledHint, onOpen, width = "w-64", accent = "brand", open: openProp, onOpenChange, align = "left", children }: {
  label: string;
  /** Text after the label when something is set, e.g. "FL, GA". */
  summary?: string;
  /** Green when something is selected. */
  active?: boolean;
  /** When set the pill is inert and this is its tooltip ("Pick a make first"). */
  disabledHint?: string;
  onOpen?: () => void;
  width?: string;
  accent?: PillAccent;
  /** Controlled mode: pass both to let the parent open/close the popover (e.g. close it on submit). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(open) : v;
    setOpenState(next);
    onOpenChange?.(next);
  };
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
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? ACCENT[accent].on : "border-border-strong text-ink-light hover:text-white"}`}
      >
        <span>{label}{summary ? <span className="font-bold"> · {summary}</span> : null}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={popId} role="dialog" aria-label={label} className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-30 mt-1.5 max-w-[90vw] rounded-xl border border-border-strong bg-surface-elevated shadow-2xl ${width}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface ListPillBase {
  label: string;
  options: PillOption[];
  /** A refresh in flight. Only shows "Loading…" when there is nothing to show yet — otherwise the current options stay clickable while counts refresh. */
  loading?: boolean;
  /** Shown when there are no options and nothing is loading (e.g. the facet request failed). */
  emptyMessage?: string;
  disabledHint?: string;
  onOpen?: () => void;
  searchable?: boolean;
  accent?: PillAccent;
}

function PillList({ label, options, selected, onPick, loading, emptyMessage, searchable, accent, multi, query, setQuery, onClear, clearLabel }: {
  label: string; options: PillOption[]; selected: Set<string>; onPick: (v: string) => void; loading?: boolean; emptyMessage?: string; searchable: boolean; accent: PillAccent; multi: boolean;
  query: string; setQuery: (q: string) => void; onClear?: () => void; clearLabel: string;
}) {
  const a = ACCENT[accent];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);
  return (
    <div className="py-1">
      {searchable && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} className="w-full bg-transparent text-xs text-white placeholder:text-ink-faint focus:outline-none" />
        </div>
      )}
      <div className="max-h-60 overflow-y-auto" role="listbox" aria-multiselectable={multi || undefined} aria-label={label}>
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
              <button key={o.value} type="button" role="option" aria-selected={on} onClick={() => onPick(o.value)} className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-surface ${on ? a.row : "text-ink-light"}`}>
                <span className="flex items-center gap-2 truncate">
                  {multi && <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? a.box : "border-border"}`}>{on && <span className={`h-1.5 w-1.5 rounded-sm ${a.dot}`} />}</span>}
                  <span className="truncate">{o.label}</span>
                </span>
                {o.count != null && <span className="shrink-0 tabular-nums text-ink-faint">{o.count.toLocaleString()}</span>}
              </button>
            );
          })
        )}
      </div>
      {selected.size > 0 && onClear && (
        <div className="border-t border-border px-3 py-1.5">
          <button type="button" onClick={onClear} className="text-[11px] font-medium text-ink-faint hover:text-white">{clearLabel}</button>
        </div>
      )}
    </div>
  );
}

export function MultiPill({ value, onChange, summary = "values", ...p }: ListPillBase & {
  value: string[];
  onChange: (next: string[]) => void;
  /** "values" lists the picks ("FL, GA"); "count" just says how many ("3") — for long labels. */
  summary?: "values" | "count";
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(value);
  const text = !value.length ? undefined : summary === "count" ? String(value.length) : pickSummary(value.map((v) => p.options.find((x) => x.value === v)?.label ?? v));
  return (
    <PillShell label={p.label} summary={text} active={value.length > 0} disabledHint={p.disabledHint} accent={p.accent} onOpen={() => { setQuery(""); p.onOpen?.(); }}>
      {() => (
        <PillList {...p} searchable={p.searchable ?? true} accent={p.accent ?? "brand"} multi selected={selected} query={query} setQuery={setQuery}
          onPick={(v) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v])}
          onClear={() => onChange([])} clearLabel={`Clear ${p.label.toLowerCase()}`} />
      )}
    </PillShell>
  );
}

/** One value at a time: picking a row sets it and closes the popover; picking the current row clears it. */
export function SinglePill({ value, onChange, ...p }: ListPillBase & { value: string; onChange: (next: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const label = value ? p.options.find((x) => x.value === value)?.label ?? value : undefined;
  return (
    <PillShell label={p.label} summary={label} active={Boolean(value)} disabledHint={p.disabledHint} accent={p.accent} open={open} onOpenChange={setOpen} onOpen={() => { setQuery(""); p.onOpen?.(); }}>
      {() => (
        <PillList {...p} searchable={p.searchable ?? true} accent={p.accent ?? "brand"} multi={false} selected={new Set(value ? [value] : [])} query={query} setQuery={setQuery}
          onPick={(v) => { onChange(v === value ? "" : v); setOpen(false); }}
          onClear={() => { onChange(""); setOpen(false); }} clearLabel={`Clear ${p.label.toLowerCase()}`} />
      )}
    </PillShell>
  );
}
