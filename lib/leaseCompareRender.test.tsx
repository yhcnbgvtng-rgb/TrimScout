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
  it("dealers are columns: line-item labels down the left in locked order; At a glance cards still there; no composite score", () => {
    const rowLabels = Array.from(html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)).map((m) => m[1]);
    assert.deepEqual(rowLabels, ["Monthly", "Due at signing", "Cap cost", "MF (APR)", "Residual %", "Term / miles", "Add-ons", "Fees", "Sales tax", "Rebates / credits", "Expires"]);
    assert.match(html, /data-columns="2"/, "two quotes, two dealer columns");
    assert.match(html, /Lowest monthly/); assert.match(html, /Lowest due at signing/); assert.match(html, /Watch-outs/);
    assert.doesNotMatch(html, /score|auction|bid war/i);
  });
  it("monthly vs due-at-signing reads across: numbers with their deltas underneath, best cells highlighted", () => {
    assert.match(html, /\$664<\/span><span[^>]*>\/mo<\/span><span[^>]*data-testid="money-note">\$54\/mo less than Lexus of Route 10/);
    assert.match(html, /\$718<\/span><span[^>]*>\/mo<\/span><span[^>]*data-testid="money-note">\$54\/mo more than Bob Johnson Lexus/);
    assert.match(html, /data-testid="money-note">\$[\d,]+ (more|less) at signing than/);
    assert.equal((html.match(/<td[^>]*bg-brand-500\/10/g) || []).length, 2, "one best-monthly cell and one best-DAS cell");
  });
  it("the dealer header is name + contact + status; add-ons and fees are named in their own rows", () => {
    const heads = Array.from(html.matchAll(/<th scope="col"[^>]*data-testid="quote-col-[^"]*"[^>]*>[\s\S]*?<\/th>/g)).map((m) => m[0]);
    assert.equal(heads.length, 2);
    assert.match(heads[0], /Bob Johnson Lexus/); assert.match(heads[0], /Sales desk/);
    assert.match(heads[1], /Lexus of Route 10/); assert.match(heads[1], /E\. Ruby/);
    for (const c of heads) assert.doesNotMatch(c, /less than|more than|e••••@/);
    assert.match(html, /Wheel &amp; tire protection/, "add-ons are named in the Add-ons row");
    assert.match(html, /Title &amp; registration/, "fees are named in the Fees row");
    assert.match(html, /data-testid="lines-summary">.*1 add-on \+\$899.*1 incentive/);
  });
  it("Choose, Counter and Walk away sit in each dealer's column footer", () => {
    assert.match(html, /data-testid="choose-quote">Choose this quote<\/button><div[^>]*><button[^>]*data-testid="counter-quote">Counter<\/button><button[^>]*data-testid="walk-away">Walk away<\/button><\/div>/);
    assert.equal((html.match(/data-testid="quote-col-footer"/g) || []).length, 2);
    assert.match(html, /Matches your ask/);
  });
});

