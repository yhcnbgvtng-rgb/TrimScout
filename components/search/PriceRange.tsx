"use client";

// Two-handle price range. Empty min/max mean "no bound" (the same empty strings the filters already use), so the thumbs at the
// ends of the track clear the filter instead of sending a price.

import React from "react";
import { HISTOGRAM_BUCKET, PRICE_SLIDER, sliderMoney } from "@/lib/searchLive";

/** `histogram`: 31 bucket counts ($5,000 wide, the last open-ended), drawn as a sparkline over the track; the bars outside the picked range dim. */
export function PriceRange({ min, max, histogram, onChange }: { min: string; max: string; histogram?: number[]; onChange: (min: string, max: string) => void }) {
  const lo = min ? Math.min(Number(min), PRICE_SLIDER.max) : PRICE_SLIDER.min;
  const hi = max ? Math.min(Number(max), PRICE_SLIDER.max) : PRICE_SLIDER.max;
  const pct = (n: number) => ((n - PRICE_SLIDER.min) / (PRICE_SLIDER.max - PRICE_SLIDER.min)) * 100;
  const emit = (a: number, b: number) => onChange(a <= PRICE_SLIDER.min ? "" : String(a), b >= PRICE_SLIDER.max ? "" : String(b));
  const thumb = "price-range";
  return (
    <div className="py-2" role="group" aria-label="Price range">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Price</span>
        <span className="text-sm tabular-nums text-white" data-testid="price-readout">{sliderMoney(lo)} – {sliderMoney(hi, hi >= PRICE_SLIDER.max)}</span>
      </div>
      {histogram && histogram.length > 1 && <Sparkline counts={histogram} lo={lo} hi={hi} />}
      <div className="relative h-6">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-border" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-brand-500" style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }} />
        <input type="range" aria-label="Minimum price" min={PRICE_SLIDER.min} max={PRICE_SLIDER.max} step={PRICE_SLIDER.step} value={lo}
          onChange={(e) => emit(Math.min(Number(e.target.value), hi - PRICE_SLIDER.step), hi)} className={thumb} />
        <input type="range" aria-label="Maximum price" min={PRICE_SLIDER.min} max={PRICE_SLIDER.max} step={PRICE_SLIDER.step} value={hi}
          onChange={(e) => emit(lo, Math.max(Number(e.target.value), lo + PRICE_SLIDER.step))} className={thumb} />
      </div>
    </div>
  );
}

/** Bars for each price bucket, scaled to the tallest; a bar is bright when any part of its bucket is inside [lo, hi]. Decorative (aria-hidden): the readout carries the numbers. */
function Sparkline({ counts, lo, hi }: { counts: number[]; lo: number; hi: number }) {
  const peak = Math.max(1, ...counts);
  const n = counts.length;
  return (
    <svg aria-hidden data-testid="price-sparkline" viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" className="mb-1 h-7 w-full">
      {counts.map((c, i) => {
        const from = i * HISTOGRAM_BUCKET, to = from + HISTOGRAM_BUCKET;
        const inside = to > lo && (i === n - 1 ? hi >= PRICE_SLIDER.max : from < hi);
        const h = c > 0 ? Math.max(1, (c / peak) * 20) : 0;
        return <rect key={i} x={i + 0.12} y={20 - h} width={0.76} height={h} rx={0.2} className={inside ? "fill-brand-500" : "fill-border-strong"} opacity={inside ? 0.85 : 0.6} />;
      })}
    </svg>
  );
}
