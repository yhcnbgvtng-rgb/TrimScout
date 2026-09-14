/**
 * Finance / Cash quote requests (new and used cars) and the dealer sheets
 * that quote against them. The buyer locks term, down payment, credit band
 * and ZIP up front; every dealer quotes to the same locks so the sheets
 * are apples to apples. Same discipline as the lease calculator:
 * structured fields only, itemized due-at-signing (never one unlabeled
 * lump), add-ons as their own lines or an explicit "none", and a future
 * expiry. A request, not a bid.
 */
import type { LeaseTimeline, LineItem } from "./leaseQuote";
import { parseCreditBand, type CreditBand } from "./creditBand";

export type UsedQuoteType = "finance" | "cash";
export const FINANCE_TERMS = [36, 48, 60, 72, 84] as const;
export type { CreditBand } from "./creditBand";
export { CREDIT_BANDS, CREDIT_BAND_LABELS, CREDIT_BAND_COPY, parseCreditBand } from "./creditBand";

/** The buyer's finance locks. Every field is required before send; dealers must quote to term + down + band. */
export interface FinancePrefs {
  termMonths: number;
  downPayment: number;
  creditBand: CreditBand;
  zip: string;
  timeline?: LeaseTimeline | null;
}
export interface CashPrefs {
  zip: string;
  timeline?: LeaseTimeline | null;
}
export type QuotePrefs = { quoteType: "finance"; finance: FinancePrefs } | { quoteType: "cash"; cash: CashPrefs };

/** What's still missing from a finance ask, in the order the form shows them — empty means the locks are complete. */
export function missingFinanceLocks(p: { termMonths?: number | "" | null; downPayment?: string | number | null; creditBand?: string | null; zip?: string | null }): string[] {
  const out: string[] = [];
  if (!(FINANCE_TERMS as readonly number[]).includes(Number(p.termMonths))) out.push("term");
  const down = typeof p.downPayment === "number" ? p.downPayment : p.downPayment == null || String(p.downPayment).trim() === "" ? NaN : Number(String(p.downPayment).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(down) || down < 0) out.push("down payment");
  if (!parseCreditBand(p.creditBand)) out.push("credit band");
  if (!/^\d{5}$/.test(String(p.zip || "").trim())) out.push("ZIP");
  return out;
}

