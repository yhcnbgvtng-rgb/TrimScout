import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listInventory, inventoryStats, inventoryByDealer, inventoryVin, inventoryAnalytics, InventoryApiError, type InventoryQuery } from "@/lib/inventoryApi";

export const dynamic = "force-dynamic";

/**
 * Crawled dealer inventory for the admin sheet. `?stats=1` returns the filter-menu counts; otherwise a page of
 * vehicles for the given filters. `?export=1` walks every page of the filter (cap 50k rows) for the CSV.
 */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  try {
    // Aggregates change once a day (the sync); let the admin's browser keep them a minute so tab switches are instant.
    const aggHeaders = { "Cache-Control": "private, max-age=60" };
    if (sp.get("stats") === "1") return NextResponse.json(await inventoryStats(), { headers: aggHeaders });
    if (sp.get("byDealer") === "1") return NextResponse.json(await inventoryByDealer(), { headers: aggHeaders });
    if (sp.get("vin")) return NextResponse.json(await inventoryVin(sp.get("vin") || ""));
    // Dealership analytics for the Site Analytics page — aggregated and cached on the box.
    if (sp.get("analytics") === "1") return NextResponse.json(await inventoryAnalytics({ state: sp.get("state") || undefined, make: sp.get("make") || undefined, dealerId: sp.get("dealerId") || null, model: sp.get("model") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined }));
    const q: InventoryQuery = {
      dealerId: sp.get("dealerId") || undefined, state: sp.get("state") || undefined, make: sp.get("make") || undefined, model: sp.get("model") || undefined,
      cond: sp.get("cond") || undefined, q: sp.get("q") || undefined, inStock: sp.get("inStock") === "1", sort: sp.get("sort") || undefined,
      changeType: sp.get("changeType") || undefined, priceChange: (sp.get("priceChange") as "drop" | "increase") || undefined, hasSticker: sp.get("hasSticker") === "1",
      minDays: sp.get("minDays") ? Number(sp.get("minDays")) : undefined,
    };
    if (sp.get("export") === "1") {
      const all: unknown[] = [];
      let offset = 0;
      while (all.length < 50_000) {
        const page = await listInventory({ ...q, limit: 2000, offset });
        all.push(...page.vehicles);
        offset += page.vehicles.length;
        if (page.vehicles.length < 2000 || offset >= page.total) break;
      }
      return NextResponse.json({ vehicles: all, capped: all.length >= 50_000 });
    }
    const limit = Math.min(Number(sp.get("limit")) || 500, 2000);
    const offset = Number(sp.get("offset")) || 0;
    return NextResponse.json(await listInventory({ ...q, limit, offset }));
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not load inventory.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
