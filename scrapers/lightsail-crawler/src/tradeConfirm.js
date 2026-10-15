// The trade-allowance rules that sit between "every invited dealer quotes the trade with the car" and "the winner confirms
// or revises that number in one in-app step". One pure ES module shared by the deals server (rfqTradeConfirm.js) and the
// Next.js app (lib/trade/confirm.ts), so the two cannot disagree. No I/O, no clock: callers pass `now`.
//
// Vocabulary
//   appraisal      a desk's trade allowance on its quote (rfq_invites.trade_appraisal_json): a single number or a low/high
//                  range, a basis (preliminary | firm), a good-until date, conditions, or a decline ("can't quote this trade").
//   confirmation   what happens AFTER the buyer selects that desk (rfq_invites.trade_confirmation_json). One per invite:
//                  pending -> confirmed | revised | expired. A revision is not binding until the buyer accepts it; the buyer can
//                  instead go back to the compare (nothing about the other desks changed) or walk away.
// Money is whole dollars or cents as given; nothing here touches the vehicle quote or any non-trade pricing.

export const DEFAULT_THRESHOLD_PCT = 10;
export const DEFAULT_DEADLINE_HOURS = 24;
/** A big drop that cites none of the dealer's own stated conditions needs a written explanation this long. */
export const GUARDRAIL_MIN_TEXT = 20;
const OTHER_MIN_TEXT = 5;

export const REVISION_REASONS = {
  inspection_finding: "Inspection finding",
  photos_dont_match: "Photos don't match the description",
  payoff_changed: "Payoff changed",
  other: "Other",
};

/** Common conditions a desk can tick instead of typing. They are the "original stated conditions" a revision may cite. */
export const CONDITION_CHIPS = {
  no_frame_damage: "Assumes no frame damage",
  second_key: "Needs 2nd key",
  clean_title: "Assumes clean title",
  no_flood_damage: "Assumes no flood damage",
  mileage_matches: "Mileage must match the odometer photo",
  tires_brakes_ok: "Assumes tires and brakes are as described",
  no_warning_lights: "Assumes no warning lights",
  no_aftermarket_mods: "Assumes no aftermarket modifications",
};
/** What a revision cites when it points at the free-text conditions rather than a chip. */
export const CONDITIONS_TEXT_KEY = "conditions_text";

export const DECLINE_CODES = {
  wrong_brand_mix: "Wrong brand mix for our store",
  salvage_title: "Salvage or branded title",
  too_old_or_high_miles: "Too old or too many miles",
  not_buying_this_type: "We don't buy this type of vehicle",
  other: "Other",
};

export const CONFIRMATION_STATUSES = ["pending", "confirmed", "revised", "expired"];

const r2 = (n) => Math.round(n * 100) / 100;
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const toMs = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? null : t; };
const iso = (ms) => new Date(ms).toISOString();

// ---- the appraisal --------------------------------------------------------

/** { low, high, mid, isRange } from a stored appraisal, or null when it carries no usable allowance. */
export function allowanceValue(a) {
  if (!a) return null;
  if (finite(a.allowanceSingle) && a.allowanceSingle > 0) return { low: a.allowanceSingle, high: a.allowanceSingle, mid: a.allowanceSingle, isRange: false };
  if (finite(a.allowanceLow) && finite(a.allowanceHigh) && a.allowanceLow > 0 && a.allowanceHigh >= a.allowanceLow) {
    return { low: a.allowanceLow, high: a.allowanceHigh, mid: r2((a.allowanceLow + a.allowanceHigh) / 2), isRange: a.allowanceHigh > a.allowanceLow };
  }
  return null;
}

/** The allowance expires with the vehicle quote: the earlier of its own good-until and the quote's expiry. */
export function effectiveGoodUntil(a, quoteExpiresAt) {
  const own = toMs(a && a.goodUntil);
  const q = toMs(quoteExpiresAt);
  if (own == null) return q;
  if (q == null) return own;
  return Math.min(own, q);
}

