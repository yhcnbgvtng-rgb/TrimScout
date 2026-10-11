/**
 * The dealer saying yes to a buyer's counter on a cash quote.
 *
 * The counter is already the dealer's own sheet with the buyer's price-side
 * edits (lib/counterSheet.ts), so accepting is a revised quote that equals
 * counter.sheet.after in every line except sales tax — the one line the
 * dealer may update, prefilled at the rate of their original quote. The
 * route rebuilds the stored quote from the counter on file and uses the
 * browser's submission only for the tax amounts, after verifyAcceptedQuote
 * rejects anything else that moved. Doc fee and title & registration stay
 * locked because they are simply required to equal the counter's.
 *
 * Pure and client-safe: the confirm step and the route share these.
 */
import type { BuyerCounter } from "./rfq";
import { counterPriceChanged, isTaxLine } from "./counterSheet";
import type { LineItem } from "./leaseQuote";
import { sumItems } from "./leaseMath";
import { cashOutTheDoor, type QuotePrefs, type UsedCashQuote, type UsedQuote } from "./usedQuote";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Stamped on the dealer's revised quote when it answers a counter by accepting it. */
export interface CounterAcceptance {
  /** The counter's sentAt — which counter this accepted. */
  counterSentAt: string;
  acceptedAt: string;
}

export const COUNTER_ACCEPTED_HEADLINE = "Dealer accepted your counter";

/** A counter this dealer can accept in one step: a cash quote with a sheet counter. */
export function acceptableCashCounter(prefs: QuotePrefs | null | undefined, counter: BuyerCounter | null | undefined): (BuyerCounter & { sheet: NonNullable<BuyerCounter["sheet"]> }) | null {
  if (prefs?.quoteType !== "cash" || !counter?.sheet || counter.sheet.kind !== "cash") return null;
  return counter as BuyerCounter & { sheet: NonNullable<BuyerCounter["sheet"]> };
}

const taxableBase = (q: Pick<UsedCashQuote, "sellingPrice" | "addOns">) => q.sellingPrice + sumItems(q.addOns);
const taxTotal = (lines: LineItem[]) => lines.filter((l) => isTaxLine(l.name)).reduce((t, l) => t + l.amount, 0);

/** The dealer's own effective rate: tax on their original quote ÷ its taxable amount (price + add-ons); null when there is nothing to divide by. */
export function originalTaxRate(before: UsedCashQuote): number | null {
  const base = taxableBase(before);
  return base > 0 ? taxTotal(before.dueAtSigning) / base : null;
}

/** Did the counter move what tax is charged on (price or add-ons)? */
export function taxBaseChanged(before: UsedCashQuote, after: UsedCashQuote): boolean {
  return counterPriceChanged({ kind: "cash", before, after }) || Math.abs(sumItems(after.addOns) - sumItems(before.addOns)) >= 0.005;
}

/** The tax to prefill: unchanged when the taxable amount didn't move, otherwise the original rate on the counter's amount. */
export function prefillTax(before: UsedCashQuote, after: UsedCashQuote): number {
  const rate = originalTaxRate(before);
  if (rate == null || !taxBaseChanged(before, after)) return r2(taxTotal(before.dueAtSigning));
  return r2(Math.max(0, rate * taxableBase(after)));
}

/** The counter's sheet with the tax line set to `tax` and the acceptance stamped — what the dealer reviews and what gets stored. */
export function buildAcceptedQuote(after: UsedCashQuote, tax: number, counterSentAt: string, now: Date = new Date()): UsedCashQuote {
  let placed = false;
  const dueAtSigning = after.dueAtSigning.map((l) => {
    if (placed || !isTaxLine(l.name)) return l;
    placed = true;
    return { ...l, amount: r2(tax) };
  });
  return { ...after, dueAtSigning, counterAccepted: { counterSentAt, acceptedAt: now.toISOString() } };
}

const canon = (lines: LineItem[] | undefined | null) =>
  (lines || [])
    .map((l) => `${String(l?.name ?? "").trim().toLowerCase()}|${Number(l?.amount).toFixed(2)}`)
    .sort()
    .join(";");

/**
 * What the server checks before storing an acceptance: everything except the
 * tax amounts equals the buyer's counter. Returns the reasons it doesn't.
 */
export function verifyAcceptedQuote(submitted: Partial<UsedQuote> | null | undefined, counter: BuyerCounter): string[] {
  const after = counter.sheet?.after as UsedCashQuote | undefined;
  if (!submitted || !after || counter.sheet?.kind !== "cash" || after.kind !== "cash") return ["There is no cash counter to accept."];
  const errors: string[] = [];
  const diff = (what: string) => errors.push(`${what} must match the buyer's counter exactly — only sales tax can change.`);
  if (submitted.kind !== "cash") diff("The quote type");
  if (!(typeof submitted.sellingPrice === "number") || Math.abs(submitted.sellingPrice - after.sellingPrice) >= 0.005) diff("The selling price");
  if (canon(submitted.addOns) !== canon(after.addOns)) diff("Add-ons");
  if (Boolean(submitted.noAddOns) !== Boolean(after.noAddOns)) diff("The add-ons confirmation");
  if (canon(submitted.rebates) !== canon(after.rebates)) diff("Rebates");
  const subDas = Array.isArray(submitted.dueAtSigning) ? submitted.dueAtSigning : [];
  if (canon(subDas.filter((l) => !isTaxLine(String(l?.name ?? "")))) !== canon(after.dueAtSigning.filter((l) => !isTaxLine(l.name)))) diff("Doc fee, title & registration and the other fees");
  const subTax = subDas.filter((l) => isTaxLine(String(l?.name ?? "")));
  const afterTax = after.dueAtSigning.filter((l) => isTaxLine(l.name));
  if (subTax.length !== afterTax.length || subTax.some((l, i) => String(l.name).trim() !== afterTax[i].name.trim())) diff("The sales-tax line names");
  else if (!subTax.every((l) => typeof l.amount === "number" && Number.isFinite(l.amount) && l.amount >= 0)) errors.push("Sales tax must be $0 or more.");
  if ((submitted.miles ?? null) !== (after.miles ?? null)) diff("Miles");
  if (Boolean(submitted.cpo) !== Boolean(after.cpo)) diff("CPO");
  const exp = (v: unknown) => (typeof v === "string" ? new Date(v).getTime() : NaN);
  if (exp(submitted.expiresAt) !== exp(after.expiresAt)) diff("The good-until date");
  return errors;
}

/** The final out-the-door the dealer confirms and the buyer is told. */
export function acceptedOutTheDoor(q: Pick<UsedCashQuote, "sellingPrice" | "dueAtSigning" | "addOns" | "rebates">): number {
  return cashOutTheDoor(q);
}
