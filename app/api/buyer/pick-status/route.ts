import { NextResponse } from "next/server";
import { inventoryVin } from "@/lib/inventoryApi";
import { listingFor, vehicleKey, MAX_PICKS, type PickListing } from "@/lib/buyerPicks";

export const dynamic = "force-dynamic";

// Is each saved pick's car still listed? Read-only: asks the deals API for every listing of each VIN (an endpoint that already
// exists) and answers per pick "listed" | "gone" | "unknown". Anything that goes wrong for a pick is "unknown", and the page
// keeps an unknown pick — a failed lookup never costs a buyer a pick. Nothing is written, sent or opened here.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { picks?: unknown } | null;
  const raw = Array.isArray(body?.picks) ? body!.picks.slice(0, MAX_PICKS) : null;
  if (!raw) return NextResponse.json({ error: "picks[] is required." }, { status: 400 });
  const status: Record<string, PickListing> = {};
  await Promise.all(raw.map(async (r) => {
    const p = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const vin = typeof p.vin === "string" ? p.vin.trim().toUpperCase() : "";
    const dealerName = typeof p.dealerName === "string" ? p.dealerName : "";
    const dealerId = typeof p.dealerId === "string" && p.dealerId ? p.dealerId : null;
    if (!VIN_RE.test(vin) || !dealerName) return;
    const key = vehicleKey({ vin, dealerId, dealerName });
    try {
      const { listings } = await inventoryVin(vin);
      status[key] = listingFor({ vin, dealerId, dealerName }, listings);
    } catch {
      status[key] = "unknown";
    }
  }));
  return NextResponse.json({ status });
}