/**
 * What a compare card should say about one desk's trade number.
 *   none      no appraisal on file                       -> "No trade quote"
 *   declined  the desk said it can't quote this trade    -> reason shown, left out of the best-deal badge
 *   expired   past good-until or past the quote's expiry -> numbers not applied
 *   quoted    a live allowance; `stale` when the buyer changed the trade after it was given ("Based on earlier details")
 */
export function appraisalState(a, ctx = {}) {
  const now = toMs(ctx.now) ?? Date.now();
  if (!a) return { kind: "none", stale: false, goodUntil: null };
  if (a.declined && a.declined.code) return { kind: "declined", stale: false, goodUntil: null, declined: a.declined };
  const value = allowanceValue(a);
  if (!value) return { kind: "none", stale: false, goodUntil: null };
  const until = effectiveGoodUntil(a, ctx.quoteExpiresAt);
  const goodUntil = until == null ? null : iso(until);
  if (until != null && until <= now) return { kind: "expired", stale: false, goodUntil, value };
  const given = toMs(a.reconfirmedAt) ?? toMs(a.createdAt);
  const changed = toMs(ctx.tradeUpdatedAt);
  const stale = given != null && changed != null && changed > given;
  return { kind: "quoted", stale, goodUntil, value };
}

/** Shape check run by the deals server on every appraisal write (the Next route validates first; this is the second lock). */
export function appraisalProblem(a) {
  if (!a || typeof a !== "object") return "appraisal is required";
  const chips = Array.isArray(a.conditionChips) ? a.conditionChips : [];
  if (!chips.every((c) => typeof c === "string" && Object.prototype.hasOwnProperty.call(CONDITION_CHIPS, c))) return "unknown condition";
  if (a.declined) {
    if (!a.declined.code || !Object.prototype.hasOwnProperty.call(DECLINE_CODES, a.declined.code)) return "pick a reason for not quoting the trade";
    if (a.declined.code === "other" && !(typeof a.declined.note === "string" && a.declined.note.trim())) return "say why you can't quote this trade";
    return null;
  }
  if (!allowanceValue(a)) return "allowance must be greater than 0 (a single number or a low/high range)";
  if ((finite(a.allowanceSingle) ? 1 : 0) + (finite(a.allowanceLow) || finite(a.allowanceHigh) ? 1 : 0) !== 1) return "send one allowance: a single number or a low/high range";
  if (a.basis !== "preliminary" && a.basis !== "firm") return "basis must be preliminary or firm";
  if (toMs(a.goodUntil) == null) return "goodUntil is required";
  return null;
}

/**
 * Does this quote need a trade answer, and does it have one? `appraisal` is what the desk has on file (or is submitting).
 * A decline counts as an answer; a missing, expired or allowance-less appraisal does not.
 */
export function tradeAnswerProblem({ hasTrade, appraisal, quoteExpiresAt, now }) {
  if (!hasTrade) return null;
  const st = appraisalState(appraisal, { quoteExpiresAt, now });
  if (st.kind === "quoted" || st.kind === "declined") return null;
  return st.kind === "expired"
    ? "Your trade allowance has expired. Enter a new one with your quote, or choose \"Can't quote this trade\"."
    : "This request includes a trade-in. A trade allowance (or \"Can't quote this trade\") is required with your quote.";
}

// ---- the confirmation -----------------------------------------------------

/** Statuses a selected desk is still working through. */
export function effectiveStatus(conf, now) {
  if (!conf) return null;
  const t = toMs(now) ?? Date.now();
  if (conf.status === "pending" && toMs(conf.deadlineAt) != null && t >= toMs(conf.deadlineAt)) return "expired";
  return conf.status;
}

/** The number is final: confirmed, defaulted at the deadline, or revised AND accepted by the buyer. */
export function isSettled(conf, now) {
  if (!conf) return false;
  const s = effectiveStatus(conf, now);
  if (s === "confirmed" || s === "expired") return true;
  return s === "revised" && conf.buyerDecision === "accepted";
}

