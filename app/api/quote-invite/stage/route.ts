// POST /api/quote-invite/stage { t, action } — the dealer's move on a staged Cash / Finance deal, behind the invite's own
// tracked-link token (no login): offer a trade value, answer the buyer's trade counter, quote financing, or walk away.
// (Accepting the buyer's out-the-door counter is /api/quote-invite/accept-counter, which locks the stage as it records the
// revised quote.) The buyer is told through the SAFE MODE sender. A request, not a bid.
import { NextResponse } from "next/server";
import { getRfq, getRfqInviteByViewToken, postDealStage, RfqApiError } from "@/lib/rfqApi";
import { isStagedRfq } from "@/lib/dealStages";
import { parseStageAction } from "@/lib/dealStageInput";
import { buildStageNotice } from "@/lib/dealStageNotice";
import { sendDealStageNotice } from "@/lib/dealerEmail";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";
import { guestTrackerPath, isGuestBuyerId } from "@/lib/buyerAccess";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const action = parseStageAction(body?.action, "dealer");
  if (!action) return NextResponse.json({ error: "That isn't something the dealer can do on this deal." }, { status: 400 });
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq) return NextResponse.json({ error: "Quote request not found." }, { status: 404 });
  if (!isStagedRfq(rfq)) return NextResponse.json({ error: "This request doesn't use the staged Cash / Finance flow." }, { status: 409 });
  const invite = rfq.invites.find((i) => i.id === found.invite.id) || found.invite;
  if (invite.notSelectedAt && action.type !== "walk") return NextResponse.json({ error: "The buyer chose another dealer, so this quote is closed." }, { status: 409 });

  try {
    const result = await postDealStage(found.rfqId, invite.id, { action: action as unknown as Record<string, unknown>, actor: "dealer" });
    const notice = buildStageNotice({
      actor: "dealer",
      action,
      state: result.stage,
      dealerName: invite.dealerName,
      vehicle: [rfq.vehicleYear, rfq.vehicleMake, rfq.vehicleModel, rfq.vehicleTrim].filter(Boolean).join(" ") || "vehicle",
      url: `${DEALER_EMAIL_BASE_URL}${isGuestBuyerId(rfq.buyerUserId) ? guestTrackerPath(found.rfqId) : `/rfq/${encodeURIComponent(found.rfqId)}`}`,
    });
    await sendDealStageNotice(notice);
    return NextResponse.json({ ok: true, stage: result.stage });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not update this deal.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
