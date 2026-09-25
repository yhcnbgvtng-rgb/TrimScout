import { NextResponse } from "next/server";
import { searchInventory, InventoryApiError, type InventoryVehicle } from "@/lib/inventoryApi";
import { parseBuyerSearchParams, BuyerSearchParamsError } from "@/lib/buyerSearchQuery";
import { calculateDistanceMiles } from "@/lib/otdCalculator";

export const dynamic = "force-dynamic";

/** Fields a buyer has no reason to see — crawl-pipeline provenance, not vehicle or deal facts. */
export type BuyerVehicle = Omit<InventoryVehicle, "sourceBox" | "crawlFirstSeen"> & { distanceMiles: number | null };

function toBuyerVehicle(v: InventoryVehicle, distanceMiles: number | null): BuyerVehicle {
  const { sourceBox: _sourceBox, crawlFirstSeen: _crawlFirstSeen, ...rest } = v;
  return { ...rest, distanceMiles };
}

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
  const { query, zip, radiusMiles, sortDistance } = parsed;

  try {
    const result = await searchInventory(query);
    let vehicles: BuyerVehicle[] = result.vehicles.map((v) =>
      toBuyerVehicle(v, zip ? calculateDistanceMiles(zip, { city: v.dealerCity || "", state: v.dealerState || "" }) : null)
    );
    if (zip && radiusMiles !== undefined) {
      vehicles = vehicles.filter((v) => v.distanceMiles !== null && v.distanceMiles <= radiusMiles);
    }
    if (zip && sortDistance) {
      vehicles = vehicles.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
    }
    return NextResponse.json({ total: result.total, limit: result.limit, offset: result.offset, vehicles });
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not search inventory.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
