// POST /api/rfqs/:id/trade-confirm { action: "accept_revised" | "go_back" | "walk" } — the buyer's answer at the trade confirm step.
//   accept_revised  the dealer's revised trade number becomes final; the other dealers are told once.
//   go_back         the request reopens to the compare: nobody else's numbers changed, nobody was told they lost, the revising
//                   dealer stays marked "Revised". No penalty, and the buyer can pick any dealer again.
//   walk            walking away is never blocked, while the dealer is deciding or while a revision waits.
// Owner (or the request's guest link) only. The dealer's side is /api/quote-invite/trade-confirm.
import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { actOnTradeConfirmation, getRfq, RfqApiError } from "@/lib/rfqApi";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { publicRfqForBuyer } from "@/lib/rfq";
import { openConfirmationOf, tradeConfirmConfig } from "@/lib/trade/confirm";
import { settleAndCloseOut, sweepIfDue } from "@/lib/trade/confirmFlow";

const ACTIONS = ["accept_revised", "go_back", "walk"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req)) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const type = body?.action;
  if (!(ACTIONS as readonly string[]).includes(type)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  try {
    let rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, rfq);
    if (!buyer) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    if (rfq.buyerUserId !== buyer.id) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    // A deadline that passed while the buyer was reading settles first: the original number stands, then their answer is judged on that.
    rfq = (await sweepIfDue(rfq)).rfq;
    const open = openConfirmationOf(rfq);
    if (!open) return NextResponse.json({ error: "There is no trade value waiting on this request.", rfq: publicRfqForBuyer(rfq) }, { status: 409 });
    const r = await actOnTradeConfirmation(id, open.invite.id, "buyer", { type }, tradeConfirmConfig());
    if (type === "accept_revised") after(async () => { await settleAndCloseOut(id, open.invite.id); });
    return NextResponse.json({ rfq: publicRfqForBuyer(r.rfq) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not record your answer.";
    return NextResponse.json({ error: message }, { status: err instanceof RfqApiError ? err.status : 502 });
  }
}