/** The buyer owes an answer: the desk revised and they have not accepted, gone back or walked. */
export function awaitingBuyer(conf) {
  return Boolean(conf && conf.status === "revised" && !conf.buyerDecision);
}

/** Open the confirm step for a selected desk. Null `ok:false` when there is no live allowance to confirm. */
export function openConfirmation({ inviteId, quoteId = null, appraisal, quoteExpiresAt = null, now = new Date(), deadlineHours = DEFAULT_DEADLINE_HOURS }) {
  const t = toMs(now) ?? Date.now();
  const st = appraisalState(appraisal, { quoteExpiresAt, now: t });
  if (st.kind === "declined") return { ok: false, code: "declined", error: "This dealer couldn't quote the trade, so there is nothing to confirm." };
  if (st.kind === "none") return { ok: false, code: "no_allowance", error: "This dealer gave no trade allowance, so there is nothing to confirm." };
  if (st.kind === "expired") return { ok: false, code: "expired", error: "This dealer's trade allowance has expired." };
  const hours = finite(deadlineHours) && deadlineHours > 0 ? deadlineHours : DEFAULT_DEADLINE_HOURS;
  const v = st.value;
  return {
    ok: true,
    confirmation: {
      v: 1,
      inviteId: String(inviteId),
      quoteId: quoteId == null ? null : String(quoteId),
      status: "pending",
      basis: appraisal.basis,
      // allowance_prelim: the single number, or the midpoint of a range (the number the buyer compared on).
      allowancePrelim: v.mid,
      range: v.isRange ? { low: v.low, high: v.high } : null,
      payoffUsed: finite(appraisal.payoffUsed) ? appraisal.payoffUsed : 0,
      originalConditions: {
        chips: Array.isArray(appraisal.conditionChips) ? appraisal.conditionChips.slice() : [],
        hasText: Boolean(appraisal.conditions && String(appraisal.conditions).trim()),
      },
      allowanceFinal: null,
      revisionDelta: null,
      revisionDropPct: null,
      revisionReasonCode: null,
      revisionReasonText: null,
      citedConditions: [],
      revisionFlagged: false,
      firmBreach: false,
      confirmedWithinDeadline: null,
      buyerDecision: null,
      buyerDecidedAt: null,
      requestedAt: iso(t),
      resolvedAt: null,
      deadlineAt: iso(t + hours * 3600_000),
    },
  };
}

const fail = (code, error) => ({ ok: false, code, error });

/**
 * One transition. `actor` is "dealer" | "buyer" | "system".
 *   dealer  confirm { allowance? }                     one click as quoted (a range needs one number inside it)
 *           revise  { allowance, reasonCode, reasonText?, citedConditions? }
 *   buyer   accept_revised | go_back | walk
 *   system  expire (at or after the deadline) | reopen (the buyer re-selected a desk they had gone back from)
 * ctx: { now, thresholdPct }
 */
