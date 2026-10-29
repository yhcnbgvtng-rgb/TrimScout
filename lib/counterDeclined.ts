/**
 * A dealer who declines the buyer's COUNTER has not declined the buyer.
 *
 * Countering supersedes the dealer's quote and reopens the invite (box: status "invited", buyerCounter set, the
 * original kept in priorQuotes). When the dealer then says "I can't do better than my quote" the invite becomes
 * "declined", but the original offer is still theirs to honour until it expires. This is the one place that tells
 * that apart from a dealer who declined the whole request (no counter on file, or never quoted):
 *
 *   counter declined  -> the original quote is live again ("Counter declined: original offer stands"), acceptable
 *                        through the ordinary pick, rankable, never "Declined" and never "No quote yet";
 *   request declined  -> stays "Declined".
 *
 * The same rule serves lease, finance (APR is locked, so a counter never moves it) and cash, with or without a
 * trade-in: a trade-in rides the request, not the counter, so there is nothing separate to decline.
 * Pure and client-safe; applied to what the buyer is sent (publicRfqForBuyer) and read by the dealer context.
 */
import type { RfqInvite, RfqQuote, RfqRequest } from "./rfq";
import { cashOutTheDoor } from "./usedQuote";

export const COUNTER_DECLINED_STATUS = "Counter declined: original offer stands";
export const ACCEPT_ORIGINAL_LABEL = "Accept original offer";
export const COUNTER_DECLINED_NOTE = "The dealer couldn't improve on it, so their original quote is still on the table.";

type Counterable = Pick<RfqInvite, "status" | "quote" | "buyerCounter" | "priorQuotes">;

/** The dealer's original quote when they declined the buyer's counter; null for every other invite. */
export function counterDeclinedQuote(invite: Counterable): RfqQuote | null {
  if (invite.status !== "declined" || invite.quote || !invite.buyerCounter) return null;
  const prior = invite.priorQuotes?.length ? invite.priorQuotes[invite.priorQuotes.length - 1] : null;
  if (!prior) return null;
  // The counter answers one specific quote; only that one stands.
  if (invite.buyerCounter.againstQuoteId && String(invite.buyerCounter.againstQuoteId) !== String(prior.id)) return null;
  return prior;
}

/** Re-seat the original quote as the invite's live quote and mark why. Anything else is returned untouched. */
export function withCounterDeclinedOffer(invite: RfqInvite): RfqInvite {
  const original = counterDeclinedQuote(invite);
  if (!original) return invite;
  return {
    ...invite,
    status: "quoted",
    quote: { ...original, supersededAt: null },
    priorQuotes: (invite.priorQuotes ?? []).filter((q) => q.id !== original.id),
    counterDeclined: true,
  };
}

export function withCounterDeclinedOffers<T extends Pick<RfqRequest, "invites">>(rfq: T): T {
  if (!rfq.invites.some((i) => counterDeclinedQuote(i))) return rfq;
  return { ...rfq, invites: rfq.invites.map(withCounterDeclinedOffer) };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** "$389/mo" for a lease or finance quote, "$41,250 out the door" for cash. */
export function offerSummary(q: Pick<RfqQuote, "lease" | "used" | "price" | "totalOtdPrice">): string {
  if (q.lease) return `${money(q.lease.monthlyPaymentPreTax)}/mo`;
  if (q.used?.kind === "finance") return `${money(q.used.monthlyPaymentPreTax)}/mo`;
  if (q.used?.kind === "cash") return `${money(cashOutTheDoor(q.used))} out the door`;
  return money(q.totalOtdPrice || q.price);
}
