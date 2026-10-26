"use client";

// A labelled group of toggle chips, each with its live count. Zero-count chips are never rendered. A picked chip stays visible
// (it is the active filter) even if its count is zero or unknown. Long lists show the first few and a "Show all" toggle.

import React, { useState } from "react";

export interface Chip {
  value: string;
  label: string;
  /** undefined = no count available for this chip (not zero): shown without a number. */
  count?: number;
  /** Secondary text after the label, e.g. an option's "+$1,225". */
  detail?: string;
}

export function FacetChips({ label, chips, selected, onToggle, limit = 12, loading, emptyText }: {
  label: string; chips: Chip[]; selected: string[]; onToggle: (value: string) => void; limit?: number; loading?: boolean; emptyText?: string;
}) {
  const [all, setAll] = useState(false);
  const visible = chips.filter((c) => c.count == null || c.count > 0 || selected.includes(c.value));
  const shown = all ? visible : visible.slice(0, Math.max(limit, 0));
  // A picked chip beyond the cut-off must not disappear behind "Show all".
  const extraPicked = all ? [] : visible.slice(limit).filter((c) => selected.includes(c.value));
  const list = [...shown, ...extraPicked];
  const hidden = visible.length - list.length;
  if (!visible.length && !loading && !emptyText) return null;
  return (
    <div role="group" aria-label={label} className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
        {hidden > 0 || all && visible.length > limit ? (
          <button type="button" onClick={() => setAll((a) => !a)} className="text-xs text-ink-muted underline underline-offset-2 hover:text-white">
            {all ? "Show fewer" : `Show all ${visible.length}`}
          </button>
        ) : null}
      </div>
      {!visible.length ? (
        <p role="status" className="text-sm text-ink-muted">{loading ? "Loading…" : emptyText}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((c) => {
            const on = selected.includes(c.value);
            return (
              <li key={c.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(c.value)}
                  className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-brand-400 ${on ? "border-brand-500 bg-brand-500/15 text-white" : "border-border bg-surface text-ink-light hover:border-border-strong hover:text-white"}`}
                >
                  <span>{c.label}</span>
                  {c.detail && <span className="text-xs tabular-nums text-ink-muted">{c.detail}</span>}
                  {c.count != null && <span className={`text-xs tabular-nums ${on ? "text-brand-300" : "text-ink-faint"}`}>{c.count.toLocaleString()}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