export function applyConfirmAction(conf, action, ctx = {}) {
  if (!conf) return fail("no_confirmation", "There is nothing to confirm on this deal.");
  const now = toMs(ctx.now) ?? Date.now();
  const thresholdPct = finite(ctx.thresholdPct) && ctx.thresholdPct >= 0 ? ctx.thresholdPct : DEFAULT_THRESHOLD_PCT;
  const type = action && action.type;
  const status = effectiveStatus(conf, now);

  if (type === "expire") {
    if (conf.status !== "pending") return fail("not_pending", "This trade value is already settled.");
    const due = toMs(conf.deadlineAt);
    if (due == null || now < due) return fail("not_due", "The deadline has not passed.");
    return { ok: true, confirmation: { ...conf, status: "expired", allowanceFinal: conf.allowancePrelim, revisionDelta: 0, confirmedWithinDeadline: false, resolvedAt: iso(due), rangeDefaulted: Boolean(conf.range) } };
  }

  if (type === "confirm" || type === "revise") {
    if (status === "expired") return fail("deadline_passed", "The confirmation deadline passed, so the original trade number stands.");
    if (status !== "pending") return fail("not_pending", "This trade value is already settled.");
    const a = action.allowance === undefined || action.allowance === null || action.allowance === "" ? null : Number(action.allowance);
    if (a !== null && !(Number.isFinite(a) && a > 0)) return fail("invalid_allowance", "Enter a trade allowance greater than $0.");
    const amount = a === null ? null : r2(a);
    const range = conf.range;

    if (type === "confirm") {
      if (range) {
        if (amount === null) return fail("single_number_required", "You quoted a range. Enter the single number you are confirming.");
        if (amount < range.low || amount > range.high) return fail("outside_range", "That number is outside the range you quoted. Use Revise trade value instead.");
      } else if (amount !== null && amount !== conf.allowancePrelim) {
        return fail("not_as_quoted", "That is not the number you quoted. Use Revise trade value instead.");
      }
      const final = amount ?? conf.allowancePrelim;
      return { ok: true, confirmation: { ...conf, status: "confirmed", allowanceFinal: final, revisionDelta: r2(final - conf.allowancePrelim), confirmedWithinDeadline: true, resolvedAt: iso(now) } };
    }

    // revise
    if (amount === null) return fail("invalid_allowance", "Enter the revised trade allowance.");
    if (range && amount >= range.low && amount <= range.high) return fail("inside_range", "That number is inside the range you quoted. Confirm it instead.");
    if (!range && amount === conf.allowancePrelim) return fail("unchanged", "That is the number you quoted. Use Confirm as quoted instead.");
    const code = action.reasonCode;
    if (!Object.prototype.hasOwnProperty.call(REVISION_REASONS, code)) return fail("reason_required", "Choose a reason for the revision.");
    const text = typeof action.reasonText === "string" ? action.reasonText.trim() : "";
    const firm = conf.basis === "firm";
    if (code === "other" && text.length < (firm ? GUARDRAIL_MIN_TEXT : OTHER_MIN_TEXT)) {
      return fail("reason_text_required", firm ? `You quoted this as Firm. Explain the revision in at least ${GUARDRAIL_MIN_TEXT} characters.` : "Tell the buyer briefly what changed.");
    }
    const hasChip = (c) => conf.originalConditions && Array.isArray(conf.originalConditions.chips) && conf.originalConditions.chips.includes(c);
    const cited = Array.from(new Set((Array.isArray(action.citedConditions) ? action.citedConditions : []).filter((c) => hasChip(c) || (c === CONDITIONS_TEXT_KEY && conf.originalConditions && conf.originalConditions.hasText))));
    // Measured from what the buyer was counting on: the number, or the bottom of a range.
    const base = range ? range.low : conf.allowancePrelim;
    const dropPct = base > 0 ? ((base - amount) / base) * 100 : 0;
    const guardrail = dropPct > thresholdPct && cited.length === 0;
    if (guardrail && text.length < GUARDRAIL_MIN_TEXT) {
      return fail("explanation_required", `This lowers your number by more than ${thresholdPct}% without citing a condition you quoted. Explain it in at least ${GUARDRAIL_MIN_TEXT} characters.`);
    }
    return {
      ok: true,
      confirmation: {
        ...conf, status: "revised", allowanceFinal: amount, revisionDelta: r2(amount - conf.allowancePrelim), revisionDropPct: Math.round(dropPct * 10) / 10,
        revisionReasonCode: code, revisionReasonText: text || null, citedConditions: cited,
        revisionFlagged: guardrail, firmBreach: firm, confirmedWithinDeadline: true, resolvedAt: iso(now), buyerDecision: null, buyerDecidedAt: null,
      },
    };
  }

  if (type === "accept_revised" || type === "go_back") {
    if (!awaitingBuyer(conf)) return fail("not_revised", "There is no revised trade number waiting for your answer.");
    return { ok: true, confirmation: { ...conf, buyerDecision: type === "accept_revised" ? "accepted" : "went_back", buyerDecidedAt: iso(now) } };
  }

  if (type === "walk") {
    if (isSettled(conf, now)) return fail("settled", "This trade value is already settled.");
    return { ok: true, confirmation: { ...conf, buyerDecision: "walked", buyerDecidedAt: iso(now) } };
  }

  if (type === "reopen") {
    // The buyer went back, then picked this desk again: the revised number is in front of them once more.
    if (!(conf.status === "revised" && conf.buyerDecision === "went_back")) return fail("not_reopenable", "Nothing to reopen.");
    return { ok: true, confirmation: { ...conf, buyerDecision: null, buyerDecidedAt: null, reopenedAt: iso(now) } };
  }

  return fail("bad_action", "Unknown action.");
}

