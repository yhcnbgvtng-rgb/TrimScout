/**
 * The buyer's counter as an edited copy of the dealer's own quote.
 *
 * Only price-side items move — selling price / cap cost, cash down, each
 * add-on, the doc fee, rebates. Everything the lender or the state sets
 * (money factor, residual, APR, term, miles, taxes, title/registration,
 * acquisition fee) is copied through untouched, and the bottom line is
 * recomputed with the dealer's own math, so the payment the buyer asks for
 * is one the dealer can actually write. Terms never change in a counter.
 *
 * Pure and client-safe: the form, the route and the comparison page share
 * these. Still "a request, not a binding bid".
 */
import { dasTotal, monthlyPreTax, netCapCost, sumItems } from "./leaseMath";
import type { LeaseQuote, LineItem } from "./leaseQuote";
import { cashOutTheDoor, financeMonthly, type UsedCashQuote, type UsedFinanceQuote, type UsedQuote } from "./usedQuote";

export type CounterKind = "lease" | "finance" | "cash";
export type CounterQuote = LeaseQuote | UsedQuote;

/** Names the lines that must not differ between the dealer's quote and the counter. */
export const LOCKED_FIELDS: Record<CounterKind, string[]> = {
  lease: ["moneyFactor", "residualPercent", "residualAmount", "termMonths", "milesPerYear", "acquisitionFee", "taxes", "expiresAt"],
  finance: ["apr", "termMonths", "lenderName", "expiresAt"],
  cash: ["expiresAt"],
};

