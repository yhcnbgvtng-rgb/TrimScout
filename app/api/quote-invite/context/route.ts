// GET /api/quote-invite/context?t=… — what the dealer's calculator needs to
// quote against: the vehicle, the buyer's lease prefs, and the invite's
// state. Nothing about the buyer beyond term / miles / ZIP.
import { NextResponse } from "next/server";
import { getRfq, getRfqInviteByViewToken, markRfqInviteDelivery } from "@/lib/rfqApi";
import { rfqVehicles } from "@/lib/rfqTracker";

export async function GET(req: Request) {
  const token = (new URL(req.url).searchParams.get("t") || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  // Loading the calculator IS the dealer viewing the request: mark it (the
  // box moves delivery forward only, and locks the buyer's lease sheet the
  // first time). Server-side, so a direct visit without the tracked
  // redirect still counts.
  if (found.invite.status === "invited") await markRfqInviteDelivery(found.rfqId, found.invite.id, "viewed").catch(() => null);
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq) return NextResponse.json({ error: "Quote request not found." }, { status: 404 });
  // The by-token row is bare; the full rfq carries the buyer counter and
  // the prior (superseded) quote the calculator should prefill from.
  const invite = rfq.invites.find((i) => i.id === found.invite.id) || found.invite;
  const priorQuote = invite.priorQuotes?.length ? invite.priorQuotes[invite.priorQuotes.length - 1] : null;
  const usedCar = rfqVehicles(rfq).find((v) => v.vin === (invite.vehicle?.vin || rfq.vin) && v.condition !== "new") || null;
  return NextResponse.json({
    buyerCounter: invite.buyerCounter || null,
    priorLease: priorQuote?.lease || null,
    condition: usedCar?.condition || "new",
    buyerMiles: usedCar?.mileage ?? null,
    buyerNote: rfq.buyerNote || null,
    vin: rfq.vin,
    stockNumber: rfq.stockNumber,
    vehicle: invite.vehicle || { year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim },
    dealerName: invite.dealerName,
    leasePrefs: rfq.leasePrefs || null,
    quotePrefs: rfq.quotePrefs || null,
    inviteStatus: invite.status,
    rfqStatus: rfq.status,
    dealReference: rfq.dealReference || null,
  });
}
