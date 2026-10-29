// A dealer who declines the buyer's COUNTER keeps their original offer on the table: the buyer sees
// "Counter declined: original offer stands", the amount, and "Accept original offer" (the ordinary pick).
// "Declined" is only a dealer who declined the whole request. Same rule for lease, finance (APR) and cash,
// with or without a trade-in. Also: the vehicle title never repeats the trim ("F-150 Raptor Raptor").
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaseCompare } from "../components/LeaseCompare";
import { UsedCompare } from "../components/UsedCompare";
import { ACCEPT_ORIGINAL_LABEL, COUNTER_DECLINED_STATUS, counterDeclinedQuote, offerSummary, withCounterDeclinedOffers } from "./counterDeclined";
import { acceptedDeal } from "./acceptTrade";
import { inviteAcceptsCounter } from "./inviteState";
import { analyzeLeaseQuotes } from "./leaseCompare";
import type { LeaseQuote } from "./leaseQuote";
import { inviteOfQuote } from "./rfqClose";
import { publicRfqForBuyer, type RfqInvite, type RfqQuote, type RfqRequest } from "./rfq";
import { rfqLifecycleStage, rfqTrackerStatusLabel, vehicleLine } from "./rfqTracker";
import type { TradeInRecord } from "./trade/types";
import type { UsedCashQuote, UsedFinanceQuote } from "./usedQuote";
import { modelEndsWithTrim, vehicleTitle } from "./vehicleTitle";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const VIN = "5J6RW2H89NL000001";
const cash = (price = 40000): UsedCashQuote => ({ kind: "cash", sellingPrice: price, msrp: 42000, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: [{ name: "NJ sales tax", amount: 2650 }, { name: "Doc fee", amount: 495 }], rebates: [] });
const finance = (monthly = 612.34): UsedFinanceQuote => ({ ...cash(), kind: "finance", downPayment: 3000, amountFinanced: 39000, apr: 5.9, termMonths: 60, monthlyPaymentPreTax: monthly, monthlyPaymentWithEstTax: null, lenderName: "Honda Financial" } as unknown as UsedFinanceQuote);
const lease = (monthly = 449): LeaseQuote => ({
  capCost: 41000, residualPercent: 58, residualAmount: 24000, moneyFactor: 0.00215, termMonths: 36, milesPerYear: 12000, capReduction: 0,
  monthlyPaymentPreTax: monthly, monthlyPaymentWithEstTax: monthly + 30, dueAtSigning: { firstMonth: monthly, acquisitionFee: 995, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 495 }] },
  incentives: [], addOns: [], expiresAt: future, notes: null, counter: { counterOffer: false, note: "" },
});
const quote = (id: string, over: { used?: UsedCashQuote | UsedFinanceQuote; lease?: LeaseQuote; superseded?: boolean; expiresAt?: string } = {}): RfqQuote =>
  ({ id, inviteId: "1", dealerName: "Scott Honda", price: 40000, fees: [], totalOtdPrice: 0, vin: VIN, stockNumber: null, expiresAt: over.expiresAt ?? future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, supersededAt: over.superseded ? future : null, used: over.used ?? null, lease: over.lease ?? null }) as unknown as RfqQuote;
const counter = { againstQuoteId: "q1", sentAt: future, note: null, sheet: null };
const inv = (over: Partial<RfqInvite>): RfqInvite =>
  ({ id: "1", dealerName: "Scott Honda", dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: null, quote: null, priorQuotes: [], ...over }) as unknown as RfqInvite;
