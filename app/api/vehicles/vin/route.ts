import { NextResponse } from "next/server";
import { InventoryApiError } from "@/lib/inventoryApi";
import { normalizeVinQuery } from "@/lib/inventoryVinQuery";
import { findByVin } from "@/lib/inventoryVinMatch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/vehicles/vin?vin=<17 characters or the last 6-8> — the /search VIN box. Public like /api/vehicles/search; buyer-shaped rows, no seen dates. */
export async function GET(req: Request) {
  const q = normalizeVinQuery(new URL(req.url).searchParams.get("vin") || "");
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 });
  try {
    const { vehicles, truncated } = await findByVin(q);
    return NextResponse.json({ kind: q.kind, vin: q.vin, vehicles, truncated });
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not look up that VIN.";
    return NextResponse.json({ error: message }, { status: err instanceof InventoryApiError && err.status === 503 ? 503 : 502 });
  }
}
