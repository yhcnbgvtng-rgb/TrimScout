export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { findComparableListingsByMakeModel } from "@/lib/vinSearch";

// Sticker-less fallback: search live listings by year/make/model only, for a
// brand with no digital window-sticker pipeline (or a subject whose sticker
// never parsed). No must-have filtering — there is no sticker to confirm
// them against.
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
    // Shaped to match ComparableSuggestion (lib/offerCompare.ts) so the
    // compare page can reuse the same "Add" flow as the sticker-backed hunts
    // — just with msrp/factoryOptions/pdfUrl left unset (nothing to fetch
    // them from without a sticker).
    const matches = result.matches.map((m) => ({ ...m, msrp: null as number | null }));
    return NextResponse.json({ success: true, ...result, matches });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Comparable search failed";
    console.error("manual-comparables failed:", message);
    return NextResponse.json(
      { error: "Could not load nearby listings.", note: "Could not load nearby listings.", matches: [] },
      { status: 502 }
    );
  }
}
