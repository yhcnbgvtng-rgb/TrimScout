"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PackagePlus, TrendingDown, Clock, Tag } from "lucide-react";
// Type-only import — MarketPulse (lib/inventoryApi.ts) also imports serverSecret, which reads
// process.env and must never end up in a client bundle. A `type` import is erased at compile
// time, so this is safe; a value import of that module from a "use client" component would not be.
import type { MarketPulse as MarketPulseData } from "@/lib/inventoryApi";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Tile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">{icon}</div>
      <div className="min-w-0">
        <p className="text-lg font-extrabold text-white leading-none">{value}</p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      </div>
    </div>
  );
}

/**
 * The public homepage's crawl-derived market pulse. Fetches /api/market-pulse client-side (never
 * blocks the page's own render) and renders nothing at all — no skeleton, no error banner — when
 * the pulse isn't available yet or the call fails; a homepage visitor came for the quote flow,
 * not this widget, so a missing pulse should be invisible, not a loading state competing for
 * attention or an error demanding one.
 */
export function MarketPulse() {
  const [pulse, setPulse] = useState<MarketPulseData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market-pulse")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json?.available && json.pulse) setPulse(json.pulse as MarketPulseData);
      })
      .catch(() => {
        // Soft-fail by design — see the component doc comment above.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!pulse) return null;

  const day = pulse.windows["24h"];

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl sm:text-2xl font-black text-white">Market Pulse</h2>
        <p className="text-xs text-ink-muted">From TrimScout&apos;s dealer crawl · updated {timeAgo(pulse.asOf)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Arrivals (24h)" value={day.arrivals.toLocaleString()} icon={<PackagePlus className="h-4 w-4" />} />
        <Tile label="Left lots (24h)" value={day.removed.toLocaleString()} icon={<TrendingDown className="h-4 w-4" />} />
        <Tile label="Median days on lot" value={day.medianDaysOnLot != null ? `${day.medianDaysOnLot}` : "—"} icon={<Clock className="h-4 w-4" />} />
        <Tile label="Price drops (24h)" value={day.priceDrops.toLocaleString()} icon={<Tag className="h-4 w-4" />} />
      </div>

      {pulse.justArrived.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Just arrived</h3>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {pulse.justArrived.map((v) => {
              const title = [v.year, v.make, v.model].filter(Boolean).join(" ");
              const card = (
                <div className="flex w-40 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
                  <div className="h-24 w-full bg-surface-elevated">
                    {v.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.imageUrl} alt={title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-faint">No photo</div>
                    )}
                  </div>
                  <div className="space-y-0.5 p-2">
                    <p className="truncate text-xs font-bold text-white">{title || "Vehicle"}</p>
                    <p className="text-xs font-extrabold text-emerald-400">{v.price != null ? `$${v.price.toLocaleString()}` : "Call for price"}</p>
                    <p className="truncate text-[10px] text-ink-faint">{v.dealerState || ""}</p>
                  </div>
                </div>
              );
              return v.vdpUrl ? (
                <Link key={v.vin} href={v.vdpUrl} target="_blank" rel="noopener noreferrer">
                  {card}
                </Link>
              ) : (
                <div key={v.vin}>{card}</div>
              );
            })}
          </div>
        </div>
      )}

      {pulse.movingMakes.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Moving now</h3>
          <div className="flex flex-wrap gap-2">
            {pulse.movingMakes.slice(0, 8).map((m) => (
              <span key={m.make} className="rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-ink-light">
                {m.make} <span className="text-emerald-400">leaving lots faster</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-ink-faint">
        Left lots = removed from dealer inventory in our crawl — not confirmed closed deals.
      </p>
    </div>
  );
}
