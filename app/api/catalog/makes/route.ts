import { NextResponse } from "next/server";
import { inventoryStats, InventoryApiError } from "@/lib/inventoryApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/makes — distinct makes with in-stock inventory, for the /search page's make
 * picker. Wraps the box's existing GET /api/inventory/stats (byMake) rather than adding a new
 * box endpoint — no deploy needed for this route.
 */
export async function GET() {
  try {
    const stats = await inventoryStats();
    const makes = stats.byMake.map((m) => m.make).filter(Boolean).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ makes }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not load makes.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
