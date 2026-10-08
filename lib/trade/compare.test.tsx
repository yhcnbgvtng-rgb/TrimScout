// Trade lines on the compare, and the dealer-side appraisal / photo-request validation.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsedCompare } from "../../components/UsedCompare";
import { LeaseCompare } from "../../components/LeaseCompare";
import { analyzeLeaseQuotes } from "../leaseCompare";
import type { LeaseQuote } from "../leaseQuote";
import type { RfqInvite, RfqRequest } from "../rfq";
import type { UsedCashQuote, UsedFinanceQuote } from "../usedQuote";
import { parseAppraisalInput, parsePhotoRequestInput } from "./dealer";
import type { DealerTradeAppraisal, TradeInRecord } from "./types";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const lines = (tax: number) => [{ name: "NJ sales tax", amount: tax }, { name: "Doc fee", amount: 495 }];
const cash = (price: number, tax: number): UsedCashQuote => ({ kind: "cash", sellingPrice: price, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: lines(tax), rebates: [] });
const fin = (price: number, tax: number): UsedFinanceQuote => ({ kind: "finance", sellingPrice: price, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: lines(tax), rebates: [], downPayment: 2000, amountFinanced: 40000, apr: 5.9, termMonths: 60, monthlyPaymentPreTax: 770, monthlyPaymentWithEstTax: 820 });
const tradeIn = (over: Partial<TradeInRecord> = {}): TradeInRecord => ({ vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", trim: "EX-L", decodedFromVin: true, mileage: 58000, zip: "07981", conditionBand: "good", titleStatus: "clean", ownership: "financed", lenderName: "Chase", payoffEstimate: 6000, keys: "2+", historyFlag: "no", historyNotes: null, drivetrain: "2wd", options: [], optionsOther: null, extColor: null, intColor: null, serviceHistory: null, serviceNotes: null, tireBrake: null, mods: null, warningLights: null, intent: "apply_to_deal", odometerConfirmed: true, photos: [], createdAt: future, updatedAt: future, ...over });
const appr = (over: Partial<DealerTradeAppraisal> = {}): DealerTradeAppraisal => ({ allowanceSingle: 18000, allowanceLow: null, allowanceHigh: null, basis: "preliminary", goodUntil: future, payoffUsed: 6000, equityComputed: 12000, conditions: null, createdAt: future, ...over });
const invite = (id: string, name: string, used: UsedCashQuote | UsedFinanceQuote, tradeAppraisal: DealerTradeAppraisal | null = null): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal, quote: { id: `q${id}`, price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin: "5J6RW2H89NL000001", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used } }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[], trade: TradeInRecord | null, quoteType: "cash" | "finance" = "cash"): RfqRequest => ({ id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: "5J6RW2H89NL000001", stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: trade, quotePrefs: quoteType === "cash" ? { quoteType, cash: { zip: "07981" } } : { quoteType, finance: { termMonths: 60, downPayment: 2000, creditBand: "excellent", zip: "07981" } }, invites }) as unknown as RfqRequest;
const render = (r: RfqRequest) => renderToStaticMarkup(<UsedCompare rfq={r} prefs={r.quotePrefs!} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
const rowHtml = (html: string, row: string) => Array.from(html.matchAll(new RegExp(`<tr data-row="${row}">([\\s\\S]*?)</tr>`, "g")))[0]?.[1] ?? "";
const labels = (html: string) => Array.from(html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)).map((m) => m[1]);

