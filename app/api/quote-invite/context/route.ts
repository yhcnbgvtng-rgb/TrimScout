// GET /api/quote-invite/context?t=… — what the dealer's calculator needs to
// quote against: the vehicle, the buyer's lease prefs, and the invite's
// state. Nothing about the buyer beyond term / miles / ZIP.
import { NextResponse } from "next/server";
import { getRfq, getRfqInviteByViewToken } from "@/lib/rfqApi";

export async function GET(req: Request) {
  const token = (new URL(req.url).searchParams.get("t") || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq) return NextResponse.json({ error: "Quote request not found." }, { status: 404 });
  const invite = found.invite;
  return NextResponse.json({
    vin: rfq.vin,
    stockNumber: rfq.stockNumber,
    vehicle: invite.vehicle || { year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim },
    dealerName: invite.dealerName,
    leasePrefs: rfq.leasePrefs || null,
    inviteStatus: invite.status,
    rfqStatus: rfq.status,
    dealReference: rfq.dealReference || null,
  });
}
