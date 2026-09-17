/**
 * The buyer's counter to one dealer's quote — since 2026-09-17 an edited
 * copy of the dealer's own sheet (lib/counterSheet.ts), scoped to that
 * quote. parseCounterEdits sanitises what the browser sends;
 * buildCounterFromEdits re-applies it to the quote on file. The legacy
 * parser and summary remain for counters stored before the sheet.
 *
 * Copy rule: "Send a counter — request, not a binding bid." Never auction
 * or bid-war language.
 */
import { LEASE_MILES, LEASE_TERMS, type LeaseQuote, type LineItem } from "./leaseQuote";
import type { BuyerCounter } from "./rfq";
import { applyCashCounter, applyFinanceCounter, applyLeaseCounter, changedKeys, counterSheetSummary, validateCounterSheet, type CounterKind, type CounterSheet, type LeaseCounterEdits, type UsedCounterEdits } from "./counterSheet";
import type { UsedQuote } from "./usedQuote";

export const COUNTER_COPY = "Send a counter — request, not a binding bid.";

// ---------------------------------------------------------------------------
// The editable-sheet counter (2026-09-17): what the browser sends is the
// dealer's quote id plus the buyer's edits; the server re-applies them to
// the quote it has on file, validates, and stores before/after.
// ---------------------------------------------------------------------------

export interface CounterEditsPayload {
  againstQuoteId: string;
  edits: LeaseCounterEdits | UsedCounterEdits;
  note?: string | null;
}

const lineItems = (raw: unknown): LineItem[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      const amount = typeof o.amount === "number" ? o.amount : typeof o.amount === "string" ? Number(String(o.amount).replace(/[$,\s]/g, "")) : NaN;
      return { name: typeof o.name === "string" ? o.name.trim().slice(0, 80) : "", amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN };
    })
    .filter((i) => i.name && Number.isFinite(i.amount))
    .slice(0, 20);
};
const moneyOf = (raw: unknown): number | undefined => {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
};

/** Sanitize the browser's edits for one quote kind — numbers and named lines only, nothing else gets through. */
export function parseCounterEdits(raw: unknown, kind: CounterKind): CounterEditsPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const againstQuoteId = String(o.againstQuoteId || "");
  if (!againstQuoteId) return null;
  const e = (o.edits && typeof o.edits === "object" ? o.edits : {}) as Record<string, unknown>;
  const note = typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 300) : null;
  if (kind === "lease") {
    const edits: LeaseCounterEdits = {};
    const capCost = moneyOf(e.capCost); if (capCost !== undefined) edits.capCost = capCost;
    const capReduction = moneyOf(e.capReduction); if (capReduction !== undefined) edits.capReduction = capReduction;
    const addOns = lineItems(e.addOns); if (addOns) edits.addOns = addOns;
    const incentives = lineItems(e.incentives); if (incentives) edits.incentives = incentives;
    const otherFees = lineItems(e.otherFees); if (otherFees) edits.otherFees = otherFees;
    return { againstQuoteId, edits, note };
  }
  const edits: UsedCounterEdits = {};
  const sellingPrice = moneyOf(e.sellingPrice); if (sellingPrice !== undefined) edits.sellingPrice = sellingPrice;
  const downPayment = moneyOf(e.downPayment); if (downPayment !== undefined) edits.downPayment = downPayment;
  const addOns = lineItems(e.addOns); if (addOns) edits.addOns = addOns;
  const rebates = lineItems(e.rebates); if (rebates) edits.rebates = rebates;
  const dueAtSigning = lineItems(e.dueAtSigning); if (dueAtSigning) edits.dueAtSigning = dueAtSigning;
  return { againstQuoteId, edits, note };
}

/** Apply the buyer's edits to the dealer's quote on file, validate, and build the stored counter. */
export function buildCounterFromEdits(
  quote: { lease?: LeaseQuote | null; used?: UsedQuote | null },
  payload: CounterEditsPayload,
  now = new Date()
): { counter: BuyerCounter | null; errors: string[] } {
  let sheet: Omit<CounterSheet, "changed"> | null = null;
  if (quote.lease) sheet = { kind: "lease", before: quote.lease, after: applyLeaseCounter(quote.lease, payload.edits as LeaseCounterEdits) };
  else if (quote.used?.kind === "finance") sheet = { kind: "finance", before: quote.used, after: applyFinanceCounter(quote.used, payload.edits as UsedCounterEdits) };
  else if (quote.used?.kind === "cash") sheet = { kind: "cash", before: quote.used, after: applyCashCounter(quote.used, payload.edits as UsedCounterEdits) };
  if (!sheet) return { counter: null, errors: ["This dealer has no current quote to counter."] };
  const errors = validateCounterSheet(sheet);
  if (errors.length) return { counter: null, errors };
  const full: CounterSheet = { ...sheet, changed: changedKeys(sheet) };
  return { counter: { againstQuoteId: payload.againstQuoteId, sheet: full, note: payload.note ?? null, sentAt: now.toISOString() }, errors: [] };
}

/** One line for badges and the dealer's page. Sheet counters: "Cap cost −$1,500 · Doc fee struck → $612/mo (was $648/mo)"; legacy asks: "≤ $650/mo · 39 mo". */
export function counterSummary(c: BuyerCounter): string {
  if (c.sheet) return counterSheetSummary(c.sheet);
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