/** Lines a fee list treats as "the doc fee" — the one mandatory fee a buyer may counter. */
export function isDocFee(name: string): boolean {
  return /\b(doc|documentation|dealer)\s*(fee|prep)?\b/i.test(name) && !/title|registration|tax/i.test(name);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

export interface LeaseCounterEdits {
  capCost?: number;
  capReduction?: number;
  /** Same length/order as the dealer's addOns; an amount of 0 strikes the line. */
  addOns?: LineItem[];
  /** The dealer's incentives, plus any the buyer added. */
  incentives?: LineItem[];
  /** The DAS "other fees" with the doc fee possibly lowered. */
  otherFees?: LineItem[];
}

/** The dealer's effective tax rate, recovered from their own two monthlies; null when they didn't estimate tax. */
export function impliedTaxRate(q: Pick<LeaseQuote, "monthlyPaymentPreTax" | "monthlyPaymentWithEstTax">): number | null {
  if (q.monthlyPaymentWithEstTax == null || !(q.monthlyPaymentPreTax > 0)) return null;
  return Math.max(0, q.monthlyPaymentWithEstTax / q.monthlyPaymentPreTax - 1);
}

/** The dealer's lease with the buyer's price-side edits applied and the payment recomputed by the dealer's own factors. */
export function applyLeaseCounter(before: LeaseQuote, edits: LeaseCounterEdits): LeaseQuote {
  const capReduction = edits.capReduction ?? before.capReduction;
  const addOns = (edits.addOns ?? before.addOns).filter((a) => a.name.trim());
  const incentives = (edits.incentives ?? before.incentives).filter((a) => a.name.trim());
  const otherFees = (edits.otherFees ?? before.dueAtSigning.otherFees).filter((a) => a.name.trim());
  // The dealer's calculator nets incentives into the cap cost (cap = selling price − incentives
  // + capitalised fees) and keeps add-ons as listed lines outside the payment. So: a lower cap
  // cost is the buyer's price ask, a bigger incentive lowers the cap by the difference, and the
  // payment is net cap (cap − cash down) at the dealer's own residual, money factor and term.
  const capCost = r2((edits.capCost ?? before.capCost) - (sumItems(incentives) - sumItems(before.incentives)));
  const netCap = netCapCost({ capCost, capReduction, incentivesTotal: 0 });
  const monthly = monthlyPreTax({ netCap, residualAmount: before.residualAmount, moneyFactor: before.moneyFactor, termMonths: before.termMonths }) ?? before.monthlyPaymentPreTax;
  const rate = impliedTaxRate(before);
  const monthlyTaxed = rate == null ? null : r2(monthly * (1 + rate));
  // DAS: first month follows the new monthly; cap reduction follows the edit. Taxes at signing are the
  // dealer's figure unless the cap reduction moved AND the dealer's figure was exactly tax on the old
  // cap reduction — then it scales (the implied rate is recovered from their two monthlies, so it
  // carries a cent of rounding; hence the tolerance and the "only when moved").
  const capMoved = Math.abs(capReduction - before.dueAtSigning.capReduction) >= 0.005;
  const beforeCapTax = before.dueAtSigning.capReduction > 0 && rate != null ? r2(before.dueAtSigning.capReduction * rate) : null;
  const taxes = capMoved && beforeCapTax != null && Math.abs(beforeCapTax - before.dueAtSigning.taxes) < 0.05 ? r2(capReduction * (rate as number)) : before.dueAtSigning.taxes;
  return {
    ...before,
    capCost,
    capReduction,
    addOns,
    incentives,
    monthlyPaymentPreTax: monthly,
    monthlyPaymentWithEstTax: monthlyTaxed,
    dueAtSigning: { ...before.dueAtSigning, firstMonth: monthlyTaxed ?? monthly, capReduction, taxes, otherFees },
  };
}

// ---------------------------------------------------------------------------
// Finance / cash
// ---------------------------------------------------------------------------

export interface UsedCounterEdits {
  sellingPrice?: number;
  downPayment?: number;
  addOns?: LineItem[];
  rebates?: LineItem[];
  /** The itemized due-at-signing list with the doc fee possibly lowered (tax/title lines copied through). */
  dueAtSigning?: LineItem[];
}

/** The dealer's finance quote with the buyer's edits and the payment recomputed at the dealer's APR and term. */
export function applyFinanceCounter(before: UsedFinanceQuote, edits: UsedCounterEdits): UsedFinanceQuote {
  const sellingPrice = edits.sellingPrice ?? before.sellingPrice;
  const downPayment = edits.downPayment ?? before.downPayment;
  const addOns = (edits.addOns ?? before.addOns).filter((a) => a.name.trim());
  const rebates = (edits.rebates ?? before.rebates ?? []).filter((a) => a.name.trim());
  const dueAtSigning = (edits.dueAtSigning ?? before.dueAtSigning).filter((a) => a.name.trim());
  // Amount financed moves by exactly the change in what's rolled in — the dealer's own tax/title
  // treatment (whatever it was) is preserved through the delta rather than re-derived.
  const delta = sellingPrice - before.sellingPrice + (sumItems(addOns) - sumItems(before.addOns)) + (sumItems(dueAtSigning) - sumItems(before.dueAtSigning)) - (sumItems(rebates) - sumItems(before.rebates ?? [])) - (downPayment - before.downPayment);
  const amountFinanced = Math.max(0, r2(before.amountFinanced + delta));
  const monthly = financeMonthly(amountFinanced, before.apr, before.termMonths) ?? before.monthlyPaymentPreTax;
  const rate = before.monthlyPaymentWithEstTax != null && before.monthlyPaymentPreTax > 0 ? Math.max(0, before.monthlyPaymentWithEstTax / before.monthlyPaymentPreTax - 1) : null;
  return {
    ...before,
    sellingPrice,
    downPayment,
    addOns,
    noAddOns: addOns.every((a) => !(a.amount > 0)),
    rebates,
    dueAtSigning,
    amountFinanced,
    monthlyPaymentPreTax: monthly,
    monthlyPaymentWithEstTax: rate == null ? null : r2(monthly * (1 + rate)),
  };
}

export function applyCashCounter(before: UsedCashQuote, edits: UsedCounterEdits): UsedCashQuote {
  const addOns = (edits.addOns ?? before.addOns).filter((a) => a.name.trim());
  return {
    ...before,
    sellingPrice: edits.sellingPrice ?? before.sellingPrice,
    addOns,
    noAddOns: addOns.every((a) => !(a.amount > 0)),
    rebates: (edits.rebates ?? before.rebates ?? []).filter((a) => a.name.trim()),
    dueAtSigning: (edits.dueAtSigning ?? before.dueAtSigning).filter((a) => a.name.trim()),
  };
}

// ---------------------------------------------------------------------------
// The counter itself: before + after + what changed
// ---------------------------------------------------------------------------

export interface CounterSheet {
  kind: CounterKind;
  before: CounterQuote;
  after: CounterQuote;
  /** Line keys that differ, for badges and the dealer's email. */
  changed: string[];
}

export interface DiffRow {
  key: string;
  label: string;
  before: number | null;
  after: number | null;
  /** after − before (negative is the buyer asking for less). */
  delta: number;
  /** A locked line the buyer couldn't touch. */
  locked: boolean;
  /** Follows from other lines (tax on the cap reduction) — not counted as a change, not policed as a lock. */
  derived?: boolean;
  /** The bottom line. */
  total?: boolean;
  /** How to print: money by default. */
  format?: "money" | "mf" | "pct" | "int";
}

const item = (key: string, label: string, before: number | null, after: number | null, opt: Partial<DiffRow> = {}): DiffRow => {
  const raw = (after ?? 0) - (before ?? 0);
  // Money factors live in the fourth decimal; everything else is cents.
  const delta = opt.format === "mf" ? Math.round(raw * 1e6) / 1e6 : r2(raw);
  return { key, label, before, after, delta, locked: false, ...opt };
};
/** Did this line actually move (beyond rounding)? */
export function rowMoved(r: Pick<DiffRow, "delta" | "format">): boolean {
  return Math.abs(r.delta) >= (r.format === "mf" ? 1e-6 : 0.005);
}

function lineRows(prefix: string, label: string, before: LineItem[], after: LineItem[], sign: 1 | -1 = 1): DiffRow[] {
  const names = Array.from(new Set([...before.map((x) => x.name), ...after.map((x) => x.name)]));
  return names.map((n) => {
    // A line missing on one side is 0 there: struck by the buyer, or added by them.
    const b = before.find((x) => x.name === n)?.amount ?? 0;
    const a = after.find((x) => x.name === n)?.amount ?? 0;
    return item(`${prefix}:${n}`, `${label}: ${n}`, sign * b, sign * a);
  });
}

/** Line-by-line comparison, in sheet order, ending with the bottom line(s). */
export function counterDiff(sheet: CounterSheet): DiffRow[] {
  if (sheet.kind === "lease") {
    const b = sheet.before as LeaseQuote;
    const a = sheet.after as LeaseQuote;
    return [
      item("capCost", "Cap cost (selling price)", b.capCost, a.capCost),
      ...lineRows("addOn", "Add-on", b.addOns, a.addOns),
      ...lineRows("incentive", "Incentive / rebate", b.incentives, a.incentives, -1),
      item("capReduction", "Cap reduction (cash down)", b.capReduction, a.capReduction),
      item("residualAmount", `Residual (${b.residualPercent}%)`, b.residualAmount, a.residualAmount, { locked: true }),
      item("moneyFactor", "Money factor", b.moneyFactor, a.moneyFactor, { locked: true, format: "mf" }),
      item("termMonths", "Term (months)", b.termMonths, a.termMonths, { locked: true, format: "int" }),
      item("milesPerYear", "Miles per year", b.milesPerYear, a.milesPerYear, { locked: true, format: "int" }),
      item("acquisitionFee", "Acquisition fee", b.dueAtSigning.acquisitionFee, a.dueAtSigning.acquisitionFee, { locked: true }),
      ...lineRows("fee", "Fee", b.dueAtSigning.otherFees, a.dueAtSigning.otherFees),
      item("dasTaxes", "Taxes due at signing", b.dueAtSigning.taxes, a.dueAtSigning.taxes, { locked: true, derived: true }),
      item("monthly", "Monthly (pre-tax)", b.monthlyPaymentPreTax, a.monthlyPaymentPreTax, { total: true }),
      item("monthlyTaxed", "Monthly with est. tax", b.monthlyPaymentWithEstTax, a.monthlyPaymentWithEstTax, { total: true }),
      item("das", "Due at signing", dasTotal(b.dueAtSigning), dasTotal(a.dueAtSigning), { total: true }),
    ];
  }
  const b = sheet.before as UsedQuote;
  const a = sheet.after as UsedQuote;
  const rows: DiffRow[] = [
    item("sellingPrice", "Selling price", b.sellingPrice, a.sellingPrice),
    ...lineRows("addOn", "Add-on", b.addOns, a.addOns),
    ...lineRows("fee", "Fee", b.dueAtSigning, a.dueAtSigning).map((r) => (isDocFee(r.label.replace(/^Fee: /, "")) ? r : { ...r, locked: true })),
    ...lineRows("rebate", "Rebate", b.rebates ?? [], a.rebates ?? [], -1),
  ];
  if (sheet.kind === "finance") {
    const bf = b as UsedFinanceQuote;
    const af = a as UsedFinanceQuote;
    rows.push(
      item("downPayment", "Down payment", bf.downPayment, af.downPayment),
      item("apr", "APR", bf.apr, af.apr, { locked: true, format: "pct" }),
      item("termMonths", "Term (months)", bf.termMonths, af.termMonths, { locked: true, format: "int" }),
      item("amountFinanced", "Amount financed", bf.amountFinanced, af.amountFinanced, { total: true }),
      item("monthly", "Monthly (pre-tax)", bf.monthlyPaymentPreTax, af.monthlyPaymentPreTax, { total: true }),
      item("monthlyTaxed", "Monthly with est. tax", bf.monthlyPaymentWithEstTax, af.monthlyPaymentWithEstTax, { total: true })
    );
  } else {
    rows.push(item("otd", "Out the door", cashOutTheDoor(b as UsedCashQuote), cashOutTheDoor(a as UsedCashQuote), { total: true }));
  }
  return rows;
}

export function changedKeys(sheet: Omit<CounterSheet, "changed">): string[] {
  return counterDiff({ ...sheet, changed: [] })
    .filter((r) => !r.total && !r.derived && rowMoved(r))
    .map((r) => r.key);
}

/**
 * Direction rules — what makes a counter a counter rather than nonsense:
 * price and fees only go down, add-ons only down (0 strikes), cash down may
 * move either way, rebates may be added or raised, locked lines may not
 * differ at all, and at least one line must change.
 */
export function validateCounterSheet(sheet: Omit<CounterSheet, "changed">): string[] {
  const errors: string[] = [];
  const rows = counterDiff({ ...sheet, changed: [] });
  for (const r of rows) {
    if (r.total || r.derived) continue;
    if (r.locked) {
      if (rowMoved(r)) errors.push(`${r.label} is set by the lender or the state and can't be countered.`);
      continue;
    }
    const rebateLine = r.key.startsWith("incentive:") || r.key.startsWith("rebate:");
    // Rebate lines are shown as negatives (money off); every other line is a positive amount.
    if (r.after != null && (rebateLine ? r.after > 0 : r.after < 0)) errors.push(`${r.label} can't be negative.`);
    if (r.key.startsWith("addOn:") || r.key.startsWith("fee:") || r.key === "capCost" || r.key === "sellingPrice") {
      if (r.delta > 0.005) errors.push(`${r.label}: a counter can lower this, not raise it.`);
    }
    // Shown as negatives; "more rebate" is a more negative number.
    if (rebateLine && r.delta > 0.005) errors.push(`${r.label}: a counter can add to a rebate, not shrink it.`);
  }
  if (sheet.kind === "lease") {
    const a = sheet.after as LeaseQuote;
    if (!(a.capCost > 0)) errors.push("Cap cost must stay above zero.");
    if (!(a.monthlyPaymentPreTax > 0)) errors.push("These numbers don't produce a payment — ease off a little.");
  } else if (sheet.kind === "finance") {
    const a = sheet.after as UsedFinanceQuote;
    if (!(a.sellingPrice > 0)) errors.push("Selling price must stay above zero.");
    if (!(a.amountFinanced > 0)) errors.push("Nothing left to finance — lower the down payment or ease off the price.");
  } else if (!((sheet.after as UsedCashQuote).sellingPrice > 0)) {
    errors.push("Selling price must stay above zero.");
  }
  if (errors.length === 0 && changedKeys(sheet).length === 0) errors.push("Change at least one number — otherwise there's nothing to counter.");
  return errors;
}

/** "Cap cost −$1,500 · Nitrogen struck · Doc fee −$300 → $612/mo (was $648)". */
export function counterSheetSummary(sheet: CounterSheet): string {
  const rows = counterDiff(sheet);
  const changes = rows.filter((r) => sheet.changed.includes(r.key)).map((r) => {
    const label = r.label.replace(/^(Add-on|Fee|Incentive \/ rebate|Rebate): /, "").replace(/ \(.*\)$/, "");
    if (r.after === 0 && (r.key.startsWith("addOn:") || r.key.startsWith("fee:"))) return `${label} struck`;
    return `${label} ${r.delta < 0 ? "−" : "+"}$${Math.abs(r.delta).toLocaleString()}`;
  });
  const bottom = rows.filter((r) => r.total);
  const headline = bottom.find((r) => r.key === "monthly") || bottom.find((r) => r.key === "otd");
  const tail = headline && headline.before != null && headline.after != null ? ` → $${headline.after.toLocaleString()}${headline.key === "monthly" ? "/mo" : ""} (was $${headline.before.toLocaleString()}${headline.key === "monthly" ? "/mo" : ""})` : "";
  return `${changes.join(" · ")}${tail}`;
}

export function counterKindOf(quote: { lease?: LeaseQuote | null; used?: UsedQuote | null }): CounterKind | null {
  if (quote.lease) return "lease";
  if (quote.used) return quote.used.kind;
  return null;
}
