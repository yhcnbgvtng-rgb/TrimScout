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
 *   due at signing   = first month + acquisition + cap reduction + taxes + fees
 *                      + security deposit + add-ons due at signing
 *   net cap cost     = selling price + rolled fees + rolled add-ons (+ rolled acquisition)
 *                      − incentives − cap reduction
 */
import type { DueAtSigning, LeaseTaxMethod, LineItem } from "./leaseQuote";

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
  securityDeposit?: number | null;
  addOnsDue?: LineItem[];
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
    ...(args.securityDeposit != null ? { securityDeposit: args.securityDeposit } : {}),
    ...(args.addOnsDue ? { addOnsDue: args.addOnsDue.filter((f) => f.name.trim() && Number.isFinite(f.amount)) } : {}),
  };
}

export function dasTotal(d: DueAtSigning | null): number | null {
  if (!d) return null;
  const sum = d.firstMonth + d.acquisitionFee + d.capReduction + d.taxes + d.otherFees.reduce((t, f) => t + f.amount, 0) + (d.securityDeposit ?? 0) + (d.addOnsDue || []).reduce((t, f) => t + f.amount, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Total lease cost = (monthly with tax × term) + due at signing − the first month
 * already counted in due at signing − the refundable security deposit + the
 * disposition fee. The deposit is paid at signing (so it is in due at signing) but
 * comes back, so it is not a cost of the lease.
 */
export function totalLeaseCost(monthly: number | null, termMonths: number | null, das: DueAtSigning | null, dispositionFee: number = 0): number | null {
  if (monthly == null || termMonths == null || termMonths <= 0 || !das) return null;
  const total = dasTotal(das)!;
  return Math.round((monthly * termMonths + total - das.firstMonth - (das.securityDeposit ?? 0) + (dispositionFee || 0)) * 100) / 100;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Net cap cost the way the dealer form calculates it (and the server re-checks it). Null until there is a selling price. */
export function calcNetCap(args: {
  sellingPrice: number | null;
  incentivesTotal: number;
  rolledFeesTotal: number;
  rolledAddOnsTotal: number;
  acquisitionRolled: number;
  capReduction: number | null;
}): number | null {
  if (args.sellingPrice == null || args.sellingPrice <= 0) return null;
  return r2(args.sellingPrice + args.rolledFeesTotal + args.rolledAddOnsTotal + args.acquisitionRolled - args.incentivesTotal - (args.capReduction ?? 0));
}

/**
 * Apply the dealer's tax method. `taxableAtSigning` is the sum of taxable fee and add-on
 * lines due at signing. Rolled taxable lines are already in the cap cost.
 *   monthly            → tax rides on each payment; at signing: tax on the cap reduction + taxable signing lines
 *   upfront_payments   → one tax on (monthly × term) + taxable signing lines, paid at signing; payments untaxed
 *   upfront_cap_cost   → one tax on the gross cap cost + taxable signing lines, paid at signing; payments untaxed
 *   other              → payments taxed at the rate like "monthly"; the dealer types the signing tax
 * A typed `taxesOverride` always wins for the amount due at signing. Null rate = no estimate.
 */
export function computeLeaseTax(args: {
  method: LeaseTaxMethod | null | undefined;
  taxRate: number | null;
  monthly: number | null;
  termMonths: number | null;
  grossCapCost: number | null;
  capReduction: number | null;
  taxableAtSigning: number;
  taxesOverride: number | null;
}): { monthlyTaxed: number | null; taxesAtSigning: number } {
  const { method, taxRate, monthly, termMonths, grossCapCost, capReduction, taxableAtSigning, taxesOverride } = args;
  if (taxRate == null || taxRate < 0 || monthly == null) return { monthlyTaxed: null, taxesAtSigning: taxesOverride ?? 0 };
  if (method === "upfront_payments") {
    const base = monthly * (termMonths && termMonths > 0 ? termMonths : 0) + taxableAtSigning;
    return { monthlyTaxed: monthly, taxesAtSigning: taxesOverride ?? r2(base * taxRate) };
  }
  if (method === "upfront_cap_cost") {
    const base = (grossCapCost ?? 0) + taxableAtSigning;
    return { monthlyTaxed: monthly, taxesAtSigning: taxesOverride ?? r2(base * taxRate) };
  }
  const base = (capReduction ?? 0) + taxableAtSigning;
  return { monthlyTaxed: monthlyWithTax(monthly, taxRate), taxesAtSigning: taxesOverride ?? (method === "other" ? 0 : r2(base * taxRate)) };
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

/** "53%" / "58.5%" / "6.625%" — up to three decimals, so state tax rates like NJ's survive; null for blank. */
export function formatPercentInput(raw: string | number | null | undefined): string {
  const n = num(raw);
  if (n == null) return "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
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
