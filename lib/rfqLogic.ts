// Pure logic for the RFQ flow — no I/O, so every rule here (invite caps,
// spec-integrity checks, quote completeness, the dealer-facing handoff
// text) is directly unit-testable and can't drift from what the box
// server enforces server-side.
import type { RfqInvite, RfqMustHave, RfqQuote, RfqRequest, RfqSpec } from "./rfq";
import { RFQ_MAX_INVITES } from "./rfq";

/** Freezes a full-match result's must-haves for an RFQ. Only ever "hit" — never freeze a miss or unknown into a locked spec. */
export function freezeMustHaves(hits: { code: string; name: string }[]): RfqMustHave[] {
  return hits.map((h) => ({ code: h.code, name: h.name, status: "hit" as const }));
}

/** True only when every must-have is a confirmed hit — mirrors the v1 gate that only a full match can ever reach here. */
export function isFullyLockedSpec(mustHaves: RfqMustHave[]): boolean {
  return mustHaves.length > 0 && mustHaves.every((m) => m.status === "hit");
}

function activeInviteCount(invites: Pick<RfqInvite, "status">[]): number {
  return invites.filter((i) => i.status !== "declined" && i.status !== "expired").length;
}

export function canInviteMore(invites: Pick<RfqInvite, "status">[], maxInvites: number = RFQ_MAX_INVITES): boolean {
  return activeInviteCount(invites) < maxInvites;
}

export function remainingInviteSlots(
  invites: Pick<RfqInvite, "status">[],
  maxInvites: number = RFQ_MAX_INVITES
): number {
  return Math.max(0, maxInvites - activeInviteCount(invites));
}

/** Spec integrity: does this quote actually reference the locked car, not a substitute? */
export function quoteMatchesLockedSpec(
  quote: Pick<RfqQuote, "vin" | "stockNumber">,
  spec: Pick<RfqSpec, "vin" | "stockNumber">
): boolean {
  if (quote.vin.trim().toUpperCase() !== spec.vin.trim().toUpperCase()) return false;
  if (spec.stockNumber && quote.stockNumber && quote.stockNumber.trim() !== spec.stockNumber.trim()) {
    return false;
  }
  return true;
}

/** Quote completeness: every field the instrumentation's completeness metric checks for. */
export function isQuoteComplete(quote: Pick<RfqQuote, "price" | "fees" | "vin" | "expiresAt">): boolean {
  if (!(quote.price > 0)) return false;
  if (!Array.isArray(quote.fees)) return false;
  if (!quote.vin.trim()) return false;
  if (!quote.expiresAt || Number.isNaN(new Date(quote.expiresAt).getTime())) return false;
  return true;
}

export function totalOtdFromFees(price: number, fees: { amount: number }[]): number {
  return price + fees.reduce((sum, f) => sum + f.amount, 0);
}

/**
 * The plain-text handoff shown to the buyer/ops to send a dealer — over
 * email, text, or read aloud on a call. Says explicitly this is a request
 * for a quote, never a binding bid or a 24-hour SLA, per the phase-2 spec.
 */
export function dealerHandoffText(spec: RfqSpec): string {
  const lines = [
    `Request for a quote — ${spec.vehicleYear} ${spec.vehicleMake} ${spec.vehicleModel} ${spec.vehicleTrim}`,
    `VIN: ${spec.vin}${spec.stockNumber ? ` · Stock #${spec.stockNumber}` : ""}`,
    "",
    "Locked must-have options (please confirm all are on this exact VIN before quoting):",
    ...spec.mustHaves.map((m) => `  - ${m.code} ${m.name}`),
    "",
    "Please reply with: your out-the-door price, an itemized list of any fees, and how long the quote is valid for.",
    "",
    "This is a request for a quote, not a binding bid, and there is no 24-hour deadline to respond.",
  ];
  return lines.join("\n");
}

export interface RfqDealerResponseRateInput {
  totalInvites: number;
  quotedInvites: number;
}

