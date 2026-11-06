"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  countByStatus,
  DEALER_QUOTE_STATUSES,
  filterDealerQuotes,
  type DealerQuoteRow,
  type DealerQuoteStatus,
} from "../lib/dealerQuotes";
import { relativeTime } from "../lib/rfqTracker";

const CHIP_TONE: Record<DealerQuoteStatus, string> = {
  needs_quoting: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  in_process: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  awarded: "bg-positive-500/15 text-positive-300 border-positive-500/40",
  not_awarded: "bg-border text-ink-muted border-border",
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The signed-in dealer's own quote requests. A request, not a bid: no deadlines, no ranks. */
export const DealerMyQuotes: React.FC = () => {
  const [rows, setRows] = useState<DealerQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DealerQuoteStatus | "all">("all");

  useEffect(() => {
    let live = true;
    fetch("/api/dealer-quotes")
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        if (live) setRows(Array.isArray(json.quotes) ? json.quotes : []);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load your quotes."))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const counts = useMemo(() => countByStatus(rows), [rows]);
  const shown = useMemo(() => filterDealerQuotes(rows, filter), [rows, filter]);

  return (
    <div className="space-y-4" data-testid="dealer-my-quotes">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        <button type="button" onClick={() => setFilter("all")} aria-pressed={filter === "all"} data-testid="chip-all"
          className={`rounded-full border px-3 py-1 text-[11px] font-bold ${filter === "all" ? "bg-brand-500 text-black border-brand-500" : "border-border text-ink-muted hover:text-white"}`}>
          All ({rows.length})
        </button>
        {DEALER_QUOTE_STATUSES.map((s) => (
          <button key={s.id} type="button" onClick={() => setFilter(s.id)} aria-pressed={filter === s.id} data-testid={`chip-${s.id}`}
            className={`rounded-full border px-3 py-1 text-[11px] font-bold ${filter === s.id ? "bg-brand-500 text-black border-brand-500" : "border-border text-ink-muted hover:text-white"}`}>
            {s.label} ({counts[s.id]})
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading your quotes…</p> : null}
      {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200" role="alert">{error}</p> : null}
      {!loading && !error && shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-ink-muted" data-testid="my-quotes-empty">
          {rows.length === 0 ? "No quote requests yet. Open a quote request link from your email while signed in and it will appear here." : "Nothing in this status."}
        </p>
      ) : null}

      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.inviteId} className="rounded-xl border border-border bg-surface p-4" data-testid="my-quote-row" data-status={r.status}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-bold text-white">{r.vehicle}</p>
                <p className="text-[11px] text-ink-muted">Ref {r.reference}{r.lastActivityAt ? ` · Last activity ${relativeTime(r.lastActivityAt)}` : ""}</p>
                {r.detail ? <p className="text-xs text-ink-light">{r.detail}</p> : null}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="flex items-center gap-1">
                  {r.test ? <span className="rounded-full border border-fuchsia-500/50 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-extrabold text-fuchsia-300" data-testid="test-badge">TEST</span> : null}
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${CHIP_TONE[r.status]}`} data-testid="status-chip">{r.statusLabel}</span>
                </span>
                <span className="text-sm font-bold text-white">{r.quotedOtd != null ? money(r.quotedOtd) : "No quote yet"}</span>
                {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-brand-300 hover:text-brand-200">{r.status === "needs_quoting" ? "Quote this request" : "Open"}</a> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-ink-muted">A request, not a bid: no deadline on you.</p>
    </div>
  );
};
