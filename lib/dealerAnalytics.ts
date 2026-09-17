/**
 * Dealership analytics (admin → Site Analytics → Dealership analytics).
 *
 * DOM here is DAYS ON MARKET — days a vehicle has sat on the lot — never the
 * HTML DOM. The deals box aggregates it in SQL (GET /api/inventory/analytics,
 * see scripts/box/2026-09-17-inventory-analytics.sh); this module holds the
 * response types and the pure math the page and the verification probe
 * share, so the definitions live in one place and are unit-tested.
 *
 *   DOM (per vehicle) = days_on_lot from the crawl when it carried one, else
 *                       (removed_at ?? today) − (crawl_first_seen ?? first_seen_at)
 *   Bands             = 0–14 · 15–45 · 46–90 · 90+ days
 *   Turn rate         = removed in the last 7 days ÷ on lot now (×100)
 *   Days supply       = on lot ÷ weekly sales pace, pace = removed in 28 days ÷ 4 (falls back to last 7)
 *   Discount %        = (MSRP − list price) ÷ MSRP, only where both are known and > 0
 *
 * "Removed" = the crawl stopped seeing the VIN at that store (sold-ish, or
 * moved); it is the only churn signal public listings give.
 */

export type DomBands = { d0_14: number; d15_45: number; d46_90: number; d90p: number };
export const DOM_BAND_LABELS: Array<{ key: keyof DomBands; label: string }> = [
  { key: "d0_14", label: "0–14" },
  { key: "d15_45", label: "15–45" },
  { key: "d46_90", label: "46–90" },
  { key: "d90p", label: "90+" },
];

export interface DomGroup {
  n: number;
  avgDom: number | null;
  medianDom: number | null;
  bands: DomBands;
}
export interface ModelDom extends DomGroup { make: string; model: string; avgDiscount?: number | string | null; withSticker?: number }
export interface DealerDom extends DomGroup {
  dealerId: number;
  dealerName: string;
  state: string | null;
  city: string | null;
  avgDiscount: number | null;
  withSticker: number;
  withOptions: number;
  missingPrice: number;
  missingPhoto: number;
  stale: number;
  hasEmail: boolean;
  lastSeenAt: string | null;
}
export interface TrimDom extends DomGroup { make: string; model: string; trim: string; avgDiscount?: number | string | null }
export interface YearDom extends DomGroup { make: string; model: string; year: number }
export interface LabelledDom extends DomGroup { drivetrain?: string; powertrain?: string }

export interface DealerAnalytics {
  computedAt: string;
  filters: { state: string; make: string; dealerId: number | null; model: string; from: string | null; to: string | null };
  domFormula: string;
  totals: { n: number; avgDom: number | null; bands: DomBands; dealers: number; models: number; lastSeenAt: string | null };
  dom: { byModel: ModelDom[]; byDealer: DealerDom[]; byTrim: TrimDom[]; byYear: YearDom[]; byDrivetrain: LabelledDom[]; byPowertrain: LabelledDom[] };
  velocity: {
    onLot: number; removed7: number; removed28: number; arrived7: number; turnRate: number | null;
    byModel: Array<{ make: string; model: string; onLot: number; removed7: number; removed28: number; turnRate: number | null; daysSupply: number | null }>;
    byDealer: Array<{ dealerId: number; dealerName: string; onLot: number; removed7: number; turnRate: number | null }>;
  };
  pricing: {
    avgDiscount: number | null; priced: number; dropsNow: number; avgDropNow: number | null;
    cuts: { vehiclesObserved: number; bands: Partial<Record<"lt30" | "d30" | "d60" | "d90", { cuts: number; avgCut: number; avgCutPct: number | null }>> } | null;
  };
  assortment: { brandNorm: Array<{ make: string; model: string; n: number }> };
  coverage: { byMake: Array<{ make: string; n: number; withSticker: number; withOptions: number; missingPrice: number; missingPhoto: number }>; dealersWithEmail: number; dealers: number };
}

