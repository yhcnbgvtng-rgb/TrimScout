/**
 * Server-side orchestration around the trade confirm step: open it when the buyer selects a desk, tell the right side, write
 * the deadline when it passes, and close out the other dealers only once the number is settled. The rules live in
 * scrapers/lightsail-crawler/src/tradeConfirm.js; the bookkeeping in rfqTradeConfirm.js on the deals box.
 *
 * Why the other dealers stay open until then: if the winner revises and the buyer goes back, the compare must still hold every
 * other desk's original number, and those desks must not have been told they lost. Closing out (the one "not selected this time"
 * note) happens when the winner confirms, the buyer accepts a revision, or the deadline lapses and the original number stands.
 */
import { actOnTradeConfirmation, getRfq, RfqApiError, sweepTradeConfirmations } from "../rfqApi";
import { rfqIsReleased, type RfqInvite, type RfqRequest } from "../rfq";
import { sendTradeConfirmNotice } from "../dealerEmail";
import { DEALER_EMAIL_BASE_URL } from "../dealerUnsubscribe";
import { guestTrackerPath, isGuestBuyerId } from "../buyerAccess";
import { closeOutLosers } from "../inviteOutbox";
import { buildConfirmRequestedNotice, buildRevisedNotice } from "../tradeConfirmNotice";
import { dueExpiries, tradeConfirmConfig, type TradeConfirmation } from "./confirm";
import { postTradeOtdAt } from "./confirmView";

const vehicleOf = (rfq: RfqRequest) => [rfq.vehicleYear, rfq.vehicleMake, rfq.vehicleModel, rfq.vehicleTrim].filter(Boolean).join(" ") || "vehicle";
const tradeTitleOf = (rfq: RfqRequest) => (rfq.tradeIn ? [rfq.tradeIn.year, rfq.tradeIn.make, rfq.tradeIn.model, rfq.tradeIn.trim].filter(Boolean).join(" ") : "") || "trade-in";
export const dealerConfirmUrl = (invite: Pick<RfqInvite, "viewToken">) => `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken || "")}`;
export const buyerRfqUrl = (rfq: Pick<RfqRequest, "id" | "buyerUserId">) => `${DEALER_EMAIL_BASE_URL}${isGuestBuyerId(rfq.buyerUserId) ? guestTrackerPath(rfq.id) : `/rfq/${encodeURIComponent(rfq.id)}`}`;

/** The post-trade OTD for a cash sheet at the number now in front of the buyer; null when it can't be priced (finance and lease). */
export const postTradeOtdFor = (rfq: RfqRequest, invite: RfqInvite, confirmation: TradeConfirmation): number | null => postTradeOtdAt(rfq, invite, confirmation.allowanceFinal ?? confirmation.allowancePrelim);

export type OpenResult = { opened: false; rfq: RfqRequest } | { opened: true; rfq: RfqRequest; confirmation: TradeConfirmation };

/**
 * Right after the buyer's pick is recorded: open the confirm step for the winner. `opened: false` (no trade, no live allowance,
 * a declined trade, or any failure) tells the caller to close out the other dealers now, exactly as before this feature.
 */
export async function openConfirmAfterPick(rfq: RfqRequest, winner: RfqInvite): Promise<OpenResult> {
  if (!rfq.tradeIn) return { opened: false, rfq };
  try {
    const r = await actOnTradeConfirmation(rfq.id, winner.id, "buyer", { type: "open" }, tradeConfirmConfig());
    return { opened: true, rfq: r.rfq, confirmation: r.confirmation };
  } catch (err) {
    if (!(err instanceof RfqApiError && err.code === "not_required")) console.error("trade confirm: could not open —", err instanceof Error ? err.message : err);
    return { opened: false, rfq };
  }
}

/** Tell the selected dealer, in-app (their quote page shows the step) and by the existing notice email that only links in. */
export async function notifyConfirmRequested(rfq: RfqRequest, winner: RfqInvite, confirmation: TradeConfirmation): Promise<boolean> {
  if (!rfqIsReleased(rfq) || !winner.viewToken || winner.dealerUnsubscribedAt) return false;
  return sendTradeConfirmNotice(buildConfirmRequestedNotice({ dealerName: winner.dealerName, vehicle: vehicleOf(rfq), tradeTitle: tradeTitleOf(rfq), confirmation, url: dealerConfirmUrl(winner) }));
}

/** Tell the buyer the dealer revised the number. */
export async function notifyRevised(rfq: RfqRequest, invite: RfqInvite, confirmation: TradeConfirmation): Promise<boolean> {
  return sendTradeConfirmNotice(buildRevisedNotice({ dealerName: invite.dealerName, vehicle: vehicleOf(rfq), confirmation, postTradeOtd: postTradeOtdFor(rfq, invite, confirmation), url: buyerRfqUrl(rfq) }));
}

/** The number is settled: now the other dealers are told, once. Best effort, safe to repeat. */
export async function settleAndCloseOut(rfqId: string, winnerInviteId: string): Promise<void> {
  const fresh = await getRfq(rfqId).catch(() => null);
  if (fresh) await closeOutLosers(fresh, winnerInviteId).catch((err) => console.error("trade confirm: close-out failed —", err instanceof Error ? err.message : err));
}

/**
 * Persist deadlines that passed ("the original number stands") and close out the others. Cheap when nothing is due: it looks at
 * the request it was given and only calls the box when a pending confirmation is past its deadline.
 */
export async function sweepIfDue(rfq: RfqRequest, now: Date = new Date()): Promise<{ rfq: RfqRequest; settledInviteIds: string[] }> {
  if (!dueExpiries(rfq, now).length) return { rfq, settledInviteIds: [] };
  try {
    const { rfq: fresh, expiredInviteIds } = await sweepTradeConfirmations(rfq.id, tradeConfirmConfig());
    return { rfq: fresh, settledInviteIds: expiredInviteIds };
  } catch (err) {
    console.error("trade confirm: sweep failed —", err instanceof Error ? err.message : err);
    return { rfq, settledInviteIds: [] };
  }
}
