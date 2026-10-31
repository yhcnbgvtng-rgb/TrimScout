/** Pure helpers for the admin Dealer Analytics pages: fetch-state mapping, table filter/sort, number formats. */
import type { DealerAnalyticsRow } from "./dealerAnalyticsTypes";

export type LoadFailure = "not_built" | "not_found" | "error";
export class AnalyticsFetchError extends Error {
  constructor(public kind: LoadFailure, message: string) { super(message); }
}

/** 503 = the nightly tables are not built yet; 404 = no such dealer; anything else is a plain error. */
export function failureKind(status: number): LoadFailure {
  return status === 503 ? "not_built" : status === 404 ? "not_found" : "error";
}

export async function getAnalytics<T>(url: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AnalyticsFetchError(failureKind(res.status), (body as { error?: string }).error || "Could not load dealer analytics.");
  return body as T;
}

export type SortKey = "dealerName" | "state" | "activeUnits" | "makeCount" | "dropUnits7d" | "dropUnits30d" | "avgDom";
export interface TableFilters { q: string; state: string; make: string }

export function filterDealers(rows: DealerAnalyticsRow[], f: TableFilters): DealerAnalyticsRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) =>
    (!f.state || r.state === f.state) &&
    (!f.make || r.brands.includes(f.make)) &&
    (!q || `${r.dealerName} ${r.city ?? ""} ${r.state ?? ""}`.toLowerCase().includes(q)));
}

/** Nulls always sort last, whichever direction. */
export function sortDealers(rows: DealerAnalyticsRow[], key: SortKey, dir: 1 | -1): DealerAnalyticsRow[] {
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
  });
}

export const facetValues = (rows: DealerAnalyticsRow[], pick: (r: DealerAnalyticsRow) => string | string[] | null): string[] =>
  [...new Set(rows.flatMap((r) => { const v = pick(r); return v == null ? [] : Array.isArray(v) ? v : [v]; }))].filter(Boolean).sort();

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`);
export const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
