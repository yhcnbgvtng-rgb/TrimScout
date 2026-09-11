export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDeal, submitDealTradeIn, DealsApiError } from "@/lib/dealsApi";
import type { TradeInSubmission } from "@/lib/types";
import { notifyDealerOfTradeIn } from "@/lib/dealerEmail";

// Photos arrive as client-compressed JPEG data URLs, five at most. The cap
// admits five ~1.5 MB base64 images with room for the details.
const MAX_BODY_BYTES = 12_000_000;

// Buyer submits their trade-in for the dealer who won to price. Only the deal's
// own buyer may do this, and only once the deal is paid — before that there is
// no winning dealer to send it to.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "buyer") {
    return NextResponse.json({ error: "Sign in as the buyer on this deal to add a trade-in." }, { status: 401 });
  }

  const { id } = await params;
  let deal;
  try {
    deal = await getDeal(id);
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not load this deal.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.buyerUserId !== user.id) {
    return NextResponse.json({ error: "This isn't your deal." }, { status: 403 });
  }
  if (deal.status !== "paid") {
    return NextResponse.json({ error: "Lock in the offer first — the trade-in goes to the dealer you chose." }, { status: 409 });
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Photos are too large. Try fewer or smaller images." }, { status: 413 });
  }

  let body: { tradeIn?: Partial<TradeInSubmission> } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const t = body?.tradeIn;
  const year = Number(t?.year);
  const mileage = Number(t?.mileage);
  if (!t || !Number.isInteger(year) || year < 1980 || !String(t.make || "").trim() || !String(t.model || "").trim()) {
    return NextResponse.json({ error: "Year, make and model are required." }, { status: 400 });
  }
  if (!Number.isFinite(mileage) || mileage < 0) {
    return NextResponse.json({ error: "Enter the mileage." }, { status: 400 });
  }
  const photos = Array.isArray(t.photos) ? t.photos : [];
  if (photos.length === 0) {
    return NextResponse.json({ error: "Add at least one photo so the dealer can price it." }, { status: 400 });
  }

  try {
    // The box does the final cleaning (angles, sizes, condition); this
    // route only turns away the obviously incomplete.
    const updated = await submitDealTradeIn(id, t as TradeInSubmission);
    // Fire-and-forget: the submission is saved; the nudge just tells the
    // dealer to go look. See lib/dealerEmail.ts for where it actually lands.
    const saved = updated.tradeIn;
    if (saved) {
      const bid = updated.winningBid as { matchedVehicleTitle?: string } | null;
      void notifyDealerOfTradeIn({
        dealerName: updated.dealerName,
        dealId: updated.id,
        certificateId: updated.certificateId,
        vehicleTitle: bid?.matchedVehicleTitle || updated.matchedVin,
        tradeInTitle: [saved.year, saved.make, saved.model, saved.trim].filter(Boolean).join(" "),
        mileage: saved.mileage,
        photoCount: saved.photos.length,
      });
    }
    return NextResponse.json({ deal: updated });
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not save your trade-in.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
