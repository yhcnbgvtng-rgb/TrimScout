/**
 * The true out-the-door, step by step, once a dealer has put a trade-in allowance on a quote.
 *
 * ONE calculation for every surface (buyer compare, the dealer's quote summary, the tracker). It adds no arithmetic of its own: the
 * numbers come from lib/trade/otd.ts (tradeEquity, otdBeforeAfter) and lib/trade/stateTradeCredit.ts (tradeTaxCredit, one
 * sourced rule per state), and this file only lays them out as the lines a buyer reads:
 *
 *   Original OTD (the dealer's quote)
 *   − Trade-in allowance
 *   − Tax savings from trade      (only where the state gives a credit; the credit follows the state's rule, incl. caps)
 *   + Payoff owed                 (when the buyer entered a payoff)
 *   = True OTD                    (a range when the dealer gave a low / high allowance)
 *
 * Surcharges are never taxable (not in the tax base) and sit inside the original OTD unchanged: a trade does not move them.
 * "Selling price as % of MSRP" is built from the selling price alone elsewhere and does not use anything here.
 * With no trade, or no usable allowance, `applies` is false and the original OTD is returned untouched.
 *
 * Pure and client-safe.
 */
import type { AllowanceValue, TradeEquity, TaxSaving } from "./otd";
import { otdBeforeAfter } from "./otd";
import { STATE_TRADE_CREDIT, type TradeTaxCredit } from "./stateTradeCredit";

export interface Span { mid: number; low: number; high: number }

export interface TrueOtdBreakdown {
  /** A dealer allowance is in: the steps below apply. False leaves the dealer's quote exactly as quoted. */
  applies: boolean;
  /** The OTD on the dealer's quote, before the trade. */
  original: number;
  /** Trade-in allowance (positive number; shown with a minus). Null until quoted. */
  allowance: (Span & { isRange: boolean }) | null;
  /** Sales tax the trade saves; null when the state gives none or the rule is not confirmed (see taxNote). */
  taxSaving: Span | null;
  /** Why there is no tax line, or a caveat on it. Null when the line shows normally. */
  taxNote: string | null;
  /** What the buyer still owes on the trade (positive number; shown with a plus). 0 when none. */
  payoff: number;
  /** Allowance minus payoff; negative means negative equity. Null until quoted. */
  netEquity: number | null;
  negativeEquity: boolean;
  /** The true OTD. `low` / `high` differ only for a range quote. */
  trueOtd: Span & { isRange: boolean };
}

export const taxNotConfirmedNote = (state: string | null): string => `Tax credit not confirmed for ${state || "your state"}`;

/** The note beside the tax line, from the buyer state's rule. Null when the credit shows with no caveat. */
function noteFor(credit: TradeTaxCredit | null): string | null {
  if (!credit) return null;
  if (credit.status === "unconfirmed") return taxNotConfirmedNote(credit.state);
  if (credit.status === "none") return `${credit.state ?? "This state"} gives no sales tax credit for a trade-in`;
  const rule = credit.state ? STATE_TRADE_CREDIT[credit.state]?.rule : undefined;
  if (rule === "capped") return `${credit.state} caps the trade-in tax credit; only the allowed part is counted`;
  if (rule === "new_only") return `${credit.state} gives the credit on new vehicles only`;
  return null;
}

export function trueOtdBreakdown(input: { originalOtd: number; eq: TradeEquity; taxCredit: TradeTaxCredit | null }): TrueOtdBreakdown {
  const { eq, taxCredit } = input;
  const saving: TaxSaving | null = taxCredit && taxCredit.status === "credit" ? { mid: taxCredit.mid, low: taxCredit.low, high: taxCredit.high } : null;
  const pair = otdBeforeAfter(input.originalOtd, eq, saving);
  const original = pair.before;
  if (!pair.changed || !eq.allowance) {
    return { applies: false, original, allowance: null, taxSaving: null, taxNote: null, payoff: 0, netEquity: null, negativeEquity: false, trueOtd: { mid: original, low: original, high: original, isRange: false } };
  }
  const shownSaving = saving && saving.mid > 0 ? { mid: saving.mid, low: saving.low, high: saving.high } : null;
  return {
    applies: true,
    original,
    allowance: { mid: eq.allowance.mid, low: eq.allowance.low, high: eq.allowance.high, isRange: eq.allowance.isRange },
    taxSaving: shownSaving,
    // A credit state with nothing to save (zero tax on the quote) says nothing; the other states say why there is no line.
    taxNote: shownSaving && !noteFor(taxCredit) ? null : noteFor(taxCredit),
    payoff: eq.payoff,
    netEquity: eq.net,
    negativeEquity: eq.negative,
    trueOtd: { mid: pair.after, low: pair.afterLow, high: pair.afterHigh, isRange: eq.allowance.isRange },
  };
}

/**
 * A "quoted" equity from a bare allowance and payoff, for the dealer's form while the number is being typed (no stored appraisal
 * yet). Same arithmetic as tradeEquity() once an appraisal exists, so the preview and the buyer's view land on the same figure.
 */
export function quotedEquityOf(allowance: AllowanceValue, payoffEstimate: number | null | undefined): TradeEquity {
  const cents = (n: number) => Math.round(n * 100) / 100;
  const payoff = payoffEstimate && payoffEstimate > 0 ? cents(payoffEstimate) : 0;
  const net = cents(allowance.mid - payoff);
  return { status: "quoted", allowance, payoff, net, netLow: cents(allowance.low - payoff), netHigh: cents(allowance.high - payoff), negative: net < 0, basis: null, goodUntil: null, stale: false, declined: null, conditions: null, conditionChips: [] };
}
