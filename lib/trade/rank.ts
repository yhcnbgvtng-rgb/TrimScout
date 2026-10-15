/**
 * How desks are ordered and which one is "best" once a trade is in the picture. The buyer compares on what they actually pay
 * after the trade, so a big allowance can't hide behind a higher price and negative equity can't hide behind a low one.
 *
 *   cash     post-trade OTD = vehicle OTD − net equity (negative equity makes it larger)
 *   finance  the equity is applied the way lib/trade/otd.ts already does (positive → cash down, negative → rolled into the amount
 *            financed); the comparable monthly is the dealer's rate and term on that adjusted amount. Ranking only: the dealer's own
 *            monthly is never overwritten on screen.
 *   lease    positive equity is a cap cost reduction and negative equity is rolled into the cap cost; the comparable monthly moves by
 *            the change in cap cost × (1/term + money factor).
 *
 * A desk with no live trade number (none, declined, expired) can't be compared on the post-trade basis: it sorts after the desks that
 * can, and it never gets the best-deal badge. "Vehicle OTD only" ignores the trade for ordering (the exclusion still holds).
 */
import { monthlyPayment } from "../dealStages";
import type { LeaseQuote } from "../leaseQuote";
import type { UsedFinanceQuote } from "../usedQuote";
import { applyToFinance, applyToLease, type TradeEquity } from "./otd";

export type TradeSortMode = "post_trade" | "vehicle";
export const TRADE_SORT_LABELS: Record<TradeSortMode, string> = { post_trade: "After trade (default)", vehicle: "Vehicle OTD only" };

/** Only a live allowance can be compared on the post-trade basis and earn a best-deal badge. */
export const tradeEligible = (eq: TradeEquity): boolean => eq.status === "quoted";

const cents = (n: number) => Math.round(n * 100) / 100;

export interface FinanceAfterTrade { monthly: number; financed: number; applied: boolean }
/** Comparable monthly on the amount financed after the equity is applied; unchanged when no live number or the dealer's APR/term are unusable. */
export function financeAfterTrade(q: Pick<UsedFinanceQuote, "amountFinanced" | "apr" | "termMonths" | "monthlyPaymentPreTax">, eq: TradeEquity): FinanceAfterTrade {
  const a = applyToFinance(eq, q.amountFinanced);
  if (a.how === "none") return { monthly: q.monthlyPaymentPreTax, financed: q.amountFinanced, applied: false };
  const m = monthlyPayment(a.adjusted, q.apr, q.termMonths) as number | null;
  return { monthly: m ?? q.monthlyPaymentPreTax, financed: a.adjusted, applied: m != null };
}

export interface LeaseAfterTrade { monthly: number; capCost: number; applied: boolean }
export function leaseAfterTrade(l: Pick<LeaseQuote, "capCost" | "moneyFactor" | "termMonths" | "monthlyPaymentPreTax">, eq: TradeEquity): LeaseAfterTrade {
  const a = applyToLease(eq, l.capCost);
  if (a.how === "none" || !(l.termMonths > 0)) return { monthly: l.monthlyPaymentPreTax, capCost: l.capCost, applied: false };
  const delta = a.adjusted - l.capCost; // negative with a cap reduction, positive when negative equity is rolled in
  return { monthly: cents(l.monthlyPaymentPreTax + delta * (1 / l.termMonths + (l.moneyFactor || 0))), capCost: a.adjusted, applied: true };
}

export interface OrderOpts<T> {
  mode: TradeSortMode;
  /** The request has a trade-in. Without one, nothing here changes the order. */
  hasTrade: boolean;
  eligible: (t: T) => boolean;
  /** Order on the post-trade basis (only ever applied to eligible desks). */
  byPostTrade: (a: T, b: T) => number;
  /** Order on the vehicle quote alone. */
  byVehicle: (a: T, b: T) => number;
}

export function orderDesks<T>(items: T[], o: OrderOpts<T>): T[] {
  if (!o.hasTrade || o.mode === "vehicle") return [...items].sort(o.byVehicle);
  const ok = items.filter(o.eligible).sort(o.byPostTrade);
  const rest = items.filter((t) => !o.eligible(t)).sort(o.byVehicle);
  return [...ok, ...rest];
}

/** The best deal is the first desk in order that is allowed to wear the badge; null when nobody can. */
export function bestDeal<T>(ordered: T[], o: { hasTrade: boolean; eligible: (t: T) => boolean }): T | null {
  return ordered.find((t) => !o.hasTrade || o.eligible(t)) ?? null;
}
