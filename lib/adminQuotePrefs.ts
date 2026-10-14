/**
 * The admin quote editor's plain-field view of a request's quote preferences.
 * Pure: turns the stored shape (leasePrefs | quotePrefs) into form fields and
 * back, with the same validation the buyer-side parsers apply. The saved data
 * shape is unchanged: lease → `leasePrefs`; finance / cash → `quotePrefs`.
 */
import { LEASE_DAS_INTENTS, LEASE_MILES, LEASE_TERMS, parseLeasePrefs, type LeaseRequestPrefs } from "./leaseQuote";
import { CREDIT_BANDS, FINANCE_TERMS, parseQuotePrefs, type QuotePrefs } from "./usedQuote";

export type EditorQuoteType = "" | "lease" | "finance" | "cash";
export const EDITOR_QUOTE_TYPES: { value: EditorQuoteType; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "finance", label: "Finance" },
  { value: "lease", label: "Lease" },
];
export const EDITOR_TIMELINES = [
  { value: "", label: "No timeline" },
  { value: "asap", label: "As soon as possible" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
] as const;
export { CREDIT_BANDS, FINANCE_TERMS, LEASE_DAS_INTENTS, LEASE_MILES, LEASE_TERMS };

export interface PrefsForm {
  type: EditorQuoteType;
  zip: string;
  timeline: string;
  termMonths: string;
  milesPerYear: string;
  downPayment: string;
  creditBand: string;
  dueAtSigningIntent: string;
}

export interface StoredPrefs {
  leasePrefs?: LeaseRequestPrefs | null;
  quotePrefs?: QuotePrefs | null;
}

export const emptyPrefsForm: PrefsForm = { type: "", zip: "", timeline: "", termMonths: "", milesPerYear: "", downPayment: "", creditBand: "", dueAtSigningIntent: "" };

export function prefsToForm(s: StoredPrefs): PrefsForm {
  if (s.leasePrefs) {
    const l = s.leasePrefs;
    return { ...emptyPrefsForm, type: "lease", zip: l.zip || "", timeline: l.timeline || "", termMonths: String(l.termMonths), milesPerYear: String(l.milesPerYear), creditBand: l.creditBand || "", dueAtSigningIntent: l.dueAtSigningIntent || "" };
  }
  const q = s.quotePrefs;
  if (q?.quoteType === "finance") {
    const f = q.finance;
    return { ...emptyPrefsForm, type: "finance", zip: f.zip || "", timeline: f.timeline || "", termMonths: String(f.termMonths), downPayment: String(f.downPayment), creditBand: f.creditBand };
  }
  if (q?.quoteType === "cash") return { ...emptyPrefsForm, type: "cash", zip: q.cash.zip || "", timeline: q.cash.timeline || "" };
  return emptyPrefsForm;
}

export type PrefsResult = { ok: true; leasePrefs: LeaseRequestPrefs | null; quotePrefs: QuotePrefs | null } | { ok: false; errors: string[] };

/** Form → stored shape. Only the selected type's fields are read; the other field is nulled. */
export function formToPrefs(f: PrefsForm, original: StoredPrefs = {}): PrefsResult {
  const errors: string[] = [];
  const tl = f.timeline || null;
  const zipOk = /^\d{5}$/.test(f.zip.trim());
  if (f.type === "") return { ok: true, leasePrefs: null, quotePrefs: null };
  if (!zipOk) errors.push("Enter a 5-digit ZIP code.");
  if (f.type === "cash") {
    if (errors.length) return { ok: false, errors };
    const staged = original.quotePrefs?.quoteType === "cash" && original.quotePrefs.staged === true;
    const raw = { quoteType: "cash", cash: { zip: f.zip.trim(), timeline: tl }, ...(staged ? { staged: true } : {}) };
    return { ok: true, leasePrefs: null, quotePrefs: parseQuotePrefs(raw) };
  }
  if (f.type === "finance") {
    if (!(FINANCE_TERMS as readonly number[]).includes(Number(f.termMonths))) errors.push("Pick a finance term.");
    const down = f.downPayment.trim() === "" ? NaN : Number(f.downPayment);
    if (!Number.isFinite(down) || down < 0) errors.push("Enter a down payment of $0 or more.");
    if (!(CREDIT_BANDS as readonly string[]).includes(f.creditBand)) errors.push("Pick a credit band.");
    if (errors.length) return { ok: false, errors };
    const parsed = parseQuotePrefs({ quoteType: "finance", finance: { termMonths: Number(f.termMonths), downPayment: down, creditBand: f.creditBand, zip: f.zip.trim(), timeline: tl } });
    return parsed ? { ok: true, leasePrefs: null, quotePrefs: parsed } : { ok: false, errors: ["Finance details are incomplete."] };
  }
  if (!(LEASE_TERMS as readonly number[]).includes(Number(f.termMonths))) errors.push("Pick a lease term.");
  if (!(LEASE_MILES as readonly number[]).includes(Number(f.milesPerYear))) errors.push("Pick miles per year.");
  if (f.creditBand && !(CREDIT_BANDS as readonly string[]).includes(f.creditBand)) errors.push("Pick a valid credit band.");
  if (errors.length) return { ok: false, errors };
  const parsed = parseLeasePrefs({ termMonths: Number(f.termMonths), milesPerYear: Number(f.milesPerYear), zip: f.zip.trim(), timeline: tl, creditBand: f.creditBand || null, dueAtSigningIntent: f.dueAtSigningIntent || null });
  return parsed ? { ok: true, leasePrefs: parsed, quotePrefs: null } : { ok: false, errors: ["Lease details are incomplete."] };
}

/** The PATCH body fields for the prefs: only what actually changed. */
export function prefsPatch(f: PrefsForm, original: StoredPrefs): { ok: true; patch: Record<string, unknown> } | { ok: false; errors: string[] } {
  const r = formToPrefs(f, original);
  if (!r.ok) return r;
  const patch: Record<string, unknown> = {};
  const differs = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  if (differs(r.leasePrefs, original.leasePrefs)) patch.leasePrefs = r.leasePrefs;
  if (differs(r.quotePrefs, original.quotePrefs)) patch.quotePrefs = r.quotePrefs;
  return { ok: true, patch };
}
