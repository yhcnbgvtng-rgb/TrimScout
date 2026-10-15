/**
 * What the buyer sees at the trade confirm step, as plain data: the before and after of the number, and what the revised number does
 * to the deal they picked (cash: out the door after trade; finance and lease: the equity applied the way the compare already does it).
 * Pure, so the buyer panel, the revision email and the tests agree.
 */
import type { RfqInvite, RfqRequest } from "../rfq";
import { cashOutTheDoor, type UsedFinanceQuote } from "../usedQuote";
import { financeAfterTrade, leaseAfterTrade } from "./rank";
import { otdBeforeAfter, tradeEquity, type TradeEquity } from "./otd";
import type { TradeConfirmation } from "./confirm";

export interface EffectLine { label: string; before: string; after: string }

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

const equityAt = (rfq: Pick<RfqRequest, "tradeIn">, invite: RfqInvite, allowance: number): TradeEquity =>
  tradeEquity(true, rfq.tradeIn?.payoffEstimate, invite.tradeAppraisal ? { ...invite.tradeAppraisal, allowanceSingle: allowance, allowanceLow: null, allowanceHigh: null } : null, new Date(), { quoteExpiresAt: invite.quote?.expiresAt ?? null });

/** Out the door after trade at the given trade number; null when the quote isn't a cash sheet. */
export function postTradeOtdAt(rfq: Pick<RfqRequest, "tradeIn">, invite: RfqInvite, allowance: number): number | null {
  const used = invite.quote?.used;
  if (!rfq.tradeIn || !used || used.kind !== "cash") return null;
  return otdBeforeAfter(cashOutTheDoor(used), equityAt(rfq, invite, allowance)).after;
}

/** The lines that move when the number goes from the quoted one to the revised one. */
export function revisionEffects(rfq: Pick<RfqRequest, "tradeIn">, invite: RfqInvite, conf: Pick<TradeConfirmation, "allowancePrelim" | "allowanceFinal">): EffectLine[] {
  const before = conf.allowancePrelim, after = conf.allowanceFinal ?? conf.allowancePrelim;
  const payoff = rfq.tradeIn?.payoffEstimate ?? 0;
  const lines: EffectLine[] = [
    { label: "Trade allowance", before: usd(before), after: usd(after) },
    { label: "Net trade equity", before: usd(before - payoff), after: usd(after - payoff) },
  ];
  const used = invite.quote?.used;
  const lease = invite.quote?.lease;
  if (used?.kind === "cash") {
    const b = postTradeOtdAt(rfq, invite, before), a = postTradeOtdAt(rfq, invite, after);
    if (b != null && a != null) lines.push({ label: "Out the door after trade", before: usd(b), after: usd(a) });
  } else if (used?.kind === "finance") {
    const f = used as UsedFinanceQuote;
    const b = financeAfterTrade(f, equityAt(rfq, invite, before)), a = financeAfterTrade(f, equityAt(rfq, invite, after));
    lines.push({ label: "Amount financed after trade", before: usd(b.financed), after: usd(a.financed) });
    lines.push({ label: "≈ Monthly at their rate and term", before: `${usd(b.monthly)}/mo`, after: `${usd(a.monthly)}/mo` });
  } else if (lease) {
    const b = leaseAfterTrade(lease, equityAt(rfq, invite, before)), a = leaseAfterTrade(lease, equityAt(rfq, invite, after));
    lines.push({ label: "Cap cost after trade", before: usd(b.capCost), after: usd(a.capCost) });
    lines.push({ label: "≈ Monthly with the cap cost change", before: `${usd(b.monthly)}/mo`, after: `${usd(a.monthly)}/mo` });
  }
  return lines;
}
