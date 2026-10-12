/**
 * The chat-style thread on one dealer's quote, for the deal and quote screens.
 *
 * Built only from what is already stored on THAT invite plus the request-level note the buyer wrote for every quoting
 * dealer: the buyer's note, the dealer's quote notes, the buyer's counter and its note, chat messages, and small inline
 * system notes for quotes, counters, accepts, fee overrides and the deal stages (out-the-door lock, trade-in values,
 * payment). The builder takes ONE invite, so another desk's words cannot reach it: each dealer sees only their own
 * thread, and the buyer sees one thread per dealer, never merged.
 *
 * Privacy: the thread carries no buyer name, email or phone, ever. Free text the buyer wrote that still contains a
 * contact vector (old notes from before the filters) is replaced for the dealer — before final acceptance for certain, and after it too,
 * because the buyer's details reach the winning dealer only through the dedicated release. A request, not a bid.
 *
 * Pure and client-safe.
 */
import type { DealMessage, RfqInvite, RfqQuote, RfqRequest } from "./rfq";
import { counterSummary } from "./buyerCounter";
import { activeOverrides, overrideSummary } from "./feeOverride";
import { findIdentityInfo } from "./identityFilter";
import { cashOutTheDoor } from "./usedQuote";
import type { DealStageState } from "./dealStages";

export type ThreadViewer = "buyer" | "dealer";
export type ThreadSide = "buyer" | "dealer" | "system";
export interface ThreadEntry {
  id: string;
  at: string;
  side: ThreadSide;
  /** "message" is chat; "note" is a note stored on the deal (shown as a bubble too); "event" is the small inline line. */
  kind: "message" | "note" | "event";
  text: string;
}

export const REDACTED_BUYER_TEXT = "[Removed — names and contact details are never shared in messages]";
export const MAX_CHAT_LENGTH = 1000;

type ThreadRfq = Pick<RfqRequest, "buyerNote" | "createdAt" | "status" | "pickedQuoteId">;

const usd = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : "");

/**
 * Final acceptance: on a staged Cash / Finance deal, the buyer tapped "Accept final deal" (stage closed with final accepted — the
 * same moment the buyer's details are released to the winning dealer, lib/dealStages.ts); on a lease or single-sheet quote, the
 * buyer picked this dealer's quote. Locking the out-the-door price, a trade value or a payment choice is not final.
 */
export function isFinallyAccepted(rfq: Pick<RfqRequest, "pickedQuoteId">, invite: Pick<RfqInvite, "quote" | "stage">): boolean {
  const st = invite.stage as (DealStageState & { final?: { status?: string } | null }) | null | undefined;
  if (st?.stage === "closed" && st.final?.status === "accepted") return true;
  if (st) return false;
  return Boolean(invite.quote && rfq.pickedQuoteId && rfq.pickedQuoteId === invite.quote.id);
}

/** Can a message be posted on this desk's thread right now? Mirrors the box (src/rfqMessages.js). */
export function canPostToThread(rfq: Pick<RfqRequest, "status">, invite: Pick<RfqInvite, "status" | "notSelectedAt" | "dealerUnsubscribedAt">): { ok: true } | { ok: false; reason: string } {
  if (rfq.status === "walked") return { ok: false, reason: "This request was closed, so the conversation is read-only." };
  if (invite.notSelectedAt) return { ok: false, reason: "This quote was closed, so the conversation is read-only." };
  if (invite.status === "declined" || invite.status === "expired") return { ok: false, reason: "This dealer is no longer in the running, so the conversation is read-only." };
  if (invite.dealerUnsubscribedAt) return { ok: false, reason: "This dealership has left TrimScout, so the conversation is read-only." };
  return { ok: true };
}

function quoteHeadline(q: RfqQuote): string {
  if (q.lease) return `${usd(q.lease.monthlyPaymentPreTax)}/mo lease`;
  if (q.used?.kind === "finance") return `${usd(q.used.monthlyPaymentPreTax)}/mo at ${q.used.apr}% for ${q.used.termMonths} mo`;
  if (q.used?.kind === "cash") return `${usd(cashOutTheDoor(q.used))} out the door`;
  return usd(q.totalOtdPrice) ? `${usd(q.totalOtdPrice)} out the door` : "a quote";
}

function stageEvent(e: Record<string, unknown>): string | null {
  const who = e.actor === "buyer" ? "Buyer" : "Dealer";
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  switch (e.type) {
    case "accept_otd": return `${who} locked the out-the-door price${n(e.amount) != null ? ` at ${usd(n(e.amount))}` : ""}`;
    case "add_trade": return "Buyer added a trade-in";
    case "skip_trade": return "Buyer has no trade-in";
    case "trade_offer": return `Dealer offered ${usd(n(e.value))} for the trade-in`;
    case "trade_hold": return `Dealer held firm at ${usd(n(e.value))} for the trade-in`;
    case "trade_counter": return `Buyer countered the trade value at ${usd(n(e.value))}`;
    case "trade_accept": case "trade_accept_counter": return `Trade-in locked at ${usd(n(e.value))}${n(e.trueOtd) != null ? ` — true out-the-door ${usd(n(e.trueOtd))}` : ""}`;
    case "choose_cash": return "Buyer chose to pay cash";
    case "choose_own_financing": return "Buyer will bring their own financing";
    case "request_finance": return "Buyer asked for a financing quote";
    case "finance_quote": return `Dealer offered ${e.apr}% for ${e.termMonths} mo — ${usd(n(e.monthly))}/mo`;
    case "finance_hold": return `Dealer held firm at ${e.apr}% for ${e.termMonths} mo`;
    case "finance_counter": return `Buyer countered financing at ${e.apr}% for ${e.termMonths} mo — ${usd(n(e.monthly))}/mo`;
    case "finance_accept": case "finance_accept_counter": return `Financing agreed — ${usd(n(e.monthly))}/mo${e.apr != null ? ` at ${e.apr}%` : ""}`;
    case "change_payment": return "Buyer went back to change the payment choice";
    case "accept_final": return "Buyer accepted the final deal";
    // The fact only: the details themselves are never part of a thread.
    case "buyer_details_released": return "Buyer details were released to the winning dealer";
    case "walk": return `${who} walked away`;
    default: return null;
  }
}

