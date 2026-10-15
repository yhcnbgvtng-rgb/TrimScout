// Buyer cash-quote compare: MSRP required on the dealer sheet, % off MSRP, vs. best, badges, OTD excluding add-ons.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsedCompare } from "../components/UsedCompare";
import { compareCashQuotes, feesTotal, msrpDiscount, otdExcludingAddOns } from "./cashCompare";
import { cashOutTheDoor, parseQuotePrefs, validateUsedQuote, type UsedCashQuote } from "./usedQuote";
import type { RfqInvite, RfqRequest } from "./rfq";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const VIN = "5J6RW2H89NL000001";
const cash = (over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({ kind: "cash", sellingPrice: 40000, msrp: 42000, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: [{ name: "NJ sales tax", amount: 2650 }, { name: "Doc fee", amount: 495 }], rebates: [], ...over });
const invite = (id: string, name: string, used: UsedCashQuote, vin = VIN): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: null, quote: { id: `q${id}`, price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin, stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used } }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[]): RfqRequest => ({ id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: VIN, stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: null, quotePrefs: { quoteType: "cash", cash: { zip: "07981" } }, invites }) as unknown as RfqRequest;
const render = (r: RfqRequest) => renderToStaticMarkup(<UsedCompare rfq={r} prefs={r.quotePrefs!} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
const rowHtml = (html: string, row: string) => Array.from(html.matchAll(new RegExp(`<tr data-row="${row}">([\\s\\S]*?)</tr>`, "g")))[0]?.[1] ?? "";
const labels = (html: string) => Array.from(html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)).map((m) => m[1]);

describe("MSRP on the dealer quote", () => {
  const prefs = parseQuotePrefs({ quoteType: "cash", cash: { zip: "07405" } })!;
  const car = { vin: "V", condition: "new" as const };
  it("is required on a new or revised sheet, with a clear error", () => {
    for (const msrp of [undefined, null, 0, -5]) {
      const r = validateUsedQuote(cash({ msrp }), prefs, { ...car, requireMsrp: true });
      assert.ok(r.errors.some((e) => /^MSRP is required/.test(e)), `msrp=${msrp}`);
    }
    assert.ok(!validateUsedQuote(cash(), prefs, { ...car, requireMsrp: true }).errors.some((e) => /MSRP/.test(e)));
  });
  it("is not demanded when re-validating an older quote (accepting a buyer counter)", () => {
    assert.ok(!validateUsedQuote(cash({ msrp: undefined }), prefs, car).errors.some((e) => /MSRP/.test(e)));
  });
});

