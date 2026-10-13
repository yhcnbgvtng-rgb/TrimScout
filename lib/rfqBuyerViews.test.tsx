// Regression: the buyer's /rfq/:id page showed the route error screen ("Something went wrong on this page") for RFQ 42, the SAFE MODE test deal.
// Its stored quotePrefs were { quoteType: "cash", staged: true } with no `cash` object (the app always writes one through parseQuotePrefs; the test
// script wrote straight to the box), and UsedCompare read `prefs.cash.zip` -> "Cannot read properties of undefined (reading 'zip')".
// The fixture is RFQ 42's real API response (dealer token and contact details removed).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { publicRfqForBuyer, type RfqRequest } from "./rfq";
import { asRfq, asRfqs } from "./rfqApi";
import { coerceQuotePrefs, parseQuotePrefs } from "./usedQuote";
import { isStagedRfq, stageOf, stageSummary } from "./dealStages";
import * as T from "./rfqTracker";
import { StagedDeals } from "../components/StagedDeals";
import { UsedCompare } from "../components/UsedCompare";
import { AddTradeInPrompt } from "../components/AddTradeInPrompt";
import { UnsubscribedBanner } from "../components/UnsubscribedBanner";
import { DealStageBar } from "../components/DealStageBar";
import { DealThreadPanel } from "../components/DealThreadPanel";
import { DealTrackerDashboard } from "../components/DealTrackerDashboard";

const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib/testdata/rfq42-safe-mode.json"), "utf8")).rfq;
const noop = () => undefined;
const variant = (over: Record<string, unknown>, inviteOver: Record<string, unknown> = {}) =>
  publicRfqForBuyer(asRfq({ ...raw, ...over, invites: raw.invites.map((i: object) => ({ ...i, ...inviteOver })) }));

const views = (rfq: RfqRequest): Record<string, () => unknown> => ({
  StagedDeals: () => renderToStaticMarkup(<StagedDeals rfq={rfq} headers={{}} onRfq={noop} onWalkAll={noop as never} />),
  UsedCompare: () => renderToStaticMarkup(<UsedCompare rfq={rfq} prefs={rfq.quotePrefs as never} staged={isStagedRfq(rfq)} onPick={noop as never} onWalk={noop as never} onCounter={noop as never} busy={null as never} />),
  AddTradeInPrompt: () => renderToStaticMarkup(<AddTradeInPrompt rfq={rfq} headers={{}} onRfq={noop} />),
  UnsubscribedBanner: () => renderToStaticMarkup(<UnsubscribedBanner rfq={rfq} />),
  DealStageBar: () => renderToStaticMarkup(<DealStageBar state={stageOf(rfq, rfq.invites[0]) as never} />),
  trackerHelpers: () => [T.rfqLifecycleStage(rfq as never), T.rfqLifecycleDetail(rfq as never), T.rfqTrackerStatus(rfq as never), T.rfqTrackerStatusLabel(rfq as never), T.rfqQuoteTypeLabel(rfq), T.rfqDealNumber(rfq), T.rfqVehicleSummary(rfq as never), stageSummary(stageOf(rfq, rfq.invites[0]) as never)],
  DealThreadPanel: () => renderToStaticMarkup(<DealThreadPanel endpoint="/x" viewer="buyer" seenKey="k" heading="Chat" initial={{ viewer: "buyer", entries: [
    { id: "1", at: "2026-10-13T19:20:30Z", side: "dealer", kind: "message", text: "Happy to hold the car until Friday.", messageId: "m1" },
    { id: "2", at: "2026-10-13T19:20:31Z", side: "system", kind: "event", text: "Deal accepted" }], canPost: true, readOnlyReason: null, finalAccepted: true, messaging: true, otherParty: "Dealer" } as never} />),
  DealTrackerDashboard: () => renderToStaticMarkup(<DealTrackerDashboard requests={[]} bids={[]} quoteRequests={[rfq]} onOpenLiveDealRoom={noop as never} onStartNewBid={noop} onToggleTradeIn={noop as never} />),
});

