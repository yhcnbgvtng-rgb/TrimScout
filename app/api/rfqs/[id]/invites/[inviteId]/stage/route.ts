// POST /api/rfqs/:id/invites/:inviteId/stage { action } — the buyer's move on one dealer's staged Cash / Finance deal:
// accept the out-the-door price, counter or accept the trade value, pay cash, ask for financing, accept it, or walk away.
// The rules and the numbers live on the deals server (lib/dealStages.ts); this route only authenticates the buyer, passes
// the buyer's state (for the trade-in tax note), and tells the dealer through the SAFE MODE sender. A request, not a bid.
import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { getRfq, postDealStage, RfqApiError } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { isStagedRfq } from "@/lib/dealStages";
import { parseStageAction } from "@/lib/dealStageInput";
import { buildStageNotice } from "@/lib/dealStageNotice";
import { sendDealStageNotice } from "@/lib/dealerEmail";
import { zipStateTax } from "@/lib/counterSheet";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";
import { closeOutLosers } from "@/lib/inviteOutbox";
import { isNotSelected } from "@/lib/rfqClose";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req) || (session?.user && (session.user as { role?: string }).role !== "buyer")) {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }
  const { id, inviteId } = await params;
  const body = await req.json().catch(() => null);
  const action = parseStageAction(body?.action, "buyer");
  if (!action) return NextResponse.json({ error: "That isn't something you can do on this deal." }, { status: 400 });

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, rfq);
    if (!buyer) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
    if (rfq.buyerUserId !== buyer.id) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    if (!isStagedRfq(rfq)) return NextResponse.json({ error: "This request doesn't use the staged Cash / Finance flow." }, { status: 409 });
    const invite = rfq.invites.find((i) => i.id === inviteId);
    if (!invite) return NextResponse.json({ error: "Dealer not found on this request." }, { status: 404 });

    if (isNotSelected(invite) && action.type !== "walk") return NextResponse.json({ error: "You chose a different dealer, so this quote is closed." }, { status: 409 });

    const zip = rfq.quotePrefs?.quoteType === "cash" ? rfq.quotePrefs.cash.zip : null;
    const result = await postDealStage(id, inviteId, { action: action as unknown as Record<string, unknown>, actor: "buyer", state: zipStateTax(zip)?.state ?? null });

    // Tell the desk. Best effort: the move is already saved and shows on their quote page.
    if (invite.viewToken) {
      const notice = buildStageNotice({
        actor: "buyer",
        action,
        state: result.stage,
        dealerName: invite.dealerName,
        vehicle: [rfq.vehicleYear, rfq.vehicleMake, rfq.vehicleModel, rfq.vehicleTrim].filter(Boolean).join(" ") || "vehicle",
        url: `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken)}`,
      });
      await sendDealStageNotice(notice);
    }
    // Accepting the out-the-door price is the buyer's choice of dealer: close and thank everyone else, once.
    if (action.type === "accept_otd" && result.stage.otd.status === "locked") after(async () => { await closeOutLosers(rfq, inviteId); });
    return NextResponse.json({ rfq: publicRfqForBuyer(result.rfq), stage: result.stage });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not update this deal.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
