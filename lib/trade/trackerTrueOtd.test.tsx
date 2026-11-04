// True OTD on the Deal Tracker's quote-request cards: same shared calculation and card as the buyer's used compare, so same numbers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DealTrackerDashboard } from "../../components/DealTrackerDashboard";
import { UsedCompare } from "../../components/UsedCompare";
import { TrueOtdCard } from "../../components/trade/TrueOtdCard";
import type { RfqInvite, RfqRequest } from "../rfq";
import type { UsedCashQuote } from "../usedQuote";
import { rfqTrueOtdRows } from "./quoteTrueOtd";
import type { DealerTradeAppraisal, TradeInRecord } from "./types";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const NJ = "07981", AK = "99501";
type Allow = { single?: number; low?: number; high?: number };
const cash = (price: number, tax: number): UsedCashQuote => ({ kind: "cash", sellingPrice: price, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: [{ name: "Sales tax", amount: tax }, { name: "Doc fee", amount: 495 }], rebates: [] });
const tradeIn = (payoff = 6000) => ({ vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", payoffEstimate: payoff, updatedAt: future, photos: [], createdAt: future }) as unknown as TradeInRecord;
const appr = (a: Allow) => ({ allowanceSingle: a.single ?? null, allowanceLow: a.low ?? null, allowanceHigh: a.high ?? null, basis: "preliminary", goodUntil: future, payoffUsed: 6000, equityComputed: 0, conditions: null, createdAt: future }) as unknown as DealerTradeAppraisal;
const invite = (used: UsedCashQuote, a: Allow | null): RfqInvite =>
  ({ id: "1", dealerName: "Route 10 Honda", dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: a ? appr(a) : null, quote: { id: "q1", price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin: "5J6RW2H89NL000001", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used } }) as unknown as RfqInvite;
const rfqOf = (zip: string, used: UsedCashQuote, a: Allow | null, withTrade = true): RfqRequest =>
  ({ id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: "5J6RW2H89NL000001", stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: withTrade ? tradeIn() : null, quotePrefs: { quoteType: "cash", cash: { zip } }, invites: [invite(used, a)] }) as unknown as RfqRequest;
const tracker = (rfq: RfqRequest) => renderToStaticMarkup(<DealTrackerDashboard requests={[]} bids={[]} quoteRequests={[rfq]} onOpenLiveDealRoom={() => {}} onStartNewBid={() => {}} onToggleTradeIn={() => {}} />);
const compare = (rfq: RfqRequest) => renderToStaticMarkup(<UsedCompare rfq={rfq} prefs={rfq.quotePrefs!} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
const cardOf = (rfq: RfqRequest) => renderToStaticMarkup(<TrueOtdCard b={rfqTrueOtdRows(rfq)[0].b} compact />);

describe("Deal Tracker true OTD", () => {
  it("NJ with a trade: original − allowance − tax saved + payoff = True OTD", () => {
    const h = tracker(rfqOf(NJ, cash(40000, 2650), { single: 18000 }));
    const s = h.slice(h.indexOf('data-testid="tracker-true-otd"'));
    assert.match(s, /Route 10 Honda/); assert.match(s, /Original OTD/); assert.match(s, /\$43,145/);
    assert.match(s, /−\$18,000/); assert.match(s, /−\$1,193/); assert.match(s, /\+\$6,000/); assert.match(s, /True OTD/); assert.match(s, /\$29,953/);
  });

  it("no trade: nothing added, the tracker is unchanged", () => {
    const h = tracker(rfqOf(NJ, cash(40000, 2650), null, false));
    assert.ok(!h.includes("tracker-true-otd")); assert.ok(!h.includes("True OTD"));
  });

  it("a trade with no dealer allowance yet adds no card", () => {
    assert.equal(rfqTrueOtdRows(rfqOf(NJ, cash(40000, 2650), null)).length, 0);
  });

  it("a low / high allowance shows a range and the midpoint", () => {
    const h = tracker(rfqOf(NJ, cash(40000, 2650), { low: 16000, high: 20000 }));
    const s = h.slice(h.indexOf('data-testid="tracker-true-otd"'));
    assert.match(s, /\$16,000 to \$20,000/); assert.match(s, /data-testid="otd-true-mid"/);
  });

  it("an unconfirmed state says so and takes no tax saving", () => {
    const h = tracker(rfqOf(AK, cash(40000, 0), { single: 18000 }));
    assert.match(h, /Tax credit not confirmed for AK/); assert.ok(!h.includes("Tax savings from trade"));
  });

  it("negative equity is stated plainly", () => {
    const rfq = rfqOf(NJ, cash(40000, 2650), { single: 5000 });
    rfq.tradeIn = tradeIn(8000);
    assert.match(tracker(rfq), /Negative equity/);
  });

  const cases: Array<[string, () => RfqRequest]> = [
    ["NJ", () => rfqOf(NJ, cash(40000, 2650), { single: 18000 })],
    ["range", () => rfqOf(NJ, cash(40000, 2650), { low: 16000, high: 20000 })],
    ["AK", () => rfqOf(AK, cash(40000, 0), { single: 18000 })],
  ];
  for (const [name, mk] of cases) {
    it(`same numbers as the used compare for the same quote (${name})`, () => {
      const rfq = mk();
      const card = cardOf(rfq);
      assert.ok(tracker(rfq).includes(card), "tracker shows the identical card");
      assert.ok(compare(rfq).includes(card), "used compare shows the identical card");
    });
  }
});
