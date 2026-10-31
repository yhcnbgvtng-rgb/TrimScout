// Trade-in sales tax credit by state: the table, the credit math, and what the cash compare shows.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsedCompare } from "../../components/UsedCompare";
import type { RfqInvite, RfqRequest } from "../rfq";
import type { UsedCashQuote } from "../usedQuote";
import { STATE_TRADE_CREDIT, UNCONFIRMED_TRADE_TAX_NOTE, quotedTaxOf, stateOfZip, tradeTaxCredit } from "./stateTradeCredit";
import type { DealerTradeAppraisal, TradeInRecord } from "./types";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const NJ = "07981", CA = "94107", MI = "48201", AK = "99501", OH = "43215", SC = "29401";
const cash = (price: number, tax: number, over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({ kind: "cash", sellingPrice: price, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: [{ name: "Sales tax", amount: tax }, { name: "Doc fee", amount: 495 }], rebates: [], ...over });
const tradeIn = (): TradeInRecord => ({ vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", trim: "EX-L", decodedFromVin: true, mileage: 58000, zip: "07981", conditionBand: "good", titleStatus: "clean", ownership: "financed", lenderName: "Chase", payoffEstimate: 6000, keys: "2+", historyFlag: "no", historyNotes: null, drivetrain: "2wd", options: [], optionsOther: null, extColor: null, intColor: null, serviceHistory: null, serviceNotes: null, tireBrake: null, mods: null, warningLights: null, intent: "apply_to_deal", odometerConfirmed: true, photos: [], createdAt: future, updatedAt: future }) as unknown as TradeInRecord;
const appr = (allowance = 18000): DealerTradeAppraisal => ({ allowanceSingle: allowance, allowanceLow: null, allowanceHigh: null, basis: "preliminary", goodUntil: future, payoffUsed: 6000, equityComputed: allowance - 6000, conditions: null, createdAt: future }) as unknown as DealerTradeAppraisal;
const invite = (used: UsedCashQuote): RfqInvite =>
  ({ id: "1", dealerName: "Route 10 Honda", dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: appr(), quote: { id: "q1", price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin: "5J6RW2H89NL000001", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used } }) as unknown as RfqInvite;
const render = (zip: string, used: UsedCashQuote) => {
  const rfq = { id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: "5J6RW2H89NL000001", stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: tradeIn(), quotePrefs: { quoteType: "cash", cash: { zip } }, invites: [invite(used)] } as unknown as RfqRequest;
  return renderToStaticMarkup(<UsedCompare rfq={rfq} prefs={rfq.quotePrefs!} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
};
const rowHtml = (html: string, row: string) => Array.from(html.matchAll(new RegExp(`<tr data-row="${row}">([\\s\\S]*?)</tr>`, "g")))[0]?.[1] ?? "";
const allow = (n: number) => ({ low: n, mid: n, high: n });

describe("the state table", () => {
  const entries = Object.entries(STATE_TRADE_CREDIT);
  it("has all 50 states and DC", () => assert.equal(entries.length, 51));
  it("every confirmed entry cites an official https page and the date it was checked", () => {
    for (const [st, e] of entries) {
      assert.match(e.checked, /^\d{4}-\d{2}-\d{2}$/, st);
      if (e.rule === "unconfirmed") continue;
      assert.match(e.url ?? "", /^https:\/\/[^ ]+$/, st);
    }
  });
  it("counts the unconfirmed states", () => assert.deepEqual(entries.filter(([, e]) => e.rule === "unconfirmed").map(([s]) => s).sort(), ["AK", "DC", "NH", "OK", "RI"]));
  it("maps a ZIP to its state, and nothing for a missing one", () => {
    assert.equal(stateOfZip(NJ), "NJ"); assert.equal(stateOfZip(CA), "CA");
    assert.equal(stateOfZip(""), null); assert.equal(stateOfZip(undefined), null);
  });
});

describe("credit math", () => {
  const base = { sellingPrice: 40000, addOns: [], quotedTax: 2650, isNew: true };
  it("full credit state (NJ): the quote's own rate on the allowance", () => {
    const c = tradeTaxCredit({ ...base, zip: NJ, allowance: allow(18000) });
    assert.equal(c.status, "credit"); assert.equal(c.mid, 1192.5);
  });
  it("NJ's 0.4% luxury surcharge on a new car at $45,000+ is not reduced by the trade", () => {
    // 50,000 × 6.625% = 3,312.50 + 200 surcharge = 3,512.50 quoted; the credit uses the 6.625% only.
    const c = tradeTaxCredit({ zip: NJ, allowance: allow(10000), sellingPrice: 50000, addOns: [], quotedTax: 3512.5, isNew: true });
    assert.equal(c.mid, 662.5);
  });
  it("no-credit state (CA): nothing saved", () => {
    const c = tradeTaxCredit({ ...base, zip: CA, allowance: allow(18000) });
    assert.equal(c.status, "none"); assert.equal(c.mid, 0);
  });
  it("capped state (MI): only the first $12,000 counts in 2026, no limit once the cap passes $14,000", () => {
    const rate = 0.06;
    const c26 = tradeTaxCredit({ zip: MI, allowance: allow(18000), sellingPrice: 40000, addOns: [], quotedTax: 2400, isNew: true, year: 2026 });
    assert.equal(c26.mid, 12000 * rate);
    const c29 = tradeTaxCredit({ zip: MI, allowance: allow(18000), sellingPrice: 40000, addOns: [], quotedTax: 2400, isNew: true, year: 2029 });
    assert.equal(c29.mid, 18000 * rate);
  });
  it("Ohio credits a new vehicle only", () => {
    const o = { zip: OH, allowance: allow(18000), sellingPrice: 40000, addOns: [], quotedTax: 2900 };
    assert.equal(tradeTaxCredit({ ...o, isNew: true }).mid, 1305);
    assert.equal(tradeTaxCredit({ ...o, isNew: false }).status, "none");
  });
  it("South Carolina's capped fee is recomputed, so a big car saves nothing", () => {
    assert.equal(tradeTaxCredit({ zip: SC, allowance: allow(18000), sellingPrice: 40000, addOns: [], quotedTax: 500, isNew: true }).mid, 0);
    assert.equal(tradeTaxCredit({ zip: SC, allowance: allow(5000), sellingPrice: 8000, addOns: [], quotedTax: 400, isNew: true }).mid, 250);
  });
  it("the credit never exceeds the taxable price", () => {
    assert.equal(tradeTaxCredit({ zip: NJ, allowance: allow(90000), sellingPrice: 40000, addOns: [], quotedTax: 2650, isNew: true }).mid, 2650);
  });
  it("unconfirmed state, or no ZIP: no saving", () => {
    assert.equal(tradeTaxCredit({ ...base, zip: AK, allowance: allow(18000) }).status, "unconfirmed");
    assert.equal(tradeTaxCredit({ ...base, zip: null, allowance: allow(18000) }).status, "unconfirmed");
  });
  it("sums only the tax lines of the quote", () => assert.equal(quotedTaxOf([{ name: "NJ sales tax", amount: 2650 }, { name: "Doc fee", amount: 495 }]), 2650));
});

describe("the cash compare with a trade", () => {
  it("NJ (full credit): OTD after trade drops by the tax the allowance saves, shown on its own line; the dealer's tax is untouched", () => {
    const h = render(NJ, cash(40000, 2650));
    assert.match(rowHtml(h, "taxcredit"), /−\$1,193/);
    assert.match(rowHtml(h, "otdbefore"), /\$43,145/); assert.match(rowHtml(h, "otdafter"), /\$29,953/);
    assert.match(rowHtml(h, "tax"), /\$2,650/);
    assert.doesNotMatch(h, /trade-tax-unconfirmed-note/);
  });
  it("CA (no credit): the old math, no credit line, and it says why", () => {
    const h = render(CA, cash(40000, 3400));
    assert.equal(rowHtml(h, "taxcredit"), "");
    assert.match(rowHtml(h, "otdafter"), /\$31,895/, "43,895 − 12,000 net equity, tax on the full price");
    assert.match(h, /Your state gives no trade-in credit/);
  });
  it("an unconfirmed state keeps full-price tax and shows the small note", () => {
    const h = render(AK, cash(40000, 0));
    assert.equal(rowHtml(h, "taxcredit"), "");
    assert.match(rowHtml(h, "otdafter"), /\$28,495/);
    assert.match(h, /data-testid="trade-tax-unconfirmed-note"/);
    assert.ok(h.includes(UNCONFIRMED_TRADE_TAX_NOTE));
  });
  it("surcharges stay out of the tax base: adding one raises OTD by exactly its amount and leaves the credit alone", () => {
    const plain = render(NJ, cash(40000, 2650));
    const withSurcharge = render(NJ, cash(40000, 2650, { surcharges: [{ name: "Market adjustment", amount: 1000 }], noSurcharges: false }));
    assert.equal(rowHtml(withSurcharge, "taxcredit"), rowHtml(plain, "taxcredit"));
    assert.match(rowHtml(withSurcharge, "otdbefore"), /\$44,145/);
    assert.match(rowHtml(withSurcharge, "otdafter"), /\$30,953/);
  });
});
