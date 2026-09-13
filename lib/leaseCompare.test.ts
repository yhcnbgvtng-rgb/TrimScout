import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeLeaseQuotes, counterHowLine, fmtMf, fmtMoney, fmtPct } from "./leaseCompare";
import type { LeaseQuote } from "./leaseQuote";
import type { RfqInvite, RfqRequest } from "./rfq";

const NOW = new Date("2026-09-13T12:00:00Z");
const lease = (over: Partial<LeaseQuote>): LeaseQuote => ({
  capCost: 52000, residualPercent: 58, residualAmount: 30160, moneyFactor: 0.00225, termMonths: 36, milesPerYear: 10000, capReduction: 0,
  monthlyPaymentPreTax: 612, monthlyPaymentWithEstTax: 652.5,
  dueAtSigning: { firstMonth: 652.5, acquisitionFee: 695, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 299 }] },
  incentives: [], addOns: [], expiresAt: "2026-09-30T00:00:00Z", notes: null, counter: { counterOffer: false, note: "" }, ...over,
});
const invite = (id: string, dealerName: string, l: LeaseQuote | null, status: RfqInvite["status"] = l ? "quoted" : "invited"): RfqInvite => ({
  id, dealerName, dealerContactEmail: null, status, declineReason: null, invitedAt: "2026-09-13T00:00:00Z", respondedAt: null,
  quote: l ? ({ id: `q${id}`, price: l.monthlyPaymentPreTax, fees: [], totalOtdPrice: 0, vin: "V", stockNumber: null, expiresAt: l.expiresAt, mustHaveAcknowledgement: true, notes: null, lease: l } as unknown as RfqInvite["quote"]) : null,
  desk: { contactName: `${dealerName} desk`, role: "gsm", emailMasked: "x••@d.com", source: "directory" },
});
const rfq = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest => ({
  id: "1", buyerUserId: "b", invites, status: "collecting", pickedQuoteId: null, createdAt: "2026-09-13T00:00:00Z",
  vin: "V", stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LS", mustHaves: [],
  leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: null }, ...over,
});