/**
 * The allowance that counts for a desk's card and ranking: the settled final number when the confirm step finished, else
 * the number as quoted. A revision the buyer went back from, or has not answered, does not move the card.
 */
export function bindingAllowance(appraisal, conf, now) {
  const v = allowanceValue(appraisal);
  if (conf && isSettled(conf, now) && finite(conf.allowanceFinal)) return { low: conf.allowanceFinal, high: conf.allowanceFinal, mid: conf.allowanceFinal, isRange: false, fromConfirmation: true };
  return v ? { ...v, fromConfirmation: false } : null;
}

// ---- desk honesty (internal only) -----------------------------------------

/** The flat per-quote record the spec asks to store, read off a confirmation. */
export function quoteMetrics(conf) {
  if (!conf) return null;
  return {
    trade_allowance_prelim: conf.allowancePrelim,
    trade_allowance_final: conf.allowanceFinal,
    revision_delta: conf.revisionDelta,
    revision_reason_code: conf.revisionReasonCode,
    basis: conf.basis,
    confirmed_within_deadline: conf.confirmedWithinDeadline,
  };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Per-dealer rollup over resolved confirmations: % confirmed as quoted, average revision delta, firm-breach count and
 * median time to confirm. Input rows: { dealerKey, dealerName, confirmation }. Pending confirmations are not counted yet.
 * Internal only: buyers and dealers never see this.
 */
export function deskHonestyRollup(rows, now = new Date()) {
  const by = new Map();
  for (const row of rows || []) {
    const c = row && row.confirmation;
    if (!c) continue;
    const status = effectiveStatus(c, now);
    if (status === "pending") continue;
    const key = row.dealerKey || row.dealerName;
    if (!by.has(key)) by.set(key, { dealerKey: key, dealerName: row.dealerName, list: [] });
    by.get(key).list.push({ ...c, status });
  }
  const out = [];
  for (const { dealerKey, dealerName, list } of by.values()) {
    const confirmed = list.filter((c) => c.status === "confirmed");
    const revised = list.filter((c) => c.status === "revised");
    const expired = list.filter((c) => c.status === "expired");
    const acted = list.filter((c) => c.status !== "expired");
    const times = acted.map((c) => toMs(c.resolvedAt) - toMs(c.requestedAt)).filter((n) => Number.isFinite(n) && n >= 0);
    const deltas = revised.map((c) => c.revisionDelta).filter(finite);
    out.push({
      dealerKey, dealerName,
      total: list.length,
      confirmed: confirmed.length, revised: revised.length, expired: expired.length,
      pctConfirmedAsQuoted: Math.round((confirmed.length / list.length) * 1000) / 10,
      pctWithinDeadline: Math.round((acted.length / list.length) * 1000) / 10,
      avgRevisionDelta: deltas.length ? r2(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
      firmBreaches: list.filter((c) => c.firmBreach).length,
      flaggedForReview: list.filter((c) => c.revisionFlagged).length,
      medianTimeToConfirmMs: median(times),
    });
  }
  return out.sort((a, b) => (a.dealerName || "").localeCompare(b.dealerName || ""));
}

// ---- audit ----------------------------------------------------------------

/** One row of the append-only allowance log. `from` / `to` are small JSON-able snapshots (allowance, basis, status). */
export function auditEntry({ rfqId, inviteId, actor, action, from = null, to = null, detail = null, at = new Date() }) {
  return { rfqId: String(rfqId), inviteId: String(inviteId), actor, action, from, to, detail, at: iso(toMs(at) ?? Date.now()) };
}