describe("cash compare maths", () => {
  it("% off MSRP uses the selling price only: $2,000 on $42,000 = 4.8% off", () => {
    assert.deepEqual(msrpDiscount({ sellingPrice: 40000, msrp: 42000 }), { status: "off", msrp: 42000, dollars: 2000, pct: 4.8, ratio: 2000 / 42000 });
  });
  it("above MSRP, at MSRP, and no MSRP", () => {
    const above = msrpDiscount({ sellingPrice: 43000, msrp: 42000 });
    assert.equal(above.status, "above");
    assert.equal(msrpDiscount({ sellingPrice: 42000, msrp: 42000 }).status, "at");
    for (const msrp of [undefined, null, 0]) assert.equal(msrpDiscount({ sellingPrice: 40000, msrp }).status, "none");
  });
  it("fees are the named non-tax lines; add-ons are not fees", () => {
    const q = cash({ addOns: [{ name: "Nitrogen", amount: 1000 }], noAddOns: false });
    assert.equal(feesTotal(q), 495);
  });
  it("OTD excluding add-ons = OTD − add-ons (rebates stay in)", () => {
    const q = cash({ addOns: [{ name: "Nitrogen", amount: 1000 }], noAddOns: false, rebates: [{ name: "Loyalty", amount: 500 }] });
    assert.equal(cashOutTheDoor(q), 43645);
    assert.equal(otdExcludingAddOns(q), 42645);
  });
  it("gap to the lowest, badges, ties share, lone quote earns none", () => {
    const a = cash(), b = cash({ sellingPrice: 39000, dueAtSigning: [{ name: "NJ sales tax", amount: 2585 }, { name: "Doc fee", amount: 800 }] }), c = cash({ msrp: undefined });
    const r = compareCashQuotes([a, b, c].map((q, i) => ({ id: String(i), otd: cashOutTheDoor(q), quote: q })));
    assert.equal(r.gapToBest["1"], 0);
    assert.equal(r.gapToBest["0"], cashOutTheDoor(a) - cashOutTheDoor(b));
    assert.deepEqual(r.lowestOtd, ["1"]);
    assert.deepEqual(r.biggestDiscount, ["1"], "the quote with no MSRP sits out of the % comparison");
    assert.deepEqual(r.lowestFees, ["0", "2"], "tied on fees → both");
    const solo = compareCashQuotes([{ id: "0", otd: 1, quote: a }]);
    assert.deepEqual([solo.lowestOtd, solo.biggestDiscount, solo.lowestFees], [[], [], []]);
    const same = compareCashQuotes([a, a].map((q, i) => ({ id: String(i), otd: cashOutTheDoor(q), quote: q })));
    assert.deepEqual([same.lowestOtd, same.biggestDiscount, same.lowestFees], [[], [], []], "everyone tied → no badge");
  });
  it("never crowns a discount at or above MSRP", () => {
    const x = cash({ sellingPrice: 43000 }), y = cash({ sellingPrice: 44000 });
    assert.deepEqual(compareCashQuotes([x, y].map((q, i) => ({ id: String(i), otd: 1 + i, quote: q }))).biggestDiscount, []);
  });
});

describe("cash compare table", () => {
  const cheap = cash({ sellingPrice: 39000, dueAtSigning: [{ name: "NJ sales tax", amount: 2585 }, { name: "Doc fee", amount: 800 }] });
  const html = render(rfqOf([invite("1", "Route 10 Honda", cash()), invite("2", "Bob Johnson Honda", cheap), invite("3", "Old Quote Honda", cash({ msrp: undefined }))]));
  it("adds the % off, OTD-excluding-add-ons rows in order", () => {
    const l = labels(html);
    assert.equal(l[l.indexOf("Selling price") + 1], "% off MSRP");
    assert.ok(l.includes("Out the door, excluding add-ons"));
    assert.equal(l[l.length - 1], "Out the door");
  });
  it("shows $ and % off, flags the best, and says so for an old quote without MSRP", () => {
    const row = rowHtml(html, "pctoff");
    assert.match(row, /\$2,000 · 4\.8% off/);
    assert.match(row, /\$3,000 · 7\.1% off/);
    assert.match(row, /MSRP not provided/);
  });
  it("shows the dollar gap under Out the door", () => {
    const row = rowHtml(html, "otd");
    assert.match(row, /Lowest quote/);
    assert.match(row, /\+\$[\d,]+ vs\. best/);
  });
  it("puts the badges in the headers", () => {
    assert.equal((html.match(/data-testid="badge-lowest-otd"/g) || []).length, 1);
    assert.equal((html.match(/data-testid="badge-biggest-discount"/g) || []).length, 1);
    assert.equal((html.match(/data-testid="badge-lowest-fees"/g) || []).length, 2, "Route 10 and the old quote tie at $495");
  });
  it("above MSRP reads 'above MSRP'", () => {
    assert.match(rowHtml(render(rfqOf([invite("1", "A", cash({ sellingPrice: 43000 })), invite("2", "B", cash())])), "pctoff"), /\$1,000 · above MSRP/);
  });
  it("an alternate vehicle keeps its badge and stays out of the ranking, gaps and badges", () => {
    const h = render(rfqOf([invite("1", "Same Car", cash()), invite("2", "Other Car", cash({ sellingPrice: 30000 }), "5J6RW2H89NL999999")]));
    assert.match(h, /data-testid="alternate-badge"/);
    assert.doesNotMatch(h, /badge-lowest-otd|badge-biggest-discount|vs\. best/);
  });
});
