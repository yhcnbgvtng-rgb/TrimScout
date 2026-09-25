import { NextResponse } from "next/server";
import { InventoryApiError } from "@/lib/inventoryApi";
import { parseBuyerSearchParams, BuyerSearchParamsError } from "@/lib/buyerSearchQuery";
import { runBuyerSearch } from "@/lib/buyerSearch";

export const dynamic = "force-dynamic";

/**
 * GET /api/vehicles/search — the deterministic search behind the buyer /search page's generic
 * filter panel (and the target of the NL parse route once Gemini fills the same query params).
 * Reads dealer_inventory only — never MarketCheck, which this series has decided is not the
 * buyer search's source of truth. No admin session — this is the public route.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  let parsed;
  try {
    parsed = parseBuyerSearchParams(sp);
  } catch (err) {
    if (err instanceof BuyerSearchParamsError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  try {
    return NextResponse.json(await runBuyerSearch(parsed));
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not search inventory.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
