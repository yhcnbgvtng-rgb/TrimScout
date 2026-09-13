/**
 * The lease calculator's arithmetic — the standard closed-end lease formula
 * every consumer calculator uses (depreciation + rent charge), with nothing
 * proprietary. Every function answers `null` until the inputs it needs are
 * real numbers, so the UI can stay blank instead of showing $0 noise.
 *
 *   net cap cost     = cap cost − cap reduction − incentives
 *   residual $       = MSRP × residual %            (when MSRP is known)
 *   depreciation/mo  = (net cap − residual $) ÷ term
 *   rent charge/mo   = (net cap + residual $) × money factor
 *   monthly (pre-tax)= depreciation + rent
 *   monthly w/ tax   = monthly × (1 + rate)         (monthly-tax states)
 *   due at signing   = first month + acquisition + cap reduction + taxes + other fees
 */
import type { DueAtSigning, LineItem } from "./leaseQuote";

/** "1,234.5" / "$1,234" → 1234.5; blank or junk → null. */
export function num(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const text = (raw ?? "").toString().replace(/[$,%\s]/g, "");
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function sumItems(items: Array<{ amount: number | null | string }>): number {
  return items.reduce((t, i) => t + (num(i.amount) ?? 0), 0);
}

export function netCapCost(args: { capCost: number | null; capReduction: number | null; incentivesTotal: number }): number | null {
  if (args.capCost == null || args.capCost <= 0) return null;
  return args.capCost - (args.capReduction ?? 0) - args.incentivesTotal;
}

/** Residual dollars from MSRP × %. Null without an MSRP — the dealer then types the amount. */
export function residualAmountFrom(msrp: number | null, residualPercent: number | null): number | null {
  if (msrp == null || msrp <= 0 || residualPercent == null || residualPercent <= 0 || residualPercent > 100) return null;
  return Math.round(msrp * (residualPercent / 100));
}

export function monthlyPreTax(args: {
  netCap: number | null;
  residualAmount: number | null;
  moneyFactor: number | null;
  termMonths: number | null;
}): number | null {
  const { netCap, residualAmount, moneyFactor, termMonths } = args;
  if (netCap == null || residualAmount == null || residualAmount < 0 || moneyFactor == null || moneyFactor <= 0 || termMonths == null || termMonths <= 0) return null;
  const depreciation = (netCap - residualAmount) / termMonths;
  const rent = (netCap + residualAmount) * moneyFactor;
  const m = depreciation + rent;
  return m > 0 ? Math.round(m * 100) / 100 : null;
}

export function monthlyWithTax(monthly: number | null, taxRate: number | null): number | null {
  if (monthly == null || taxRate == null || taxRate < 0) return null;
  return Math.round(monthly * (1 + taxRate) * 100) / 100;
}

/** APR-equivalent of a money factor: MF × 2400, one decimal. */
export function aprFromMf(moneyFactor: number | null): number | null {
  if (moneyFactor == null || moneyFactor <= 0) return null;
  return Math.round(moneyFactor * 2400 * 10) / 10;
}

/**
 * Due at signing, itemized. First month is the taxed monthly when a rate
 * is known, else the pre-tax monthly; taxes default to tax on the cap
 * reduction (what most monthly-tax states collect up front) unless the
 * dealer typed a figure. Null until there's a monthly to put in it.
 */
export function dueAtSigningFrom(args: {
  monthly: number | null;
  monthlyTaxed: number | null;
  acquisitionFee: number | null;
  capReduction: number | null;
  taxesOverride: number | null;
  taxRate: number | null;
  otherFees: LineItem[];
}): DueAtSigning | null {
  const first = args.monthlyTaxed ?? args.monthly;
  if (first == null) return null;
  const capReduction = args.capReduction ?? 0;
  const taxes = args.taxesOverride ?? (args.taxRate != null ? Math.round(capReduction * args.taxRate * 100) / 100 : 0);
  return {
    firstMonth: first,
    acquisitionFee: args.acquisitionFee ?? 0,
    capReduction,
    taxes,
    otherFees: args.otherFees.filter((f) => f.name.trim() && Number.isFinite(f.amount)),
  };
}

export function dasTotal(d: DueAtSigning | null): number | null {
  if (!d) return null;
  return Math.round((d.firstMonth + d.acquisitionFee + d.capReduction + d.taxes + d.otherFees.reduce((t, f) => t + f.amount, 0)) * 100) / 100;
}

/** Total lease cost = monthly × term + due at signing − the first month already counted in DAS. */
export function totalLeaseCost(monthly: number | null, termMonths: number | null, das: DueAtSigning | null): number | null {
  if (monthly == null || termMonths == null || termMonths <= 0 || !das) return null;
  const total = dasTotal(das)!;
  return Math.round((monthly * termMonths + total - das.firstMonth) * 100) / 100;
}

export function effectiveMonthly(total: number | null, termMonths: number | null): number | null {
  if (total == null || termMonths == null || termMonths <= 0) return null;
  return Math.round((total / termMonths) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Display formatting for the calculator inputs: what the dealer sees while
// typing is "$75,000" / "53%" / "0.00250"; what's stored is the number.
// ---------------------------------------------------------------------------

/** "$75,000" for whole dollars, "$1,234.50" when there are cents; null for blank. */
export function formatMoneyInput(raw: string | number | null | undefined): string {
  const n = num(raw);
  if (n == null) return "";
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** "53%" / "58.5%"; null for blank. */
export function formatPercentInput(raw: string | number | null | undefined): string {
  const n = num(raw);
  if (n == null) return "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

/** Money factors keep at least 5 decimals ("0.00250") — the precision dealers quote them at. */
export function formatMoneyFactorInput(raw: string | number | null | undefined): string {
  const n = num(raw);
  if (n == null) return "";
  const s = n.toFixed(Math.max(5, (String(raw ?? "").split(".")[1] || "").length));
  return s;
}

/** Net capitalized cost the way a lease worksheet builds it: selling price − incentives + capitalized fees. */
export function netCapFromWorksheet(args: { sellingPrice: number | null; incentivesTotal: number; capitalizedFees: number }): number | null {
  if (args.sellingPrice == null || args.sellingPrice <= 0) return null;
  return Math.round((args.sellingPrice - args.incentivesTotal + args.capitalizedFees) * 100) / 100;
}