describe("cash compare with a trade", () => {
  // Route 10: 40,000 + 2,650 + 495 = 43,145; trade 18,000 − 6,000 payoff = +12,000 → 31,145.
  // Bob Johnson: 39,500 + 2,617 + 495 = 42,612; trade still pending → unchanged.
  const html = render(rfqOf([invite("1", "Route 10 Honda", cash(40000, 2650), appr()), invite("2", "Bob Johnson Honda", cash(39500, 2617))], tradeIn()));
  it("adds the trade rows under Rebates / credits and OTD before / after at the end", () => {
    const l = labels(html), i = l.indexOf("Rebates / credits");
    assert.deepEqual(l.slice(i, i + 4), ["Rebates / credits", "Trade-in allowance", "Payoff to lender", "Net trade equity"]);
    assert.deepEqual(l.slice(-2), ["OTD before trade", "OTD after trade"]);
    assert.ok(!l.includes("Out the door"));
  });
  it("shows allowance, payoff, positive equity (green) and the Preliminary label; OTD before and after", () => {
    assert.match(rowHtml(html, "tradeallow"), /\$18,000/); assert.match(rowHtml(html, "tradeallow"), /Preliminary/);
    assert.match(rowHtml(html, "payoff"), /\$6,000/);
    assert.match(rowHtml(html, "netequity"), /text-emerald-300[^>]*data-testid="positive-equity"[^>]*>\+\$12,000/);
    assert.match(rowHtml(html, "otdbefore"), /\$43,145/); assert.match(rowHtml(html, "otdafter"), /\$31,145/);
  });
  it("a pending dealer says so and keeps their total; tax is untouched", () => {
    assert.match(rowHtml(html, "tradeallow"), /Trade value pending/);
    assert.match(rowHtml(html, "otdafter"), /\$42,612[\s\S]*trade pending; not applied/);
    assert.match(rowHtml(html, "tax"), /\$2,650/); assert.match(rowHtml(html, "tax"), /\$2,617/);
  });
  it("labels Firm, shows a range, and flags negative equity in red", () => {
    const h = render(rfqOf([
      invite("1", "A", cash(40000, 2650), appr({ basis: "firm", allowanceSingle: null, allowanceLow: 4000, allowanceHigh: 6000 })),
    ], tradeIn({ payoffEstimate: 9000 })));
    assert.match(rowHtml(h, "tradeallow"), /\$4,000 to \$6,000/); assert.match(rowHtml(h, "tradeallow"), /Firm/);
    assert.match(rowHtml(h, "netequity"), /text-rose-300[^>]*data-testid="negative-equity"[^>]*>−\$4,000[\s\S]*Negative equity/);
    assert.match(rowHtml(h, "otdafter"), /\$47,145/, "negative equity (mid 5,000 − 9,000 = −4,000) is added: 43,145 + 4,000");
  });
  it("ranks on post-trade OTD: a big trade offset by a higher price can't win by trade size alone", () => {
    const h = render(rfqOf([
      invite("1", "Big Trade Honda", cash(52000, 2650), appr({ allowanceSingle: 20000 })),   // 55,145 − 14,000 = 41,145
      invite("2", "Lower Price Honda", cash(41000, 2650), appr({ allowanceSingle: 10000 })), // 44,145 − 4,000 = 40,145
    ], tradeIn()));
    const heads = Array.from(h.matchAll(/data-testid="quote-col-quoted"[^>]*>[\s\S]*?<\/th>/g)).map((m) => m[0]);
    assert.match(heads[0], /Lower Price Honda/); assert.match(heads[1], /Big Trade Honda/);
    assert.match(h, /Lowest out the door after trade/);
  });
  it("no trade: the table is exactly as before (no trade rows, Out the door row)", () => {
    const h = render(rfqOf([invite("1", "A", cash(40000, 2650))], null));
    assert.ok(labels(h).includes("Out the door")); assert.ok(!labels(h).includes("Net trade equity")); assert.doesNotMatch(h, /Trade value pending/);
  });
  it("carries the 'dealer estimates' copy", () => assert.match(html, /Trade values are dealer estimates and may change after inspection\./));
});

describe("finance and lease: how equity is applied", () => {
  it("finance: positive equity is cash down, negative is rolled into the amount financed; monthly is not recomputed", () => {
    const up = render(rfqOf([invite("1", "A", fin(44000, 2650), appr())], tradeIn(), "finance"));
    assert.match(rowHtml(up, "applied"), /Equity applied as cash down: \$12,000[\s\S]*\$40,000 → \$28,000/);
    assert.match(rowHtml(up, "monthly"), /\$770/);
    const down = render(rfqOf([invite("1", "A", fin(44000, 2650), appr({ allowanceSingle: 3000 }))], tradeIn(), "finance"));
    assert.match(rowHtml(down, "applied"), /Negative equity rolled into amount financed: \$3,000[\s\S]*\$40,000 → \$43,000/);
    assert.match(rowHtml(down, "netequity"), /Negative equity/);
  });
  it("lease: equity is a cap cost reduction (or rolled into cap cost); pending says so", () => {
    const lease = (cap: number): LeaseQuote => ({ capCost: cap, residualPercent: 58, residualAmount: 30595, moneyFactor: 0.00215, termMonths: 36, milesPerYear: 12000, capReduction: 0, monthlyPaymentPreTax: 718.29, monthlyPaymentWithEstTax: 765.87, dueAtSigning: { firstMonth: 765.87, acquisitionFee: 995, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 799 }] }, incentives: [], addOns: [], expiresAt: future, notes: null, counter: { counterOffer: false, note: "" } });
    const mk = (id: string, name: string, l: LeaseQuote, a: DealerTradeAppraisal | null) => ({ ...invite(id, name, cash(1, 0), a), quote: { id: `q${id}`, price: l.capCost, fees: [], totalOtdPrice: 0, vin: "5J6RW2H89NL000001", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, lease: l } }) as unknown as RfqInvite;
    const invites = [mk("1", "Route 10", lease(50000), appr()), mk("2", "Bob Johnson", lease(49900), null)];
    const rfq = { ...rfqOf(invites, tradeIn()), quotePrefs: null, leasePrefs: { termMonths: 36, milesPerYear: 12000, zip: "07981" } } as unknown as RfqRequest;
    const html = renderToStaticMarkup(<LeaseCompare data={analyzeLeaseQuotes(rfq)!} trade={{ record: tradeIn(), byInvite: Object.fromEntries(invites.map((i) => [i.id, i.tradeAppraisal ?? null])) }} collecting onPick={() => {}} onWalk={() => {}} busy={false} />);
    const l = labels(html); const i = l.indexOf("Rebates / credits");
    assert.deepEqual(l.slice(i + 1, i + 5), ["Trade-in allowance", "Payoff to lender", "Net trade equity", "How equity is applied"]);
    assert.match(html, /Equity applied as cap cost reduction: \$12,000[\s\S]*cap cost \$50,000 → \$38,000/);
    assert.match(html, /Trade value pending/);
  });
});

