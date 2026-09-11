/**
 * What the deal looks like once the trade-in has a number on it.
 *
 * Dealers quote and compete on an out-the-door price that excludes sales tax
 * and registration — those depend on where the buyer lives, not on the dealer.
 * Once a trade-in allowance is agreed, two things move: the cash the buyer
 * brings (price minus what the trade is worth, plus any loan payoff the
 * allowance doesn't cover), and, in most states, the sales tax itself,
 * because the trade-in's value comes off the taxable amount.
 *
 * Pure arithmetic and a state table. No I/O, shared by the buyer's revised
 * breakdown and the dealer's appraisal preview.
 */

export interface TradeInAppraisal {
  /** What the dealer will allow for the trade, in whole dollars. */
  allowance: number;
  /** Outstanding loan on the trade-in, if any. Paid off out of the allowance. */
  loanPayoff: number;
}

export interface RevisedOtdInput {
  /** The dealer's quoted price — vehicle plus dealer fees, no tax, no registration. */
  quotedOtdPrice: number;
  /** Combined state + local rate as a fraction, e.g. 0.06625 for NJ. */
  taxRate: number;
  /** Two-letter state the vehicle will be registered in. */
  registrationState: string | null | undefined;
  appraisal: TradeInAppraisal;
}

export interface RevisedOtdResult {
  quotedOtdPrice: number;
  tradeInAllowance: number;
  loanPayoff: number;
  /** Allowance minus payoff. Negative means the buyer owes the difference. */
  tradeInEquity: number;
  /** Whether this state taxes the price net of the trade-in. */
  tradeInTaxCredit: boolean;
  /** The amount sales tax is actually computed on. */
  taxableAmount: number;
  salesTax: number;
  /** Tax the buyer would have paid with no trade-in, for the comparison line. */
  salesTaxWithoutTradeIn: number;
  taxSavedByTradeIn: number;
  registrationFees: number;
  /** Everything: price + tax + registration, before the trade is applied. */
  totalBeforeTradeIn: number;
  /** What the buyer actually brings to the table. Never below zero. */
  amountDue: number;
}

/**
 * States that give no sales-tax credit for a trade-in — tax is on the full
 * price regardless. Everywhere else taxes the difference. Michigan phased its
 * cap out; as of 2026 its credit is full, so it's not listed. This is an
 * estimate for the buyer's planning, labelled as such in the UI; the dealer's
 * paperwork and the state's DMV are the final word.
 */
export const NO_TRADE_IN_TAX_CREDIT_STATES = new Set(["CA", "DC", "HI", "KY", "MD", "VA"]);

export function stateGivesTradeInTaxCredit(state: string | null | undefined): boolean {
  const code = (state || "").trim().toUpperCase();
  if (code.length !== 2) return true; // unknown state: assume the common case
  return !NO_TRADE_IN_TAX_CREDIT_STATES.has(code);
}

/** Same registration estimate calculateOtd uses — kept identical so the two never disagree. */
export function estimateRegistrationFees(sellingPrice: number): number {
  return Math.round(Math.max(0, sellingPrice) * 0.011 + 220);
}

function money(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function revisedOtd(input: RevisedOtdInput): RevisedOtdResult {
  const quotedOtdPrice = Math.max(0, money(input.quotedOtdPrice));
  const tradeInAllowance = Math.max(0, money(input.appraisal.allowance));
  const loanPayoff = Math.max(0, money(input.appraisal.loanPayoff));
  const taxRate = Number.isFinite(input.taxRate) && input.taxRate >= 0 ? input.taxRate : 0;

  const tradeInTaxCredit = stateGivesTradeInTaxCredit(input.registrationState);
  const taxableAmount = tradeInTaxCredit
    ? Math.max(0, quotedOtdPrice - tradeInAllowance)
    : quotedOtdPrice;

  const salesTax = money(taxableAmount * taxRate);
  const salesTaxWithoutTradeIn = money(quotedOtdPrice * taxRate);
  const registrationFees = estimateRegistrationFees(quotedOtdPrice);

  const totalBeforeTradeIn = quotedOtdPrice + salesTax + registrationFees;
  const tradeInEquity = tradeInAllowance - loanPayoff;
  // Positive equity comes off what's owed; negative equity is added to it.
  const amountDue = Math.max(0, totalBeforeTradeIn - tradeInEquity);

  return {
    quotedOtdPrice,
    tradeInAllowance,
    loanPayoff,
    tradeInEquity,
    tradeInTaxCredit,
    taxableAmount,
    salesTax,
    salesTaxWithoutTradeIn,
    taxSavedByTradeIn: Math.max(0, salesTaxWithoutTradeIn - salesTax),
    registrationFees,
    totalBeforeTradeIn,
    amountDue,
  };
}
