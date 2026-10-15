/** Validation for what a dealer sends back on a trade: the appraisal and an ask for more photos. */
import { findContactInfo } from "../piiFilter";
import { allowanceOf, computeEquity } from "./otd";
import { CONDITION_CHIPS, DECLINE_CODES, tradeAnswerProblem } from "./confirm";
import { APPRAISAL_BASES, OPTIONAL_PHOTO_SLOTS, type DealerTradeAppraisal, type OptionalSlot, type TradePhotoRequest } from "./types";

const num = (v: unknown): number | null => {
  const t = typeof v === "string" ? v.replace(/[$,\s]/g, "") : v;
  if (t === "" || t == null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export type AppraisalParse = { ok: true; value: DealerTradeAppraisal } | { ok: false; errors: string[] };

/**
 * `allowance` is either { mode: "single", single } or { mode: "range", low, high }. The allowance must be > 0,
 * the payoff used is always the buyer's estimate (the dealer confirms it, not retypes it) and equity is computed here.
 * `quoteExpiresAt` is the default good-until: the same expiry as the vehicle quote.
 */
export function parseAppraisalInput(raw: unknown, ctx: { payoffEstimate: number; ownership: string; quoteExpiresAt: string | null }, now: Date = new Date()): AppraisalParse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = (o.allowance && typeof o.allowance === "object" ? o.allowance : {}) as Record<string, unknown>;
  const errors: string[] = [];
  let single: number | null = null, low: number | null = null, high: number | null = null;
  if (a.mode === "range") {
    low = num(a.low); high = num(a.high);
    if (!(low != null && low > 0 && high != null && high > 0)) errors.push("Enter a low and a high trade allowance above $0.");
    else if (high < low) errors.push("The high allowance can't be below the low one.");
    if (low != null && high != null && low === high) { single = low; low = null; high = null; }
  } else {
    single = num(a.single);
    if (!(single != null && single > 0)) errors.push("Trade allowance must be greater than $0.");
  }
  const basis = APPRAISAL_BASES.find((b) => b === o.basis) ?? null;
  if (!basis) errors.push("Choose Preliminary or Firm.");
  const goodUntilRaw = typeof o.goodUntil === "string" && o.goodUntil ? o.goodUntil : ctx.quoteExpiresAt;
  const goodUntil = goodUntilRaw ? new Date(goodUntilRaw) : null;
  if (!goodUntil || Number.isNaN(goodUntil.getTime())) errors.push("A good-until date is required.");
  else if (goodUntil.getTime() <= now.getTime()) errors.push("The good-until date must be in the future.");
  const hasLien = ctx.ownership !== "owned" || ctx.payoffEstimate > 0;
  if (hasLien && o.payoffConfirmed !== true) errors.push("Confirm you'll pay off the lien and that the buyer's estimated payoff was used.");
  const conditions = typeof o.conditions === "string" ? o.conditions.trim().slice(0, 500) : "";
  if (conditions && findContactInfo(conditions)) errors.push("Leave contact info out of the conditions. Replies stay inside TrimScout.");
  const askedChips = Array.isArray(o.conditionChips) ? (o.conditionChips as unknown[]) : [];
  const conditionChips = Array.from(new Set(askedChips.filter((c): c is string => typeof c === "string" && Object.prototype.hasOwnProperty.call(CONDITION_CHIPS, c))));
  if (askedChips.length && conditionChips.length !== new Set(askedChips).size) errors.push("One of the condition choices isn't recognised.");
  if (errors.length || !basis || !goodUntil) return { ok: false, errors };
  const value = { allowanceSingle: single, allowanceLow: low, allowanceHigh: high };
  const allowance = allowanceOf(value)!;
  return { ok: true, value: { ...value, basis, goodUntil: goodUntil.toISOString(), payoffUsed: ctx.payoffEstimate, equityComputed: computeEquity(allowance, ctx.payoffEstimate), conditions: conditions || null, conditionChips, declined: null, createdAt: now.toISOString() } };
}

export type PhotoRequestParse = { ok: true; value: TradePhotoRequest } | { ok: false; error: string };

/** Only the optional slots are requestable (the core six are always present) plus/or a free-text ask. */
export function parsePhotoRequestInput(raw: unknown, now: Date = new Date()): PhotoRequestParse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const asked = Array.isArray(o.slots) ? (o.slots as unknown[]) : [];
  const slots = Array.from(new Set(asked.filter((s): s is OptionalSlot => (OPTIONAL_PHOTO_SLOTS as readonly string[]).includes(s as string))));
  if (asked.length && slots.length !== new Set(asked).size) return { ok: false, error: "Only the optional photo slots can be requested. The six core photos are always required." };
  const note = typeof o.note === "string" ? o.note.trim().slice(0, 300) : "";
  if (note && findContactInfo(note)) return { ok: false, error: "Leave contact info out of the note. Replies stay inside TrimScout." };
  if (!slots.length && !note) return { ok: false, error: "Pick at least one photo, or say what you'd like to see." };
  return { ok: true, value: { slots, note: note || null, status: "open", createdAt: now.toISOString(), fulfilledAt: null } };
}

