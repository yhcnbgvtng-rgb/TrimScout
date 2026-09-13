/**
 * Lease quotes — the only kind of quote in this flow. The buyer states
 * term, miles/year and ZIP; each dealer replies through a structured
 * calculator, never a free-text "monthly only" number. Everything a buyer
 * compares is derived from these fields, and nothing here is a bid.
 *
 * Pure: types, validation, derived numbers. No I/O.
 */

export const LEASE_TERMS = [24, 36, 39, 48] as const;
export type LeaseTerm = (typeof LEASE_TERMS)[number];
export const LEASE_MILES = [7500, 10000, 12000, 15000] as const;
export type LeaseMiles = (typeof LEASE_MILES)[number];
export const DEFAULT_LEASE_TERM: LeaseTerm = 36;
export type LeaseTimeline = "asap" | "this_week" | "this_month";

/** What the buyer asked for. */
export interface LeaseRequestPrefs {
  termMonths: LeaseTerm;
  milesPerYear: LeaseMiles;
  /** Tax context only — never shared with the dealer beyond the state it implies. */
  zip: string;
  timeline?: LeaseTimeline | null;
}

export interface LineItem {
  name: string;
  amount: number;
}

/** Itemized, always — a single unlabeled lump is not a quote. */
export interface DueAtSigning {
  firstMonth: number;
  acquisitionFee: number;
  capReduction: number;
  taxes: number;
  otherFees: LineItem[];
}

export interface CounterOffer {
  counterOffer: boolean;
  /** Required when term or miles differ from the buyer's prefs. */
  note: string;
}

export interface LeaseQuote {
  capCost: number;
  residualPercent: number;
  residualAmount: number;
  moneyFactor: number;
  termMonths: number;
  milesPerYear: number;
  capReduction: number;
  monthlyPaymentPreTax: number;
  /** Null when the dealer can't estimate tax — shown as "tax estimated at signing". */
  monthlyPaymentWithEstTax: number | null;
  dueAtSigning: DueAtSigning;
  incentives: LineItem[];
  addOns: LineItem[];
  /** ISO timestamp; must be in the future when submitted. */
  expiresAt: string;
  notes?: string | null;
  counter: CounterOffer;
}

/** A desk on the invite list, as the buyer sees it — masked, never a cleartext address or phone. */
export interface LeaseInvitee {
  inviteId: string | null;
  deskId: string | null;
  dealerName: string;
  city: string | null;
  state: string | null;
  contactName: string | null;
  role: string | null;
  emailMasked: string | null;
  contactReady: boolean;
  checked: boolean;
}

export function aprFromMoneyFactor(mf: number): number {
  return Math.round(mf * 2400 * 100) / 100;
}

export function dueAtSigningTotal(d: DueAtSigning): number {
  const other = (d.otherFees || []).reduce((s, f) => s + (Number(f.amount) || 0), 0);
  return (Number(d.firstMonth) || 0) + (Number(d.acquisitionFee) || 0) + (Number(d.capReduction) || 0) + (Number(d.taxes) || 0) + other;
}

export interface LeaseValidation {
  /** Blocks submission. */
  errors: string[];
  /** Shown, never blocks. */
  warnings: string[];
}

const pos = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonneg = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * The submit gate, mirrored on the dealer form and the server. Blocks on
 * anything a buyer couldn't compare on; warns on the merely unusual.
 */