describe("dealer appraisal input", () => {
  const ctx = { payoffEstimate: 6000, ownership: "financed", quoteExpiresAt: future };
  const NOW = new Date();
  const ok = { allowance: { mode: "single", single: "18000" }, basis: "preliminary", payoffConfirmed: true };
  it("computes equity server-side from the buyer's payoff and defaults good-until to the quote's expiry", () => {
    const r = parseAppraisalInput(ok, ctx, NOW);
    assert.ok(r.ok); if (r.ok) { assert.equal(r.value.equityComputed, 12000); assert.equal(r.value.payoffUsed, 6000); assert.equal(r.value.goodUntil, new Date(future).toISOString()); }
    const neg = parseAppraisalInput({ ...ok, allowance: { mode: "single", single: 4000 } }, ctx, NOW);
    assert.ok(neg.ok); if (neg.ok) assert.equal(neg.value.equityComputed, -2000);
  });
  it("allowance must be > 0 and a range must be low ≤ high", () => {
    assert.ok(!parseAppraisalInput({ ...ok, allowance: { mode: "single", single: 0 } }, ctx, NOW).ok);
    assert.ok(!parseAppraisalInput({ ...ok, allowance: { mode: "single", single: "" } }, ctx, NOW).ok);
    assert.ok(!parseAppraisalInput({ ...ok, allowance: { mode: "range", low: 20000, high: 16000 } }, ctx, NOW).ok);
    const r = parseAppraisalInput({ ...ok, allowance: { mode: "range", low: 16000, high: 20000 } }, ctx, NOW);
    assert.ok(r.ok); if (r.ok) { assert.equal(r.value.allowanceSingle, null); assert.equal(r.value.equityComputed, 12000); }
  });
  it("basis is required; lien payoff must be confirmed; a past good-until is refused; contact info is refused", () => {
    assert.ok(!parseAppraisalInput({ ...ok, basis: undefined }, ctx, NOW).ok);
    assert.ok(!parseAppraisalInput({ ...ok, payoffConfirmed: false }, ctx, NOW).ok);
    assert.ok(parseAppraisalInput({ ...ok, payoffConfirmed: false }, { payoffEstimate: 0, ownership: "owned", quoteExpiresAt: future }, NOW).ok, "owned outright: nothing to confirm");
    assert.ok(!parseAppraisalInput({ ...ok, goodUntil: "2020-01-01T00:00:00Z" }, ctx, NOW).ok);
    assert.ok(!parseAppraisalInput({ ...ok, conditions: "email me at a@b.com" }, ctx, NOW).ok);
    assert.ok(!parseAppraisalInput(ok, { ...ctx, quoteExpiresAt: null }, NOW).ok, "no quote expiry and no date typed");
  });
  it("photo requests: optional slots and/or a note; the core six are never requestable", () => {
    assert.ok(parsePhotoRequestInput({ slots: ["tire_tread", "damage_1"] }).ok);
    assert.ok(parsePhotoRequestInput({ note: "Can I see the dash lights lit?" }).ok);
    assert.ok(!parsePhotoRequestInput({ slots: ["front"] }).ok);
    assert.ok(!parsePhotoRequestInput({ slots: ["tire_tread", "odometer"] }).ok);
    assert.ok(!parsePhotoRequestInput({}).ok);
    assert.ok(!parsePhotoRequestInput({ note: "call me 201-555-0100" }).ok);
  });
});
