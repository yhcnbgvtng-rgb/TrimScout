"use client";

// A dropdown trigger + popover menu shared by every primary /search filter (State, Make, Model,
// Trim, Factory options): a search field pinned to the top of the menu, a live hit-count on every
// row, and the same count surfaced on the closed trigger once a value is picked — e.g. `NJ ·
// 84,210`. Quiet slate chrome with a soft blue selected/hover state (never the admin sheet's
// emerald "shouty chip" look — a deliberate, separate style for this buyer-facing page). Supports
// both single-select (State/Make/Model/Trim) and multi-select (factory options) through the same
// component so the two behave identically otherwise.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  /** In-stock vehicles matching this option under the CURRENT filters — not a global count. */
  count: number;
}

interface BaseProps {
  label: string;
  placeholder: string;
  options: DropdownOption[];
  loading?: boolean;
  /** Shown in place of the trigger when the filter isn't unlocked yet — kept out of the DOM entirely by the caller otherwise (progressive-unlock). */
  disabledHint?: string;
  /**
   * Shown instead of the generic "No matches." when `options` itself is empty (not loading) —
   * i.e. there's genuinely nothing to search, as opposed to a search term matching nothing. Lets
   * a caller distinguish "this data doesn't exist yet" from "try a different search term," which
   * look identical without this — e.g. factory options for a make/model the crawler hasn't
   * captured any option data for yet vs. a real search with no results.
   */
  emptyMessage?: string;
}

interface SingleProps extends BaseProps {
  multi?: false;
  value: string;
  onChange: (value: string) => void;
}

interface MultiProps extends BaseProps {
  multi: true;
  value: string[];
  onChange: (value: string[]) => void;
}

type Props = SingleProps | MultiProps;

export default function SearchableDropdown(props: Props) {
  const { label, placeholder, options, loading, disabledHint, emptyMessage } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    // Menu opens fresh every time — a stale search term from the last time this dropdown was
    // used would otherwise silently hide options the shopper expects to see.
    setQuery("");
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selectedSet = props.multi ? new Set(props.value) : null;

  const triggerText = useMemo(() => {
    if (!props.multi) {
      const opt = options.find((o) => o.value === props.value);
      if (!props.value) return placeholder;
      return opt ? `${opt.label} · ${opt.count.toLocaleString()}` : props.value;
    }
    if (props.value.length === 0) return placeholder;
    // The intersection of several must-have options can never exceed the smallest individual
    // option's own count — showing that minimum is an honest upper bound on the real combined
    // result, not a sum that would overstate it.
    const picked = options.filter((o) => selectedSet!.has(o.value));
    const minCount = picked.length ? Math.min(...picked.map((o) => o.count)) : 0;
    return `${props.value.length} option${props.value.length === 1 ? "" : "s"} · ${minCount.toLocaleString()}`;
  }, [props.multi, props.value, options, placeholder, selectedSet]);

  const hasValue = props.multi ? props.value.length > 0 : Boolean(props.value);

  if (disabledHint) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">{label}</span>
        <div
          title={disabledHint}
          className="flex w-full cursor-not-allowed items-center justify-between rounded-xl border border-border bg-surface/50 px-3 py-2.5 text-sm text-ink-faint"
        >
          <span>{disabledHint}</span>
        </div>
      </div>
    );
  }

  const selectSingle = (value: string) => {
    if (props.multi) return;
    props.onChange(props.value === value ? "" : value);
    setOpen(false);
  };

  const toggleMulti = (value: string) => {
    if (!props.multi) return;
    const next = selectedSet!.has(value) ? props.value.filter((v) => v !== value) : [...props.value, value];
    props.onChange(next);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    props.multi ? props.onChange([]) : props.onChange("");
  };

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
          hasValue ? "border-sky-500/50 bg-sky-950/20 text-white" : "border-border bg-surface-elevated text-ink-light hover:border-border-strong"
        }`}
      >
        <span className="truncate font-semibold">{triggerText}</span>
        <span className="flex items-center gap-1 shrink-0">
          {hasValue && (
            <X className="h-3.5 w-3.5 text-ink-faint hover:text-white" onClick={clear} role="button" aria-label={`Clear ${label}`} />
          )}
          <ChevronDown className={`h-3.5 w-3.5 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[90vw] overflow-hidden rounded-xl border border-border-strong bg-surface-elevated shadow-2xl">
          <div className="relative border-b border-border p-2">
            <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-white placeholder:text-ink-faint focus:border-sky-500/50 focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-4 text-center text-xs text-ink-faint">Loading…</div>
            ) : options.length === 0 && emptyMessage ? (
              <div className="px-3 py-4 text-center text-xs text-ink-faint">{emptyMessage}</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-faint">No matches.</div>
            ) : (
              filtered.map((o) => {
                const selected = props.multi ? selectedSet!.has(o.value) : props.value === o.value;
                const zero = o.count === 0;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => (props.multi ? toggleMulti(o.value) : selectSingle(o.value))}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors ${
                      selected ? "bg-sky-500/15 text-sky-300" : zero ? "text-ink-faint hover:bg-surface" : "text-ink-light hover:bg-surface"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {props.multi && (
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                            selected ? "border-sky-400 bg-sky-500/30" : "border-border"
                          }`}
                        >
                          {selected && <span className="h-1.5 w-1.5 rounded-sm bg-sky-300" />}
                        </span>
                      )}
                      <span className="truncate">{o.label}</span>
                    </span>
                    <span className={`shrink-0 tabular-nums ${selected ? "text-sky-300/80" : "text-ink-faint"}`}>{o.count.toLocaleString()}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
