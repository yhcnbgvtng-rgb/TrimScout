/**
 * The dealer's trade-allowance form as plain data, so the browser and the tests check it with the SAME code the server runs
 * (lib/trade/dealer.ts). The quote form refuses to submit on a trade request until this checks out; the server then refuses
 * again whatever the browser sent.
 */
import { allowanceOf, computeEquity } from "./otd";
import { parseAppraisalInput, parseTradeDecline } from "./dealer";
import type { AppraisalBasis } from "./types";

export interface TradeFormState {
  /** Quote the trade, or say "Can't quote this trade". */
  mode: "allowance" | "decline";
  /** One number, or a low/high range. */
  shape: "single" | "range";
  single: string; low: string; high: string;
  basis: AppraisalBasis;
  /** yyyy-mm-dd; empty means "same as my quote's expiry". */
  goodUntil: string;
  payoffConfirmed: boolean;
  conditions: string;
  chips: string[];
  declineCode: string;
  declineNote: string;
  /** Set once the value-guide asked the desk to confirm an unusual number. */
  confirmOutlier: boolean;
}

export const emptyTradeForm = (): TradeFormState => ({
  mode: "allowance", shape: "single", single: "", low: "", high: "", basis: "preliminary", goodUntil: "", payoffConfirmed: false,
  conditions: "", chips: [], declineCode: "", declineNote: "", confirmOutlier: false,
});

export const toNum = (v: string): number | null => { const t = v.replace(/[$,\s]/g, ""); return t === "" || !Number.isFinite(Number(t)) ? null : Number(t); };

/** What the browser POSTs as `trade`. */
export function tradeFormPayload(s: TradeFormState): Record<string, unknown> {
  if (s.mode === "decline") return { declined: { code: s.declineCode, note: s.declineNote.trim() || null } };
  return {
    allowance: s.shape === "single" ? { mode: "single", single: s.single } : { mode: "range", low: s.low, high: s.high },
    basis: s.basis,
    ...(s.goodUntil ? { goodUntil: new Date(`${s.goodUntil}T23:59:59`).toISOString() } : {}),
    payoffConfirmed: s.payoffConfirmed,
    conditions: s.conditions,
    conditionChips: s.chips,
    confirmOutlier: s.confirmOutlier,
  };
}

export type TradeFormCheck = { ok: true; trade: Record<string, unknown> } | { ok: false; errors: string[] };

/** The server's own validation, run on the form. `quoteExpiresAt` is the vehicle quote's expiry (the default good-until). */
export function checkTradeForm(s: TradeFormState, ctx: { payoffEstimate: number; ownership: string; quoteExpiresAt: string | null }, now: Date = new Date()): TradeFormCheck {
  const trade = tradeFormPayload(s);
  const parsed = s.mode === "decline" ? parseTradeDecline(trade, { quoteExpiresAt: ctx.quoteExpiresAt }, now) : parseAppraisalInput(trade, ctx, now);
  return parsed.ok ? { ok: true, trade } : { ok: false, errors: parsed.errors };
}

/** Live "allowance − payoff = equity" while typing; null until there is a usable number. */
export function liveEquity(s: TradeFormState, payoffEstimate: number): { mid: number; equity: number; lowEq: number; highEq: number; isRange: boolean } | null {
  if (s.mode !== "allowance") return null;
  const v = allowanceOf(s.shape === "single" ? { allowanceSingle: toNum(s.single), allowanceLow: null, allowanceHigh: null } : { allowanceSingle: null, allowanceLow: toNum(s.low), allowanceHigh: toNum(s.high) });
  return v ? { mid: v.mid, equity: computeEquity(v, payoffEstimate), lowEq: v.low - payoffEstimate, highEq: v.high - payoffEstimate, isRange: v.isRange } : null;
}

/** Has the desk filled in enough to submit? (Cheap check for the button; the full check runs on submit.) */
export function tradeFormReady(s: TradeFormState, lien: boolean): boolean {
  if (s.mode === "decline") return Boolean(s.declineCode) && (s.declineCode !== "other" || Boolean(s.declineNote.trim()));
  const filled = s.shape === "single" ? (toNum(s.single) ?? 0) > 0 : (toNum(s.low) ?? 0) > 0 && (toNum(s.high) ?? 0) > 0;
  return filled && (!lien || s.payoffConfirmed);
}

/** Pre-fill from the desk's saved appraisal so an edit starts from what they sent. */
export function tradeFormFrom(a: { allowanceSingle: number | null; allowanceLow: number | null; allowanceHigh: number | null; basis: AppraisalBasis; goodUntil: string; conditions: string | null; conditionChips?: string[]; declined?: { code: string; note: string | null } | null } | null | undefined): TradeFormState {
  const base = emptyTradeForm();
  if (!a) return base;
  if (a.declined) return { ...base, mode: "decline", declineCode: a.declined.code, declineNote: a.declined.note ?? "" };
  return {
    ...base,
    shape: a.allowanceSingle != null ? "single" : "range",
    single: a.allowanceSingle != null ? String(a.allowanceSingle) : "", low: a.allowanceLow != null ? String(a.allowanceLow) : "", high: a.allowanceHigh != null ? String(a.allowanceHigh) : "",
    basis: a.basis, goodUntil: a.goodUntil.slice(0, 10), conditions: a.conditions ?? "", chips: a.conditionChips ?? [],
  };
}