/** The dealer declined the counter: the box has status declined, no live quote, the counter on file and the original in priorQuotes. */
const counterDeclinedInvite = (original: RfqQuote, id = "1") => inv({ id, status: "declined", declineReason: "other", quote: null, buyerCounter: counter, priorQuotes: [{ ...original, supersededAt: future }] });
const trade = { vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", trim: "EX-L", mileage: 58000, payoffEstimate: 0, photos: [], createdAt: future, updatedAt: future } as unknown as TradeInRecord;
const rfqOf = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: VIN, stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: null, quotePrefs: { quoteType: "cash", cash: { zip: "07981" } }, invites, ...over }) as unknown as RfqRequest;
const used = (r: RfqRequest) => renderToStaticMarkup(<UsedCompare rfq={r} prefs={r.quotePrefs!} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
const leaseHtml = (r: RfqRequest) => renderToStaticMarkup(<LeaseCompare data={analyzeLeaseQuotes(r)!} collecting onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);

describe("which invites count as 'counter declined'", () => {
  const original = quote("q1", { used: cash() });
  it("declined + the buyer's counter + the superseded original = counter declined", () => {
    assert.equal(counterDeclinedQuote(counterDeclinedInvite(original))?.id, "q1");
  });
  it("a dealer who declined the whole request stays declined (no counter on file, or nothing quoted)", () => {
    assert.equal(counterDeclinedQuote(inv({ status: "declined", quote: null, priorQuotes: [] })), null);
    assert.equal(counterDeclinedQuote(inv({ status: "declined", quote: null, buyerCounter: counter, priorQuotes: [] })), null);
  });
  it("an open counter, a live quote or a counter against another quote is not a declined counter", () => {
    assert.equal(counterDeclinedQuote(inv({ status: "invited", buyerCounter: counter, priorQuotes: [original] })), null);
    assert.equal(counterDeclinedQuote(inv({ status: "quoted", quote: original, priorQuotes: [] })), null);
    assert.equal(counterDeclinedQuote(inv({ status: "declined", buyerCounter: { ...counter, againstQuoteId: "q0" }, priorQuotes: [original] })), null);
  });
  it("the buyer's view re-seats the original as the live quote, never as an earlier version of itself", () => {
    const [i] = publicRfqForBuyer(rfqOf([counterDeclinedInvite(original)])).invites;
    assert.equal(i.status, "quoted");
    assert.equal(i.counterDeclined, true);
    assert.equal(i.quote?.id, "q1");
    assert.equal(i.quote?.supersededAt, null);
    assert.deepEqual(i.priorQuotes, []);
    assert.equal(inviteAcceptsCounter(i), false, "a declined counter cannot be countered again");
  });
  it("leaves every other invite and request untouched", () => {
    const plain = rfqOf([inv({ status: "declined", quote: null }), inv({ id: "2", quote: original })]);
    assert.equal(withCounterDeclinedOffers(plain), plain);
  });
  it("the request reads as having a quote in, not as 'awaiting' or one fewer dealer", () => {
    const r = publicRfqForBuyer(rfqOf([counterDeclinedInvite(original)]));
    assert.equal(rfqTrackerStatusLabel(r), "1 quote in");
    assert.equal(rfqLifecycleStage(r), "responses_received");
  });
});

describe("cash compare", () => {
  const original = quote("q1", { used: cash() });
  const html = used(publicRfqForBuyer(rfqOf([counterDeclinedInvite(original)])));
  it("shows the status, the amount and 'Accept original offer' — never 'Declined' or 'No quote yet'", () => {
    assert.match(html, new RegExp(COUNTER_DECLINED_STATUS));
    assert.match(html, new RegExp(ACCEPT_ORIGINAL_LABEL));
    assert.match(html, /\$43,145/, "the original out-the-door");
    assert.doesNotMatch(html, />Declined</);
    assert.doesNotMatch(html, /No quote yet/);
    assert.doesNotMatch(html, /data-testid="counter-quote"/);
    assert.doesNotMatch(html, /Waiting ·/);
  });
  it("a dealer who declined the whole request still reads Declined", () => {
    const h = used(publicRfqForBuyer(rfqOf([inv({ status: "declined", quote: null })])));
    assert.match(h, />Declined</);
    assert.doesNotMatch(h, new RegExp(COUNTER_DECLINED_STATUS));
  });
  it("an ordinary quote keeps 'Choose this quote' and the Counter button", () => {
    const h = used(rfqOf([inv({ quote: original })]));
    assert.match(h, />Choose this quote</);
    assert.match(h, /data-testid="counter-quote"/);
    assert.doesNotMatch(h, new RegExp(ACCEPT_ORIGINAL_LABEL));
  });
  it("an expired original is just expired — there is nothing to accept", () => {
    const old = quote("q1", { used: { ...cash(), expiresAt: "2020-01-01T00:00:00Z" } });
    const h = used(publicRfqForBuyer(rfqOf([counterDeclinedInvite(old)])));
    assert.doesNotMatch(h, new RegExp(ACCEPT_ORIGINAL_LABEL));
    assert.doesNotMatch(h, />Declined</);
  });
  it("with a trade-in on the request it behaves the same", () => {
    const h = used(publicRfqForBuyer(rfqOf([counterDeclinedInvite(original)], { tradeIn: trade })));
    assert.match(h, new RegExp(COUNTER_DECLINED_STATUS));
    assert.match(h, new RegExp(ACCEPT_ORIGINAL_LABEL));
    assert.doesNotMatch(h, />Declined</);
  });
});

describe("finance (APR) compare", () => {
  const original = quote("q1", { used: finance() });
  const prefs = { quoteType: "finance", finance: { termMonths: 60, downPayment: 3000, creditBand: "excellent", zip: "07981" } };
  it("the APR, monthly and 'Accept original offer' show; the status is not 'Declined'", () => {
    const h = used(publicRfqForBuyer(rfqOf([counterDeclinedInvite(original)], { quotePrefs: prefs as never })));
    assert.match(h, new RegExp(COUNTER_DECLINED_STATUS));
    assert.match(h, new RegExp(ACCEPT_ORIGINAL_LABEL));
    assert.match(h, /\$612\.34|\$612/);
    assert.match(h, /5\.9/);
    assert.doesNotMatch(h, />Declined</);
    assert.doesNotMatch(h, /No quote yet/);
  });
  it("with a trade-in too", () => {
    const h = used(publicRfqForBuyer(rfqOf([counterDeclinedInvite(original)], { quotePrefs: prefs as never, tradeIn: trade })));
    assert.match(h, new RegExp(ACCEPT_ORIGINAL_LABEL));
    assert.doesNotMatch(h, />Declined</);
  });
});

describe("lease compare", () => {
  const original = quote("q1", { lease: lease() });
  const leaseRfq = (invites: RfqInvite[], over: Partial<RfqRequest> = {}) => publicRfqForBuyer(rfqOf(invites, { quotePrefs: undefined, leasePrefs: { termMonths: 36, milesPerYear: 12000, zip: "07981" } as never, ...over }));
  it("shows the status, the monthly and 'Accept original offer' — not 'Declined' / 'No quote yet' / 'Revised'", () => {
    const h = leaseHtml(leaseRfq([counterDeclinedInvite(original)]));
    assert.match(h, new RegExp(COUNTER_DECLINED_STATUS));
    assert.match(h, new RegExp(ACCEPT_ORIGINAL_LABEL));
    assert.match(h, /\$449/);
    assert.doesNotMatch(h, />Declined</);
    assert.doesNotMatch(h, /No quote yet/);
    assert.doesNotMatch(h, /Revised after your counter/);
    assert.doesNotMatch(h, /data-testid="counter-quote"/);
  });
  it("a whole-request decline stays Declined", () => {
    const h = leaseHtml(leaseRfq([inv({ status: "declined", quote: null })]));
    assert.match(h, />Declined</);
  });
  it("with a trade-in", () => {
    const h = leaseHtml(leaseRfq([counterDeclinedInvite(original)], { tradeIn: trade }));
    assert.match(h, new RegExp(ACCEPT_ORIGINAL_LABEL));
  });
});

describe("accepting the original goes through the ordinary pick", () => {
  const original = quote("q1", { used: cash() });
  it("the pick finds the dealer by the original quote id, before and after the buyer's view", () => {
    const raw = rfqOf([counterDeclinedInvite(original)]);
    assert.equal(inviteOfQuote(raw, "q1")?.id, "1");
    assert.equal(inviteOfQuote(publicRfqForBuyer(raw), "q1")?.id, "1");
  });
  it("once picked, the accepted deal is that dealer (trade-in prompt and 'Chosen' work)", () => {
    const picked = publicRfqForBuyer(rfqOf([counterDeclinedInvite(original)], { status: "picked", pickedQuoteId: "q1" }));
    assert.equal(acceptedDeal(picked)?.invite.id, "1");
    assert.match(used(picked), />Chosen</);
  });
  it("a staged cash deal shows the state and amount but no accept button the box would refuse", () => {
    const staged = publicRfqForBuyer(rfqOf([counterDeclinedInvite(original)], { quotePrefs: { quoteType: "cash", cash: { zip: "07981" }, staged: true } as never }));
    const src = fs.readFileSync("components/StagedDeals.tsx", "utf8");
    assert.match(src, /counter-declined-staged/);
    // The accept stays off until the box patch is installed (docs/STAGED_ACCEPT_ORIGINAL.md); then NEXT_PUBLIC_STAGED_ACCEPT_ORIGINAL=on.
    assert.match(src, /process\.env\.NEXT_PUBLIC_STAGED_ACCEPT_ORIGINAL === "on"/);
    assert.match(src, /\(!invite\.counterDeclined \|\| ACCEPT_ORIGINAL_ON\) && !isExpired/);
    assert.match(fs.readFileSync(".env.example", "utf8"), /NEXT_PUBLIC_STAGED_ACCEPT_ORIGINAL/);
    const h = renderToStaticMarkup(<UsedCompare rfq={staged} prefs={staged.quotePrefs!} staged onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
    assert.match(h, new RegExp(COUNTER_DECLINED_STATUS));
    assert.doesNotMatch(h, /data-testid="choose-quote"/);
  });
});

describe("dealer side shows the same state", () => {
  it("summarises the offer that stands, per quote type", () => {
    assert.equal(offerSummary(quote("q", { lease: lease(449) })), "$449/mo");
    assert.equal(offerSummary(quote("q", { used: finance(612.34) })), "$612/mo");
    assert.equal(offerSummary(quote("q", { used: cash() })), "$43,145 out the door");
  });
  it("the quote context reports counterDeclined, and the page leads with the same words", () => {
    const route = fs.readFileSync("app/api/quote-invite/context/route.ts", "utf8");
    assert.match(route, /counterDeclined: Boolean\(counterDeclinedQuote\(invite\)\)/);
    assert.match(route, /acceptedOriginal/);
    const page = fs.readFileSync("app/quote-request/received/page.tsx", "utf8");
    assert.match(page, /Counter declined: your original offer stands\./);
    assert.match(page, /The buyer accepted your original offer\./);
    assert.match(page, /ctx\.buyerCounter \|\| ctx\.counterDeclined/);
  });
  it("a whole-request decline keeps its own wording on the dealer page", () => {
    const page = fs.readFileSync("app/quote-request/received/page.tsx", "utf8");
    assert.match(page, /Recorded — the buyer will see you couldn&apos;t go further on this one\./);
  });
});

describe("vehicle title never repeats the trim", () => {
  it("drops the trim when the model already ends with it", () => {
    assert.equal(vehicleTitle({ year: 2026, make: "Ford", model: "F-150 Raptor", trim: "Raptor" }), "2026 Ford F-150 Raptor");
    assert.equal(vehicleTitle({ year: 2026, make: "Ford", model: "F-150 Raptor", trim: "raptor" }), "2026 Ford F-150 Raptor");
    assert.equal(vehicleTitle({ year: 2026, make: "Toyota", model: "Tundra TRD Pro", trim: "TRD Pro" }), "2026 Toyota Tundra TRD Pro");
  });
  it("keeps the trim when it is a different word, or only shares letters with the model", () => {
    assert.equal(vehicleTitle({ year: 2026, make: "Ford", model: "F-150", trim: "Raptor" }), "2026 Ford F-150 Raptor");
    assert.equal(vehicleTitle({ year: 2026, make: "Honda", model: "CR-V", trim: "V" }), "2026 Honda CR-V V");
    assert.equal(vehicleTitle({ year: 2026, make: "Honda", model: "CR-V", trim: "EX" }), "2026 Honda CR-V EX");
    assert.equal(vehicleTitle({ year: 2026, make: "Ford", model: "Raptor R", trim: "Raptor" }), "2026 Ford Raptor R Raptor");
  });
  it("tolerates missing parts", () => {
    assert.equal(vehicleTitle({ make: "Ford", model: "F-150", trim: "" }), "Ford F-150");
    assert.equal(vehicleTitle({ year: 2026, make: "Ford", model: null, trim: "Raptor" }), "2026 Ford Raptor");
    assert.equal(modelEndsWithTrim("F-150 Raptor", undefined), false);
  });
  it("the Deal Tracker's vehicle line uses it", () => {
    assert.equal(vehicleLine({ year: 2026, make: "Ford", model: "F-150 Raptor", trim: "Raptor" }), "2026 Ford F-150 Raptor");
  });
});
