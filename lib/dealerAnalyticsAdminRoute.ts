/**
 * Request handlers behind app/api/admin/dealer-analytics/*. Kept out of the route files so the admin gate, the input checks and the error mapping are
 * unit-tested with injected dependencies. Admin only: the same 403 as app/api/admin/inventory/route.ts.
 */
import { NextResponse } from "next/server";
import { InventoryApiError } from "./inventoryApi";
import { dealerAnalyticsDealer, dealerAnalyticsDealers, dealerAnalyticsMarket } from "./dealerAnalyticsApi";

export interface AdminRouteDeps {
  requireAdmin: () => Promise<unknown>;
  dealers: typeof dealerAnalyticsDealers;
  dealer: typeof dealerAnalyticsDealer;
  market: typeof dealerAnalyticsMarket;
}
// adminAuth pulls in NextAuth, so it is loaded on first use (the unit tests inject their own gate and never load it).
const requireAdmin = async () => (await import("./adminAuth")).requireAdminSession();
export const defaultAdminRouteDeps: AdminRouteDeps = { requireAdmin, dealers: dealerAnalyticsDealers, dealer: dealerAnalyticsDealer, market: dealerAnalyticsMarket };

// The data changes once a day (the nightly job); let the admin's browser keep a page a minute so tab and filter switches are instant.
const CACHE_HEADERS = { "Cache-Control": "private, max-age=60" };

class BadInput extends Error {}

export function parseDealerIdParam(raw: string): number {
  if (!/^[1-9]\d{0,8}$/.test(raw)) throw new BadInput("A dealer id is a positive whole number.");
  return Number(raw);
}
function flag(sp: URLSearchParams, key: string): boolean {
  const v = sp.get(key);
  if (v == null || v === "" || v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  throw new BadInput(`${key} must be 1 or 0.`);
}
function day(sp: URLSearchParams): string | undefined {
  const v = sp.get("day");
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new BadInput("day must be YYYY-MM-DD.");
  return v;
}
function int(sp: URLSearchParams, key: string, min: number, max: number): number | undefined {
  const v = sp.get(key);
  if (v == null || v === "") return undefined;
  if (!/^\d{1,6}$/.test(v) || Number(v) < min || Number(v) > max) throw new BadInput(`${key} must be a whole number from ${min} to ${max}.`);
  return Number(v);
}
function direction(sp: URLSearchParams): "all" | "drop" | "increase" | undefined {
  const v = sp.get("direction");
  if (!v) return undefined;
  if (v !== "all" && v !== "drop" && v !== "increase") throw new BadInput("direction must be all, drop or increase.");
  return v;
}

async function guarded(deps: AdminRouteDeps, work: () => Promise<unknown>): Promise<Response> {
  if (!(await deps.requireAdmin())) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try {
    return NextResponse.json(await work(), { headers: CACHE_HEADERS });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    // 503 from the box is "not built yet" (or a statement the cap stopped); 400/404 pass through; everything else is a bad gateway.
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    const message = err instanceof InventoryApiError ? err.message : "Could not load dealer analytics.";
    return NextResponse.json({ error: message }, { status });
  }
}

export function getDealersTable(req: Request, deps: AdminRouteDeps = defaultAdminRouteDeps) {
  return guarded(deps, async () => {
    const sp = new URL(req.url).searchParams;
    return deps.dealers({ includeBuckets: flag(sp, "includeBuckets"), day: day(sp) });
  });
}

export function getDealerView(req: Request, rawId: string, deps: AdminRouteDeps = defaultAdminRouteDeps) {
  return guarded(deps, async () => {
    const sp = new URL(req.url).searchParams;
    const id = parseDealerIdParam(rawId);
    return deps.dealer(id, { limit: int(sp, "limit", 1, 200), offset: int(sp, "offset", 0, 10_000), direction: direction(sp), day: day(sp) });
  });
}

export function getDealerMarket(req: Request, rawId: string, deps: AdminRouteDeps = defaultAdminRouteDeps) {
  return guarded(deps, async () => {
    const sp = new URL(req.url).searchParams;
    return deps.market(parseDealerIdParam(rawId), { day: day(sp) });
  });
}