// 1, 3 and 5 dealers; a counter gets its own block on the same grid; every table scrolls sideways.
const many = (n: number, extra: Partial<LeaseQuote>[] = []) => ({
  ...rfq,
  invites: Array.from({ length: n }, (_, i) => invite(String(30 + i), `Dealer ${i + 1}`, `Desk ${i + 1}`, lease({ monthlyPaymentPreTax: 700 + i * 10, ...(extra[i] || {}) }))),
}) as unknown as RfqRequest;
const render = (r: RfqRequest, narrow = false) => {
  const d = analyzeLeaseQuotes(r, NOW)!;
  const out = renderToStaticMarkup(<div style={narrow ? { width: 375 } : undefined}><LeaseCompare data={d} collecting onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} /></div>);
  return out;
};
describe("column compare at 1, 3 and 5 dealers", () => {
  for (const n of [1, 3, 5]) {
    it(`${n} dealer${n === 1 ? "" : "s"}: ${n} columns, one label column, fixed readable width, scroll container`, () => {
      const html = render(many(n));
      assert.match(html, new RegExp(`data-testid="lease-table" data-columns="${n}"`));
      assert.equal((html.match(/data-testid="quote-col-eligible"/g) || []).length, n);
      assert.equal((html.match(/<th scope="row"/g) || []).length, 12, "11 line-item labels + the actions row, once");
      assert.match(html, /overflow-auto/, "the table scrolls sideways when it outgrows the screen");
      assert.match(html, /w-\[15\.5rem\] min-w-\[15\.5rem\] max-w-\[15\.5rem\]/, "capped readable column width");
      assert.match(html, /sticky left-0/); assert.match(html, /sticky top-0/);
      assert.equal((html.match(/data-testid="choose-quote"/g) || []).length, n);
    });
  }
  it("narrow width keeps the column grid (swipe sideways) — no stacked full cards", () => {
    const html = render(many(3), true);
    assert.match(html, /data-columns="3"/);
    assert.doesNotMatch(html, /sm:hidden|md:hidden/, "no separate stacked mobile view");
    assert.equal((html.match(/<table/g) || []).length, 1);
  });
  it("a counter gets its own block under the main table, same rows, with a counter badge column", () => {
    const html = render(many(3, [{}, { termMonths: 39, counter: { counterOffer: true, note: "39 mo works better" } }, {}]));
    assert.match(html, /data-testid="lease-table" data-columns="2"/);
    assert.match(html, /data-testid="counters-block"/);
    assert.match(html, /data-testid="lease-counters-table" data-columns="1"/);
    assert.match(html, /data-testid="counter-badge">Counter</);
    assert.ok(html.indexOf('data-testid="lease-table"') < html.indexOf('data-testid="counters-block"'));
    assert.equal((html.match(/<th scope="row"/g) || []).length, 24, "both tables use the same line-item rows");
  });
  it("expanding a dealer shows the itemized detail for that quote only", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("components/LeaseCompare.tsx", "utf8");
    assert.match(src, /isOpen && l \? \(/);
    assert.match(src, /data-testid="lease-row-detail"/);
  });
  it("copy: counters are requests, not bids", async () => {
    const fs = await import("node:fs");
    const { COUNTER_COPY } = await import("./buyerCounter");
    assert.equal(COUNTER_COPY, "Send a counter — request, not a binding bid.");
    const form = fs.readFileSync("components/CounterSheetForm.tsx", "utf8");
    assert.match(form, /grid-cols-\[minmax\(0,1fr\)_6\.5rem\]/, "label left, input right — no overlap");
    assert.match(form, /data-testid="fixed-tax-line"/);
    assert.match(form, /Comment on a line \(optional\)/); assert.match(form, /Note to the dealer \(optional\)/);
  });
});

describe("deal page: compare wins the first screen once a quote exists; actions never scroll away", () => {
  it("wiring", async () => {
    const fs = await import("node:fs");
    const page = fs.readFileSync("app/rfq/[id]/page.tsx", "utf8");
    assert.match(page, /const hasQuotes = quotedInvites\.length > 0;/);
    assert.match(page, /<details className="group rounded-2xl border border-border bg-surface" open=\{!hasQuotes\} data-testid="request-details">/, "sheet + invited dealers fold once quotes exist");
    const foldIdx = page.indexOf('data-testid="request-details"');
    const compareFirst = page.indexOf("{hasQuotes ? (");
    assert.ok(compareFirst > -1 && compareFirst < foldIdx, "with quotes, the compare renders above the folded request details");
    assert.match(page, /mx-auto max-w-6xl px-4 py-10/);
    const cols = fs.readFileSync("components/QuoteColumns.tsx", "utf8");
    assert.match(cols, /sticky left-0 z-10/, "line-item labels pinned left");
    assert.match(cols, /sticky left-0 top-0 z-30/, "header pinned top");
    const sheet = fs.readFileSync("components/LeaseQuoteSheet.tsx", "utf8");
    assert.match(sheet, /data-testid="unconfirmed-build-help"/);
    assert.match(sheet, /reduce<Record<string, ReturnType<typeof rfqVehicles>\[number\] & \{ dealers:/, "one row per VIN, rooftops listed under it");
  });
});