export function validateLeaseQuote(
  q: Partial<LeaseQuote>,
  prefs: Pick<LeaseRequestPrefs, "termMonths" | "milesPerYear">,
  vinOrStock: { vin?: string | null; stockNumber?: string | null },
  now: Date = new Date()
): LeaseValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!(vinOrStock.vin || "").trim() && !(vinOrStock.stockNumber || "").trim()) errors.push("VIN or stock number is required.");
  if (!pos(q.capCost)) errors.push("Cap cost must be greater than 0.");
  if (!(typeof q.residualPercent === "number" && q.residualPercent > 0 && q.residualPercent <= 100)) errors.push("Residual % must be greater than 0 and at most 100.");
  else if (q.residualPercent < 40 || q.residualPercent > 70) warnings.push(`Residual ${q.residualPercent}% is outside the usual 40–70% range — double-check it.`);
  if (!nonneg(q.residualAmount)) errors.push("Residual amount is required (0 or more).");
  if (!pos(q.moneyFactor)) errors.push("Money factor is required and must be greater than 0.");
  else if (q.moneyFactor! > 0.005) warnings.push(`Money factor ${q.moneyFactor} is ${aprFromMoneyFactor(q.moneyFactor!)}% APR — unusually high; confirm it's the factor, not a percent.`);
  if (!pos(q.termMonths)) errors.push("Term (months) is required.");
  if (!pos(q.milesPerYear)) errors.push("Miles per year is required.");
  if (!nonneg(q.capReduction)) errors.push("Cap reduction is required (0 or more).");
  if (!pos(q.monthlyPaymentPreTax)) errors.push("Monthly payment (pre-tax) must be greater than 0.");
  if (q.monthlyPaymentWithEstTax != null && !pos(q.monthlyPaymentWithEstTax)) errors.push("Monthly payment with estimated tax must be greater than 0 when given.");

  const d = q.dueAtSigning;
  if (!d) errors.push("Due at signing must be itemized: first month, acquisition fee, cap reduction, taxes, other fees.");
  else {
    const parts = [d.firstMonth, d.acquisitionFee, d.capReduction, d.taxes];
    if (!parts.every(nonneg)) errors.push("Each due-at-signing line must be a number (0 or more).");
    const other = Array.isArray(d.otherFees) ? d.otherFees : [];
    if (!other.every((f) => f && typeof f.name === "string" && nonneg(f.amount))) errors.push("Every other fee needs a name and an amount.");
    const labeledLines = parts.filter((n) => nonneg(n) && n > 0).length + other.filter((f) => f && f.amount > 0).length;
    // One positive "other" line with a vague name and nothing else itemized is the lump we refuse.
    if (labeledLines === 1 && other.length === 1 && other[0].amount > 0 && /^(due|total|dueatsigning|das|down|other|misc|fees?)$/i.test((other[0].name || "").replace(/[^a-z]/gi, ""))) {
      errors.push("Due at signing can't be a single unlabeled lump — itemize first month, acquisition fee, cap reduction, taxes and fees.");
    }
    if (pos(q.monthlyPaymentPreTax) && dueAtSigningTotal(d) > 2 * q.monthlyPaymentPreTax!) warnings.push("Due at signing is more than twice the monthly payment — make sure that's intended.");
    if (other.some((f) => f && f.amount > 0 && (f.name || "").trim().length < 4)) warnings.push("Some fees have unclear names — buyers compare these line by line.");
  }
  for (const [label, list] of [["Incentive", q.incentives], ["Add-on", q.addOns]] as const) {
    if (list && !list.every((f) => f && typeof f.name === "string" && Number.isFinite(f.amount))) errors.push(`${label}s need a name and an amount.`);
    if (label === "Add-on" && list?.some((f) => f && f.amount > 0 && (f.name || "").trim().length < 4)) warnings.push("Add-ons without clear names — the buyer will see them line by line.");
  }
  if (!q.expiresAt || Number.isNaN(new Date(q.expiresAt).getTime())) errors.push("An expiry date is required.");
  else if (new Date(q.expiresAt).getTime() <= now.getTime()) errors.push("The expiry date must be in the future.");

  const termDiffers = pos(q.termMonths) && q.termMonths !== prefs.termMonths;
  const milesDiffers = pos(q.milesPerYear) && q.milesPerYear !== prefs.milesPerYear;
  if (termDiffers || milesDiffers) {
    if (!q.counter?.counterOffer) errors.push(`Term/miles differ from the buyer's ${prefs.termMonths} mo / ${prefs.milesPerYear.toLocaleString()} mi — mark it as a counter-offer to submit.`);
    else if (!(q.counter.note || "").trim()) errors.push("A counter-offer needs a short note saying why.");
  }
  return { errors, warnings };
}

/** True when the quote's term or miles differ from what the buyer asked for. */
export function isCounter(q: Pick<LeaseQuote, "termMonths" | "milesPerYear">, prefs: Pick<LeaseRequestPrefs, "termMonths" | "milesPerYear">): boolean {
  return q.termMonths !== prefs.termMonths || q.milesPerYear !== prefs.milesPerYear;
}

export function isExpired(q: Pick<LeaseQuote, "expiresAt">, now: Date = new Date()): boolean {
  const t = new Date(q.expiresAt).getTime();
  return Number.isNaN(t) || t <= now.getTime();
}

/** Coerce a form / JSON body into a LeaseQuote shape (numbers as numbers, lists as lists). Validation decides what's usable. */
export function coerceLeaseQuote(raw: Record<string, unknown>): Partial<LeaseQuote> {
  const num = (v: unknown): number | undefined => {
    if (v === "" || v == null) return undefined;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };
  const items = (v: unknown): LineItem[] =>
    Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => ({ name: String((x as LineItem).name ?? "").trim(), amount: num((x as LineItem).amount) ?? NaN })) : [];
  const d = (raw.dueAtSigning || {}) as Record<string, unknown>;
  const c = (raw.counter || {}) as Record<string, unknown>;
  return {
    capCost: num(raw.capCost),
    residualPercent: num(raw.residualPercent),
    residualAmount: num(raw.residualAmount),
    moneyFactor: num(raw.moneyFactor),
    termMonths: num(raw.termMonths),
    milesPerYear: num(raw.milesPerYear),
    capReduction: num(raw.capReduction),
    monthlyPaymentPreTax: num(raw.monthlyPaymentPreTax),
    monthlyPaymentWithEstTax: raw.monthlyPaymentWithEstTax === "" || raw.monthlyPaymentWithEstTax == null ? null : num(raw.monthlyPaymentWithEstTax) ?? null,
    dueAtSigning: raw.dueAtSigning
      ? { firstMonth: num(d.firstMonth) ?? NaN, acquisitionFee: num(d.acquisitionFee) ?? NaN, capReduction: num(d.capReduction) ?? NaN, taxes: num(d.taxes) ?? NaN, otherFees: items(d.otherFees) }
      : undefined,
    incentives: items(raw.incentives),
    addOns: items(raw.addOns),
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim().slice(0, 1000) : null,
    counter: { counterOffer: Boolean(c.counterOffer), note: typeof c.note === "string" ? c.note.trim().slice(0, 300) : "" },
  };
}

/** Human line for the compare table's term/miles cell. */
export function termMilesLabel(termMonths: number, milesPerYear: number): string {
  return `${termMonths} mo · ${milesPerYear.toLocaleString()} mi/yr`;
}

/** Copy the buyer sees for the calculator, never numbers we didn't get from the dealer. */
export const LEASE_NON_BINDING_COPY =
  "This is a non-binding lease quote request — not an auction, not a bid, and no response deadline. The dealer replies through TrimScout's lease calculator on their own time; you compare and pick one, or walk away.";
