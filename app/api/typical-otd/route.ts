import { NextResponse } from "next/server";
import { getTypicalOtd } from "@/lib/dealsApi";

// Public (no login) — shown as market context while a buyer is setting
// their own target OTD price, never a bid floor they must beat. Real,
// computed from actual dealer bid history only; any backend hiccup
// degrades to the same honest "no data yet" shape rather than surfacing
// an error for what's purely informational.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const make = (searchParams.get("make") || "").trim();
  const model = (searchParams.get("model") || "").trim();
  if (!make || !model) {
    return NextResponse.json({ error: "make and model are required" }, { status: 400 });
  }

  try {
    const stats = await getTypicalOtd(make, model);
    return NextResponse.json(stats);
  } catch {
    return NextResponse.json({ make, model, sampleSize: 0, avgDiscountPercent: null });
  }
}
