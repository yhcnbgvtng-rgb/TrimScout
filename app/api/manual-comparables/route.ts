export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { findComparableListingsByMakeModel } from "@/lib/vinSearch";

// The compare page's one and only comparable-vehicle search: a single
// MarketCheck call by year/make/model/zip/radius, full result set returned
// — no per-VIN factory-sticker fetch here, so no brand-specific pipeline is
// needed and this works for every make. Trim is deliberately not sent —
// see the comment in findComparableListingsByMakeModel for why.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const make = String(body?.make || "").trim();
  const model = String(body?.model || "").trim();
  if (!make || !model) {
    return NextResponse.json({ error: "A make and model are required." }, { status: 400 });
  }
  const rawYear = Number(body?.year);
  const year = Number.isFinite(rawYear) && rawYear > 0 ? rawYear : undefined;
  const zip = String(body?.zip || "").trim();
  const radiusMiles = Number(body?.radiusMiles);
  const subjectVin = String(body?.subjectVin || "").trim();

  try {
    const result = await findComparableListingsByMakeModel({ subjectVin, year, make, model, zip, radiusMiles });
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Comparable search failed";
    console.error("manual-comparables failed:", message);
    return NextResponse.json(
      { error: "Could not load nearby listings.", note: "Could not load nearby listings.", matches: [] },
      { status: 502 }
    );
  }
}