/** Everything on this desk's thread, oldest first, for one viewer. */
export function buildThread(rfq: ThreadRfq, invite: RfqInvite, viewer: ThreadViewer): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  // Contact details in the buyer's free text are blanked for the dealer even after final acceptance: the dealer gets the buyer's details
  // through the one dedicated release (lib/dealStages.ts), never through a thread.
  const buyerText = (t: string) => (viewer === "dealer" && findIdentityInfo(t) ? REDACTED_BUYER_TEXT : t);
  const push = (e: ThreadEntry) => { if (e.text && e.at) out.push(e); };

  if (rfq.buyerNote) push({ id: "buyer-note", at: rfq.createdAt, side: "buyer", kind: "note", text: buyerText(rfq.buyerNote) });

  const quotes: RfqQuote[] = [...(invite.priorQuotes || []), ...(invite.quote ? [invite.quote] : [])];
  const seen = new Set<string>();
  for (const q of quotes) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    push({ id: `quote-${q.id}`, at: q.submittedAt, side: "system", kind: "event", text: `Dealer sent a quote: ${quoteHeadline(q)}` });
    if (q.notes) push({ id: `quote-note-${q.id}`, at: q.submittedAt, side: "dealer", kind: "note", text: q.notes });
    if (q.used?.kind === "cash" && q.used.counterAccepted) {
      push({ id: `accepted-${q.id}`, at: q.used.counterAccepted.acceptedAt, side: "system", kind: "event", text: "Dealer accepted the buyer's counter" });
    }
    for (const o of activeOverrides(q.used)) push({ id: `override-${q.id}-${o.key}`, at: o.at, side: "system", kind: "event", text: `Dealer adjusted a fee — ${overrideSummary(o)}` });
  }

  const c = invite.buyerCounter;
  if (c) {
    push({ id: `counter-${c.sentAt}`, at: c.sentAt, side: "system", kind: "event", text: `Buyer sent a counter: ${counterSummary(c) || "see the comparison"}` });
    if (c.note) push({ id: `counter-note-${c.sentAt}`, at: c.sentAt, side: "buyer", kind: "note", text: buyerText(c.note) });
  }

  for (const [i, e] of (invite.stage?.log || []).entries()) {
    const text = stageEvent(e);
    if (text && typeof e.at === "string") push({ id: `stage-${i}-${e.type}`, at: e.at, side: "system", kind: "event", text });
  }
  // The buyer's optional notes on a trade-value or financing counter are words the buyer wrote: same redaction as every buyer note.
  const stg = invite.stage as (DealStageState & { payment?: { financeCounter?: { note?: string | null; at?: string } | null } }) | null | undefined;
  const tc = stg?.trade?.counter;
  if (tc?.note) push({ id: `trade-counter-note-${tc.at}`, at: tc.at, side: "buyer", kind: "note", text: buyerText(tc.note) });
  const fc = stg?.payment?.financeCounter;
  if (fc?.note && fc.at) push({ id: `finance-counter-note-${fc.at}`, at: fc.at, side: "buyer", kind: "note", text: buyerText(fc.note) });

  if (invite.tradeAppraisal) {
    const a = invite.tradeAppraisal;
    const text = a.allowanceSingle != null ? `Dealer appraised the trade-in at ${usd(a.allowanceSingle)}` : a.allowanceLow != null && a.allowanceHigh != null ? `Dealer appraised the trade-in at ${usd(a.allowanceLow)} to ${usd(a.allowanceHigh)}` : null;
    if (text) push({ id: "trade-appraisal", at: a.createdAt, side: "system", kind: "event", text });
  }

  for (const m of invite.messages || []) {
    push({ id: `msg-${m.id}`, at: m.at, side: m.from, kind: "message", text: m.from === "buyer" ? buyerText(m.text) : m.text });
  }

  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

/** Messages and notes from the other side after `lastSeen` — the drawer's unread badge. System lines never count. */
export function unreadCount(entries: ThreadEntry[], viewer: ThreadViewer, lastSeen: string | null): number {
  return entries.filter((e) => e.side !== "system" && e.side !== viewer && (!lastSeen || e.at > lastSeen)).length;
}

/** Which side a bubble sits on for this viewer: "mine" on the right, "theirs" on the left. */
export const bubbleAlign = (side: ThreadSide, viewer: ThreadViewer): "mine" | "theirs" | "center" => (side === "system" ? "center" : side === viewer ? "mine" : "theirs");

export type { DealMessage };
