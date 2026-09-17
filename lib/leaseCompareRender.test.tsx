// Renders the compare table for the two seeded Lexus quotes (Bob Johnson: lower monthly, higher DAS;
// Route 10: higher monthly, lower DAS) and checks the primary band is scannable: money columns are
// first-class with their deltas underneath, the dealer cell holds no comparison badges, add-ons are a
// one-line summary until expanded.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaseCompare } from "../components/LeaseCompare";
import { analyzeLeaseQuotes } from "./leaseCompare";
import type { LeaseQuote } from "./leaseQuote";
import type { RfqInvite, RfqRequest } from "./rfq";

const NOW = new Date("2026-09-17T12:00:00Z");
const lease = (over: Partial<LeaseQuote>): LeaseQuote => ({
  capCost: 50200, residualPercent: 58, residualAmount: 30595, moneyFactor: 0.00215, termMonths: 36, milesPerYear: 12000, capReduction: 0,
  monthlyPaymentPreTax: 718.29, monthlyPaymentWithEstTax: 765.87, dueAtSigning: { firstMonth: 765.87, acquisitionFee: 995, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 395 }] },
  incentives: [{ name: "Lexus lease cash", amount: 1000 }], addOns: [{ name: "Wheel & tire protection", amount: 899 }], expiresAt: "2026-09-27T00:00:00Z", notes: null, counter: { counterOffer: false, note: "" }, ...over,
});
const invite = (id: string, dealerName: string, contactName: string, l: LeaseQuote): RfqInvite =>
  ({ id, dealerName, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: "2026-09-17T00:00:00Z", respondedAt: "2026-09-17T01:00:00Z", desk: { contactName, role: "sales", emailMasked: "e••••@example.com", source: "directory" }, quote: { id: `q${id}`, price: l.capCost, fees: [], totalOtdPrice: 0, vin: "2T2HGCEZ9TC38B302", stockNumber: null, expiresAt: l.expiresAt, submittedAt: "2026-09-17T01:00:00Z", mustHaveAcknowledgement: true, notes: null, lease: l, supersededAt: null } }) as unknown as RfqInvite;
const rfq: RfqRequest = { id: "26", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: "2026-09-17T00:00:00Z", vin: "2T2HGCEZ9TC38B302", stockNumber: null, vehicleYear: 2026, vehicleMake: "Lexus", vehicleModel: "NX", vehicleTrim: "350 Luxury", mustHaves: [], leasePrefs: { termMonths: 36, milesPerYear: 12000, zip: "07981" }, invites: [
  invite("23", "Lexus of Route 10", "E. Ruby", lease({})),
  invite("24", "Bob Johnson Lexus", "Sales desk", lease({ capCost: 49900, capReduction: 1500, monthlyPaymentPreTax: 664.42, monthlyPaymentWithEstTax: 717.57, dueAtSigning: { firstMonth: 717.57, acquisitionFee: 995, capReduction: 1500, taxes: 120, otherFees: [{ name: "Doc fee", amount: 175 }, { name: "Title & registration", amount: 395 }] }, addOns: [] })),
] } as unknown as RfqRequest;

describe("Compare lease quotes — an airy, scannable primary band", () => {
  const data = analyzeLeaseQuotes(rfq, NOW)!;
  const html = renderToStaticMarkup(<LeaseCompare data={data} collecting onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
  it("locked columns, in order; At a glance cards still there; no composite score", () => {
    const headers = Array.from(html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)).map((m) => m[1]);
    assert.deepEqual(headers, ["Dealer", "Monthly", "Due at signing", "Cap cost", "MF (APR)", "Residual %", "Term / miles", "Expires", "Status"]);
    assert.match(html, /Lowest monthly/); assert.match(html, /Lowest due at signing/); assert.match(html, /Watch-outs/);
    assert.doesNotMatch(html, /score|auction|bid war|OTD/i);
  });
  it("monthly vs due-at-signing reads in one pass: big numbers with their deltas underneath, best cells highlighted", () => {
    assert.match(html, /\$664<span[^>]*>\/mo<\/span><\/span><span[^>]*data-testid="money-note">\$54\/mo less than Lexus of Route 10/);
    assert.match(html, /\$718<span[^>]*>\/mo<\/span><\/span><span[^>]*data-testid="money-note">\$54\/mo more than Bob Johnson Lexus/);
    assert.match(html, /data-testid="money-note">\$[\d,]+ (more|less) at signing than/);
    assert.equal((html.match(/bg-emerald-500\/10/g) || []).length, 2, "one best-monthly cell and one best-DAS cell");
  });
  it("the dealer cell is just the name and the contact — no badges, no email; add-ons are a one-line summary", () => {
    // Rows are ranked by monthly, so Bob Johnson (lower monthly) is first; check both dealer cells.
    const dealerCells = Array.from(html.matchAll(/<td class="sticky[^"]*"[^>]*>[\s\S]*?<\/td>/g)).map((m) => m[0]);
    assert.equal(dealerCells.length, 2);
    assert.match(dealerCells[0], /Bob Johnson Lexus/); assert.match(dealerCells[0], /Sales desk/);
    assert.match(dealerCells[1], /Lexus of Route 10/); assert.match(dealerCells[1], /E\. Ruby/);
    for (const c of dealerCells) assert.doesNotMatch(c, /less than|more than|e••••@/);
    assert.match(html, /data-testid="lines-summary">.*1 add-on \+\$899.*1 incentive/);
    assert.doesNotMatch(html, /Wheel &amp; tire protection/, "the add-on's name waits for the expand");
    assert.match(html, /py-4 align-top/, "16px vertical cell padding");
  });
  it("Choose is green and primary, Counter secondary, side by side", () => {
    assert.match(html, /data-testid="choose-quote">Choose this quote<\/button><button[^>]*data-testid="counter-quote">Counter<\/button>/);
    assert.match(html, /Matches your ask/);
  });
});