/** Brands the crawler is scoped to: franchises that don't publish window stickers publicly. */
export const IN_SCOPE_MAKES = ["Toyota", "Lexus", "Kia", "Honda", "Acura", "Nissan", "Infiniti", "Subaru", "Mazda", "Volkswagen", "Audi", "BMW", "Mercedes-Benz", "Volvo", "Porsche", "MINI", "Mitsubishi"] as const;
const IN_SCOPE_KEYS = new Set(IN_SCOPE_MAKES.map((m) => m.toLowerCase().replace(/[^a-z]/g, "")));
export function isInScopeMake(make: string | null | undefined): boolean {
  const k = (make || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return false;
  if (k === "mercedes" || k === "mercedesbenz") return true;
  if (k === "vw" || k === "volkswagen") return true;
  return IN_SCOPE_KEYS.has(k);
}

// ---------------------------------------------------------------------------
// Pure math — the same formulas the box runs in SQL, for tests and the probe.
// ---------------------------------------------------------------------------

/** Per-vehicle DOM: the crawl's days_on_lot when present, else first-seen → removed/today. */
export function vehicleDom(v: { daysOnLot?: number | null; crawlFirstSeen?: string | null; firstSeenAt: string; removedAt?: string | null }, now: Date = new Date()): number {
  if (typeof v.daysOnLot === "number" && v.daysOnLot > 0) return v.daysOnLot;
  const start = Date.parse((v.crawlFirstSeen || v.firstSeenAt).slice(0, 10) + "T00:00:00Z");
  const end = v.removedAt ? Date.parse(v.removedAt) : now.getTime();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function domBand(dom: number): keyof DomBands {
  if (dom <= 14) return "d0_14";
  if (dom <= 45) return "d15_45";
  if (dom <= 90) return "d46_90";
  return "d90p";
}

export function bandsOf(doms: number[]): DomBands {
  const b: DomBands = { d0_14: 0, d15_45: 0, d46_90: 0, d90p: 0 };
  for (const d of doms) b[domBand(d)]++;
  return b;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

export function mean(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((t, v) => t + v, 0) / values.length) * 10) / 10 : null;
}

/** Removed in the last 7 days ÷ on lot, as a percentage. */
export function turnRate(onLot: number, removed7: number): number | null {
  return onLot > 0 ? Math.round((removed7 / onLot) * 1000) / 10 : null;
}

/** On lot ÷ weekly pace, in days. Pace from 28 days when there is any churn there, else the last 7. */
export function daysSupply(onLot: number, removed7: number, removed28: number): number | null {
  const weeklyPace = removed28 > 0 ? removed28 / 4 : removed7;
  return weeklyPace > 0 ? Math.round(onLot / (weeklyPace / 7)) : null;
}

export function discountPct(msrp: number | null | undefined, price: number | null | undefined): number | null {
  if (!msrp || !price || msrp <= 0 || price <= 0) return null;
  return Math.round(((msrp - price) / msrp) * 1000) / 10;
}

/** Share of each band, as percentages that sum to ~100. */
export function bandShares(b: DomBands): Record<keyof DomBands, number> {
  const n = b.d0_14 + b.d15_45 + b.d46_90 + b.d90p;
  const pct = (x: number) => (n ? Math.round((x / n) * 1000) / 10 : 0);
  return { d0_14: pct(b.d0_14), d15_45: pct(b.d15_45), d46_90: pct(b.d46_90), d90p: pct(b.d90p) };
}

/**
 * Model mix in this scope vs the brand's mix across every store we crawl.
 * Returns share points (scope − norm) per model, so +5 means this dealer/state
 * carries 5 points more of that model than the brand does overall.
 */
export function mixVsBrandNorm(scope: Array<{ make: string; model: string; n: number }>, norm: Array<{ make: string; model: string; n: number }>): Array<{ make: string; model: string; scopeShare: number; normShare: number; delta: number; n: number }> {
  const scopeTotals = new Map<string, number>();
  const normTotals = new Map<string, number>();
  for (const r of scope) scopeTotals.set(r.make, (scopeTotals.get(r.make) || 0) + r.n);
  for (const r of norm) normTotals.set(r.make, (normTotals.get(r.make) || 0) + r.n);
  const normByKey = new Map(norm.map((r) => [`${r.make}|${r.model}`, r.n]));
  return scope
    .map((r) => {
      const scopeShare = scopeTotals.get(r.make) ? (r.n / scopeTotals.get(r.make)!) * 100 : 0;
      const nn = normByKey.get(`${r.make}|${r.model}`) || 0;
      const normShare = normTotals.get(r.make) ? (nn / normTotals.get(r.make)!) * 100 : 0;
      return { make: r.make, model: r.model, n: r.n, scopeShare: Math.round(scopeShare * 10) / 10, normShare: Math.round(normShare * 10) / 10, delta: Math.round((scopeShare - normShare) * 10) / 10 };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}
