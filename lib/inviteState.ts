/**
 * When a dealership unsubscribes from TrimScout (opt-out), every open invite
 * pointing at that rooftop is flagged with dealerUnsubscribedAt (auth server's
 * cascade). These pure helpers give the app one place to decide what that means,
 * so the tracker, the compare tables and the dealer email agree:
 *
 *  - the buyer stops waiting on that rooftop (it's not "awaiting");
 *  - counters and reply-expecting affordances are off for it;
 *  - a quote it submitted BEFORE unsubscribing stays readable and choosable;
 *  - an open invite with no quote is a dead end → the request may need a re-pick.
 *
 * Never blaming the buyer, never auction language.
 */
import type { RfqInvite, RfqRequest } from "./rfq";

export function inviteUnsubscribed(invite: Pick<RfqInvite, "dealerUnsubscribedAt">): boolean {
  return Boolean(invite.dealerUnsubscribedAt);
}

/** The dealer opted out and never quoted — nothing will come, and nothing to choose here. */
export function inviteUnsubscribedNoQuote(invite: Pick<RfqInvite, "dealerUnsubscribedAt" | "quote">): boolean {
  return Boolean(invite.dealerUnsubscribedAt) && !invite.quote;
}

/** Counters / reply-expecting UI are off once a rooftop has unsubscribed, quote or not. */
export function inviteAcceptsCounter(invite: Pick<RfqInvite, "dealerUnsubscribedAt" | "quote" | "status">): boolean {
  return !invite.dealerUnsubscribedAt && Boolean(invite.quote) && invite.status !== "declined" && invite.status !== "expired";
}

export interface UnsubscribedDealer { dealerName: string; hadQuote: boolean; inviteId: string }

/** Rooftops on this request that unsubscribed while open — drives the banner. */
export function unsubscribedDealers(rfq: Pick<RfqRequest, "invites">): UnsubscribedDealer[] {
  return rfq.invites
    .filter((i) => i.dealerUnsubscribedAt)
    .map((i) => ({ dealerName: i.dealerName, hadQuote: Boolean(i.quote), inviteId: i.id }));
}

/**
 * The request is stuck on the unsubscribe: every non-declined/expired invite it
 * has is an unsubscribed rooftop, and none of them left a quote — so there's
 * nothing to wait for and nothing to choose. The buyer must pick a replacement.
 */
export function rfqNeedsRepick(rfq: Pick<RfqRequest, "invites" | "status">): boolean {
  if (rfq.status !== "collecting") return false;
  const live = rfq.invites.filter((i) => i.status !== "declined" && i.status !== "expired");
  if (live.length === 0) return false;
  return live.every((i) => i.dealerUnsubscribedAt) && live.every((i) => !i.quote);
}

/** Banner copy — neutral, one rooftop or several. */
export function unsubscribedBannerCopy(dealers: UnsubscribedDealer[]): { title: string; body: string } | null {
  if (!dealers.length) return null;
  const names = dealers.map((d) => d.dealerName);
  const title = names.length === 1 ? `${names[0]} is no longer accepting quote requests on TrimScout` : `${names.length} dealerships are no longer accepting quote requests on TrimScout`;
  const list = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const anyQuote = dealers.some((d) => d.hadQuote);
  const body = `${list} unsubscribed, so ${names.length === 1 ? "they won't" : "they won't"} reply here. Choose a different vehicle at another dealership to continue.${anyQuote ? " Any quote already sent stays here to compare." : ""}`;
  return { title, body };
}