/**
 * "Can't quote this trade": a reason code (wrong brand mix, salvage title, ...) instead of an allowance. Stored as an
 * appraisal with no allowance and `declined` set, so it travels the same path; the vehicle quote still counts.
 */
export function parseTradeDecline(raw: unknown, ctx: { quoteExpiresAt: string | null }, now: Date = new Date()): AppraisalParse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = (o.declined && typeof o.declined === "object" ? o.declined : o) as Record<string, unknown>;
  const code = typeof d.code === "string" && Object.prototype.hasOwnProperty.call(DECLINE_CODES, d.code) ? d.code : null;
  const note = typeof d.note === "string" ? d.note.trim().slice(0, 300) : "";
  const errors: string[] = [];
  if (!code) errors.push("Pick a reason you can't quote this trade.");
  if (code === "other" && !note) errors.push("Say briefly why you can't quote this trade.");
  if (note && findContactInfo(note)) errors.push("Leave contact info out of the note. Replies stay inside TrimScout.");
  if (errors.length || !code) return { ok: false, errors };
  const until = ctx.quoteExpiresAt && !Number.isNaN(new Date(ctx.quoteExpiresAt).getTime()) ? new Date(ctx.quoteExpiresAt).toISOString() : now.toISOString();
  return { ok: true, value: { allowanceSingle: null, allowanceLow: null, allowanceHigh: null, basis: "preliminary", goodUntil: until, payoffUsed: 0, equityComputed: 0, conditions: null, conditionChips: [], declined: { code, note: note || null }, createdAt: now.toISOString() } };
}

export type QuoteTradeResolution =
  | { ok: true; kind: "none" | "existing" }
  | { ok: true; kind: "appraisal" | "decline"; appraisal: DealerTradeAppraisal; outlierCheck: boolean }
  | { ok: false; status: 422; errors: string[] };

/**
 * The server-side lock on "every invited dealer quotes the trade with the car". Called by every route that records a vehicle
 * quote. No trade on the request: nothing needed. A trade: the body must carry an allowance or a "can't quote" decline,
 * or the desk must already hold a live one (a re-quote after a counter). Otherwise the quote is refused with 422, whatever
 * the browser did. `quoteExpiresAt` is the new quote's expiry: it is the default good-until and the allowance dies with it.
 */
export function resolveTradeForQuote(
  rfq: { tradeIn?: { payoffEstimate: number; ownership: string } | null },
  invite: { tradeAppraisal?: DealerTradeAppraisal | null },
  body: { trade?: unknown } | null | undefined,
  quoteExpiresAt: string | null,
  now: Date = new Date(),
): QuoteTradeResolution {
  if (!rfq.tradeIn) return { ok: true, kind: "none" };
  const t = body?.trade && typeof body.trade === "object" ? (body.trade as Record<string, unknown>) : null;
  if (t && (t.declined || t.kind === "decline")) {
    const parsed = parseTradeDecline(t, { quoteExpiresAt }, now);
    return parsed.ok ? { ok: true, kind: "decline", appraisal: parsed.value, outlierCheck: false } : { ok: false, status: 422, errors: parsed.errors };
  }
  if (t) {
    const parsed = parseAppraisalInput(t, { payoffEstimate: rfq.tradeIn.payoffEstimate, ownership: rfq.tradeIn.ownership, quoteExpiresAt }, now);
    return parsed.ok ? { ok: true, kind: "appraisal", appraisal: parsed.value, outlierCheck: true } : { ok: false, status: 422, errors: parsed.errors };
  }
  const missing = tradeAnswerProblem({ hasTrade: true, appraisal: invite.tradeAppraisal, quoteExpiresAt, now });
  return missing ? { ok: false, status: 422, errors: [missing] } : { ok: true, kind: "existing" };
}