describe("RFQ 42 (picked, staged deal at 'closed', quotePrefs without a cash object, trade expected but none on file)", () => {
  it("the fixture really is the shape that crashed", () => {
    assert.equal(raw.status, "picked");
    assert.deepEqual(raw.quotePrefs, { quoteType: "cash", staged: true });
    assert.equal(raw.tradeIn, null);
    assert.equal(raw.tradeInExpected, true);
    assert.equal(raw.invites[0].stage.stage, "closed");
  });

  for (const [label, rfq] of [
    ["as stored", publicRfqForBuyer(raw)],
    ["through the asRfq boundary", publicRfqForBuyer(asRfq(raw))],
  ] as const) {
    for (const [name, render] of Object.entries(views(rfq))) {
      it(`${name} renders (${label})`, () => { assert.doesNotThrow(render); });
    }
  }

  it("UsedCompare shows the deal without inventing a ZIP", () => {
    const html = (views(publicRfqForBuyer(asRfq(raw))).UsedCompare as () => string)();
    assert.match(html, /Tax is as each dealer quoted it/);
    assert.doesNotMatch(html, /ZIP undefined|ZIP null|undefined/);
  });
});

describe("other missing or null data in the buyer views", () => {
  const cases: Array<[string, RfqRequest]> = [
    ["no quotePrefs.cash at all", variant({ quotePrefs: { quoteType: "cash" } })],
    ["quotePrefs.cash is null", variant({ quotePrefs: { quoteType: "cash", cash: null, staged: true } })],
    ["no stage state on the invite", variant({}, { stage: null })],
    ["no quote on the invite", variant({}, { quote: null, stage: null, status: "invited" })],
    ["no trade-in, none expected", variant({ tradeIn: null, tradeInExpected: false })],
    ["a partial trade-in", variant({ tradeIn: { year: 2019, make: "Toyota", model: "Camry", mileage: 48000, photos: [] } })],
    ["no fee overrides / no counter / no appraisal fields", variant({}, { buyerCounter: undefined, buyerCounterAt: undefined, tradeAppraisal: undefined, tradePhotoRequest: undefined })],
  ];
  for (const [label, rfq] of cases) {
    for (const [name, render] of Object.entries(views(rfq))) {
      // A request with no quote has nothing for the finance/stage helpers to show, but nothing may throw.
      it(`${name} renders: ${label}`, () => { assert.doesNotThrow(render); });
    }
  }
});

describe("coerceQuotePrefs", () => {
  it("always gives a cash request a cash object, keeps staged, and never invents a ZIP", () => {
    assert.deepEqual(coerceQuotePrefs({ quoteType: "cash", staged: true }), { quoteType: "cash", cash: { zip: "", timeline: null }, staged: true });
    assert.deepEqual(coerceQuotePrefs({ quoteType: "cash", cash: { zip: "07030", timeline: "asap" } }), { quoteType: "cash", cash: { zip: "07030", timeline: "asap" } });
    assert.deepEqual(coerceQuotePrefs({ quoteType: "cash", cash: { zip: "7030", timeline: "someday" } }), { quoteType: "cash", cash: { zip: "", timeline: null } });
    assert.deepEqual(coerceQuotePrefs({ quoteType: "cash", cash: "x" }), { quoteType: "cash", cash: { zip: "", timeline: null } });
  });
  it("keeps a complete finance ask and drops an incomplete one rather than guessing a term or credit band", () => {
    const fin = { quoteType: "finance", finance: { termMonths: 60, downPayment: 3000, creditBand: "good", zip: "07030", timeline: null } };
    assert.deepEqual(coerceQuotePrefs(fin), parseQuotePrefs(fin));
    assert.ok(coerceQuotePrefs(fin));
    assert.equal(coerceQuotePrefs({ quoteType: "finance" }), null);
    assert.equal(coerceQuotePrefs({ quoteType: "finance", finance: { termMonths: 60 } }), null);
  });
  it("returns null for anything else", () => {
    for (const v of [null, undefined, "cash", 5, [], {}, { quoteType: "lease" }]) assert.equal(coerceQuotePrefs(v), null);
  });
});

describe("asRfq / asRfqs normalise quotePrefs and the trade-in together", () => {
  it("fills in the cash object on every request read from the box", () => {
    const r = asRfq(raw);
    assert.deepEqual(r.quotePrefs, { quoteType: "cash", cash: { zip: "", timeline: null }, staged: true });
    assert.equal(r.tradeIn, null);
    assert.equal(asRfqs([raw, { ...raw, id: "43" }]).every((x) => x.quotePrefs?.quoteType === "cash" && x.quotePrefs.cash.zip === ""), true);
  });
  it("leaves requests without prefs alone", () => {
    const lease = { id: "1", quotePrefs: null, leasePrefs: { termMonths: 36 } };
    assert.equal(asRfq(lease).quotePrefs, null);
  });
});