/** Straight ratio — kept as a named function so every caller reports this metric the same way. */
export function dealerResponseRate(input: RfqDealerResponseRateInput): number | null {
  return input.totalInvites > 0 ? input.quotedInvites / input.totalInvites : null;
}

export function timeToFirstQuoteHours(createdAt: string, firstQuoteSubmittedAt: string): number {
  return (new Date(firstQuoteSubmittedAt).getTime() - new Date(createdAt).getTime()) / 3_600_000;
}

export function firstQuoteFor(rfq: Pick<RfqRequest, "invites">): RfqQuote | null {
  const quotes = rfq.invites.map((i) => i.quote).filter((q): q is RfqQuote => q != null);
  if (quotes.length === 0) return null;
  return quotes.reduce((earliest, q) =>
    new Date(q.submittedAt).getTime() < new Date(earliest.submittedAt).getTime() ? q : earliest
  );
}

// ---------------------------------------------------------------------------
// Quality/anti-abuse gates: one active RFQ at a time, a light reputation
// system that slows (never fully blocks) a buyer's invite cap after repeated
// no-shows, and a reachable-email check before a pick is finalized. Derived
// entirely from data the box already returns — no new columns/tables.
// ---------------------------------------------------------------------------

/** True once any of the buyer's RFQs is still open — gates a second RFQ. */
export function hasActiveRfq(rfqs: Pick<RfqRequest, "status">[]): boolean {
  return rfqs.some((r) => r.status === "collecting");
}

/** A quoted RFQ left uncollected this long reads as abandoned, not merely slow. */
export const RFQ_GHOST_STALE_DAYS = 7;

export type RfqOutcome = "ghosted" | "cancelled_after_quote" | "completed" | "walked_early" | "in_progress";

/**
 * Classifies one finished-or-in-flight RFQ for reputation purposes. Only
 * "ghosted" (got real quotes, never picked or walked, gone stale) and
 * "cancelled_after_quote" (saw real numbers, walked instead of picking) are
 * strikes — walking away with zero quotes is a normal, healthy outcome
 * (the buyer didn't waste anyone's time) and must never count against them.
 */
export function classifyRfqOutcome(rfq: Pick<RfqRequest, "status" | "invites">, nowMs: number): RfqOutcome {
  if (rfq.status === "picked") return "completed";

  const quotes = rfq.invites.map((i) => i.quote).filter((q): q is RfqQuote => q != null);
  const hasQuote = quotes.length > 0;

  if (rfq.status === "walked") {
    return hasQuote ? "cancelled_after_quote" : "walked_early";
  }

  // Still "collecting"
  if (!hasQuote) return "in_progress";
  const latestQuoteMs = Math.max(...quotes.map((q) => new Date(q.submittedAt).getTime()));
  const staleMs = RFQ_GHOST_STALE_DAYS * 86_400_000;
  return nowMs - latestQuoteMs > staleMs ? "ghosted" : "in_progress";
}

/** Count of strike-worthy outcomes across a buyer's RFQ history. */
export function buyerRfqStrikeCount(rfqs: Pick<RfqRequest, "status" | "invites">[], nowMs: number): number {
  return rfqs.filter((r) => {
    const outcome = classifyRfqOutcome(r, nowMs);
    return outcome === "ghosted" || outcome === "cancelled_after_quote";
  }).length;
}

/** At/above this many strikes, a buyer's invite cap is reduced — "slow their invites," never a hard ban. */
export const RFQ_REPUTATION_STRIKE_THRESHOLD = 2;
export const RFQ_REPUTATION_REDUCED_CAP = 1;

export function reputationInviteCap(strikeCount: number): number {
  return strikeCount >= RFQ_REPUTATION_STRIKE_THRESHOLD ? RFQ_REPUTATION_REDUCED_CAP : RFQ_MAX_INVITES;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cheap format check, not a mailbox-existence check — the real gate is that email is required at signup; this only catches the edge cases (legacy/OAuth accounts) where it might be missing or malformed. */
export function isReachableEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && EMAIL_SHAPE.test(email.trim());
}
