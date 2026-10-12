// POST /api/rfqs/:id/trade-in { draftId, token } — the buyer adds a trade-in AFTER accepting a dealer's offer ("Add your
// trade-in"). The draft is verified here exactly like at send time (fields + all six required photos present in storage),
// then adopted into the request and attached on the deals box. Staged Cash / Finance deals also re-open the trade stage
// (`add_trade`) so the winning dealer is asked for a value; the accepted OTD stays locked. The winner is told through the
// SAFE MODE sender. Only possible once a dealer has been accepted and only when the request has no trade-in yet.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, postDealStage, RfqApiError, submitRfqTradeIn } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { needsTradePrompt } from "@/lib/acceptTrade";
import { isStagedRfq } from "@/lib/dealStages";
import { buildTradeAddedNotice, buildStageNotice } from "@/lib/dealStageNotice";
import { sendDealStageNotice } from "@/lib/dealerEmail";
import { zipStateTax } from "@/lib/counterSheet";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";
import { buyerMayManageTrade } from "@/lib/trade/access";
import { adoptDraftIntoRfq, prepareTradeForRfq } from "@/lib/trade/service";
import { s3Storage } from "@/lib/trade/storage";
import { tradeErrorResponse } from "@/lib/trade/routeKit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req)) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.draftId !== "string" || typeof body?.token !== "string") return NextResponse.json({ error: "Finish the trade-in step first." }, { status: 400 });

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, rfq);
    if (!buyer) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
    if (!buyerMayManageTrade(buyer.id, rfq)) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    const deal = needsTradePrompt(rfq);
    if (!deal) return NextResponse.json({ error: rfq.tradeIn ? "This request already has a trade-in." : "Accept a dealer's offer first." }, { status: 409 });

    // Same checks as at send time: nothing attaches unless the whole record, six required photos included, is real.
    const ready = await prepareTradeForRfq(s3Storage, { tradeIn: { enabled: true, draftId: body.draftId, token: body.token } }, buyer.id);
    if (!ready) return NextResponse.json({ error: "Finish the trade-in step first." }, { status: 400 });
    const record = await adoptDraftIntoRfq(s3Storage, ready.draft, ready.record, rfq.id);
    let updated = await submitRfqTradeIn(rfq.id, record);

    const vehicle = [rfq.vehicleYear, rfq.vehicleMake, rfq.vehicleModel, rfq.vehicleTrim].filter(Boolean).join(" ") || "vehicle";
    const winner = deal.invite;
    const url = winner.viewToken ? `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(winner.viewToken)}` : DEALER_EMAIL_BASE_URL;
    if (isStagedRfq(rfq)) {
      const zip = rfq.quotePrefs?.quoteType === "cash" ? rfq.quotePrefs.cash.zip : null;
      const result = await postDealStage(id, winner.id, { action: { type: "add_trade" }, actor: "buyer", state: zipStateTax(zip)?.state ?? null });
      updated = result.rfq;
      await sendDealStageNotice(buildStageNotice({ actor: "buyer", action: { type: "add_trade" }, state: result.stage, dealerName: winner.dealerName, vehicle, url }));
    } else {
      await sendDealStageNotice(buildTradeAddedNotice({ dealerName: winner.dealerName, vehicle, url, lease: deal.kind === "lease" }));
    }
    return NextResponse.json({ rfq: publicRfqForBuyer(updated) });
  } catch (err) {
    if (err instanceof RfqApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return tradeErrorResponse(err);
  }
}
