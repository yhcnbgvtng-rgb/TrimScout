"use client";

import React, { useMemo, useState } from "react";
import { VehicleRecord } from "./LightsailIntelligence";
import { Sparkles, PackageX, TrendingDown, TrendingUp, Clock, ExternalLink } from "lucide-react";

interface DailyChangesPanelProps {
  vehicles: VehicleRecord[];
  selectedDealer: string;
}

type ChangeTab = "new" | "sold" | "price_drop" | "price_up";

const TAB_STYLES: Record<ChangeTab, { active: string; iconActive: string }> = {
  new: { active: "border-emerald-500/50 bg-emerald-500/10", iconActive: "text-emerald-400" },
  sold: { active: "border-zinc-400/50 bg-zinc-400/10", iconActive: "text-zinc-300" },
  price_drop: { active: "border-rose-500/50 bg-rose-500/10", iconActive: "text-rose-400" },
  price_up: { active: "border-amber-500/50 bg-amber-500/10", iconActive: "text-amber-400" },
};

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function formatDate(d?: string): string {
  if (!d) return "—";
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const DailyChangesPanel: React.FC<DailyChangesPanelProps> = ({ vehicles, selectedDealer }) => {
  const [activeTab, setActiveTab] = useState<ChangeTab>("new");

  const scoped = useMemo(
    () => (selectedDealer === "ALL" ? vehicles : vehicles.filter((v) => v.dealerName === selectedDealer)),
    [vehicles, selectedDealer]
  );

  const { newArrivals, sold, priceDrops, priceIncreases, lastSync } = useMemo(() => {
    const newArrivals = scoped.filter((v) => v.changeType === "NEW_ARRIVAL");
    const sold = scoped.filter((v) => v.status === "SOLD_OR_REMOVED" || v.changeType === "SOLD");
    const priceDrops = scoped
      .filter((v) => v.changeType === "PRICE_DROP")
      .sort((a, b) => (a.priceDiff || 0) - (b.priceDiff || 0));
    const priceIncreases = scoped
      .filter((v) => v.changeType === "PRICE_INCREASE")
      .sort((a, b) => (b.priceDiff || 0) - (a.priceDiff || 0));
    const timestamps = scoped.map((v) => v.lastSeen).filter((d): d is string => !!d).sort();
    const lastSync = timestamps[timestamps.length - 1];
    return { newArrivals, sold, priceDrops, priceIncreases, lastSync };
  }, [scoped]);

  const tabs: { id: ChangeTab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: "new", label: "New Arrivals", count: newArrivals.length, icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: "sold", label: "Sold / Removed", count: sold.length, icon: <PackageX className="h-3.5 w-3.5" /> },
    { id: "price_drop", label: "Price Drops", count: priceDrops.length, icon: <TrendingDown className="h-3.5 w-3.5" /> },
    { id: "price_up", label: "Price Increases", count: priceIncreases.length, icon: <TrendingUp className="h-3.5 w-3.5" /> },
  ];

  const activeList =
    activeTab === "new" ? newArrivals : activeTab === "sold" ? sold : activeTab === "price_drop" ? priceDrops : priceIncreases;

  // If every tracked vehicle shares the same changeType, "NEW_ARRIVAL" isn't
  // a real signal — it just means the crawler has only ever run once (or
  // without a persistent snapshot to diff against), so everything defaults
  // to "new" regardless of whether it actually is. In that case there is no
  // real day-over-day comparison available, so show nothing rather than the
  // entire inventory mislabeled as "activity" — that was the actual bug:
  // dumping ~17,000 vehicles into "New Arrivals" because the field couldn't
  // distinguish real change from "never compared."
  const hasComparableData = scoped.length > 0 && !scoped.every((v) => v.changeType === scoped[0].changeType);

  if (!hasComparableData) {
    return (
      <div className="rounded-3xl border border-border bg-surface p-6 space-y-4 shadow-xl">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Clock className="h-4 w-4 text-emerald-400" />
            Daily Market Activity
          </h3>
          <p className="text-[11px] text-ink-muted mt-1">
            {selectedDealer === "ALL" ? "All dealerships" : selectedDealer}
          </p>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[11px] text-amber-300">
          No day-over-day comparison is available yet. This inventory sync doesn't have a prior snapshot to diff against, so
          there's nothing genuine to show as "new," "sold," or a price change — new arrivals, sold vehicles, and price moves
          will appear here once the crawler runs on a recurring schedule against a persistent snapshot.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border bg-surface p-6 space-y-5 shadow-xl">
      <div>
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Clock className="h-4 w-4 text-emerald-400" />
          Daily Market Activity
        </h3>
        <p className="text-[11px] text-ink-muted mt-1">
          {selectedDealer === "ALL" ? "All dealerships" : selectedDealer} · Based on most recent inventory sync
          {lastSync ? ` (${formatDate(lastSync)})` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-2xl border p-3 text-left transition-all cursor-pointer ${
              activeTab === tab.id ? TAB_STYLES[tab.id].active : "border-border bg-surface-elevated hover:border-border-strong"
            }`}
          >
            <div
              className={`flex items-center gap-1.5 text-[10px] uppercase font-bold ${
                activeTab === tab.id ? TAB_STYLES[tab.id].iconActive : "text-ink-faint"
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </div>
            <div className="text-xl font-black text-white mt-1">{tab.count}</div>
          </button>
        ))}
      </div>

      <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
        {activeList.length === 0 ? (
          <div className="text-[11px] text-ink-muted text-center py-8">No vehicles in this category right now.</div>
        ) : (
          activeList.map((v) => (
            <a
              key={v.vin}
              href={v.url || undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-3 text-xs hover:border-border-strong transition-all group"
            >
              <div className="space-y-0.5 min-w-0">
                <div className="font-bold text-white flex items-center gap-1.5 truncate">
                  <span className="truncate">
                    {v.year} {v.make} {v.model} {v.trim || ""}
                  </span>
                  <ExternalLink className="h-3 w-3 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </div>
                <div className="text-[10.5px] text-ink-muted truncate">
                  {v.dealerName} · {v.vin}
                </div>
              </div>
              <div className="text-right font-mono flex-shrink-0 pl-3">
                {activeTab === "price_drop" || activeTab === "price_up" ? (
                  <>
                    <div className={`font-bold ${activeTab === "price_drop" ? "text-rose-400" : "text-amber-400"}`}>
                      {v.priceDiff && v.priceDiff > 0 ? "+" : ""}
                      {formatMoney(v.priceDiff)}
                    </div>
                    <div className="text-[10px] text-ink-faint">
                      {formatMoney(v.oldPrice)} → {formatMoney(v.price)}
                    </div>
                  </>
                ) : activeTab === "sold" ? (
                  <div className="text-[10.5px] text-ink-faint">Last seen {formatDate(v.lastSeen)}</div>
                ) : (
                  <>
                    <div className="font-bold text-white">{formatMoney(v.price)}</div>
                    <div className="text-[10px] text-ink-faint">First seen {formatDate(v.firstSeen)}</div>
                  </>
                )}
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
};
