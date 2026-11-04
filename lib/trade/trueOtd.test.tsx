// True OTD after a trade-in: one shared calculation (lib/trade/trueOtd.ts), the step-by-step card, and the buyer's compare using it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsedCompare } from "../../components/UsedCompare";
import { TrueOtdCard } from "../../components/trade/TrueOtdCard";
import type { RfqInvite, RfqRequest } from "../rfq";
import { cashOutTheDoor, type UsedCashQuote } from "../usedQuote";
import { msrpDiscount } from "../cashCompare";
import { allowanceOf, tradeEquity } from "./otd";
import { quotedTaxOf, tradeTaxCredit } from "./stateTradeCredit";
import { quotedEquityOf, taxNotConfirmedNote, trueOtdBreakdown } from "./trueOtd";
import type { DealerTradeAppraisal, TradeInRecord } from "./types";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const NJ = "07981", CA = "94107", AK = "99501";
const cash = (price: number, tax: number, over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({ kind: "cash", sellingPrice: price, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: [{ name: "Sales tax", amount: tax }, { name: "Doc fee", amount: 495 }], rebates: [], ...over });
const tradeIn = (payoff = 6000): TradeInRecord => ({ vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", trim: "EX-L", decodedFromVin: true, mileage: 58000, zip: "07981", conditionBand: "good", titleStatus: "clean", ownership: "financed", lenderName: "Chase", payoffEstimate: payoff, keys: "2+", historyFlag: "no", historyNotes: null, drivetrain: "2wd", options: [], optionsOther: null, extColor: null, intColor: null, serviceHistory: null, serviceNotes: null, tireBrake: null, mods: null, warningLights: null, intent: "apply_to_deal", odometerConfirmed: true, photos: [], createdAt: future, updatedAt: future }) as unknown as TradeInRecord;
const appr = (a: { single?: number; low?: number; high?: number }, payoff = 6000): DealerTradeAppraisal => ({ allowanceSingle: a.single ?? null, allowanceLow: a.low ?? null, allowanceHigh: a.high ?? null, basis: "preliminary", goodUntil: future, payoffUsed: payoff, equityComputed: 0, conditions: null, createdAt: future }) as unknown as DealerTradeAppraisal;

/** The same inputs the buyer's compare feeds the shared calculation. */
function breakdown(zip: string, used: UsedCashQuote, a: { single?: number; low?: number; high?: number } | null, payoff = 6000) {
  const eq = tradeEquity(a != null, payoff, a ? appr(a, payoff) : null, new Date(), { quoteExpiresAt: used.expiresAt });
  const taxCredit = tradeTaxCredit({ zip, allowance: eq.status === "quoted" ? eq.allowance : null, sellingPrice: used.sellingPrice, addOns: used.addOns, quotedTax: quotedTaxOf(used.dueAtSigning), isNew: used.miles == null });
  return trueOtdBreakdown({ originalOtd: cashOutTheDoor(used), eq, taxCredit });
}

describe("true OTD breakdown", () => {
  it("NJ (credit state): original − allowance − tax saved + payoff, in order", () => {
    const b = breakdown(NJ, cash(40000, 2650), { single: 18000 });
    assert.equal(b.applies, true);
    assert.equal(b.original, 43145);
    assert.equal(b.allowance?.mid, 18000);
    assert.equal(b.taxSaving?.mid, 1192.5, "18,000 × 6.625%");
    assert.equal(b.payoff, 6000);
    assert.equal(b.netEquity, 12000);
    assert.equal(b.taxNote, null);
    assert.equal(b.trueOtd.mid, 29952.5, "43,145 − 18,000 + 6,000 − 1,192.50");
    assert.equal(b.trueOtd.isRange, false);
  });

  it("a no-credit state (CA): no tax line, the reason is given, tax stays on the full price", () => {
    const b = breakdown(CA, cash(40000, 3400), { single: 18000 });
    assert.equal(b.taxSaving, null);
    assert.match(b.taxNote ?? "", /CA gives no sales tax credit for a trade-in/);
    assert.equal(b.trueOtd.mid, 31895, "43,895 − 12,000");
  });

  it("an unconfirmed state (AK): no tax saving, never a guess, with the note", () => {
    const b = breakdown(AK, cash(40000, 0), { single: 18000 });
    assert.equal(b.taxSaving, null);
    assert.equal(b.taxNote, "Tax credit not confirmed for AK");
    assert.equal(b.taxNote, taxNotConfirmedNote("AK"));
    assert.equal(b.trueOtd.mid, 28495, "40,495 − 12,000");
  });

  it("negative equity: the payoff beyond the allowance adds to the OTD and is said plainly", () => {
    const b = breakdown(NJ, cash(40000, 2650), { single: 5000 }, 8000);
    assert.equal(b.netEquity, -3000);
    assert.equal(b.negativeEquity, true);
    assert.equal(b.taxSaving?.mid, 331.25);
    assert.equal(b.trueOtd.mid, 45813.75, "43,145 + 3,000 − 331.25");
    const html = renderToStaticMarkup(<TrueOtdCard b={b} />);
    assert.match(html, /data-testid="otd-negative-equity"[^>]*>Negative equity: the payoff is \$3,000 more than the allowance/);
    assert.match(html, /\+\$8,000/);
  });

  it("a low / high allowance gives a true OTD range with the midpoint", () => {
    const b = breakdown(NJ, cash(40000, 2650), { low: 15000, high: 20000 });
    assert.equal(b.trueOtd.isRange, true);
    assert.equal(b.trueOtd.mid, 30485.62, "midpoint 17,500: 43,145 − 11,500 − 1,159.38");
    assert.equal(b.trueOtd.low, 27820, "20,000 allowance: 43,145 − 14,000 − 1,325");
    assert.equal(b.trueOtd.high, 33151.25, "15,000 allowance: 43,145 − 9,000 − 993.75");
    const html = renderToStaticMarkup(<TrueOtdCard b={b} />);
    assert.match(html, /\$27,820 to \$33,151/);
    assert.match(html, /−\$15,000 to \$20,000/);
  });

  it("no trade: exactly today's number, one line, nothing else", () => {
    const used = cash(40000, 2650);
    const b = breakdown(NJ, used, null);
    assert.equal(b.applies, false);
    assert.equal(b.trueOtd.mid, cashOutTheDoor(used));
    assert.equal(b.trueOtd.low, b.trueOtd.high);
    const html = renderToStaticMarkup(<TrueOtdCard b={b} />);
    assert.match(html, /Out the door[\s\S]*\$43,145/);
    assert.doesNotMatch(html, /True OTD|Trade-in allowance|Payoff/);
  });

  it("a trade with no usable number yet (pending) also leaves the quote untouched", () => {
    const eq = tradeEquity(true, 6000, null, new Date());
    const b = trueOtdBreakdown({ originalOtd: 43145, eq, taxCredit: null });
    assert.equal(b.applies, false);
    assert.equal(b.trueOtd.mid, 43145);
  });

  it("surcharges stay in the OTD, out of the tax base, and the trade does not change them; % of MSRP ignores the trade", () => {
    const plain = cash(40000, 2650, { msrp: 42000 } as Partial<UsedCashQuote>);
    const withSur = cash(40000, 2650, { msrp: 42000, surcharges: [{ name: "Market adjustment", amount: 1000, reason: "dealer" }] } as Partial<UsedCashQuote>);
    const a = breakdown(NJ, plain, { single: 18000 }), b = breakdown(NJ, withSur, { single: 18000 });
    assert.equal(b.original, a.original + 1000);
    assert.equal(b.taxSaving?.mid, a.taxSaving?.mid, "a surcharge is not taxable, so the saving is the same");
    assert.equal(b.trueOtd.mid, a.trueOtd.mid + 1000);
    assert.deepEqual(msrpDiscount(withSur), msrpDiscount(plain), "selling price over MSRP only; no trade input exists");
  });

  it("the dealer's preview (typed allowance) and the buyer's stored appraisal agree to the cent", () => {
    const used = cash(40000, 2650);
    const allowance = allowanceOf({ allowanceSingle: 18000, allowanceLow: null, allowanceHigh: null })!;
    const taxCredit = tradeTaxCredit({ zip: NJ, allowance, sellingPrice: 40000, addOns: [], quotedTax: 2650, isNew: true });
    const preview = trueOtdBreakdown({ originalOtd: cashOutTheDoor(used), eq: quotedEquityOf(allowance, 6000), taxCredit });
    assert.deepEqual(preview.trueOtd, breakdown(NJ, used, { single: 18000 }).trueOtd);
  });

  it("the card lists the steps in order with a labelled True OTD", () => {
    const html = renderToStaticMarkup(<TrueOtdCard b={breakdown(NJ, cash(40000, 2650), { single: 18000 })} />);
    const order = ["Original OTD", "Trade-in allowance", "Tax savings from trade", "Payoff owed", "True OTD"].map((t) => html.indexOf(t));
    assert.ok(order.every((n) => n >= 0), "every step shows");
    assert.deepEqual([...order].sort((x, y) => x - y), order, "in order");
    assert.match(html, /−\$18,000/); assert.match(html, /−\$1,193/); assert.match(html, /\+\$6,000/); assert.match(html, /\$29,953/);
  });
});

describe("the buyer's compare shows the same numbers", () => {
  const invite = (used: UsedCashQuote): RfqInvite =>
    ({ id: "1", dealerName: "Route 10 Honda", dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: appr({ single: 18000 }), quote: { id: "q1", price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin: "5J6RW2H89NL000001", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used } }) as unknown as RfqInvite;
  const render = (zip: string, used: UsedCashQuote) => {
    const rfq = { id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: "5J6RW2H89NL000001", stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: tradeIn(), quotePrefs: { quoteType: "cash", cash: { zip } }, invites: [invite(used)] } as unknown as RfqRequest;
    return renderToStaticMarkup(<UsedCompare rfq={rfq} prefs={rfq.quotePrefs!} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
  };

  it("NJ: the table row is labelled True OTD and the step-by-step card carries the same figure", () => {
    const h = render(NJ, cash(40000, 2650));
    assert.match(h, /True OTD after trade/);
    const steps = h.slice(h.indexOf('data-testid="true-otd-steps"'));
    assert.match(steps, /Route 10 Honda/); assert.match(steps, /\$29,953/); assert.match(steps, /−\$1,193/);
  });

  it("an unconfirmed state shows \"Tax credit not confirmed for AK\" under the true OTD", () => {
    const h = render(AK, cash(40000, 0));
    assert.match(h, /data-testid="tax-credit-not-confirmed"[^>]*>Tax credit not confirmed for AK/);
  });
});
