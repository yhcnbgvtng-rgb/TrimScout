"use client";

import React, { useEffect, useState } from "react";
import {
  DEALER_QUOTE_STATUSES,
  DEALER_QUOTE_STATUS_LABELS,
  dealerQuoteCounts,
  filterDealerQuoteRows,
  type DealerQuoteRow,
  type DealerQuoteStatus,
} from "../lib/dealerQuotes";

type Filter = DealerQuoteStatus | "all";

const STATUS_STYLE: Record<DealerQuoteStatus, string> = {
  needs_quoting: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  in_process: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  awarded: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  not_awarded: "bg-surface text-ink-muted border-border",
};

function money(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Presentational list: the filter chips (counts included) and one row per quote request. */
export function DealerMyQuotesList({ quotes, filter, onFilter }: { quotes: DealerQuoteRow[]; filter: Filter; onFilter?: (f: Filter) => void }) {
  const counts = dealerQuoteCounts(quotes);
  const shown = filterDealerQuoteRows(quotes, filter);
  const chips: Array<{ id: Filter; label: string }> = [{ id: "all", label: "All" }, ...DEALER_QUOTE_STATUSES.map((s) => ({ id: s as Filter, label: DEALER_QUOTE_STATUS_LABELS[s] }))];
  return (
    <div className="space-y-4" data-testid="dealer-my-quotes">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter quotes">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={filter === c.id}
            onClick={() => onFilter?.(c.id)}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${filter === c.id ? "bg-brand-500 text-black border-brand-500" : "bg-surface text-ink-muted border-border hover:text-white"}`}
          >
            {c.label} ({counts[c.id]})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-center text-xs text-ink-muted">
          {quotes.length === 0 ? "No quote requests are linked to your account yet. Open a quote link from your email while signed in and it will appear here." : "Nothing in this filter."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((q) => (
            <li key={q.inviteId} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">
                    {q.vehicle || "Vehicle"}
                    {q.test && <span className="ml-2 rounded border border-fuchsia-500/50 bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-300">TEST</span>}
                  </p>
                  <p className="text-[11px] text-ink-faint">Ref {q.dealerReference} · Last activity {when(q.lastActivityAt)}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide text-ink-faint">Quoted OTD</p>
                    <p className="text-sm font-bold text-white">{money(q.quotedOtd)}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[q.status]}`}>{q.statusLabel}</span>
                  {q.viewUrl ? (
                    <a href={q.viewUrl} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-bold text-black">
                      {q.status === "needs_quoting" ? "Quote" : "Open"}
                    </a>
                  ) : (
                    <span className="text-[11px] text-ink-faint">No link</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const DealerMyQuotes: React.FC = () => {
  const [quotes, setQuotes] = useState<DealerQuoteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let live = true;
    fetch("/api/dealer-quotes", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setError(json?.error || "Could not load your quotes right now.");
        else setQuotes(Array.isArray(json.quotes) ? json.quotes : []);
      })
      .catch(() => live && setError("Could not load your quotes right now."));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p className="rounded-xl border border-border bg-surface p-6 text-center text-xs text-red-300">{error}</p>;
  if (!quotes) return <p className="p-6 text-center text-xs text-ink-muted">Loading your quotes…</p>;
  return <DealerMyQuotesList quotes={quotes} filter={filter} onFilter={setFilter} />;
};
