import React from 'react';
import { TrendingDown, Clock, Zap } from 'lucide-react';

export const MarketAnalytics: React.FC = () => {
  return (
    <section className="border-b border-border bg-surface/40 py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-1 mb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Real-Time Market Dynamics
            </h2>
          </div>
          <p className="text-sm text-ink-muted">
            Aggregated dealer pricing trends, days on lot supply, and negotiation leverage insights
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Card 1 */}
          <div className="group rounded-xl border border-border bg-surface p-4 transition-all hover:border-border-strong hover:bg-surface-elevated">
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                  New 2026 BMW 3-Series
                </span>
                <h3 className="mt-2 font-bold text-white text-base">
                  8.5% Avg Discount from MSRP
                </h3>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                  High inbound transit allocations. Buyers currently average <strong className="text-emerald-400">,200 below MSRP</strong> on 330i models.
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                <TrendingDown className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 pt-3 border-t border-border/50 text-[11px] text-ink-faint">
              <span className="text-emerald-400 font-semibold">14 dealers competing</span> in your regional radius
            </div>
          </div>

          {/* Card 2 */}
          <div className="group rounded-xl border border-border bg-surface p-4 transition-all hover:border-border-strong hover:bg-surface-elevated">
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400 border border-blue-500/20">
                  New 2026 Toyota Prius
                </span>
                <h3 className="mt-2 font-bold text-white text-base">
                  74% Sell Before Reaching Lot
                </h3>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                  Fastest-moving hybrid in the country. 74% are sold in transit. Only 26% ever reach a physical dealer lot.
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                <Zap className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 pt-3 border-t border-border/50 text-[11px] text-ink-faint">
              <span className="text-blue-400 font-semibold">Tip:</span> Bid on In-Transit units to lock in MSRP without dealer markups
            </div>
          </div>

          {/* Card 3 */}
          <div className="group rounded-xl border border-border bg-surface p-4 transition-all hover:border-border-strong hover:bg-surface-elevated">
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                  Cadillac Lyriq / Luxury EVs
                </span>
                <h3 className="mt-2 font-bold text-white text-base">
                  61+ Days on Lot (High Leverage)
                </h3>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                  Stale showroom inventory gives buyers heavy negotiation leverage. Dealers are accepting aggressive cash and lease discounts.
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                <Clock className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 pt-3 border-t border-border/50 text-[11px] text-ink-faint">
              <span className="text-amber-400 font-semibold">High Leverage:</span> Bid 10% below MSRP on units over 45 days
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
