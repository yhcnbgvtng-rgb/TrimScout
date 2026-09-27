import { NextResponse } from "next/server";
import { inventoryFacets, InventoryApiError } from "@/lib/inventoryApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/facets?state=&make=&model= — hit counts for the /search page's
 * State/Make/Model/Trim dropdowns. Each param is optional and cross-scopes the others (see
 * lib/inventoryApi.ts's inventoryFacets for the exact rules); `models` is only populated when
 * `make` is set and `trims` only when both `make` and `model` are set, mirroring the page's own
 * progressive-unlock order.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const result = await inventoryFacets({
      state: sp.get("state") || undefined,
      make: sp.get("make") || undefined,
      model: sp.get("model") || undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not load filter counts.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