/** Only the terms and bands the product offers; anything else is dropped, not guessed. */
export function parseQuotePrefs(raw: unknown): QuotePrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const zipOf = (v: unknown) => (typeof v === "string" && /^\d{5}$/.test(v) ? v : "");
  const tlOf = (v: unknown): LeaseTimeline | null => (v === "asap" || v === "this_week" || v === "this_month" ? v : null);
  if (o.quoteType === "cash") {
    const c = (o.cash || {}) as Record<string, unknown>;
    const zip = zipOf(c.zip);
    if (!zip) return null;
    return { quoteType: "cash", cash: { zip, timeline: tlOf(c.timeline) } };
  }
  if (o.quoteType === "finance") {
    const f = (o.finance || {}) as Record<string, unknown>;
    const term = Number(f.termMonths);
    const down = Number(f.downPayment);
    const zip = zipOf(f.zip);
    const band = parseCreditBand(f.creditBand);
    // Term, down, band and ZIP are all locks — a finance ask without any one of them can't be quoted apples to apples.
    if (!(FINANCE_TERMS as readonly number[]).includes(term) || !Number.isFinite(down) || down < 0 || !zip || !band) return null;
    return { quoteType: "finance", finance: { termMonths: term, downPayment: Math.round(down), creditBand: band, zip, timeline: tlOf(f.timeline) } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dealer sheets
// ---------------------------------------------------------------------------
interface UsedQuoteBase {
  sellingPrice: number;
  /** Itemized — sales tax, doc fee, title/registration, each named. Never one lump. */
  dueAtSigning: LineItem[];
  /** Dealer add-ons, each its own line — or none, said explicitly. Never buried in price or payment. */
  addOns: LineItem[];
  noAddOns: boolean;
  /** Rebates / incentives the dealer is applying, each named. Reduce cash due at signing. */
  rebates?: LineItem[];
  /** Used cars only — null on a new car. */
  miles: number | null;
  stockNumber: string | null;
  cpo: boolean;
  /** ISO timestamp; must be in the future when submitted. */
  expiresAt: string;
  notes?: string | null;
}
export interface UsedCashQuote extends UsedQuoteBase {
  kind: "cash";
}
export interface UsedFinanceQuote extends UsedQuoteBase {
  kind: "finance";
  downPayment: number;
  tradeEquity?: number | null;
  amountFinanced: number;
  apr: number;
  termMonths: number;
  monthlyPaymentPreTax: number;
  /** Null when the dealer can't estimate tax — shown as "tax estimated at signing". */
  monthlyPaymentWithEstTax: number | null;
  lenderName?: string | null;
}
export type UsedQuote = UsedCashQuote | UsedFinanceQuote;

export function dueAtSigningSum(items: LineItem[] | null | undefined): number {
  return (items || []).reduce((t, i) => t + (Number.isFinite(i.amount) ? i.amount : 0), 0);
}

/** Standard amortized payment: P × r / (1 − (1+r)^−n); 0% APR is just P / n. */
export function financeMonthly(amountFinanced: number, apr: number, termMonths: number): number | null {
  if (!(amountFinanced > 0) || !(termMonths > 0) || apr < 0 || !Number.isFinite(apr)) return null;
  const r = apr / 100 / 12;
  const m = r === 0 ? amountFinanced / termMonths : (amountFinanced * r) / (1 - Math.pow(1 + r, -termMonths));
  return Math.round(m * 100) / 100;
}

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonneg = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const LUMP_RE = /^(due|total|dueatsigning|das|down|other|misc|fees?|taxesandfees|otd|outthedoor)$/i;
const TAX_RE = /tax/i;

/**
 * The submit gate for a Finance / Cash sheet — mirrored on the dealer form
 * and the server. Term and down must equal the buyer's locks (no counters:
 * a different structure isn't comparable); fees itemized with a sales-tax
 * line; add-ons listed or explicitly none.
 */
export function validateUsedQuote(
  q: Partial<UsedQuote>,
  prefs: QuotePrefs,
  car: { vin?: string | null; stockNumber?: string | null; condition?: "new" | "used" | "cpo" | null },
  now: Date = new Date()
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!(car.vin || "").trim() && !(car.stockNumber || "").trim()) errors.push("VIN or stock number is required.");
  if (q.kind !== prefs.quoteType) errors.push(`The buyer asked for a ${prefs.quoteType} quote.`);
  if (!pos(q.sellingPrice)) errors.push("Selling price must be greater than 0.");
  const used = car.condition === "used" || car.condition === "cpo";
  if (used && !nonneg(q.miles)) errors.push("Miles on the car are required (0 or more).");
  const das = Array.isArray(q.dueAtSigning) ? q.dueAtSigning : null;
  if (!das) errors.push("Due at signing must be itemized — sales tax, doc fee, title and registration, each named.");
  else {
    if (!das.every((f) => f && typeof f.name === "string" && nonneg(f.amount))) errors.push("Every due-at-signing line needs a name and an amount (0 or more).");
    const positive = das.filter((f) => f && f.amount > 0);
    if (positive.length === 1 && LUMP_RE.test((positive[0].name || "").replace(/[^a-z]/gi, ""))) errors.push("Due at signing can't be a single unlabeled lump — itemize it.");
    if (!das.some((f) => f && TAX_RE.test(f.name || ""))) errors.push("Sales tax for the buyer's ZIP is required as its own line ($0 if none applies).");
    if (das.some((f) => f && f.amount > 0 && (f.name || "").trim().length < 3)) warnings.push("Some fees have unclear names — buyers compare these line by line.");
  }
  const addOns = Array.isArray(q.addOns) ? q.addOns : [];
  if (!addOns.every((a) => a && typeof a.name === "string" && a.name.trim().length >= 2 && pos(a.amount))) errors.push("Every add-on needs a name and a price above $0.");
  if (!q.noAddOns && addOns.length === 0) errors.push("Add-ons: list each one with its price, or confirm there are none.");
  if (q.noAddOns && addOns.length > 0) errors.push("Either list the add-ons or mark none — not both.");
  const rebates = Array.isArray(q.rebates) ? q.rebates : [];
  if (!rebates.every((r) => r && typeof r.name === "string" && r.name.trim().length >= 2 && pos(r.amount))) errors.push("Every rebate / incentive needs a name and an amount above $0.");
  if (!q.expiresAt || Number.isNaN(new Date(q.expiresAt).getTime())) errors.push("An expiry date is required.");
  else if (new Date(q.expiresAt).getTime() <= now.getTime()) errors.push("The expiry date must be in the future.");

  if (q.kind === "finance" && prefs.quoteType === "finance") {
    const f = q as Partial<UsedFinanceQuote>;
    if (!nonneg(f.downPayment)) errors.push("Down payment is required (0 or more).");
    if (!pos(f.amountFinanced)) errors.push("Amount financed must be greater than 0.");
    if (!(typeof f.apr === "number" && Number.isFinite(f.apr) && f.apr >= 0 && f.apr < 40)) errors.push("APR is required (0–39.99%).");
    if (!(FINANCE_TERMS as readonly number[]).includes(Number(f.termMonths))) errors.push("Pick a term the calculator can quote to.");
    if (!pos(f.monthlyPaymentPreTax)) errors.push("Monthly payment must be greater than 0 — it's calculated from the amount financed, APR and term.");
    if (f.monthlyPaymentWithEstTax != null && !pos(f.monthlyPaymentWithEstTax)) errors.push("Monthly with estimated tax must be greater than 0 when given.");
    if (pos(f.amountFinanced) && pos(f.sellingPrice) && nonneg(f.downPayment) && f.amountFinanced > f.sellingPrice - f.downPayment + dueAtSigningSum(das) + 1) {
      warnings.push("Amount financed is more than selling price − down + fees — double-check what's being rolled in.");
    }
    if (pos(f.termMonths) && f.termMonths !== prefs.finance.termMonths) errors.push(`Term must be the buyer's lock: ${prefs.finance.termMonths} months.`);
    if (nonneg(f.downPayment) && Math.round(f.downPayment) !== prefs.finance.downPayment) errors.push(`Down payment must be the buyer's lock: $${prefs.finance.downPayment.toLocaleString()}.`);
  }
  return { errors, warnings };
}

export function lineSum(items: LineItem[] | null | undefined): number {
  return dueAtSigningSum(items);
}

/**
 * Cash due at signing on a finance quote: down + fees & tax + add-ons −
 * rebates. The second ranking key next to the monthly, so a cheap payment
 * can't hide money moved to the front.
 */
export function financeCashDue(q: Pick<UsedFinanceQuote, "downPayment" | "dueAtSigning" | "addOns" | "rebates">): number {
  return Math.round((q.downPayment + dueAtSigningSum(q.dueAtSigning) + dueAtSigningSum(q.addOns) - dueAtSigningSum(q.rebates)) * 100) / 100;
}

/**
 * Compare-order for finance quotes: monthly first, then cash due at
 * signing, then amount financed; a tie on all three keeps dealer order.
 */
export function compareFinanceQuotes(a: UsedFinanceQuote, b: UsedFinanceQuote): number {
  return a.monthlyPaymentPreTax - b.monthlyPaymentPreTax || financeCashDue(a) - financeCashDue(b) || a.amountFinanced - b.amountFinanced;
}

/** Buyer-comparable out-the-door figure for a cash quote: selling price + itemized fees & tax + add-ons − rebates. */
export function cashOutTheDoor(q: Pick<UsedCashQuote, "sellingPrice" | "dueAtSigning"> & Partial<Pick<UsedCashQuote, "addOns" | "rebates">>): number {
  return Math.round((q.sellingPrice + dueAtSigningSum(q.dueAtSigning) + dueAtSigningSum(q.addOns) - dueAtSigningSum(q.rebates)) * 100) / 100;
}
