"use client";

import React, { useEffect, useState } from "react";
import {
  Sparkles,
  TrendingDown,
  TrendingUp,
  Clock,
  Package,
  AlertTriangle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { UserProfile } from "../lib/types";

interface DealerAnalyticsProps {
  user: UserProfile;
}

interface AnalyticsResponse {
  dealerName: string;
  brands: string[];
  hasData: boolean;
  stats: {
    totalActive: number;
    priceDrops: number;
    newArrivals: number;
    staleCount: number;
    avgDaysOnLot: number;
  };
  modelMix: { model: string; count: number }[];
  agingInventory: {
    vin: string;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    price: number | null;
    daysOnLot: number | null;
    url: string | null;
  }[];
  recentPriceDrops: {
    vin: string;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    price: number | null;
    oldPrice: number | null;
    priceDiff: number | null;
    url: string | null;
  }[];
}

// Rule-based for now, computed entirely from this dealer's own real
// inventory numbers — no fabricated claims. A natural next iteration is
// swapping this for an actual LLM call over the same stats to produce
// richer, more specific narrative language; the real data pipeline this
// reads from won't need to change either way.
function buildInsights(data: AnalyticsResponse): string[] {
  const insights: string[] = [];
  const { stats, agingInventory, modelMix } = data;

  if (stats.staleCount > 0) {
    insights.push(
      `${stats.staleCount} vehicle${stats.staleCount === 1 ? " has" : "s have"} been on the lot over 45 days — a price adjustment or featured placement could accelerate turnover.`
    );
  }
  if (agingInventory[0]?.daysOnLot) {
    const v = agingInventory[0];
    insights.push(
      `Your longest-aging unit is the ${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""} at ${v.daysOnLot} days on lot — worth a closer look first.`
    );
  }
  if (stats.priceDrops > 0) {
    insights.push(
      `${stats.priceDrops} active price drop${stats.priceDrops === 1 ? "" : "s"} in your current inventory — make sure these are visible in your own listings and any third-party syndication.`
    );
  }
  if (modelMix.length > 0) {
    insights.push(
      `${modelMix[0].model} is your highest-volume model right now (${modelMix[0].count} unit${modelMix[0].count === 1 ? "" : "s"}) — a good candidate for featured/homepage placement.`
    );
  }
  if (stats.newArrivals > 0) {
    insights.push(
      `${stats.newArrivals} new arrival${stats.newArrivals === 1 ? "" : "s"} since your last crawl cycle — fresh inventory converts fastest in its first 2 weeks.`
    );
  }
  if (insights.length === 0) {
    insights.push("No notable patterns in your current inventory — everything looks healthy.");
  }
  return insights;
}

export const DealerAnalytics: React.FC<DealerAnalyticsProps> = ({ user }) => {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user.dealerName) {
      setIsLoading(false);
      setError("No dealership is associated with your account yet.");
      return;
    }
    setIsLoading(true);
    setError(null);
    fetch(`/api/dealer-analytics?dealerName=${encodeURIComponent(user.dealerName)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((json: AnalyticsResponse) => setData(json))
      .catch((e) => setError(e.message || "Could not load analytics."))
      .finally(() => setIsLoading(false));
  }, [user.dealerName]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-black text-white">AI Sales Analytics</h1>
          <p className="text-xs text-ink-muted">
            {user.dealerName || "No dealership on file"}
            {data && data.brands.length > 0 && (
              <span className="ml-2 text-ink-faint">· {data.brands.join(", ")}</span>
            )}
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface p-16 text-ink-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading your real inventory data…</span>
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-6 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!isLoading && !error && data && !data.hasData && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center space-y-2">
          <Package className="h-8 w-8 text-ink-faint mx-auto" />
          <p className="text-sm text-white font-bold">No live inventory found for "{data.dealerName}" yet.</p>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            This dashboard reads real crawled inventory data. If your dealership was recently added, its brand's
            nationwide crawl may not have reached it yet — check back once that finishes.
          </p>
        </div>
      )}

      {!isLoading && !error && data && data.hasData && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-ink-faint">
                <Package className="h-3 w-3" /> Active Inventory
              </div>
              <div className="text-2xl font-black text-white font-mono">{data.stats.totalActive}</div>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-ink-faint">
                <TrendingDown className="h-3 w-3" /> Price Drops Active
              </div>
              <div className="text-2xl font-black text-rose-400 font-mono">{data.stats.priceDrops}</div>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-ink-faint">
                <TrendingUp className="h-3 w-3" /> New Arrivals
              </div>
              <div className="text-2xl font-black text-emerald-400 font-mono">{data.stats.newArrivals}</div>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-ink-faint">
                <Clock className="h-3 w-3" /> Avg Days on Lot
              </div>
              <div className="text-2xl font-black text-white font-mono">{data.stats.avgDaysOnLot}</div>
            </div>
          </div>

          {/* Insights */}
          <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wide">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              Insights
            </div>
            <ul className="space-y-2">
              {buildInsights(data).map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-ink-muted leading-relaxed">
                  <span className="mt-1 h-1 w-1 rounded-full bg-emerald-400 shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Model mix */}
            <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
              <div className="text-xs font-bold text-white uppercase tracking-wide">Model Mix</div>
              {data.modelMix.length === 0 ? (
                <p className="text-xs text-ink-faint">No model data available.</p>
              ) : (
                <div className="space-y-2">
                  {data.modelMix.map((m) => {
                    const max = data.modelMix[0].count;
                    return (
                      <div key={m.model} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-white font-semibold">{m.model}</span>
                          <span className="text-ink-muted font-mono">{m.count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.max(4, (m.count / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Aging inventory */}
            <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wide">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                Aging Inventory (&gt;45 Days)
              </div>
              {data.agingInventory.length === 0 ? (
                <p className="text-xs text-ink-faint">No aging inventory — nice work.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {data.agingInventory.map((v) => (
                    <div
                      key={v.vin}
                      className="flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-2.5 text-[11px]"
                    >
                      <div>
                        <div className="font-bold text-white">
                          {v.year} {v.make} {v.model} {v.trim && `(${v.trim})`}
                        </div>
                        <div className="text-ink-faint font-mono">{v.vin}</div>
                      </div>
                      <div className="text-right space-y-0.5">
                        <div className="text-amber-400 font-mono font-bold">{v.daysOnLot}d</div>
                        {v.url && (
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                          >
                            View <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent price drops */}
          {data.recentPriceDrops.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wide">
                <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
                Recent Price Drops
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.recentPriceDrops.map((v) => (
                  <div
                    key={v.vin}
                    className="flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-2.5 text-[11px]"
                  >
                    <div>
                      <div className="font-bold text-white">
                        {v.year} {v.make} {v.model}
                      </div>
                      <div className="text-ink-faint font-mono">{v.vin}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-mono font-bold">${v.price?.toLocaleString()}</div>
                      <div className="text-rose-400 font-mono">
                        {v.priceDiff && v.priceDiff < 0 ? "-" : "+"}${Math.abs(v.priceDiff || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
