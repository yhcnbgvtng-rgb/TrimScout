/**
 * Dealer Analytics on the deals box (admin page): thin typed client for the box's /api/inventory/dealer-analytics/* endpoints, which read the tables the
 * nightly job fills (docs/DEALER_ANALYTICS_NIGHTLY.md). Server-only (API key). Brands are completed here with the same rule as the Crawl page's Dealers tab:
 * the crawl's "Brand:" tags first, else the dealer name.
 */
import { brandsFromName } from "./crawlSheet";
import { dealsRequest } from "./inventoryApi";

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

type BoxRow = Omit<DealerAnalyticsRow, "brands"> & { brandTags: string[] };

const BASE = "/api/inventory/dealer-analytics";
const brandsFor = (tags: string[] | undefined, name: string) => (tags && tags.length ? tags : brandsFromName(name));

export interface DealerAnalyticsDeps {
  request: (method: "GET" | "POST", path: string) => Promise<any>;
}
const defaultDeps: DealerAnalyticsDeps = { request: (method, path) => dealsRequest(method, path) };

export function dealerAnalyticsQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    p.set(k, v === true ? "1" : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function dealerAnalyticsDealers(f: { includeBuckets?: boolean; day?: string } = {}, deps: DealerAnalyticsDeps = defaultDeps): Promise<DealerAnalyticsTable> {
  const json = await deps.request("GET", `${BASE}/dealers${dealerAnalyticsQuery({ includeBuckets: f.includeBuckets, day: f.day })}`);
  return { ...json, dealers: (json.dealers as BoxRow[]).map(({ brandTags, ...r }) => ({ ...r, brands: brandsFor(brandTags, r.dealerName) })) };
}

export async function dealerAnalyticsDealer(id: number, f: { limit?: number; offset?: number; direction?: "all" | "drop" | "increase"; day?: string } = {}, deps: DealerAnalyticsDeps = defaultDeps): Promise<DealerAnalyticsView> {
  const json = await deps.request("GET", `${BASE}/dealers/${id}${dealerAnalyticsQuery({ limit: f.limit, offset: f.offset, direction: f.direction, day: f.day })}`);
  const { brandTags, ...dealer } = json.dealer;
  return { ...json, dealer: { ...dealer, brands: brandsFor(brandTags, dealer.dealerName) } };
}

export async function dealerAnalyticsMarket(id: number, f: { day?: string } = {}, deps: DealerAnalyticsDeps = defaultDeps): Promise<DealerMarketView> {
  return deps.request("GET", `${BASE}/dealers/${id}/market${dealerAnalyticsQuery({ day: f.day })}`);
}
