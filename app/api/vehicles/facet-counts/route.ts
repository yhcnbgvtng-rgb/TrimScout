import { NextResponse } from "next/server";
import { facetCounts, InventoryApiError } from "@/lib/inventoryApi";
import { parseBuyerSearchParams, BuyerSearchParamsError } from "@/lib/buyerSearchQuery";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/vehicles/facet-counts?<the /search filters> — the live counts behind the "More filters" chips (year, mileage, body style, fuel,
 * drivetrain, transmission, days on market, dealer). Same query gates as the search itself (a make is required), so it can never be a scan
 * of every car. A box without the endpoint answers { supported: false } and the page hides those groups.
 */
export async function GET(req: Request) {
  let parsed;
  try {
    parsed = parseBuyerSearchParams(new URL(req.url).searchParams);
  } catch (err) {
    if (err instanceof BuyerSearchParamsError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  try {
    return NextResponse.json(await facetCounts(parsed.query), { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not load filter counts.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 ? 400 : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
