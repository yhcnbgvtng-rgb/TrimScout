/**
 * Trade-in money, kept out of every quoted price. The dealer's quote (price, fees, tax, add-ons,
 * rebates, monthly) is never edited; the trade is its own set of lines beside it:
 *
 *   Trade-in allowance − Payoff to lender = Net trade equity
 *   OTD after trade = OTD before trade − net equity   (negative equity makes it larger)
 *
 * Sales tax stays whatever the dealer quoted on the full price: no trade-in tax credit is applied.
 * TODO(tax): decide per-state trade-in tax treatment (NJ taxes the full price) before changing this.
 *
 * How net equity is applied depends on the deal:
 *   cash     comes straight off (or onto) the out-the-door total.
 *   finance  positive equity is applied as cash down, negative equity is rolled into the amount financed.
 *   lease    positive equity is a cap cost reduction, negative equity is rolled into the cap cost.
 * The dealer's monthly is not recomputed here; the applied amount and the adjusted principal are shown instead.
 */
import type { AppraisalBasis, DealerTradeAppraisal } from "./types";

const cents = (n: number) => Math.round(n * 100) / 100;

export interface AllowanceValue { low: number; high: number; mid: number; isRange: boolean }

/** The dealer's number as low/high/mid, whichever way they entered it. Null when nothing usable. */
export function allowanceOf(a: Pick<DealerTradeAppraisal, "allowanceSingle" | "allowanceLow" | "allowanceHigh"> | null | undefined): AllowanceValue | null {
  if (!a) return null;
  if (a.allowanceSingle != null && Number.isFinite(a.allowanceSingle) && a.allowanceSingle > 0) {
    return { low: a.allowanceSingle, high: a.allowanceSingle, mid: a.allowanceSingle, isRange: false };
  }
  if (a.allowanceLow != null && a.allowanceHigh != null && a.allowanceLow > 0 && a.allowanceHigh >= a.allowanceLow) {
    return { low: a.allowanceLow, high: a.allowanceHigh, mid: cents((a.allowanceLow + a.allowanceHigh) / 2), isRange: a.allowanceHigh > a.allowanceLow };
  }
  return null;
}

export type TradeStatus = "none" | "pending" | "expired" | "quoted";

export interface TradeEquity {
  status: TradeStatus;
  allowance: AllowanceValue | null;
  payoff: number;
  /** allowance (midpoint) − payoff; null until quoted. */
  net: number | null;
  netLow: number | null;
  netHigh: number | null;
  negative: boolean;
  basis: AppraisalBasis | null;
  goodUntil: string | null;
}

/**
 * `hasTrade` is whether the buyer sent one. No trade → "none"; trade but no (or an expired) appraisal → the
 * dealer's totals are left alone and the column says pending / expired.
 */
export function tradeEquity(hasTrade: boolean, payoffEstimate: number | null | undefined, appraisal: DealerTradeAppraisal | null | undefined, now: Date = new Date()): TradeEquity {
  const payoff = payoffEstimate && payoffEstimate > 0 ? cents(payoffEstimate) : 0;
  const empty = { allowance: null, payoff, net: null, netLow: null, netHigh: null, negative: false, basis: null, goodUntil: null };
  if (!hasTrade) return { status: "none", ...empty, payoff: 0 };
  const allowance = allowanceOf(appraisal);
  if (!appraisal || !allowance) return { status: "pending", ...empty };
  if (new Date(appraisal.goodUntil).getTime() <= now.getTime()) return { status: "expired", ...empty, basis: appraisal.basis, goodUntil: appraisal.goodUntil };
  const net = cents(allowance.mid - payoff);
  return { status: "quoted", allowance, payoff, net, netLow: cents(allowance.low - payoff), netHigh: cents(allowance.high - payoff), negative: net < 0, basis: appraisal.basis, goodUntil: appraisal.goodUntil };
}

/** The equity the dealer computed when they entered the allowance (midpoint − payoff used). */
export const computeEquity = (allowance: AllowanceValue, payoffUsed: number): number => cents(allowance.mid - Math.max(0, payoffUsed));

export interface OtdPair { before: number; after: number; afterLow: number; afterHigh: number; changed: boolean }

/** OTD before and after trade. Pending / expired / none leave the dealer's total exactly as quoted. */
export function otdBeforeAfter(before: number, eq: TradeEquity): OtdPair {
  const b = cents(before);
  if (eq.status !== "quoted" || eq.net == null) return { before: b, after: b, afterLow: b, afterHigh: b, changed: false };
  return { before: b, after: cents(b - eq.net), afterLow: cents(b - (eq.netHigh as number)), afterHigh: cents(b - (eq.netLow as number)), changed: true };
}

export type EquityApplication =
  | { how: "none"; amount: 0; label: string }
  | { how: "cash_down" | "cap_reduction" | "rolled_into_financed" | "rolled_into_cap"; amount: number; label: string; adjusted: number };

/** Finance: positive equity is cash down, negative is rolled into the amount financed. */
export function applyToFinance(eq: TradeEquity, amountFinanced: number): EquityApplication {
  if (eq.status !== "quoted" || eq.net == null || eq.net === 0) return { how: "none", amount: 0, label: "No equity applied" };
  if (eq.net > 0) return { how: "cash_down", amount: eq.net, adjusted: Math.max(0, cents(amountFinanced - eq.net)), label: "Equity applied as cash down" };
  return { how: "rolled_into_financed", amount: Math.abs(eq.net), adjusted: cents(amountFinanced + Math.abs(eq.net)), label: "Negative equity rolled into amount financed" };
}

/** Lease: positive equity is a cap cost reduction, negative is rolled into the cap cost. */
export function applyToLease(eq: TradeEquity, capCost: number): EquityApplication {
  if (eq.status !== "quoted" || eq.net == null || eq.net === 0) return { how: "none", amount: 0, label: "No equity applied" };
  if (eq.net > 0) return { how: "cap_reduction", amount: eq.net, adjusted: Math.max(0, cents(capCost - eq.net)), label: "Equity applied as cap cost reduction" };
  return { how: "rolled_into_cap", amount: Math.abs(eq.net), adjusted: cents(capCost + Math.abs(eq.net)), label: "Negative equity rolled into cap cost" };
}

/**
 * Compare order: lowest post-trade OTD first (the buyer's real bottom line, so a big trade offset by a
 * higher price can't hide), ties broken by the larger net equity. The columns still highlight the best
 * net equity and the best post-trade OTD separately. A dealer with no trade number yet is ranked on the
 * total they quoted, which is also what the buyer would pay today.
 */
export function compareByOtdAfterThenEquity(a: { eq: TradeEquity; otdAfter: number }, b: { eq: TradeEquity; otdAfter: number }): number {
  const an = a.eq.status === "quoted" ? (a.eq.net as number) : -Infinity;
  const bn = b.eq.status === "quoted" ? (b.eq.net as number) : -Infinity;
  return a.otdAfter - b.otdAfter || (bn === an ? 0 : bn > an ? 1 : -1);
}
