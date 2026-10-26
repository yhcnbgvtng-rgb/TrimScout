"use client";

// A two-handle range with an optional distribution sparkline. Empty min/max mean "no bound" (the same empty strings the filters already use),
// so a thumb parked at an end of the track clears that bound instead of sending a number. Used for price, year and mileage.

import React from "react";

export interface RangeFilterProps {
  label: string;
  /** The picked bounds as the filter state holds them: "" = no bound. */
  min: string;
  max: string;
  domainMin: number;
  domainMax: number;
  step: number;
  /** Text for a bound; `open` is true at the open end of the track ("$150k+", "Newest"). */
  format: (n: number, open: boolean) => string;
  onChange: (min: string, max: string) => void;
  /** Bucket counts drawn as bars over the track: bucket i spans [domainMin + i*bucketWidth, +bucketWidth). The last bucket is open-ended when `lastOpen`. */
  histogram?: number[];
  bucketWidth?: number;
  lastOpen?: boolean;
  /** Each bucket is one whole value (a year): a bar is inside when its value is within [min, max], both ends included. */
  discrete?: boolean;
  testId?: string;
}

export function RangeFilter(p: RangeFilterProps) {
  const { domainMin, domainMax, step } = p;
  const lo = p.min ? Math.max(domainMin, Math.min(Number(p.min), domainMax)) : domainMin;
  const hi = p.max ? Math.max(domainMin, Math.min(Number(p.max), domainMax)) : domainMax;
  const pct = (n: number) => ((n - domainMin) / (domainMax - domainMin)) * 100;
  const emit = (a: number, b: number) => p.onChange(a <= domainMin ? "" : String(a), b >= domainMax ? "" : String(b));
  return (
    <div className="py-2" role="group" aria-label={`${p.label} range`}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{p.label}</span>
        <span className="text-sm tabular-nums text-white" data-testid={p.testId ? `${p.testId}-readout` : undefined}>{p.format(lo, false)} – {p.format(hi, hi >= domainMax)}</span>
      </div>
      {p.histogram && p.histogram.length > 1 && p.bucketWidth ? <Sparkline counts={p.histogram} lo={lo} hi={hi} {...{ domainMin, domainMax, bucketWidth: p.bucketWidth, lastOpen: Boolean(p.lastOpen), discrete: Boolean(p.discrete), testId: p.testId }} /> : null}
      <div className="relative h-6">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-border" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-brand-500" style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }} />
        <input type="range" aria-label={`Minimum ${p.label.toLowerCase()}`} min={domainMin} max={domainMax} step={step} value={lo}
          onChange={(e) => emit(Math.min(Number(e.target.value), hi - step), hi)} className="price-range" />
        <input type="range" aria-label={`Maximum ${p.label.toLowerCase()}`} min={domainMin} max={domainMax} step={step} value={hi}
          onChange={(e) => emit(lo, Math.max(Number(e.target.value), lo + step))} className="price-range" />
      </div>
    </div>
  );
}

/** Bars scaled to the tallest bucket; a bar is bright when any part of its bucket is inside [lo, hi]. Decorative (aria-hidden): the readout carries the numbers. */
function Sparkline({ counts, lo, hi, domainMin, domainMax, bucketWidth, lastOpen, discrete, testId }: {
  counts: number[]; lo: number; hi: number; domainMin: number; domainMax: number; bucketWidth: number; lastOpen: boolean; discrete: boolean; testId?: string;
}) {
  const peak = Math.max(1, ...counts);
  const n = counts.length;
  return (
    <svg aria-hidden data-testid={testId ? `${testId}-sparkline` : undefined} viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" className="mb-1 h-7 w-full">
      {counts.map((c, i) => {
        const from = domainMin + i * bucketWidth, to = from + bucketWidth;
        const inside = discrete ? from >= lo && from <= hi : to > lo && (i === n - 1 && lastOpen ? hi >= domainMax : from < hi);
        const h = c > 0 ? Math.max(1, (c / peak) * 20) : 0;
        return <rect key={i} x={i + 0.12} y={20 - h} width={0.76} height={h} rx={0.2} className={inside ? "fill-brand-500" : "fill-border-strong"} opacity={inside ? 0.85 : 0.6} />;
      })}
    </svg>
  );
}
