import { NextResponse } from "next/server";
import { getDealerResponsiveness } from "@/lib/dealsApi";

// Public (no login) — shown next to a dealer's name while a buyer is still
// building an offer, before the wizard requires signing in. Real, computed
// stats only; never a fabricated "usually responds within..." default.
// Any backend hiccup degrades to the same honest "no data yet" shape
// rather than surfacing an error for what's purely a nice-to-have.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dealerName = (searchParams.get("dealerName") || "").trim();
  if (!dealerName) {
    return NextResponse.json({ error: "dealerName is required" }, { status: 400 });
  }

  try {
    const stats = await getDealerResponsiveness(dealerName);
    return NextResponse.json(stats);
  } catch {
    return NextResponse.json({ dealerName, bidCount: 0, avgResponseHours: null });
  }
}
