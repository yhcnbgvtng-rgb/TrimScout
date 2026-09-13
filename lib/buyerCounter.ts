/**
 * The buyer's counter to one dealer's lease quote: structured fields only,
 * scoped to that quote. Validation shared by the form and the route.
 *
 * Copy rule: "Send a counter — request, not a binding bid." Never auction
 * or bid-war language.
 */
import { LEASE_MILES, LEASE_TERMS, type LeaseQuote, type LeaseRequestPrefs } from "./leaseQuote";
import type { BuyerCounter } from "./rfq";

export const COUNTER_COPY = "Send a counter — request, not a binding bid.";

export interface CounterDraft {
  targetMonthlyMax: string;
  maxCashDueAtSigning: string;
  termMonths: string;
  milesPerYear: string;
  note: string;
}

/** Prefill from the dealer's quote (term/miles) and the buyer's ask; money fields start blank. */
export function counterDraftFrom(quote: LeaseQuote, prefs: LeaseRequestPrefs): CounterDraft {
  return {
    targetMonthlyMax: "",
    maxCashDueAtSigning: "",
    termMonths: String(quote.termMonths || prefs.termMonths),
    milesPerYear: String(quote.milesPerYear || prefs.milesPerYear),
    note: "",
  };
}

const money = (raw: string): number | null => {
  const t = (raw || "").replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

/** Build the counter or list what's wrong. At least one number (or a term/miles change) must be asked for. */
export function buildBuyerCounter(draft: CounterDraft, quote: LeaseQuote, againstQuoteId: string, now = new Date()): { counter: BuyerCounter | null; errors: string[] } {
  const errors: string[] = [];
  const target = money(draft.targetMonthlyMax);
  const maxDas = money(draft.maxCashDueAtSigning);
  const term = draft.termMonths ? Number(draft.termMonths) : null;
  const miles = draft.milesPerYear ? Number(draft.milesPerYear) : null;
  if (target != null && !(target > 0)) errors.push("Target monthly must be a number greater than 0.");
  if (maxDas != null && !(maxDas >= 0)) errors.push("Max due at signing must be 0 or more.");
  if (term != null && !(LEASE_TERMS as readonly number[]).includes(term)) errors.push("Pick a term the calculator can quote to.");
  if (miles != null && !(LEASE_MILES as readonly number[]).includes(miles)) errors.push("Pick a mileage band the calculator can quote to.");
  if (target != null && target >= quote.monthlyPaymentPreTax) errors.push(`Target monthly should be below the quoted $${Math.round(quote.monthlyPaymentPreTax).toLocaleString()}/mo — otherwise there's nothing to counter.`);
  const termChanged = term != null && term !== quote.termMonths;
  const milesChanged = miles != null && miles !== quote.milesPerYear;
  if (target == null && maxDas == null && !termChanged && !milesChanged) errors.push("Ask for something: a target monthly, a max due at signing, or a different term or miles.");
  const note = (draft.note || "").trim();
  if (note.length > 300) errors.push("Keep the note under 300 characters.");
  if (errors.length) return { counter: null, errors };
  return {
    counter: {
      againstQuoteId,
      targetMonthlyMax: target,
      maxCashDueAtSigning: maxDas,
      termMonths: termChanged ? term : null,
      milesPerYear: milesChanged ? miles : null,
      note: note || null,
      sentAt: now.toISOString(),
    },
    errors: [],
  };
}

/** One line for badges and the dealer's page: "≤ $650/mo · ≤ $1,500 due at signing · 39 mo". */
export function counterSummary(c: BuyerCounter): string {
  const parts: string[] = [];
  if (c.targetMonthlyMax != null) parts.push(`≤ $${c.targetMonthlyMax.toLocaleString()}/mo`);
  if (c.maxCashDueAtSigning != null) parts.push(`≤ $${c.maxCashDueAtSigning.toLocaleString()} due at signing`);
  if (c.termMonths != null) parts.push(`${c.termMonths} mo`);
  if (c.milesPerYear != null) parts.push(`${c.milesPerYear.toLocaleString()} mi/yr`);
  return parts.join(" · ");
}

/** Parse an untrusted body into a counter, or null. */
export function parseBuyerCounter(raw: unknown): BuyerCounter | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  const term = num(o.termMonths);
  const miles = num(o.milesPerYear);
  const c: BuyerCounter = {
    againstQuoteId: String(o.againstQuoteId || ""),
    targetMonthlyMax: num(o.targetMonthlyMax),
    maxCashDueAtSigning: num(o.maxCashDueAtSigning),
    termMonths: term != null && (LEASE_TERMS as readonly number[]).includes(term) ? term : null,
    milesPerYear: miles != null && (LEASE_MILES as readonly number[]).includes(miles) ? miles : null,
    note: typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 300) : null,
    sentAt: new Date().toISOString(),
  };
  if (!c.againstQuoteId) return null;
  if ((c.targetMonthlyMax != null && c.targetMonthlyMax <= 0) || (c.maxCashDueAtSigning != null && c.maxCashDueAtSigning < 0)) return null;
  if (c.targetMonthlyMax == null && c.maxCashDueAtSigning == null && c.termMonths == null && c.milesPerYear == null) return null;
  return c;
}
