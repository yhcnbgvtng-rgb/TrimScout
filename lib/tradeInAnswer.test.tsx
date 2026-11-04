// "Do you have a trade-in?" on a quote request: three required answers (now / later / none), stored as the box's one
// boolean `tradeInExpected` plus whether a trade-in is attached, so older requests keep working. Nothing on the box changes.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  tradeInAnswerOf, tradeInExpectedFor, tradeInIsExpected, tradeInBlocksContinue,
  tradeInReviewLabel, tradeInReviewText, TRADE_IN_REQUIRED_MESSAGE,
} from "./tradeInAnswer";
import { needsTradePrompt, tradeAttachable } from "./acceptTrade";
import { rfqLifecycleStage, rfqLifecycleDetail } from "./rfqTracker";
import { AddTradeInPrompt } from "../components/AddTradeInPrompt";
import type { RfqRequest } from "./rfq";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** A picked single-sheet (lease) request: accepting is the pick, so the add-trade-in prompt is eligible. */
const picked = (over: Record<string, unknown> = {}) => ({
  id: "17", status: "picked", pickedQuoteId: "q1", quotePrefs: null,
  leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_month" },
  invites: [{ id: "1", status: "quoted", dealerName: "Winner Toyota", quote: { id: "q1" } }],
  ...over,
}) as unknown as RfqRequest;

/** A sent request with one quote in, to read the tracker strip. */
const comparing = (over: Record<string, unknown> = {}) => ({
  id: "18", status: "collecting", approvalStatus: "approved", pickedQuoteId: null,
  invites: [{ id: "1", status: "quoted", deliveryStatus: "sent", quote: { id: "q1" } }],
  ...over,
}) as unknown as RfqRequest;

describe("the three answers and the stored boolean", () => {
  it("now, later and none store as true, true, false; no answer stores null", () => {
    assert.equal(tradeInExpectedFor("now"), true);
    assert.equal(tradeInExpectedFor("later"), true);
    assert.equal(tradeInExpectedFor("none"), false);
    assert.equal(tradeInExpectedFor(null), null);
  });
  it("reads back from a stored request: attached trade = now, true = later, false = none, null = never answered", () => {
    assert.equal(tradeInAnswerOf({ tradeInExpected: true, tradeIn: { vin: "T" } }), "now");
    assert.equal(tradeInAnswerOf({ tradeInExpected: false, tradeIn: { vin: "T" } }), "now", "a trade added after a No is a trade");
    assert.equal(tradeInAnswerOf({ tradeInExpected: true }), "later");
    assert.equal(tradeInAnswerOf({ tradeInExpected: false }), "none");
    assert.equal(tradeInAnswerOf({ tradeInExpected: null }), null);
    assert.equal(tradeInAnswerOf({}), null);
  });
  it("every new answer round-trips through the box boolean (now reads back as later until the trade is attached)", () => {
    assert.equal(tradeInAnswerOf({ tradeInExpected: tradeInExpectedFor("later") }), "later");
    assert.equal(tradeInAnswerOf({ tradeInExpected: tradeInExpectedFor("none") }), "none");
    assert.equal(tradeInAnswerOf({ tradeInExpected: tradeInExpectedFor("now"), tradeIn: {} }), "now");
  });
  it("a trade is expected for now and later, not for none or old unanswered requests", () => {
    assert.equal(tradeInIsExpected({ tradeInExpected: true }), true);
    assert.equal(tradeInIsExpected({ tradeInExpected: false, tradeIn: {} }), true);
    assert.equal(tradeInIsExpected({ tradeInExpected: false }), false);
    assert.equal(tradeInIsExpected({ tradeInExpected: null }), false);
  });
});

