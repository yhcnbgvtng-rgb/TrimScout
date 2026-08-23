import React from 'react';
import {
  TrendingDown,
  Clock,
  Zap
} from "lucide-react";

interface MarketAnalyticsProps {
  onNavigateToLightsail?: () => void;
}

export const MarketAnalytics: React.FC<MarketAnalyticsProps> = ({ onNavigateToLightsail }) => {
  return (
    <section className="border-b border-border bg-surface/40 py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Real-Time Market Dynamics & Cloud Intelligence
              </h2>
            </div>
            <p className="text-sm text-ink-muted">
              Aggregated dealer pricing trends, AWS Lightsail live feeds, and negotiation leverage insights
            </p>
          </div>

          {onNavigateToLightsail && (
            <button
              onClick={onNavigateToLightsail}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all cursor-pointer"
            >
              <span>View Full Lightsail Tracker</span>
              <span className="text-[10px]">→</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {/* Card 1 */}
          <div className="group rounded-xl border border-border bg-surface p-4 transition-all hover:border-border-strong hover:bg-surface-elevated">
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                  New 2026 BMW 3-Series
                </span>
                <h3 className="mt-2 font-bold text-white text-base">
                  8.5% Avg Discount
                </h3>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                  High inbound transit allocations. Buyers currently average <strong className="text-emerald-400">$4,200 below MSRP</strong> on 330i models.
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                <TrendingDown className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 pt-3 border-t border-border/50 text-[11px] text-ink-faint">
              <span className="text-emerald-400 font-semibold">14 dealers competing</span> in your radius
            </div>
          </div>

          {/* Card 2: AWS Lightsail Flagship Tracker Card */}
          <div
            onClick={onNavigateToLightsail}
            className="group rounded-xl border border-emerald-500/40 bg-gradient-to-br from-surface to-emerald-950/20 p-4 transition-all hover:border-emerald-400 hover:bg-surface-elevated cursor-pointer shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400 border border-emerald-500/30 flex items-center gap-1 w-fit">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  AWS Lightsail Live
                </span>
                <h3 className="mt-2 font-bold text-white text-base">
                  729 Porsche VINs Ingested
                </h3>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                  Direct telemetry from Paul Miller (NJ), Champion (FL), The Collection (FL), Brooklyn & South Shore.
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0">
                <Zap className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between pt-3 border-t border-border/50 text-[11px] text-ink-faint">
              <span className="text-emerald-400 font-bold">Overnight Price Drops Active</span>
              <span className="text-emerald-400">View Data →</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="group rounded-xl border border-border bg-surface p-4 transition-all hover:border-border-strong hover:bg-surface-elevated">
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400 border border-blue-500/20">
                  New 2026 Toyota Prius
                </span>
                <h3 className="mt-2 font-bold text-white text-base">
                  74% Sell in Transit
                </h3>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                  Fastest-moving hybrid in the USA. 74% sold before lot delivery.
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                <Zap className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 pt-3 border-t border-border/50 text-[11px] text-ink-faint">
              <span className="text-blue-400 font-semibold">Tip:</span> Bid on In-Transit units
            </div>
          </div>

          {/* Card 4 */}
          <div className="group rounded-xl border border-border bg-surface p-4 transition-all hover:border-border-strong hover:bg-surface-elevated">
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                  Luxury EVs & Aging Stock
                </span>
                <h3 className="mt-2 font-bold text-white text-base">
                  61+ Days on Lot
                </h3>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                  Stale showroom inventory gives buyers heavy negotiation leverage.
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                <Clock className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 pt-3 border-t border-border/50 text-[11px] text-ink-faint">
              <span className="text-amber-400 font-semibold">High Leverage:</span> Bid 10% below MSRP
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
