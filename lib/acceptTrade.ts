/**
 * The "Add your trade-in" step shown right after a buyer accepts a dealer's offer.
 *
 * - Cash / Finance (staged): acceptance is the buyer's `accept_otd`. The accepted OTD stays locked; adding a trade
 *   re-opens the trade stage for the winning dealer (`add_trade`), skipping while that stage is open is `skip_trade`.
 * - Lease and single-sheet Cash: acceptance is the pick (the request closes as "picked"). The trade attaches to the
 *   request and the winning dealer appraises it; the equity lands on the cap cost (lib/trade/otd.ts).
 * Pure rules only; the routes and the prompt component use them.
 */
import type { RfqInvite, RfqRequest } from "./rfq";
import { isStagedRfq, stageOf } from "./dealStages";

export interface AcceptedDeal {
  /** The dealer whose offer the buyer accepted. */
  invite: RfqInvite;
  kind: "lease" | "cash_finance";
  /** Staged deals only: the locked out-the-door amount. */
  lockedOtd: number | null;
  /** Staged deals only: whether the trade stage is currently open for this dealer (so Skip moves the deal forward). */
  tradeStageOpen: boolean;
}

/** The accepted dealer, or null while the buyer is still comparing. */
export function acceptedDeal(rfq: Pick<RfqRequest, "status" | "pickedQuoteId" | "invites" | "leasePrefs" | "quotePrefs" | "tradeInExpected">): AcceptedDeal | null {
  if (rfq.status === "walked") return null;
  if (isStagedRfq(rfq)) {
    for (const invite of rfq.invites) {
      const st = stageOf(rfq, invite);
      if (!st || st.stage === "walked" || invite.notSelectedAt) continue;
      if (st.otd.status === "locked") return { invite, kind: "cash_finance", lockedOtd: st.otd.amount, tradeStageOpen: st.stage === "trade" };
    }
    return null;
  }
  if (rfq.status !== "picked" || !rfq.pickedQuoteId) return null;
  const invite = rfq.invites.find((i) => i.quote?.id === rfq.pickedQuoteId);
  return invite ? { invite, kind: rfq.leasePrefs ? "lease" : "cash_finance", lockedOtd: null, tradeStageOpen: false } : null;
}

/** True when the buyer should be asked to add a trade-in: they accepted, and there is no trade-in on the request. */
export function needsTradePrompt(rfq: Parameters<typeof acceptedDeal>[0] & Pick<RfqRequest, "tradeIn">): AcceptedDeal | null {
  if (rfq.tradeIn) return null;
  const deal = acceptedDeal(rfq);
  if (!deal) return null;
  // A staged deal whose payment step has begun (cash chosen, financing requested) is too far along to add a trade.
  if (deal.kind === "cash_finance" && isStagedRfq(rfq)) {
    const st = stageOf(rfq, deal.invite);
    if (!st || st.stage === "closed" || st.payment.financeRequestedAt || st.payment.method) return null;
  }
  return deal;
}

/** The OTD stays what the buyer accepted: nothing in the trade-in step may change it. */
export const TRADE_PROMPT_COPY = {
  title: "Add your trade-in",
  lockedLine: (otd: string) => `Your accepted out-the-door price of ${otd} stays locked. Adding a trade-in lets the dealer give you a trade value, which gets you to your true out-the-door.`,
  leaseLine: "Your accepted quote stays as quoted. Adding a trade-in lets the dealer give you a trade value, applied to your lease as a cap cost reduction.",
  skip: "Skip, no trade-in",
  submit: "Send my trade-in to the dealer",
} as const;

/**
 * May this desk appraise the trade-in? While the request is open, any live desk the buyer did not turn down; once the
 * buyer accepted a quote (request "picked"), only the winner. A desk marked not selected never can.
 */
export function dealerMayAppraise(rfq: Pick<RfqRequest, "status" | "pickedQuoteId">, invite: Pick<RfqInvite, "status" | "quote" | "notSelectedAt">): boolean {
  if (invite.status === "declined" || invite.notSelectedAt) return false;
  if (rfq.status === "collecting") return true;
  return rfq.status === "picked" && Boolean(invite.quote) && invite.quote!.id === rfq.pickedQuoteId;
}
