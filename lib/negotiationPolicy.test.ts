import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideNegotiation, type BidSnapshot, type NegotiationGuardrails } from "./negotiationPolicy";

const bid = (totalOtdPrice: number, overrides: Partial<BidSnapshot> = {}): BidSnapshot => ({
  bidId: "bid-1",
  dealerName: "Battlefield Ford",
  totalOtdPrice,
  msrp: 64000,
  ...overrides,
});

const guardrails = (overrides: Partial<NegotiationGuardrails> = {}): NegotiationGuardrails => ({
  targetOtd: 58000,
  walkAwayOtd: 61000,
  autoAcceptUnderOtd: null,
  concessionStep: 500,
  maxCountersPerDealer: 3,
  countersAlreadySent: 0,
  fairOtdLow: null,
  fairOtdMid: null,
  ...overrides,
});

describe("decideNegotiation", () => {
  it("walks when the bid is above walk-away", () => {
    const d = decideNegotiation(bid(62000), guardrails());
    assert.equal(d.action, "walk");
    assert.equal(d.allowAutoAccept, false);
    assert.equal(d.nextTargetOtd, null);
  });

  it("recommends accept when the bid already meets target", () => {
    const d = decideNegotiation(bid(57500), guardrails());
    assert.equal(d.action, "recommend_accept");
    assert.equal(d.allowAutoAccept, false);
    assert.match(d.messageTemplate, /57,500/);
  });

  it("allows auto-accept only when the bid is under the auto-accept line", () => {
    const underAuto = decideNegotiation(bid(59000), guardrails({ autoAcceptUnderOtd: 59500 }));
    assert.equal(underAuto.action, "recommend_accept");
    assert.equal(underAuto.allowAutoAccept, true);

    const aboveAuto = decideNegotiation(bid(60000), guardrails({ autoAcceptUnderOtd: 59500 }));
    assert.notEqual(aboveAuto.action, "recommend_accept");
    assert.equal(aboveAuto.allowAutoAccept, false);
  });

  it("counters toward target by one bounded step, not straight to target, past the first look", () => {
    // otd(60000) - step(500) = 59500, still above target(58000) — one step, not the full gap.
    const d = decideNegotiation(bid(60000), guardrails({ countersAlreadySent: 1 }));
    assert.equal(d.action, "counter");
    assert.equal(d.nextTargetOtd, 59500);
    assert.equal(d.askImprovementDollars, 500);
    assert.match(d.messageTemplate, /Battlefield Ford/);
    assert.match(d.messageTemplate, /59,500/);
  });

  it("counters in bounded steps rather than jumping straight to target from far away", () => {
    // otd(60500) - step(500) = 60000, still above target(58000) — asks one step, not the full gap.
    const d = decideNegotiation(bid(60500), guardrails({ countersAlreadySent: 1 }));
    assert.equal(d.action, "counter");
    assert.equal(d.nextTargetOtd, 60000);
    assert.equal(d.askImprovementDollars, 500);
  });

  it("holds once max counters for this dealer are used up", () => {
    const d = decideNegotiation(bid(60000), guardrails({ countersAlreadySent: 3, maxCountersPerDealer: 3 }));
    assert.equal(d.action, "hold");
    assert.match(d.reason, /Out of counters/);
  });

  it("holds on the first look when the bid already sits at/under a fair-mid estimate", () => {
    const d = decideNegotiation(bid(59000), guardrails({ fairOtdMid: 59500, countersAlreadySent: 0 }));
    assert.equal(d.action, "hold");
    assert.match(d.reason, /fair mid/);

    // But once a counter has already gone out, the same bid counters normally instead of holding again.
    const secondLook = decideNegotiation(bid(59000), guardrails({ fairOtdMid: 59500, countersAlreadySent: 1 }));
    assert.equal(secondLook.action, "counter");
  });

  it("holds instead of guessing when target is misconfigured above walk-away", () => {
    const d = decideNegotiation(bid(60000), guardrails({ targetOtd: 62000, walkAwayOtd: 61000 }));
    assert.equal(d.action, "hold");
    assert.match(d.reason, /guardrails/);
  });

  it("holds when the bid, target, or walk-away isn't a finite number", () => {
    const d = decideNegotiation(bid(NaN), guardrails());
    assert.equal(d.action, "hold");
    assert.match(d.reason, /Missing numeric/);
  });

  it("never lets the LLM-facing fields imply a different action than what's returned", () => {
    // walk/hold always carry an empty template or a fixed non-negotiating
    // line — never a dollar figure an LLM could be tempted to "polish" into
    // a different number.
    const walked = decideNegotiation(bid(70000), guardrails());
    assert.equal(walked.nextTargetOtd, null);
    assert.equal(walked.askImprovementDollars, null);
  });
});