describe("required answer", () => {
  it("blocks Continue with no answer, and with 'now' until the details and photos are complete", () => {
    assert.equal(tradeInBlocksContinue(null, true), "unanswered");
    assert.equal(tradeInBlocksContinue("now", false), "incomplete");
    assert.equal(tradeInBlocksContinue("now", true), null);
    assert.equal(tradeInBlocksContinue("later", false), null);
    assert.equal(tradeInBlocksContinue("none", false), null);
  });
  it("the wizard shows an inline message, scrolls to the question, and keeps Continue disabled until one is picked", () => {
    const src = read("components/BiddingWizard.tsx");
    assert.match(src, /block === "unanswered"/);
    assert.match(src, /getElementById\("trade-question-section"\)\?\.scrollIntoView\?\./);
    assert.match(src, /data-testid="trade-required"/);
    assert.match(src, /aria-disabled=\{step === 3 && tradeAnswer === null \? true : undefined\}/);
    assert.match(src, /Answer the trade-in question/);
    assert.match(TRADE_IN_REQUIRED_MESSAGE, /Choose one to continue/);
  });
  it("sends the box boolean and attaches a trade only for 'Yes'", () => {
    const src = read("components/BiddingWizard.tsx");
    assert.match(src, /tradeInExpected: tradeInExpectedFor\(tradeAnswer\)/);
    assert.match(src, /tradeIn: tradeAnswer === "now" && tradeStep\.draftId \?/);
  });
  it("asks before the dealer list with three buttons, keeping the hint but not 'Optional.'", () => {
    const src = read("components/BiddingWizard.tsx");
    const q = src.indexOf('title="Do you have a trade-in?"');
    assert.ok(q > 0 && q < src.indexOf('data-testid="dealer-contact-list"'));
    for (const t of ["Yes, add my trade", "Skip, add later", '"No"']) assert.ok(src.includes(t), t);
    assert.match(src, /hint="Required\. Invited dealers see the vehicle, mileage, condition and photos if you add it now\. You can add or change it later in the deal\."/);
    assert.doesNotMatch(src, /hint="Optional\./);
  });
});

describe("review step", () => {
  it("says what the buyer chose", () => {
    assert.equal(tradeInReviewLabel("now"), "Trade-in: included");
    assert.equal(tradeInReviewLabel("later"), "Trade-in: adding later");
    assert.equal(tradeInReviewLabel("none"), "No trade-in");
  });
  it("uses quote request wording and no contact details", () => {
    for (const a of ["now", "later", "none"] as const) {
      const t = tradeInReviewText(a);
      assert.doesNotMatch(t, /\bbid/i);
      assert.doesNotMatch(t, /@|\d{3}[-.\s]\d{3,4}|https?:/i);
    }
    assert.match(tradeInReviewText("none"), /quote request/);
  });
});

describe("after the buyer accepts an offer", () => {
  it("'Skip, add later' is asked to add the trade; an old unanswered request still is", () => {
    assert.ok(needsTradePrompt(picked({ tradeInExpected: true })));
    assert.ok(needsTradePrompt(picked({ tradeInExpected: null })));
  });
  it("'No' is not prompted, but a trade can still be attached from the deal", () => {
    const rfq = picked({ tradeInExpected: false });
    assert.equal(needsTradePrompt(rfq), null);
    assert.ok(tradeAttachable(rfq), "the attach route still accepts it");
    assert.match(read("app/api/rfqs/[id]/trade-in/route.ts"), /tradeAttachable\(rfq\)/);
  });
  it("nothing is asked once a trade is on the request, or the request was walked", () => {
    assert.equal(needsTradePrompt(picked({ tradeInExpected: true, tradeIn: { vin: "T" } })), null);
    assert.equal(tradeAttachable(picked({ tradeInExpected: true, status: "walked" })), null);
  });
  it("the prompt shows for 'later'; 'No' gets only a quiet Add a trade-in link", () => {
    const later = renderToStaticMarkup(<AddTradeInPrompt rfq={picked({ tradeInExpected: true })} headers={{}} onRfq={() => {}} />);
    assert.match(later, /data-testid="add-trade-in-prompt"/);
    const none = renderToStaticMarkup(<AddTradeInPrompt rfq={picked({ tradeInExpected: false })} headers={{}} onRfq={() => {}} />);
    assert.doesNotMatch(none, /data-testid="add-trade-in-prompt"/);
    assert.match(none, /data-testid="trade-prompt-add-anyway"/);
    assert.match(none, /No trade-in on this quote request/);
  });
});

describe("tracker and deal views", () => {
  it("the Deal Tracker shows the trade-in step for now and later, not for none or old unanswered requests", () => {
    assert.equal(rfqLifecycleStage(comparing({ tradeInExpected: true })), "trade_in_evaluation");
    assert.equal(rfqLifecycleStage(comparing({ tradeInExpected: false, tradeIn: {} })), "trade_in_evaluation");
    assert.equal(rfqLifecycleStage(comparing({ tradeInExpected: false })), "responses_received");
    assert.equal(rfqLifecycleStage(comparing({ tradeInExpected: null })), "responses_received");
    assert.match(rfqLifecycleDetail(comparing({ tradeInExpected: true })), /trade-in/);
    assert.match(read("components/DealTrackerDashboard.tsx"), /showTradeIn=\{tradeInIsExpected\(rfq\)\}/);
  });
  it("the deal stage line says skipped only for No, and 'adding it in the deal' for later", () => {
    const src = read("components/StagedDeals.tsx");
    assert.match(src, /a === "later"\) return " \(you're adding it in the deal\)"/);
    assert.match(src, /skipped: you have no trade-in/);
    assert.match(src, /Value your trade-in\{tradeStageNote\(rfq\)\}/);
  });
  it("dealers are told a trade-in is expected for later, and 'No trade-in' for none; the invite email says Coming", () => {
    const page = read("app/quote-request/received/page.tsx");
    assert.match(page, /The buyer has a trade-in and will add it in the deal\./);
    assert.match(page, /No trade-in\./);
    assert.match(read("lib/quoteInviteEmail.ts"), /input\.tradeInExpected === true \? row\("Trade-in", `Coming/);
  });
  it("old draft restore: true was Yes, false was Skip", () => {
    const src = read("components/BiddingWizard.tsx");
    assert.match(src, /setTradeAnswer\(oldTrade \? "now" : "none"\)/);
  });
});
