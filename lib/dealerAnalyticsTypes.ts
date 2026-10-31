/**
 * Response shapes of /api/admin/dealer-analytics/* — copied from lib/dealerAnalyticsApi.ts in PR 647 (type-only, so client components never import the
 * server client). Once 647 is merged, replace this file with `export type * from "./dealerAnalyticsApi"`.
 */

export interface DealerAnalyticsRow {
  dealerId: number;
  dealerName: string;
  city: string | null;
  state: string | null;
  /** Crawl "Brand:" tags, else brands recognised in the dealer name. */
  brands: string[];
  /** Dealer-group website attributed to one rooftop (40+ makes or 1,500+ units): hidden by default on the page. */
  isGroupBucket: boolean;
  makeCount: number;
  activeUnits: number;
  newUnits: number;
  usedUnits: number;
  pricedUnits: number;
  avgPrice: number | null;
  avgDom: number | null;
  added7d: number;
  removed7d: number;
  dropUnits7d: number;
  dropUnits30d: number;
  avgDropUsd7d: number | null;
  avgDropPct7d: number | null;
  avgDropUsd30d: number | null;
  avgDropPct30d: number | null;
}

export interface DealerAnalyticsTable {
  /** UTC date of the run the numbers come from, and when that run finished (ISO). */
  day: string;
  asOf: string;
  includeBuckets: boolean;
  /** Group-bucket dealers in this run, and how many of them this response left out. */
  bucketCount: number;
  hiddenBuckets: number;
  dealers: DealerAnalyticsRow[];
}

export interface DealerPriceChange {
  vin: string;
  changedOn: string;
  oldPrice: number;
  newPrice: number;
  deltaUsd: number;
  pctChange: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: string | null;
  vdpUrl: string | null;
  inStock: boolean | null;
}

export interface DealerAnalyticsView {
  day: string;
  asOf: string;
  dealer: { dealerId: number; dealerName: string; city: string | null; state: string | null; brands: string[] };
  isGroupBucket: boolean;
  summary: null | {
    makeCount: number; activeUnits: number; newUnits: number; usedUnits: number; pricedUnits: number; avgPrice: number | null; avgDom: number | null;
    added7d: number; removed7d: number; dropUnits7d: number; dropUnits30d: number; avgDropUsd7d: number | null; avgDropPct7d: number | null; avgDropUsd30d: number | null; avgDropPct30d: number | null;
  };
  /** 0-30, 31-60, 61-90, 90+ days on the lot, from the run's summary row. */
  ageBuckets: null | Array<{ bucket: "0-30" | "31-60" | "61-90" | "90+"; units: number }>;
  /** Daily units, up to the last 90 days of finished runs (fills in over time: history starts when the nightly job does). */
  trend: Array<{ day: string; activeUnits: number; newUnits: number; usedUnits: number; avgPrice: number | null; addedUnits: number; removedUnits: number }>;
  mix: { makes: Array<{ make: string; units: number }>; models: Array<{ make: string; model: string; units: number; avgPrice: number | null }>; modelsTruncated: boolean };
  priceChanges: { total: number; limit: number; offset: number; direction: "all" | "drop" | "increase"; changes: DealerPriceChange[] };
}

export interface DealerMarketRow {
  make: string;
  model: string;
  year: number;
  condition: string;
  units: number;
  avgPrice: number;
  marketUnits: number | null;
  /** Dealers in the market sample for this make/model/year/condition. */
  marketDealers: number;
  marketAvgPrice: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
  /** Fewer than `minMarketDealers` dealers in the sample: show the delta greyed out. */
  thinMarket: boolean;
}

export interface DealerMarketView {
  day: string;
  asOf: string;
  dealerId: number;
  marketIncludesDealer: boolean;
  minMarketDealers: number;
  overall: { comparableUnits: number; weightedDeltaPct: number | null };
  rows: DealerMarketRow[];
}
