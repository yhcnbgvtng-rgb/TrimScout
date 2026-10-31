// Deal page reliability and ranking edge cases: a non-JSON 502 or a dropped connection must surface a plain error (load, pick, walk);
// lease "Best deal" needs two comparable quotes; with a trade the headline is the lowest post-trade OTD, alternates included.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dealPageRequest } from "./dealPageRequest";
import { UsedCompare } from "../components/UsedCompare";
import { LeaseCompare } from "../components/LeaseCompare";
import { analyzeLeaseQuotes } from "./leaseCompare";
import type { LeaseQuote } from "./leaseQuote";
import type { RfqInvite, RfqRequest } from "./rfq";
import type { UsedCashQuote } from "./usedQuote";
import type { DealerTradeAppraisal, TradeInRecord } from "./trade/types";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const html502 = () => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502, headers: { "content-type": "text/html" } });

describe("dealPageRequest: load, pick and walk never hang on a bad reply", () => {
  const calls: [string, RequestInit, string][] = [
    ["/api/rfqs/9", { headers: {} }, "Could not load this request."],
    ["/api/rfqs/9/pick", { method: "POST", body: "{}" }, "Could not record your pick."],
    ["/api/rfqs/9/walk", { method: "POST" }, "Could not record that you walked away."],
  ];
  for (const [url, init, msg] of calls) {
    it(`${url}: a 502 HTML page becomes a plain-language error`, async () => {
      globalThis.fetch = (async () => html502()) as typeof fetch;
      const r = await dealPageRequest(url, init, msg);
      assert.equal(r.ok, false);
      if (!r.ok) { assert.equal(r.status, 502); assert.ok(r.error.startsWith(msg)); assert.match(r.error, /try again/i); assert.doesNotMatch(r.error, /<|Unexpected token|JSON/); }
    });
    it(`${url}: a rejected fetch becomes a plain-language error`, async () => {
      globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
      const r = await dealPageRequest(url, init, msg);
      assert.equal(r.ok, false);
      if (!r.ok) { assert.equal(r.status, 0); assert.match(r.error, /connection/i); assert.doesNotMatch(r.error, /Failed to fetch/); }
    });
  }
  it("keeps the server's own message on a JSON error, and returns the body on success", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "This quote has expired." }), { status: 409 })) as typeof fetch;
    const bad = await dealPageRequest("/x", {}, "Could not record your pick.");
    assert.deepEqual(bad, { ok: false, status: 409, error: "This quote has expired." });
    globalThis.fetch = (async () => new Response(JSON.stringify({ rfq: { id: "9" } }), { status: 200 })) as typeof fetch;
    const good = await dealPageRequest<{ rfq: { id: string } }>("/x", {}, "n/a");
    assert.deepEqual(good, { ok: true, json: { rfq: { id: "9" } } });
  });
  it("a 200 with a non-JSON body is an error, not a silent blank page", async () => {
    globalThis.fetch = (async () => new Response("<html>ok</html>", { status: 200 })) as typeof fetch;
    const r = await dealPageRequest("/x", {}, "Could not load this request.");
    assert.equal(r.ok, false);
  });
  it("the page routes load, pick and walk through it, resets the busy flags in finally, and offers Retry", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/rfq/[id]/page.tsx"), "utf8");
    for (const u of ["/api/rfqs/${rfqId}`", "/api/rfqs/${rfqId}/pick`", "/api/rfqs/${rfqId}/walk`"]) assert.ok(src.includes(`dealPageRequest<any>(\`${u}`), u);
    assert.doesNotMatch(src, /await res\.json\(\)\s*;\s*\n\s*if \(!res\.ok\) \{\s*\n\s*setLoadError/);
    assert.equal((src.match(/\} finally \{\s*\n\s*set(Picking|Walking)\(false\)/g) || []).length, 2);
    assert.match(src, /data-testid="load-retry"/);
    assert.equal((src.match(/data-testid="action-retry"/g) || []).length, 2);
  });
});

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const ASKED = "5J6RW2H89NL000001", ALT = "5J6RW2H89NL000002";
const trade = { vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", trim: "EX-L", decodedFromVin: true, mileage: 58000, zip: "07981", conditionBand: "good", titleStatus: "clean", ownership: "financed", lenderName: "Chase", payoffEstimate: 6000, keys: "2+", historyFlag: "no", historyNotes: null, drivetrain: "2wd", options: [], updatedAt: "2020-01-01T00:00:00Z" } as unknown as TradeInRecord;
const appr = (allowance: number): DealerTradeAppraisal => ({ allowanceSingle: allowance, allowanceLow: null, allowanceHigh: null, basis: "preliminary", goodUntil: future, payoffUsed: 6000, equityComputed: allowance - 6000, conditions: null, createdAt: future } as DealerTradeAppraisal);
const cash = (price: number, tax: number): UsedCashQuote => ({ kind: "cash", sellingPrice: price, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: [{ name: "NJ sales tax", amount: tax }, { name: "Doc fee", amount: 495 }], rebates: [] });
const invite = (id: string, name: string, vin: string, quote: Record<string, unknown>, a: DealerTradeAppraisal | null): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: a, quote: { id: `q${id}`, fees: [], totalOtdPrice: 0, vin, stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, ...quote } }) as unknown as RfqInvite;
const baseRfq = { id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: ASKED, stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], lane: "same_spec" };

