"use client";

import React, { useEffect, useState } from "react";
import type { DeskHonestyRow } from "../../../lib/trade/confirm";

const usd = (n: number | null) => (n == null ? "—" : `${n < 0 ? "−" : n > 0 ? "+" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`);
const dur = (ms: number | null) => {
  if (ms == null) return "—";
  const m = Math.round(ms / 60000);
  return m < 90 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`;
};

/**
 * INTERNAL ONLY. How honest each desk's trade numbers are once the buyer picks them: % confirmed as quoted, average revision delta,
 * firm-breach count and median time to confirm. Not shown to buyers or dealers (yet). Reads /api/admin/trade-honesty (admin session).
 */
export default function TradeHonestyPanel() {
  const [rows, setRows] = useState<DeskHonestyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/trade-honesty").then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Could not load trade metrics."); setRows(j.desks as DeskHonestyRow[]); }).catch((e) => setError(e instanceof Error ? e.message : "Could not load trade metrics."));
  }, []);
  return (
    <details className="rounded-xl border border-border bg-surface px-4 py-3" data-testid="trade-honesty">
      <summary className="cursor-pointer text-xs font-bold text-white">Desk honesty on trade values <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-300">Internal only</span></summary>
      <div className="mt-3 space-y-2">
        <p className="text-[11px] text-ink-muted">After the buyer selects a desk, it confirms or revises its trade number. These are the results so far. Buyers and dealers never see this.</p>
        {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}
        {rows === null && !error ? <p className="text-xs text-ink-muted">Loading…</p> : null}
        {rows && rows.length === 0 ? <p className="text-xs text-ink-muted">No resolved confirmations yet.</p> : null}
        {rows && rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint"><th className="py-1 pr-3">Dealer</th><th className="py-1 pr-3 text-right">Confirmations</th><th className="py-1 pr-3 text-right">Confirmed as quoted</th><th className="py-1 pr-3 text-right">Avg revision</th><th className="py-1 pr-3 text-right">Firm breaches</th><th className="py-1 pr-3 text-right">Flagged</th><th className="py-1 pr-3 text-right">Acted in time</th><th className="py-1 text-right">Median time to confirm</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.dealerKey} className="border-t border-border/60 tabular-nums text-ink-light" data-testid="honesty-row">
                  <td className="py-1.5 pr-3 font-bold text-white">{r.dealerName}</td>
                  <td className="py-1.5 pr-3 text-right">{r.total}</td>
                  <td className="py-1.5 pr-3 text-right">{r.pctConfirmedAsQuoted}%</td>
                  <td className={`py-1.5 pr-3 text-right ${r.avgRevisionDelta != null && r.avgRevisionDelta < 0 ? "text-rose-300" : ""}`}>{usd(r.avgRevisionDelta)}</td>
                  <td className={`py-1.5 pr-3 text-right ${r.firmBreaches ? "font-bold text-rose-300" : ""}`}>{r.firmBreaches}</td>
                  <td className={`py-1.5 pr-3 text-right ${r.flaggedForReview ? "font-bold text-amber-200" : ""}`}>{r.flaggedForReview}</td>
                  <td className="py-1.5 pr-3 text-right">{r.pctWithinDeadline}%</td>
                  <td className="py-1.5 text-right">{dur(r.medianTimeToConfirmMs)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        ) : null}
      </div>
    </details>
  );
}
