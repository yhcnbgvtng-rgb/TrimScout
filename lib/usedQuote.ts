/**
 * Used-car quote types (v1: Finance and Cash — no used lease yet) and the
 * dealer sheets that quote against them. Same discipline as the lease
 * calculator: structured fields only, itemized due-at-signing (never one
 * unlabeled lump), and a future expiry. A request, not a bid.
 */
import type { LeaseTimeline, LineItem } from "./leaseQuote";

export type UsedQuoteType = "finance" | "cash";
export const FINANCE_TERMS = [36, 48, 60, 72, 84] as const;
export type CreditBand = "excellent" | "good" | "fair" | "rebuilding";

export interface FinancePrefs {
  termMonths: number;
  downPayment: number;
  creditBand?: CreditBand | null;
  zip: string;
  timeline?: LeaseTimeline | null;
}
export interface CashPrefs {
  zip: string;
  timeline?: LeaseTimeline | null;
}
export type QuotePrefs = { quoteType: "finance"; finance: FinancePrefs } | { quoteType: "cash"; cash: CashPrefs };

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
    if (!(FINANCE_TERMS as readonly number[]).includes(term) || !Number.isFinite(down) || down < 0 || !zip) return null;
    const band = f.creditBand === "excellent" || f.creditBand === "good" || f.creditBand === "fair" || f.creditBand === "rebuilding" ? f.creditBand : null;
    return { quoteType: "finance", finance: { termMonths: term, downPayment: Math.round(down), creditBand: band, zip, timeline: tlOf(f.timeline) } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dealer sheets
// ---------------------------------------------------------------------------
interface UsedQuoteBase {
  sellingPrice: number;
  /** Itemized — taxes, doc fee, title/registration, each named. Never one lump. */
  dueAtSigning: LineItem[];
  miles: number;
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
  creditAssumption: CreditBand | "unknown";
  counter: { counterOffer: boolean; note: string };
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
const LUMP_RE = /^(due|total|dueatsigning|das|down|other|misc|fees?|taxesandfees)$/i;

/** The submit gate for a used Finance / Cash sheet — mirrored on the dealer form and the server. */
export function validateUsedQuote(
  q: Partial<UsedQuote>,
  prefs: QuotePrefs,
  vinOrStock: { vin?: string | null; stockNumber?: string | null },
  now: Date = new Date()
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!(vinOrStock.vin || "").trim() && !(vinOrStock.stockNumber || "").trim()) errors.push("VIN or stock number is required.");
  if (q.kind !== prefs.quoteType) errors.push(`The buyer asked for a ${prefs.quoteType} quote.`);
  if (!pos(q.sellingPrice)) errors.push("Selling price must be greater than 0.");
  if (!nonneg(q.miles)) errors.push("Miles on the car are required (0 or more).");
  const das = Array.isArray(q.dueAtSigning) ? q.dueAtSigning : null;
  if (!das) errors.push("Due at signing must be itemized — taxes, doc fee, title and registration, each named.");
  else {
    if (!das.every((f) => f && typeof f.name === "string" && nonneg(f.amount))) errors.push("Every due-at-signing line needs a name and an amount (0 or more).");
    const positive = das.filter((f) => f && f.amount > 0);
    if (positive.length === 1 && LUMP_RE.test((positive[0].name || "").replace(/[^a-z]/gi, ""))) errors.push("Due at signing can't be a single unlabeled lump — itemize it.");
    if (das.some((f) => f && f.amount > 0 && (f.name || "").trim().length < 3)) warnings.push("Some fees have unclear names — buyers compare these line by line.");
  }
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
    if (!f.creditAssumption) errors.push("Say which credit tier this rate assumes (or 'unknown').");
    const termDiffers = pos(f.termMonths) && f.termMonths !== prefs.finance.termMonths;
    const downDiffers = nonneg(f.downPayment) && Math.round(f.downPayment) !== prefs.finance.downPayment;
    if (termDiffers || downDiffers) {
      if (!f.counter?.counterOffer) errors.push(`Term/down differ from the buyer's ${prefs.finance.termMonths} mo / $${prefs.finance.downPayment.toLocaleString()} down — mark it as a counter-offer to submit.`);
      else if (!(f.counter.note || "").trim()) errors.push("A counter-offer needs a short note saying why.");
    }
  }
  return { errors, warnings };
}

/** Buyer-comparable out-the-door figure for a cash quote: selling price + itemized due at signing. */
export function cashOutTheDoor(q: Pick<UsedCashQuote, "sellingPrice" | "dueAtSigning">): number {
  return Math.round((q.sellingPrice + dueAtSigningSum(q.dueAtSigning)) * 100) / 100;
}

export function isFinanceCounter(q: Pick<UsedFinanceQuote, "termMonths" | "downPayment">, prefs: FinancePrefs): boolean {
  return q.termMonths !== prefs.termMonths || Math.round(q.downPayment) !== prefs.downPayment;
}
