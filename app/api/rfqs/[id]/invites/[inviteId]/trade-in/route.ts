// POST /api/rfqs/:id/invites/:inviteId/trade-in — the buyer attaches a trade-in
// to ONE dealer's invite and asks that dealer to quote a trade value.
//   { tradeIn }                  the form, validated here (lib/rfqTradeIn.ts)
//   { copyFromInviteId }         "add the same trade to this dealer": the box's stored copy
//                                (photos included) is re-attached to this invite
// Nothing is binding. The dealer is told by email through the SAFE MODE sender,
// so it lands at SAFE_MODE_RECIPIENT only.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInviteTradeIn, getRfq, RfqApiError, submitInviteTradeIn } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { parseTradeInRequest, tradeTitle, type RfqTradeIn } from "@/lib/rfqTradeIn";
import { sendQuoteInviteEmail } from "@/lib/dealerEmail";
import { tradeInRequestHtml, tradeInRequestSubject } from "@/lib/quoteInviteEmail";
import { dealerReference } from "@/lib/dealerReference";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";

// Six client-compressed photos plus the details.
const MAX_BODY_BYTES = 3_500_000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req) || (session?.user && (session.user as { role?: string }).role !== "buyer")) {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Photos are too large. Try fewer or smaller images." }, { status: 413 });
  }
  const { id, inviteId } = await params;
  const body = await req.json().catch(() => null);

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, rfq);
    if (!buyer) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
    if (rfq.buyerUserId !== buyer.id) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    if (rfq.status !== "collecting") return NextResponse.json({ error: "This request is closed." }, { status: 409 });
    const invite = rfq.invites.find((i) => i.id === inviteId);
    if (!invite) return NextResponse.json({ error: "Dealer not found on this request." }, { status: 404 });
    if (invite.status === "declined" || invite.dealerUnsubscribedAt) return NextResponse.json({ error: "This dealer can't take a trade-in on this request." }, { status: 409 });

    let tradeIn: RfqTradeIn;
    if (typeof body?.copyFromInviteId === "string") {
      if (!rfq.invites.some((i) => i.id === body.copyFromInviteId)) return NextResponse.json({ error: "That trade-in isn't on this request." }, { status: 404 });
      const source = await getInviteTradeIn(id, body.copyFromInviteId);
      if (!source) return NextResponse.json({ error: "That trade-in isn't on file anymore." }, { status: 404 });
      // The same car, a fresh ask: the other dealer's allowance never travels with it.
      tradeIn = { ...source, allowance: null, allowanceAt: null, submittedAt: new Date().toISOString() };
    } else {
      const parsed = parseTradeInRequest(body?.tradeIn);
      if (!parsed.ok) return NextResponse.json({ error: parsed.errors.join(" "), errors: parsed.errors }, { status: 400 });
      tradeIn = parsed.tradeIn;
    }

    const updated = await submitInviteTradeIn(id, inviteId, tradeIn);

    // Tell the desk. Best effort — the trade-in is already on their invite.
    if (invite.viewToken && invite.desk) {
      const input = {
        dealerName: invite.dealerName,
        contactName: invite.desk.contactName,
        vehicle: invite.vehicle || { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim, vdpUrl: null },
        dealReference: dealerReference(id, inviteId),
        tradeTitle: tradeTitle(tradeIn),
        mileage: tradeIn.mileage,
        condition: tradeIn.condition,
        payoff: tradeIn.payoff,
        photoCount: tradeIn.photoCount,
        alreadyQuoted: invite.status === "quoted",
        viewUrl: `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken)}`,
      };
      await sendQuoteInviteEmail(tradeInRequestSubject(input), tradeInRequestHtml(input)).catch(() => false);
    }
    return NextResponse.json({ rfq: publicRfqForBuyer(updated) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not add your trade-in.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
