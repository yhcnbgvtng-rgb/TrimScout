"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { DealerAnalyticsView, DealerMarketView } from "@/lib/dealerAnalyticsTypes";
import { AnalyticsFetchError, fmtInt, fmtPct, fmtUsd, getAnalytics, type LoadFailure } from "@/lib/dealerAnalyticsPage";
import { AnalyticsMessage, Skeleton } from "@/components/admin/AnalyticsStates";

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-border bg-surface/50 px-3 py-2">
    <p className="text-[10px] font-bold uppercase text-ink-muted">{label}</p>
    <p className="text-lg font-black tabular-nums text-white">{value}</p>
  </div>
);
const th = "px-3 py-2 font-bold";
const td = "px-3 py-1.5";

export default function DealerDetailClient({ id }: { id: string }) {
  const [view, setView] = useState<DealerAnalyticsView | null>(null);
  const [market, setMarket] = useState<DealerMarketView | null>(null);
  const [failure, setFailure] = useState<{ kind: LoadFailure; detail: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const base = `/api/admin/dealer-analytics/${encodeURIComponent(id)}`;
      const [v, m] = await Promise.all([getAnalytics<DealerAnalyticsView>(`${base}?limit=25`), getAnalytics<DealerMarketView>(`${base}/market`)]);
      setView(v);
      setMarket(m);
    } catch (e) {
      setView(null);
      setMarket(null);
      setFailure(e instanceof AnalyticsFetchError ? { kind: e.kind, detail: e.message } : { kind: "error", detail: "Could not load dealer analytics." });
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const s = view?.summary;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin/dealer-analytics" className="inline-flex items-center gap-1 text-xs font-bold text-ink-muted hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Dealer analytics</Link>
            <h1 className="text-sm font-black text-white" data-testid="dealer-title">{view ? view.dealer.dealerName : "Dealer"}</h1>
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {loading ? <Skeleton rows={6} testId="detail-skeleton" /> : failure ? <AnalyticsMessage kind={failure.kind} detail={failure.detail} /> : view && market ? (
          <>
            <p className="text-xs text-ink-muted">{[view.dealer.city, view.dealer.state].filter(Boolean).join(", ")}{view.dealer.brands.length ? ` · ${view.dealer.brands.join(", ")}` : ""} · data as of {view.day}</p>

            <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {s ? (
                <>
                  <Stat label="In stock" value={fmtInt(s.activeUnits)} />
                  <Stat label="Makes" value={fmtInt(s.makeCount)} />
                  <Stat label="Avg price" value={fmtUsd(s.avgPrice)} />
                  <Stat label="Avg days in stock" value={fmtInt(s.avgDom)} />
                  <Stat label="Drops 7d" value={fmtInt(s.dropUnits7d)} />
                  <Stat label="Drops 30d" value={fmtInt(s.dropUnits30d)} />
                  <Stat label="Added 7d" value={fmtInt(s.added7d)} />
                  <Stat label="Removed 7d" value={fmtInt(s.removed7d)} />
                </>
              ) : <p className="col-span-full text-xs text-ink-muted">No summary for this dealer in the latest run.</p>}
            </section>

            <section aria-label="Recent price changes">
              <h2 className="mb-2 text-sm font-black text-white">Recent price changes</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-xs" data-testid="price-changes">
                  <thead className="bg-surface-elevated text-ink-muted"><tr>
                    <th className={th}>Vehicle</th><th className={th}>Changed</th><th className={`${th} text-right`}>Old</th><th className={`${th} text-right`}>New</th><th className={`${th} text-right`}>Change</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {view.priceChanges.changes.map((c) => (
                      <tr key={`${c.vin}-${c.changedOn}`}>
                        <td className={td}>{[c.year, c.make, c.model, c.trim].filter(Boolean).join(" ") || c.vin}</td>
                        <td className={td}>{c.changedOn}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtUsd(c.oldPrice)}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtUsd(c.newPrice)}</td>
                        <td className={`${td} text-right tabular-nums ${c.deltaUsd < 0 ? "text-emerald-300" : "text-amber-300"}`}>{fmtUsd(c.deltaUsd)} ({fmtPct(c.pctChange)})</td>
                      </tr>
                    ))}
                    {view.priceChanges.changes.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-muted">No recent price changes.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-label="Market comparison">
              <h2 className="text-sm font-black text-white">Versus the market</h2>
              <p className="mb-2 text-[11px] text-ink-muted" data-testid="market-overall">
                {fmtInt(market.overall.comparableUnits)} comparable units · weighted average {fmtPct(market.overall.weightedDeltaPct)} vs market
              </p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-xs" data-testid="market-table">
                  <thead className="bg-surface-elevated text-ink-muted"><tr>
                    <th className={th}>Model</th><th className={th}>Condition</th><th className={`${th} text-right`}>Units</th><th className={`${th} text-right`}>Dealer avg</th><th className={`${th} text-right`}>Market avg</th><th className={`${th} text-right`}>Difference</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {market.rows.map((r) => (
                      <tr key={`${r.make}-${r.model}-${r.year}-${r.condition}`} className={r.thinMarket ? "opacity-50" : ""} title={r.thinMarket ? `Fewer than ${market.minMarketDealers} dealers in the market sample` : undefined}>
                        <td className={td}>{r.year} {r.make} {r.model}</td>
                        <td className={td}>{r.condition}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtInt(r.units)}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtUsd(r.avgPrice)}</td>
                        <td className={`${td} text-right tabular-nums`}>{fmtUsd(r.marketAvgPrice)}</td>
                        <td className={`${td} text-right tabular-nums`}>{r.deltaUsd == null ? "—" : `${fmtUsd(r.deltaUsd)} (${fmtPct(r.deltaPct)})`}</td>
                      </tr>
                    ))}
                    {market.rows.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-muted">No market comparison available.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