describe("analyzeLeaseQuotes — at a glance + table eligibility, server-computable", () => {
  it("two eligible quotes: lowest monthly and lowest DAS can be different dealers; both highlight; chips are derived math", () => {
    const a = invite("1", "Dealer A", lease({ monthlyPaymentPreTax: 612, dueAtSigning: { firstMonth: 612, acquisitionFee: 995, capReduction: 0, taxes: 0, otherFees: [] } })); // DAS 1607
    const b = invite("2", "Dealer B", lease({ monthlyPaymentPreTax: 652, dueAtSigning: { firstMonth: 652, acquisitionFee: 0, capReduction: 0, taxes: 0, otherFees: [] } })); // DAS 652
    const c = analyzeLeaseQuotes(rfq([a, b]), NOW)!;
    assert.deepEqual(c.glance.lowestMonthly, { dealerName: "Dealer A", amount: 612, quoteId: "q1" });
    assert.deepEqual(c.glance.lowestDas, { dealerName: "Dealer B", amount: 652, quoteId: "q2" });
    assert.equal(c.glance.noEligible, null);
    assert.equal(c.glance.watchOuts, null);
    assert.deepEqual(c.rows.map((r) => [r.dealerName, r.bestMonthly, r.bestDas]), [["Dealer A", true, false], ["Dealer B", false, true]]);
    assert.deepEqual(c.rows[0].chips, ["$40/mo less than Dealer B", "$955 more at signing than Dealer B"]);
    assert.deepEqual(c.rows[1].chips, ["$40/mo more than Dealer A", "$955 less at signing than Dealer A"]);
  });

  it("a counter never wins lowest monthly when an eligible quote exists; it sits in the counter block with a how-it-differs line", () => {
    const cheapCounter = invite("1", "Counter Co", lease({ monthlyPaymentPreTax: 500, termMonths: 39, counter: { counterOffer: true, note: "39 carries a better residual" } }));
    const fair = invite("2", "Fair Co", lease({ monthlyPaymentPreTax: 640 }));
    const c = analyzeLeaseQuotes(rfq([cheapCounter, fair]), NOW)!;
    assert.equal(c.glance.lowestMonthly?.dealerName, "Fair Co");
    assert.deepEqual(c.rows.map((r) => [r.dealerName, r.kind]), [["Fair Co", "eligible"], ["Counter Co", "counter"]]);
    assert.equal(c.rows[1].counterHow, "39 mo instead of 36");
    assert.equal(c.rows[1].counterNote, "39 carries a better residual");
    assert.deepEqual(c.rows[1].chips, ["Counters to 39 mo instead of 36"]);
    assert.match(c.glance.watchOuts!, /1 counter on term\/miles/);
  });

  it("only counters so far → no one is crowned; the glance says so and points at the counters", () => {
    const c = analyzeLeaseQuotes(rfq([invite("1", "Counter Co", lease({ milesPerYear: 12000 }))]), NOW)!;
    assert.equal(c.glance.lowestMonthly, null);
    assert.match(c.glance.noEligible!, /No quote matches your 36 mo · 10,000 mi\/yr yet — the counters below differ/);
    assert.equal(counterHowLine({ termMonths: 36, milesPerYear: 12000 }, c.prefs), "12,000 mi/yr instead of 10,000");
  });

  it("expired quotes are greyed out of 'best' and flagged; waiting rows carry no numbers", () => {
    const dead = invite("1", "Old Co", lease({ monthlyPaymentPreTax: 400, expiresAt: "2026-09-01T00:00:00Z" }));
    const live = invite("2", "Live Co", lease({ monthlyPaymentPreTax: 700 }));
    const wait = invite("3", "Quiet Co", null);
    const c = analyzeLeaseQuotes(rfq([dead, live, wait]), NOW)!;
    assert.equal(c.glance.lowestMonthly?.dealerName, "Live Co");
    assert.deepEqual(c.rows.map((r) => [r.dealerName, r.kind]), [["Live Co", "eligible"], ["Old Co", "expired"], ["Quiet Co", "waiting"]]);
    assert.equal(c.rows[2].monthly, null);
    assert.match(c.glance.watchOuts!, /1 expired/);
    assert.deepEqual(c.counts, { quoted: 2, eligible: 1, counters: 0, expired: 1, waiting: 1 });
  });

  it("zero quotes → waiting copy only, no analysis; no lease prefs → null (finance/cash never enter the lease grid)", () => {
    const c = analyzeLeaseQuotes(rfq([invite("1", "A", null), invite("2", "B", null)]), NOW)!;
    assert.equal(c.glance.lowestMonthly, null);
    assert.equal(c.glance.lowestDas, null);
    assert.match(c.glance.noEligible!, /^Waiting on 2 dealers/);
    assert.equal(analyzeLeaseQuotes(rfq([invite("1", "A", lease({}))], { leasePrefs: null }), NOW), null);
  });

  it("formatting matches the dealer calculator: $1,280 · 53% · MF ≈ APR", () => {
    assert.equal(fmtMoney(1279.6), "$1,280");
    assert.equal(fmtPct(53), "53%");
    assert.equal(fmtMf(0.00225), "0.00225 ≈ 5.4% APR");
    assert.equal(fmtMf(0.0025), "0.00250 ≈ 6% APR");
  });
});

import fs from "node:fs";
import path from "node:path";

describe("wiring — server attaches the analysis, the page renders it, lease deals only, no prose/score", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("GET /api/rfqs/:id returns leaseCompare computed from the sanitized rfq; the page prefers it", () => {
    assert.match(read("app/api/rfqs/[id]/route.ts"), /leaseCompare: analyzeLeaseQuotes\(pub\)/);
    const page = read("app/rfq/[id]/page.tsx");
    assert.match(page, /setLeaseCompare\(\(json\.leaseCompare as LeaseCompareData \| null\) \?\? null\)/);
    assert.match(page, /<LeaseCompare data=\{leaseCompare \|\| analyzeLeaseQuotes\(rfq\)!\}/);
    assert.match(page, /\{rfq\.leasePrefs && \(\s*<div className="space-y-3">\s*<h2[^>]*>Compare lease quotes/);
    assert.match(page, /quotedInvites\.length > 0 && !rfq\.leasePrefs && \(/, "cash/finance keep their own compare");
  });
  it("the compare component: glance → same-column table (sticky dealer) → expand detail → Choose / Walk away; no inputs, no score, no price hero", () => {
    const c = read("components/LeaseCompare.tsx");
    for (const col of ["Dealer", "Monthly", "Due at signing", "Cap cost", "MF (APR)", "Residual %", "Term / miles", "Expires", "Status"]) assert.match(c, new RegExp(`>${col.replace(/[()]/g, "\\\\$&")}<`), col);
    assert.match(c, /sticky left-0/);
    assert.match(c, /data-testid="counter-divider"/);
    assert.match(c, /data-testid="lease-row-detail"/);
    assert.match(c, /data-testid="walk-away"/);
    assert.doesNotMatch(c, /<input|<select|<textarea/);
    assert.doesNotMatch(c, /score|auction|\bbid\b|list price|advertised/i);
  });
});
