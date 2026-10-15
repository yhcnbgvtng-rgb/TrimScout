import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyConfirmAction, appraisalForCompare, awaitingBuyer, bindingAllowance, deskHonestyRollup, dueExpiries, effectiveStatus, isSettled, openConfirmation,
  openConfirmationOf, quoteMetrics, tradeAnswerProblem, tradeConfirmConfig, type TradeConfirmation,
} from "./confirm";
import { parseAppraisalInput, parseTradeDecline, resolveTradeForQuote } from "./dealer";
import { tradeEquity, otdBeforeAfter } from "./otd";
import type { DealerTradeAppraisal } from "./types";
import type { RfqInvite } from "../rfq";

const T0 = new Date("2026-10-16T12:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3600_000);
const appraisal = (over: Partial<DealerTradeAppraisal> = {}): DealerTradeAppraisal => ({
  allowanceSingle: 10000, allowanceLow: null, allowanceHigh: null, basis: "preliminary", goodUntil: "2026-10-30T23:59:59Z", payoffUsed: 4000, equityComputed: 6000,
  conditions: "assumes no frame damage", conditionChips: ["no_frame_damage", "second_key"], declined: null, createdAt: "2026-10-16T10:00:00Z", ...over,
});
const open = (a: DealerTradeAppraisal = appraisal(), hours = 24): TradeConfirmation => {
  const r = openConfirmation({ inviteId: "11", quoteId: "99", appraisal: a, now: T0, deadlineHours: hours });
  assert.ok(r.ok); return (r as { ok: true; confirmation: TradeConfirmation }).confirmation;
};
const act = (c: TradeConfirmation, action: Parameters<typeof applyConfirmAction>[1], now = at(1), thresholdPct = 10) => applyConfirmAction(c, action, { now, thresholdPct });
const okc = (r: ReturnType<typeof applyConfirmAction>): TradeConfirmation => { assert.ok(r.ok, r.ok ? "" : r.error); return (r as { ok: true; confirmation: TradeConfirmation }).confirmation; };
const code = (r: ReturnType<typeof applyConfirmAction>) => (r.ok ? "ok" : r.code);

describe("opening the confirm step", () => {
  it("starts pending with the quoted number, the basis and a 24h deadline by default", () => {
    const c = open();
    assert.equal(c.status, "pending"); assert.equal(c.allowancePrelim, 10000); assert.equal(c.basis, "preliminary");
    assert.equal(c.deadlineAt, "2026-10-17T12:00:00.000Z"); assert.equal(c.range, null);
  });
  it("honours a configured deadline", () => assert.equal(open(appraisal(), 48).deadlineAt, "2026-10-18T12:00:00.000Z"));
  it("uses the midpoint of a range as the quoted number and remembers the range", () => {
    const c = open(appraisal({ allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 }));
    assert.equal(c.allowancePrelim, 10000); assert.deepEqual(c.range, { low: 9000, high: 11000 });
  });
  it("has nothing to confirm for a decline, a missing allowance or an expired one", () => {
    const r = (a: DealerTradeAppraisal | null, quoteExpiresAt: string | null = null) => openConfirmation({ inviteId: "1", appraisal: a, quoteExpiresAt, now: T0 });
    const declined = parseTradeDecline({ code: "salvage_title" }, { quoteExpiresAt: null }, T0);
    assert.ok(declined.ok); if (declined.ok) assert.equal(r(declined.value).ok, false);
    assert.equal(r(null).ok, false);
    assert.equal(r(appraisal({ goodUntil: "2026-10-01T00:00:00Z" })).ok, false);
    assert.equal(r(appraisal(), "2026-10-16T11:00:00Z").ok, false, "the allowance expires with the vehicle quote");
  });
});

describe("confirm as quoted", () => {
  it("one click confirms the quoted number, within the deadline", () => {
    const c = okc(act(open(), { type: "confirm" }, at(2)));
    assert.equal(c.status, "confirmed"); assert.equal(c.allowanceFinal, 10000); assert.equal(c.revisionDelta, 0);
    assert.equal(c.confirmedWithinDeadline, true); assert.equal(c.resolvedAt, at(2).toISOString());
    assert.ok(isSettled(c, at(2)));
  });
  it("refuses a different number as 'as quoted'", () => assert.equal(code(act(open(), { type: "confirm", allowance: 9000 })), "not_as_quoted"));
  it("a range needs ONE number inside it; outside the range is a revision", () => {
    const r = open(appraisal({ allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 }));
    assert.equal(code(act(r, { type: "confirm" })), "single_number_required");
    assert.equal(code(act(r, { type: "confirm", allowance: 12000 })), "outside_range");
    const c = okc(act(r, { type: "confirm", allowance: 9500 }));
    assert.equal(c.status, "confirmed"); assert.equal(c.allowanceFinal, 9500); assert.equal(c.revisionDelta, -500);
  });
});

describe("revising", () => {
  it("needs a reason from the list; 'other' needs text", () => {
    assert.equal(code(act(open(), { type: "revise", allowance: 9500 })), "reason_required");
    assert.equal(code(act(open(), { type: "revise", allowance: 9500, reasonCode: "nonsense" })), "reason_required");
    assert.equal(code(act(open(), { type: "revise", allowance: 9500, reasonCode: "other", reasonText: "  " })), "reason_text_required");
    assert.equal(code(act(open(), { type: "revise", allowance: 9500, reasonCode: "other", reasonText: "Needs tires" })), "ok");
  });
  it("is not the same as confirming: an unchanged number is refused", () => assert.equal(code(act(open(), { type: "revise", allowance: 10000, reasonCode: "inspection_finding" })), "unchanged"));
  it("records before/after, delta and reason, and waits for the buyer", () => {
    const c = okc(act(open(), { type: "revise", allowance: 9500, reasonCode: "inspection_finding", reasonText: "Curb rash on two wheels" }));
    assert.equal(c.status, "revised"); assert.equal(c.allowancePrelim, 10000); assert.equal(c.allowanceFinal, 9500); assert.equal(c.revisionDelta, -500);
    assert.equal(c.revisionReasonCode, "inspection_finding"); assert.equal(c.firmBreach, false); assert.equal(c.revisionFlagged, false);
    assert.ok(awaitingBuyer(c)); assert.equal(isSettled(c, at(2)), false, "a revision is not binding until the buyer accepts");
  });
  it("a raise is a revision too", () => {
    const c = okc(act(open(), { type: "revise", allowance: 10500, reasonCode: "payoff_changed" }));
    assert.equal(c.revisionDelta, 500); assert.equal(c.revisionFlagged, false);
  });
  it("a range revision must land outside the range", () => {
    const r = open(appraisal({ allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 }));
    assert.equal(code(act(r, { type: "revise", allowance: 10500, reasonCode: "inspection_finding" })), "inside_range");
    const c = okc(act(r, { type: "revise", allowance: 8800, reasonCode: "inspection_finding" }));
    assert.equal(c.allowanceFinal, 8800); assert.equal(c.revisionDelta, -1200, "delta is against the midpoint the buyer compared on");
  });
});

describe("revision guardrail (TRADE_REVISION_THRESHOLD_PCT)", () => {
  it("defaults to 10% and 24 hours", () => {
    assert.deepEqual(tradeConfirmConfig({}), { thresholdPct: 10, deadlineHours: 24 });
    assert.deepEqual(tradeConfirmConfig({ TRADE_REVISION_THRESHOLD_PCT: "15", TRADE_CONFIRM_DEADLINE_HOURS: "48" }), { thresholdPct: 15, deadlineHours: 48 });
    assert.deepEqual(tradeConfirmConfig({ TRADE_REVISION_THRESHOLD_PCT: "junk" }).thresholdPct, 10);
  });
  it("a drop of exactly the threshold needs nothing extra; over it, with no cited condition, needs 20+ characters and is flagged", () => {
    assert.equal(code(act(open(), { type: "revise", allowance: 9000, reasonCode: "inspection_finding" })), "ok", "10% is not more than 10%");
    assert.equal(code(act(open(), { type: "revise", allowance: 8900, reasonCode: "inspection_finding" })), "explanation_required");
    assert.equal(code(act(open(), { type: "revise", allowance: 8900, reasonCode: "inspection_finding", reasonText: "too short" })), "explanation_required");
    const c = okc(act(open(), { type: "revise", allowance: 8900, reasonCode: "inspection_finding", reasonText: "Transmission slips between second and third gear." }));
    assert.equal(c.revisionFlagged, true); assert.equal(c.revisionDropPct, 11);
  });
  it("citing one of the dealer's original conditions lifts the requirement and the flag", () => {
    const c = okc(act(open(), { type: "revise", allowance: 8000, reasonCode: "inspection_finding", citedConditions: ["no_frame_damage"] }));
    assert.equal(c.revisionFlagged, false); assert.deepEqual(c.citedConditions, ["no_frame_damage"]);
    const t = okc(act(open(), { type: "revise", allowance: 8000, reasonCode: "inspection_finding", citedConditions: ["conditions_text"] }));
    assert.equal(t.revisionFlagged, false);
  });
  it("ignores citations of conditions the desk never stated", () => {
    assert.equal(code(act(open(), { type: "revise", allowance: 8000, reasonCode: "inspection_finding", citedConditions: ["clean_title"] })), "explanation_required");
    const noText = open(appraisal({ conditions: null, conditionChips: [] }));
    assert.equal(code(act(noText, { type: "revise", allowance: 8000, reasonCode: "inspection_finding", citedConditions: ["conditions_text"] })), "explanation_required");
  });
  it("uses the configured threshold", () => {
    assert.equal(code(act(open(), { type: "revise", allowance: 8900, reasonCode: "inspection_finding" }, at(1), 15)), "ok");
    assert.equal(code(act(open(), { type: "revise", allowance: 8400, reasonCode: "inspection_finding" }, at(1), 15)), "explanation_required");
  });
  it("a drop on a range is measured from the bottom of the range", () => {
    const r = open(appraisal({ allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 }));
    assert.equal(code(act(r, { type: "revise", allowance: 8000, reasonCode: "inspection_finding" })), "explanation_required");
    assert.equal(code(act(r, { type: "revise", allowance: 8500, reasonCode: "inspection_finding" })), "ok", "5.6% below the low end");
  });
  it("never blocks the buyer: a flagged revision still reaches them with go back / walk", () => {
    const c = okc(act(open(), { type: "revise", allowance: 5000, reasonCode: "other", reasonText: "The car does not match the description at all." }));
    assert.ok(okc(act(c, { type: "go_back" })).buyerDecision === "went_back");
    assert.ok(okc(act(c, { type: "walk" })).buyerDecision === "walked");
  });
});

describe("firm quotes", () => {
  const firm = () => open(appraisal({ basis: "firm" }));
  it("a revision is flagged as a firm breach and needs a real explanation for 'other'", () => {
    const c = okc(act(firm(), { type: "revise", allowance: 9800, reasonCode: "photos_dont_match" }));
    assert.equal(c.firmBreach, true); assert.equal(c.revisionFlagged, false, "a small drop is a breach but not a guardrail flag");
    assert.equal(code(act(firm(), { type: "revise", allowance: 9800, reasonCode: "other", reasonText: "needs tires" })), "reason_text_required");
  });
  it("a confirmation is not a breach, and a preliminary revision is not either", () => {
    assert.equal(okc(act(firm(), { type: "confirm" })).firmBreach, false);
    assert.equal(okc(act(open(), { type: "revise", allowance: 9800, reasonCode: "photos_dont_match" })).firmBreach, false);
  });
});

describe("the dealer deadline", () => {
  it("lets the original number stand once it passes (derived, then persisted by expire)", () => {
    const c = open();
    assert.equal(effectiveStatus(c, at(23)), "pending"); assert.equal(effectiveStatus(c, at(25)), "expired");
    assert.ok(isSettled(c, at(25)));
    assert.equal(code(act(c, { type: "confirm" }, at(25))), "deadline_passed");
    assert.equal(code(act(c, { type: "revise", allowance: 9000, reasonCode: "inspection_finding" }, at(25))), "deadline_passed");
    assert.equal(code(act(c, { type: "expire" }, at(23))), "not_due");
    const e = okc(act(c, { type: "expire" }, at(30)));
    assert.equal(e.status, "expired"); assert.equal(e.allowanceFinal, 10000); assert.equal(e.confirmedWithinDeadline, false);
    assert.equal(e.resolvedAt, c.deadlineAt, "resolved at the deadline, not whenever the sweep ran");
  });
  it("a range that expires stands at its midpoint", () => {
    const r = open(appraisal({ allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 }));
    const e = okc(act(r, { type: "expire" }, at(30)));
    assert.equal(e.allowanceFinal, 10000); assert.equal(e.rangeDefaulted, true);
  });
  it("finds due expiries on a request", () => {
    const invites = [{ id: "11", tradeConfirmation: open() }, { id: "12", tradeConfirmation: okc(act(open(), { type: "confirm" })) }, { id: "13" }] as unknown as RfqInvite[];
    assert.deepEqual(dueExpiries({ invites }, at(30)).map((i) => i.id), ["11"]);
    assert.deepEqual(dueExpiries({ invites }, at(2)).map((i) => i.id), []);
  });
});

describe("buyer answers", () => {
  const revised = () => okc(act(open(), { type: "revise", allowance: 9000, reasonCode: "inspection_finding" }));
  it("accepting the revision makes the final number binding", () => {
    const c = okc(act(revised(), { type: "accept_revised" }, at(3)));
    assert.equal(c.buyerDecision, "accepted"); assert.ok(isSettled(c, at(3))); assert.equal(bindingAllowance(appraisal(), c, at(3))?.mid, 9000);
  });
  it("going back leaves the dealer's quoted number alone and marks the desk revised", () => {
    const c = okc(act(revised(), { type: "go_back" }, at(3)));
    assert.equal(c.status, "revised"); assert.equal(isSettled(c, at(3)), false);
    assert.equal(bindingAllowance(appraisal(), c, at(3))?.mid, 10000, "no penalty: the original number is what the compare shows");
    assert.equal(appraisalForCompare(appraisal(), c, at(3))?.allowanceSingle, 10000);
  });
  it("re-selecting that desk puts the revision in front of the buyer again", () => {
    const back = okc(act(revised(), { type: "go_back" }, at(3)));
    assert.equal(code(act(open(), { type: "reopen" })), "not_reopenable");
    const again = okc(act(back, { type: "reopen" }, at(4)));
    assert.ok(awaitingBuyer(again));
  });
  it("only a revision can be accepted or gone back from, once", () => {
    assert.equal(code(act(open(), { type: "accept_revised" })), "not_revised");
    assert.equal(code(act(okc(act(revised(), { type: "accept_revised" })), { type: "go_back" })), "not_revised");
  });
  it("walking away is always allowed until the number is settled", () => {
    assert.equal(okc(act(open(), { type: "walk" })).buyerDecision, "walked");
    assert.equal(code(act(okc(act(open(), { type: "confirm" })), { type: "walk" })), "settled");
  });
  it("a confirmed final replaces the quoted number on the card", () => {
    const r = open(appraisal({ allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 }));
    const c = okc(act(r, { type: "confirm", allowance: 9500 }));
    const a = appraisalForCompare(appraisal({ allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 }), c, at(2))!;
    assert.equal(a.allowanceSingle, 9500); assert.equal(a.allowanceLow, null);
  });
});

describe("the spec's per-quote record and the desk rollup", () => {
  it("stores prelim, final, delta, reason code, basis and confirmed-in-time", () => {
    const c = okc(act(open(appraisal({ basis: "firm" })), { type: "revise", allowance: 9500, reasonCode: "payoff_changed" }));
    assert.deepEqual(quoteMetrics(c), { trade_allowance_prelim: 10000, trade_allowance_final: 9500, revision_delta: -500, revision_reason_code: "payoff_changed", basis: "firm", confirmed_within_deadline: true });
  });
  it("rolls up % as quoted, average delta, firm breaches and median time per dealer", () => {
    const done = (hours: number, action: Parameters<typeof applyConfirmAction>[1], a = appraisal()) => okc(act(open(a), action, at(hours)));
    const rows = [
      { dealerKey: "A", dealerName: "Alpha", confirmation: done(1, { type: "confirm" }) },
      { dealerKey: "A", dealerName: "Alpha", confirmation: done(3, { type: "confirm" }) },
      { dealerKey: "A", dealerName: "Alpha", confirmation: done(5, { type: "revise", allowance: 9000, reasonCode: "inspection_finding" }, appraisal({ basis: "firm" })) },
      { dealerKey: "A", dealerName: "Alpha", confirmation: okc(act(open(), { type: "expire" }, at(30))) },
      { dealerKey: "B", dealerName: "Bravo", confirmation: done(2, { type: "revise", allowance: 8500, reasonCode: "other", reasonText: "Engine knock heard on a cold start up." }) },
      { dealerKey: "C", dealerName: "Pending Co", confirmation: open() },
      { dealerKey: "D", dealerName: "None", confirmation: null },
    ];
    const r = deskHonestyRollup(rows, at(10));
    assert.deepEqual(r.map((x) => x.dealerName), ["Alpha", "Bravo"], "pending and empty rows are not counted");
    const a = r[0];
    assert.equal(a.total, 4); assert.equal(a.confirmed, 2); assert.equal(a.pctConfirmedAsQuoted, 50); assert.equal(a.firmBreaches, 1);
    assert.equal(a.avgRevisionDelta, -1000); assert.equal(a.expired, 1); assert.equal(a.pctWithinDeadline, 75);
    assert.equal(a.medianTimeToConfirmMs, 3 * 3600_000, "1h, 3h, 5h: expiry is not a confirmation time");
    assert.equal(r[1].flaggedForReview, 1); assert.equal(r[1].avgRevisionDelta, -1500);
  });
});

describe("a trade request cannot take a quote without a trade answer", () => {
  const rfq = { tradeIn: { payoffEstimate: 4000, ownership: "financed" } };
  const noTrade = { tradeIn: null };
  const body = (trade: unknown) => ({ trade });
  const goodTrade = { allowance: { mode: "single", single: "10000" }, basis: "preliminary", goodUntil: "2026-10-30T23:59:59Z", payoffConfirmed: true };
  const QUOTE_EXP = "2026-10-30T23:59:59Z";

  it("is rejected with 422 when the request has a trade and the body has none", () => {
    const r = resolveTradeForQuote(rfq, {}, body(undefined), QUOTE_EXP, T0);
    assert.ok(!r.ok); if (!r.ok) { assert.equal(r.status, 422); assert.match(r.errors[0], /trade allowance/i); }
  });
  it("is rejected for a zero, negative or missing allowance", () => {
    for (const single of ["0", "-5", "", "abc"]) {
      const r = resolveTradeForQuote(rfq, {}, body({ ...goodTrade, allowance: { mode: "single", single } }), QUOTE_EXP, T0);
      assert.ok(!r.ok, `single=${single}`);
    }
  });
  it("needs the basis, a future good-until and the payoff confirmation on a lien", () => {
    assert.ok(!resolveTradeForQuote(rfq, {}, body({ ...goodTrade, basis: undefined }), QUOTE_EXP, T0).ok);
    assert.ok(!resolveTradeForQuote(rfq, {}, body({ ...goodTrade, goodUntil: "2026-10-01T00:00:00Z" }), QUOTE_EXP, T0).ok);
    assert.ok(!resolveTradeForQuote(rfq, {}, body({ ...goodTrade, payoffConfirmed: false }), QUOTE_EXP, T0).ok);
  });
  it("accepts an allowance (defaulting good-until to the quote's expiry), a range, a decline, or a live one already on file", () => {
    const { goodUntil: _g, ...noDate } = goodTrade;
    const r = resolveTradeForQuote(rfq, {}, body(noDate), QUOTE_EXP, T0);
    assert.ok(r.ok && r.kind === "appraisal"); if (r.ok && r.kind === "appraisal") assert.equal(r.appraisal.goodUntil, "2026-10-30T23:59:59.000Z");
    assert.ok(resolveTradeForQuote(rfq, {}, body({ ...goodTrade, allowance: { mode: "range", low: "9000", high: "11000" } }), QUOTE_EXP, T0).ok);
    const d = resolveTradeForQuote(rfq, {}, body({ declined: { code: "salvage_title" } }), QUOTE_EXP, T0);
    assert.ok(d.ok && d.kind === "decline");
    assert.ok(resolveTradeForQuote(rfq, { tradeAppraisal: appraisal() }, body(undefined), QUOTE_EXP, T0).ok, "a re-quote keeps the allowance on file");
  });
  it("an allowance on file that has expired does not satisfy a new quote", () => {
    assert.ok(!resolveTradeForQuote(rfq, { tradeAppraisal: appraisal({ goodUntil: "2026-10-01T00:00:00Z" }) }, body(undefined), QUOTE_EXP, T0).ok);
    assert.ok(!resolveTradeForQuote(rfq, { tradeAppraisal: appraisal() }, body(undefined), "2026-10-16T11:00:00Z", T0).ok, "expires with a quote that already expired");
  });
  it("asks nothing when there is no trade", () => {
    const r = resolveTradeForQuote(noTrade, {}, body(undefined), QUOTE_EXP, T0);
    assert.ok(r.ok && r.kind === "none");
    assert.equal(tradeAnswerProblem({ hasTrade: false, appraisal: null, now: T0 }), null);
  });
  it("a decline needs a code, and 'other' needs a note; no contact info", () => {
    assert.ok(!parseTradeDecline({ code: "nope" }, { quoteExpiresAt: null }, T0).ok);
    assert.ok(!parseTradeDecline({ code: "other" }, { quoteExpiresAt: null }, T0).ok);
    assert.ok(!parseTradeDecline({ code: "other", note: "call me at 555-123-4567" }, { quoteExpiresAt: null }, T0).ok);
    assert.ok(parseTradeDecline({ code: "wrong_brand_mix" }, { quoteExpiresAt: null }, T0).ok);
  });
  it("stores structured conditions and rejects unknown ones", () => {
    const ok = parseAppraisalInput({ ...goodTrade, conditionChips: ["second_key", "no_frame_damage", "second_key"] }, { payoffEstimate: 4000, ownership: "financed", quoteExpiresAt: QUOTE_EXP }, T0);
    assert.ok(ok.ok); if (ok.ok) assert.deepEqual(ok.value.conditionChips, ["second_key", "no_frame_damage"]);
    assert.ok(!parseAppraisalInput({ ...goodTrade, conditionChips: ["made_up"] }, { payoffEstimate: 4000, ownership: "financed", quoteExpiresAt: QUOTE_EXP }, T0).ok);
  });
});

describe("the card's view of an allowance", () => {
  const eq = (a: DealerTradeAppraisal | null, opts = {}) => tradeEquity(true, 4000, a, T0, opts);
  it("flags 'Based on earlier details' once the buyer changed the trade, until the desk reconfirms", () => {
    assert.equal(eq(appraisal(), { tradeUpdatedAt: "2026-10-16T11:00:00Z" }).stale, true);
    assert.equal(eq(appraisal(), { tradeUpdatedAt: "2026-10-16T09:00:00Z" }).stale, false);
    assert.equal(eq(appraisal({ reconfirmedAt: "2026-10-16T11:30:00Z" }), { tradeUpdatedAt: "2026-10-16T11:00:00Z" }).stale, false);
  });
  it("expires with the vehicle quote", () => {
    assert.equal(eq(appraisal(), { quoteExpiresAt: "2026-10-16T11:00:00Z" }).status, "expired");
    assert.equal(eq(appraisal(), { quoteExpiresAt: "2026-10-20T11:00:00Z" }).status, "quoted");
  });
  it("shows a decline as its own status, with the reason", () => {
    const d = parseTradeDecline({ code: "salvage_title", note: "branded title" }, { quoteExpiresAt: null }, T0);
    assert.ok(d.ok); if (d.ok) { const e = eq(d.value); assert.equal(e.status, "declined"); assert.equal(e.declined?.code, "salvage_title"); assert.equal(otdBeforeAfter(30000, e).after, 30000); }
  });
  it("carries the conditions to the card", () => {
    const e = eq(appraisal()); assert.equal(e.conditions, "assumes no frame damage"); assert.deepEqual(e.conditionChips, ["no_frame_damage", "second_key"]);
  });
});

describe("finding the open confirmation on a request", () => {
  it("only while picked, never for a settled or walked-away desk", () => {
    const invites = [{ id: "11", tradeConfirmation: open() }] as unknown as RfqInvite[];
    assert.equal(openConfirmationOf({ status: "collecting", invites }, at(1)), null);
    assert.equal(openConfirmationOf({ status: "picked", invites }, at(1))?.invite.id, "11");
    assert.equal(openConfirmationOf({ status: "picked", invites }, at(30)), null, "past the deadline the number already stands");
  });
});
