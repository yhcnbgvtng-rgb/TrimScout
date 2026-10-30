/**
 * What an invited dealer may see of the buyer's trade-in. Everything but the payoff passes through; the payoff AMOUNT
 * (and the lender, which names the debt) reaches a dealer only when the buyer ticked "Share my payoff". Otherwise the
 * dealer sees that a payoff exists (ownership is financed/leased) and nothing more. The unredacted record stays on the
 * server for the equity math; this is applied at the dealer-facing edge only.
 */
import type { DealerTradeAppraisal, TradeInRecord } from "./types";
import type { TradeConfirmation } from "./confirm";

export const payoffShared = (t: Pick<TradeInRecord, "sharePayoff"> | null | undefined): boolean => t?.sharePayoff === true;

export function redactTradeForDealer(t: TradeInRecord): TradeInRecord {
  if (payoffShared(t)) return t;
  return { ...t, payoffEstimate: 0, lenderName: null, sharePayoff: false };
}

/** Equity = allowance - payoff, so it would give the payoff away by subtraction; hidden along with it. */
export function redactAppraisalForDealer<T extends DealerTradeAppraisal | null | undefined>(a: T, t: Pick<TradeInRecord, "sharePayoff">): T {
  if (!a || payoffShared(t)) return a;
  return { ...a, payoffUsed: 0, equityComputed: 0 } as T;
}

export function redactConfirmationForDealer<T extends TradeConfirmation | null | undefined>(c: T, t: Pick<TradeInRecord, "sharePayoff">): T {
  if (!c || payoffShared(t)) return c;
  return { ...c, payoffUsed: 0 } as T;
}

/** The dealer GET body: redact the three places the payoff travels (the record, the desk's appraisal, the confirm step). */
export function redactDealerTradePayload<T extends { tradeIn: TradeInRecord; appraisal?: DealerTradeAppraisal | null; confirmation?: TradeConfirmation | null }>(body: T, trade: TradeInRecord): T {
  return { ...body, tradeIn: redactTradeForDealer(body.tradeIn), appraisal: redactAppraisalForDealer(body.appraisal ?? null, trade), confirmation: redactConfirmationForDealer(body.confirmation ?? null, trade) };
}
