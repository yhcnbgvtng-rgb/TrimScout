"use client";

// The price slider: a RangeFilter over $0 - $150k+ with the $5,000-bucket sparkline (31 buckets, the last open-ended).

import React from "react";
import { HISTOGRAM_BUCKET, PRICE_SLIDER, sliderMoney } from "@/lib/searchLive";
import { RangeFilter } from "./RangeFilter";

export function PriceRange({ min, max, histogram, onChange }: { min: string; max: string; histogram?: number[]; onChange: (min: string, max: string) => void }) {
  return (
    <RangeFilter label="Price" testId="price" min={min} max={max} domainMin={PRICE_SLIDER.min} domainMax={PRICE_SLIDER.max} step={PRICE_SLIDER.step}
      format={(n, open) => sliderMoney(n, open)} onChange={onChange} histogram={histogram} bucketWidth={HISTOGRAM_BUCKET} lastOpen />
  );
}
