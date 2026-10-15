/**
 * The one sales-tax base every TrimScout path shares: selling price + dealer add-ons.
 * The doc fee and title & registration are never taxed here, and never part of this base.
 *
 * Used by the dealer quote form (and its hint), the server's recomputation of that figure, the buyer's counter,
 * the dealer's accept-counter prefill and the dealer-portal out-the-door preview (calculateOtd).
 * The dealer stays responsible for confirming the tax; this is an estimate.
 *
 * Pure and client-safe.
 */
import type { LineItem } from "./leaseQuote";
import { sumItems } from "./leaseMath";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const SALES_TAX_ESTIMATE_NOTE = "Estimate only. The dealer confirms the tax.";

/** What sales tax is charged on: the selling price plus the dealer's add-ons. */
export function salesTaxBase(sellingPrice: number | null | undefined, addOns: Array<Pick<LineItem, "amount">> | null | undefined): number {
  const price = typeof sellingPrice === "number" && Number.isFinite(sellingPrice) ? sellingPrice : 0;
  return price + sumItems((addOns || []) as LineItem[]);
}

/** New Jersey's one-time luxury surcharge: 0.4% on a new car priced at $45,000 or more (dealer-sales-tax-research-2026-10-15.md, NJ row). */
export const NJ_LUXURY_SURCHARGE_RATE = 0.004;
export const NJ_LUXURY_SURCHARGE_THRESHOLD = 45000;

/** The NJ surcharge applies to a new vehicle whose selling price is at least $45,000. No other state has a special rule here. */
export function njLuxurySurchargeApplies(input: { state: string | null | undefined; isNew: boolean | null | undefined; sellingPrice: number | null | undefined }): boolean {
  return input.state === "NJ" && input.isNew === true && typeof input.sellingPrice === "number" && input.sellingPrice >= NJ_LUXURY_SURCHARGE_THRESHOLD;
}

/** Rate × (price + add-ons), plus the NJ surcharge (on the selling price) when it applies; never negative, rounded to cents. */
export function computeSalesTax(input: {
  rate: number;
  state?: string | null;
  isNew?: boolean | null;
  sellingPrice: number;
  addOns?: Array<Pick<LineItem, "amount">> | null;
}): number {
  const tax = input.rate * salesTaxBase(input.sellingPrice, input.addOns);
  const surcharge = njLuxurySurchargeApplies({ state: input.state, isNew: input.isNew, sellingPrice: input.sellingPrice }) ? input.sellingPrice * NJ_LUXURY_SURCHARGE_RATE : 0;
  return r2(Math.max(0, tax + surcharge));
}

/** A stored dealer quote is for a new car when it carries no miles (used cars always do). */
export const quoteIsNew = (q: { miles?: number | null }): boolean => q.miles == null;
