import { NextResponse } from "next/server";
import { catalogOptions, InventoryApiError } from "@/lib/inventoryApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/options?make=&model=&trim= — the buyer /search page's filter-panel source for
 * factory option codes and colors, scoped to what actually exists among in-stock vehicles matching
 * the given make/model/trim (never a global list a filter combination could return zero results for).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const result = await catalogOptions({
      make: sp.get("make") || undefined,
      model: sp.get("model") || undefined,
      trim: sp.get("trim") || undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not load catalog options.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
