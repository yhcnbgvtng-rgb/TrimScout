import { NextResponse } from "next/server";
import { inventoryMakes, InventoryApiError } from "@/lib/inventoryApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/makes — distinct makes with in-stock inventory, for the /search page's make
 * picker. Calls the box's dedicated GET /api/inventory/makes — deliberately not
 * GET /api/inventory/stats: that endpoint also computes a slow byState aggregate and a movement
 * aggregate this route doesn't need, and (until 2026-09-25) shared one cache key with them, so
 * every visitor to /search paid for the admin sheet's full stats computation just to populate a
 * <select>. See docs/BUYER_SEARCH.md.
 */
export async function GET() {
  try {
    const { makes: byMake } = await inventoryMakes();
    const makes = byMake.map((m) => m.make).filter(Boolean).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ makes }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not load makes.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
