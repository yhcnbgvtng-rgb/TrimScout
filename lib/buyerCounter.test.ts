import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { COUNTER_COPY, buildBuyerCounter, counterDraftFrom, counterSummary, parseBuyerCounter } from "./buyerCounter";
import { analyzeLeaseQuotes } from "./leaseCompare";
import type { LeaseQuote } from "./leaseQuote";
import type { RfqInvite, RfqRequest } from "./rfq";

const NOW = new Date("2026-09-13T12:00:00Z");
const PREFS = { termMonths: 36 as const, milesPerYear: 10000 as const, zip: "07405", timeline: null };
const quote: LeaseQuote = {
  capCost: 66000, residualPercent: 55, residualAmount: 39391, moneyFactor: 0.0019, termMonths: 36, milesPerYear: 10000, capReduction: 0,
  monthlyPaymentPreTax: 939, monthlyPaymentWithEstTax: 1001, dueAtSigning: { firstMonth: 1001, acquisitionFee: 695, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 299 }] },
  incentives: [{ name: "Lease cash / rebate", amount: 1500 }], addOns: [], expiresAt: "2026-09-30T00:00:00Z", notes: null, counter: { counterOffer: false, note: "" },
};

describe("buyer counter — structured, scoped to one quote, a request not a bid", () => {
  it("prefills term/miles from the quote and leaves money blank; asks for at least one thing", () => {
    const d = counterDraftFrom(quote, PREFS);
    assert.deepEqual(d, { targetMonthlyMax: "", maxCashDueAtSigning: "", termMonths: "36", milesPerYear: "10000", note: "" });
    const empty = buildBuyerCounter(d, quote, "q1", NOW);
    assert.equal(empty.counter, null);
    assert.match(empty.errors[0], /Ask for something/);
  });

  it("builds a counter from $ text, refuses a target at or above the quoted monthly, keeps term/miles only when changed", () => {
    const ok = buildBuyerCounter({ targetMonthlyMax: "$875", maxCashDueAtSigning: "1,500", termMonths: "39", milesPerYear: "10000", note: " Roll the acquisition fee in? " }, quote, "q1", NOW);
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.counter, { againstQuoteId: "q1", targetMonthlyMax: 875, maxCashDueAtSigning: 1500, termMonths: 39, milesPerYear: null, note: "Roll the acquisition fee in?", sentAt: NOW.toISOString() });
    assert.equal(counterSummary(ok.counter!), "≤ $875/mo · ≤ $1,500 due at signing · 39 mo");
    const high = buildBuyerCounter({ targetMonthlyMax: "939", maxCashDueAtSigning: "", termMonths: "36", milesPerYear: "10000", note: "" }, quote, "q1", NOW);
    assert.match(high.errors[0], /below the quoted \$939\/mo/);
  });

  it("parseBuyerCounter rejects junk and empty asks; copy never says bid or auction", () => {
    assert.equal(parseBuyerCounter({ againstQuoteId: "q1" }), null);
    assert.equal(parseBuyerCounter({ againstQuoteId: "q1", targetMonthlyMax: -5 }), null);
    assert.equal(parseBuyerCounter({ targetMonthlyMax: 800 }), null, "must name the quote it answers");
    const c = parseBuyerCounter({ againstQuoteId: "q1", targetMonthlyMax: 800.4, termMonths: 39, milesPerYear: 99, note: "x".repeat(400) });
    assert.deepEqual([c?.targetMonthlyMax, c?.termMonths, c?.milesPerYear, c?.note?.length], [800, 39, null, 300]);
    assert.equal(COUNTER_COPY, "Send a counter — request, not a binding bid.");
    assert.doesNotMatch(COUNTER_COPY, /auction/i);
  });

  it("compare: a countered desk shows its last numbers greyed as 'Buyer countered'; a revised quote is a live row badged Revised", () => {
    const base = (over: Partial<RfqInvite>): RfqInvite => ({ id: "1", dealerName: "Desk", dealerContactEmail: null, status: "invited", declineReason: null, invitedAt: "2026-09-13T00:00:00Z", respondedAt: null, quote: null, ...over });
    const priorQuote = { id: "q1", price: 939, fees: [], totalOtdPrice: 0, vin: "V", stockNumber: null, expiresAt: quote.expiresAt, submittedAt: "2026-09-13T01:00:00Z", mustHaveAcknowledgement: true, notes: null, lease: quote, supersededAt: "2026-09-13T02:00:00Z" } as unknown as NonNullable<RfqInvite["quote"]>;
    const rfq = (invites: RfqInvite[]): RfqRequest => ({ id: "1", buyerUserId: "b", invites, status: "collecting", pickedQuoteId: null, createdAt: "2026-09-13T00:00:00Z", vin: "V", stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LS", mustHaves: [], leasePrefs: PREFS });
    const counter = { againstQuoteId: "q1", targetMonthlyMax: 875, maxCashDueAtSigning: null, termMonths: null, milesPerYear: null, note: null, sentAt: NOW.toISOString() };

    const pending = analyzeLeaseQuotes(rfq([base({ buyerCounter: counter, priorQuotes: [priorQuote] })]), NOW)!;
    assert.equal(pending.rows[0].kind, "countered");
    assert.equal(pending.rows[0].monthly, 939, "last numbers stay visible");
    assert.deepEqual(pending.rows[0].chips, ["You countered — waiting on a revised quote"]);
    assert.equal(pending.glance.lowestMonthly, null, "a countered (superseded) quote is not eligible");
    assert.match(pending.glance.noEligible!, /You countered a quote — revised numbers appear here/);

    const revisedLease = { ...quote, monthlyPaymentPreTax: 880 };
    const revised = analyzeLeaseQuotes(rfq([base({ status: "quoted", buyerCounter: counter, priorQuotes: [priorQuote], quote: { ...priorQuote, id: "q2", lease: revisedLease, supersededAt: null } })]), NOW)!;
    assert.equal(revised.rows[0].kind, "eligible");
    assert.equal(revised.rows[0].revised, true);
    assert.equal(revised.rows[0].chips[0], "Revised after your counter (v2)");
    assert.equal(revised.glance.lowestMonthly?.amount, 880);
  });

  it("wiring: box stores the counter and supersedes the quote; buyer route is owner-only and emails the desk; dealer page prefills and can decline; compare has Counter per live row", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    const box = read("scrapers/lightsail-crawler/src/deals_api_server.js");
    assert.match(box, /ADD COLUMN IF NOT EXISTS buyer_counter_json TEXT NULL/);
    assert.match(box, /ADD COLUMN IF NOT EXISTS superseded_at DATETIME NULL/);
    assert.match(box, /UPDATE rfq_quotes SET superseded_at = NOW\(\) WHERE invite_id = \? AND superseded_at IS NULL/);
    assert.match(box, /SET status = 'invited', responded_at = NULL, buyer_counter_json = \?, buyer_counter_at = NOW\(\)/);
    assert.match(read("scripts/box/2026-09-13-buyer-counter.sh"), /"counter handler"/);
    const route = read("app/api/rfqs/[id]/invites/[inviteId]/counter/route.ts");
    assert.match(route, /rfq\.buyerUserId !== session\.user\.id/);
    assert.match(route, /invite\.quote\.id !== counter\.againstQuoteId/);
    assert.match(route, /buyerCounterHtml\(input\)/);
    const dealer = read("app/quote-request/received/page.tsx");
    assert.match(dealer, /data-testid="buyer-counter-panel"/);
    assert.match(dealer, /initial=\{ctx\.priorLease\}/);
    assert.match(dealer, /\/api\/quote-invite\/decline/);
    const compare = read("components/LeaseCompare.tsx");
    assert.match(compare, /data-testid="counter-quote"/);
    assert.match(compare, /<BuyerCounterForm/);
    assert.match(compare, />Buyer countered</);
    assert.match(compare, />Revised</);
    for (const f of ["components/BuyerCounterForm.tsx", "components/LeaseCompare.tsx", "lib/quoteInviteEmail.ts", "app/quote-request/received/page.tsx"]) {
      assert.doesNotMatch(read(f).replace(/not an auction, not a bid|not a binding bid|not a bid/g, ""), /auction|bid[- ]out|bid war|\bbids?\b/i, f);
    }
  });
});
