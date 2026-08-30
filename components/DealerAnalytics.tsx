"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  TrendingDown,
  TrendingUp,
  Clock,
  Package,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Search,
  Layers,
  Globe,
} from "lucide-react";
import { UserProfile } from "../lib/types";
import { VehicleHistoryTimeline } from "./VehicleHistoryTimeline";

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
  fullInventory: {
    vin: string;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    price: number | null;
    oldPrice: number | null;
    priceDiff: number | null;
    changeType: string | null;
    status: string | null;
    daysOnLot: number | null;
    url: string | null;
  }[];
  nationwideInventory: {
    model: string;
    brand: string;
    totalCount: number;
    vehicles: {
      vin: string;
      dealerName: string | null;
      state: string | null;
      year: number | null;
      make: string | null;
      model: string | null;
      trim: string | null;
      price: number | null;
      oldPrice: number | null;
      priceDiff: number | null;
      changeType: string | null;
      daysOnLot: number | null;
      url: string | null;
    }[];
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

  const [vinInput, setVinInput] = useState("");
  const [lookupVin, setLookupVin] = useState<string | null>(null);

  const [inventoryFilter, setInventoryFilter] = useState("");
  const [nationwideFilter, setNationwideFilter] = useState("");

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

  const groupedInventory = useMemo(() => {
    if (!data) return [];
    const q = inventoryFilter.trim().toLowerCase();
    const filtered = q
      ? data.fullInventory.filter((v) =>
          [v.vin, v.year, v.make, v.model, v.trim].filter(Boolean).join(" ").toLowerCase().includes(q)
        )
      : data.fullInventory;
    const byModel = new Map<string, AnalyticsResponse["fullInventory"]>();
    for (const v of filtered) {
      const key = v.model || "Unknown Model";
      if (!byModel.has(key)) byModel.set(key, []);
      byModel.get(key)!.push(v);
    }
    return [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, inventoryFilter]);

  // Each group already arrives sorted by days-on-lot descending (the box
  // API sorts server-side) — filtering here must not re-sort, just narrow.
  const filteredNationwide = useMemo(() => {
    if (!data) return [];
    const q = nationwideFilter.trim().toLowerCase();
    return data.nationwideInventory
      .map((group) => ({
        ...group,
        vehicles: q
          ? group.vehicles.filter((v) =>
              [v.vin, v.year, v.make, v.model, v.trim, v.dealerName, v.state]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(q)
            )
          : group.vehicles,
      }))
      .filter((group) => group.vehicles.length > 0);
  }, [data, nationwideFilter]);

  const handleVinSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const vin = vinInput.trim().toUpperCase();
    if (vin.length === 17) setLookupVin(vin);
  };

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

      {/* VIN price-history search — works for any VIN, independent of dealer match */}
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wide">
          <Search className="h-3.5 w-3.5 text-emerald-400" />
          VIN Price History Search
        </div>
        <form onSubmit={handleVinSearch} className="flex gap-2">
          <input
            value={vinInput}
            onChange={(e) => setVinInput(e.target.value)}
            placeholder="Enter a 17-character VIN…"
            maxLength={17}
            className="flex-1 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs font-mono text-white placeholder:text-ink-faint focus:outline-none focus:border-emerald-500/50"
          />
          <button
            type="submit"
            disabled={vinInput.trim().length !== 17}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Search
          </button>
        </form>
        {lookupVin && <VehicleHistoryTimeline key={lookupVin} vin={lookupVin} showSummary />}
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

          {/* Full inventory, grouped by model, searchable, with price change per VIN */}
          <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wide">
                <Layers className="h-3.5 w-3.5 text-emerald-400" />
                Dealership Inventory ({data.fullInventory.length})
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-ink-faint" />
                <input
                  value={inventoryFilter}
                  onChange={(e) => setInventoryFilter(e.target.value)}
                  placeholder="Search model, VIN, trim…"
                  className="w-56 rounded-xl border border-border bg-surface-elevated pl-7 pr-3 py-1.5 text-[11px] text-white placeholder:text-ink-faint focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>

            {groupedInventory.length === 0 ? (
              <p className="text-xs text-ink-faint py-4">No vehicles match your search.</p>
            ) : (
              <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
                {groupedInventory.map(([model, vehicles]) => (
                  <div key={model} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] font-bold text-white sticky top-0 bg-surface py-1">
                      {model}
                      <span className="text-ink-faint font-normal">({vehicles.length})</span>
                    </div>
                    <div className="space-y-1.5">
                      {vehicles.map((v) => {
                        const hasDelta = v.priceDiff != null && v.priceDiff !== 0;
                        const dropped = (v.priceDiff ?? 0) < 0;
                        return (
                          <div
                            key={v.vin}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-elevated p-2.5 text-[11px]"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-white truncate">
                                {v.year} {v.make} {v.model} {v.trim && `(${v.trim})`}
                              </div>
                              <div className="text-ink-faint font-mono flex items-center gap-2">
                                {v.vin}
                                {v.daysOnLot != null && <span>· {v.daysOnLot}d on lot</span>}
                              </div>
                            </div>
                            <div className="text-right shrink-0 space-y-0.5">
                              <div className="text-white font-mono font-bold">
                                {v.price != null ? `$${v.price.toLocaleString()}` : "—"}
                              </div>
                              {hasDelta ? (
                                <div className={`font-mono ${dropped ? "text-rose-400" : "text-amber-400"}`}>
                                  {dropped ? "-" : "+"}${Math.abs(v.priceDiff || 0).toLocaleString()}
                                </div>
                              ) : (
                                <div className="text-ink-faint font-mono">no change</div>
                              )}
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
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Nationwide inventory for the same make/model/trim, across every
              dealer — competitive view, sorted by highest days-on-hand. */}
          <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wide">
                <Globe className="h-3.5 w-3.5 text-emerald-400" />
                Nationwide Inventory — Same Models
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-ink-faint" />
                <input
                  value={nationwideFilter}
                  onChange={(e) => setNationwideFilter(e.target.value)}
                  placeholder="Search model, VIN, trim, dealer, state…"
                  className="w-64 rounded-xl border border-border bg-surface-elevated pl-7 pr-3 py-1.5 text-[11px] text-white placeholder:text-ink-faint focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
            <p className="text-[11px] text-ink-muted">
              Every VIN nationwide (any dealer) for the models you carry, sorted by days on hand — highest first.
            </p>

            {filteredNationwide.length === 0 ? (
              <p className="text-xs text-ink-faint py-4">No matching nationwide inventory.</p>
            ) : (
              <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
                {filteredNationwide.map((group) => (
                  <div key={group.model} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] font-bold text-white sticky top-0 bg-surface py-1">
                      {group.model}
                      <span className="text-ink-faint font-normal">
                        (showing {group.vehicles.length} of {group.totalCount.toLocaleString()} nationwide)
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {group.vehicles.map((v) => {
                        const hasDelta = v.priceDiff != null && v.priceDiff !== 0;
                        const dropped = (v.priceDiff ?? 0) < 0;
                        return (
                          <div
                            key={v.vin}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-elevated p-2.5 text-[11px]"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-white truncate">
                                {v.year} {v.make} {v.model} {v.trim && `(${v.trim})`}
                              </div>
                              <div className="text-ink-faint font-mono flex items-center gap-2 flex-wrap">
                                {v.vin}
                                <span className="text-ink-muted font-sans">
                                  {v.dealerName}
                                  {v.state && ` · ${v.state}`}
                                </span>
                              </div>
                            </div>
                            <div className="text-right shrink-0 space-y-0.5">
                              <div className="text-amber-400 font-mono font-bold">{v.daysOnLot ?? 0}d on lot</div>
                              <div className="text-white font-mono">
                                {v.price != null ? `$${v.price.toLocaleString()}` : "—"}
                              </div>
                              {hasDelta ? (
                                <div className={`font-mono ${dropped ? "text-rose-400" : "text-amber-400"}`}>
                                  {dropped ? "-" : "+"}${Math.abs(v.priceDiff || 0).toLocaleString()}
                                </div>
                              ) : (
                                <div className="text-ink-faint font-mono">no change</div>
                              )}
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
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