describe("lease: Best deal needs two comparable quotes", () => {
  const lease = (cap: number): LeaseQuote => ({ capCost: cap, residualPercent: 58, residualAmount: 30595, moneyFactor: 0.00215, termMonths: 36, milesPerYear: 12000, capReduction: 0, monthlyPaymentPreTax: 718.29, monthlyPaymentWithEstTax: 765.87, dueAtSigning: { firstMonth: 765.87, acquisitionFee: 995, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 799 }] }, incentives: [], addOns: [], expiresAt: future, notes: null, counter: { counterOffer: false, note: "" } });
  const leaseInvite = (id: string, name: string, cap: number, a: DealerTradeAppraisal | null) => invite(id, name, ASKED, { price: cap, lease: lease(cap) }, a);
  const render = (invites: RfqInvite[], withTrade: boolean) => {
    const rfq = { ...baseRfq, invites, tradeIn: withTrade ? trade : null, quotePrefs: null, leasePrefs: { termMonths: 36, milesPerYear: 12000, zip: "07981" } } as unknown as RfqRequest;
    return renderToStaticMarkup(<LeaseCompare data={analyzeLeaseQuotes(rfq)!} trade={withTrade ? { record: trade, byInvite: Object.fromEntries(invites.map((i) => [i.id, i.tradeAppraisal ?? null])) } : null} collecting onPick={() => {}} onWalk={() => {}} busy={false} />);
  };
  it("a trade with only one trade-quoted desk: no Best deal on anyone", () => {
    const h = render([leaseInvite("1", "Route 10", 50000, appr(18000)), leaseInvite("2", "Bob Johnson", 49900, null)], true);
    assert.doesNotMatch(h, /badge-best-deal/);
  });
  it("a trade with two trade-quoted desks: exactly one Best deal after trade", () => {
    const h = render([leaseInvite("1", "Route 10", 50000, appr(18000)), leaseInvite("2", "Bob Johnson", 49900, appr(12000))], true);
    assert.equal((h.match(/data-testid="badge-best-deal"/g) || []).length, 1);
    assert.match(h, /Best deal after trade/);
  });
  it("no trade, two eligible quotes: still one Best deal", () => {
    const h = render([leaseInvite("1", "Route 10", 50000, null), leaseInvite("2", "Bob Johnson", 49900, null)], false);
    assert.equal((h.match(/data-testid="badge-best-deal"/g) || []).length, 1);
  });
});

describe("cash with a trade: the headline is the lowest post-trade OTD, alternates included", () => {
  const render = (invites: RfqInvite[]) => renderToStaticMarkup(<UsedCompare rfq={{ ...baseRfq, invites, tradeIn: trade, quotePrefs: { quoteType: "cash", cash: { zip: "07405" } } } as unknown as RfqRequest} prefs={{ quoteType: "cash", cash: { zip: "07405", timeline: null } } as never} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
  const glance = (h: string) => { const at = h.indexOf('data-testid="used-glance-best"'); return h.slice(at, h.indexOf("</div>", at)); };
  const q = (c: UsedCashQuote) => ({ price: c.sellingPrice, used: c });
  // Exact build: 40,000 + 2,650 + 495 = 43,145 − (18,000 − 6,000) = 31,145. Alternate: 38,000 + 2,500 + 495 = 40,995 − (20,000 − 6,000) = 26,995.
  const h = render([invite("1", "Exact Honda", ASKED, q(cash(40000, 2650)), appr(18000)), invite("2", "Alt Honda", ALT, q(cash(38000, 2500)), appr(20000))]);
  it("headlines the alternate at its post-trade OTD, labelled as an alternate", () => {
    const g = glance(h);
    assert.match(g, /Alt Honda/);
    assert.match(g, /\$26,995/);
    assert.match(g, /Alternate vehicle/);
    assert.doesNotMatch(g, /tabular-nums">\$31,145/);
  });
  it("still names the exact-build desk separately, and gives no Best deal (one comparable quote)", () => {
    assert.match(glance(h), /Best for your exact build: Exact Honda/);
    assert.doesNotMatch(h, /badge-best-deal/);
  });
  it("a cheaper exact build still wins the headline over a pricier alternate", () => {
    const h2 = render([invite("1", "Exact Honda", ASKED, q(cash(36000, 2400)), appr(18000)), invite("2", "Alt Honda", ALT, q(cash(38000, 2500)), appr(18000))]);
    assert.match(glance(h2), /Exact Honda/);
  });
});
