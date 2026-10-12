/**
 * What happens to the other invited dealers when a buyer accepts one dealer's offer.
 *
 * Acceptance is either `pickRfqQuote` (lease and single-sheet cash) or the buyer's `accept_otd` on a staged
 * Cash / Finance deal. Everyone else on the request is told once, politely, that they were not selected, and their
 * quote is closed so it cannot be countered or revised. Pure rules live here; the sending is in lib/inviteOutbox.ts.
 */
import type { RfqInvite, RfqRequest } from "./rfq";

/** True once the buyer chose another dealer: no counters, no revised quotes, no new stage moves (a walk-away stays possible). */
export function isNotSelected(invite: Pick<RfqInvite, "notSelectedAt">): boolean {
  return Boolean(invite.notSelectedAt);
}

/** The invite that owns this quote id, or null. */
export function inviteOfQuote(rfq: Pick<RfqRequest, "invites">, quoteId: string): RfqInvite | null {
  return rfq.invites.find((i) => i.quote?.id === quoteId || i.priorQuotes?.some((q) => q.id === quoteId)) ?? null;
}

/**
 * Dealers who are owed the "not selected this time" note: everyone invited except the winner, minus dealers who already
 * walked away, declined, expired or unsubscribed, and minus anyone already told (sent). A desk with no named contact
 * cannot be written to (nothing to build the note from) and is simply closed.
 */
export function dealersOwedNotSelected(rfq: Pick<RfqRequest, "invites">, winnerInviteId: string): RfqInvite[] {
  return rfq.invites.filter((i) => {
    if (i.id === winnerInviteId) return false;
    if (i.status === "declined" || i.status === "expired") return false;
    if (i.stage?.stage === "walked") return false;
    if (i.dealerUnsubscribedAt) return false;
    if (i.notSelectedNoticeSentAt) return false;
    return true;
  });
}

/** Invites to mark closed on the box: same set as above but ignoring whether the note was already sent (marking is idempotent). */
export function invitesToClose(rfq: Pick<RfqRequest, "invites">, winnerInviteId: string): RfqInvite[] {
  return rfq.invites.filter((i) => i.id !== winnerInviteId && i.status !== "declined" && i.status !== "expired" && i.stage?.stage !== "walked");
}
