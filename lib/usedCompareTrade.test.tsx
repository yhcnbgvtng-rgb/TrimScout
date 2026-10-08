// Renders the cash compare with one dealer's trade quoted and one still pending.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsedCompare } from "../components/UsedCompare";
import type { RfqInvite, RfqRequest } from "./rfq";
import type { RfqTradeIn } from "./rfqTradeIn";
import type { UsedCashQuote } from "./usedQuote";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const cash = (price: number, tax: number): UsedCashQuote => ({
  kind: "cash", sellingPrice: price, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future,
  dueAtSigning: [{ name: "NJ sales tax", amount: tax }, { name: "Doc fee", amount: 495 }], rebates: [],
});
const trade = (over: Partial<RfqTradeIn> = {}): RfqTradeIn => ({ vin: null, year: 2019, make: "Honda", model: "Accord", trim: "EX-L", mileage: 58000, payoff: 6000, lender: null, condition: "good", note: null, photoCount: 2, submittedAt: "2026-10-08T00:00:00Z", ...over });
const invite = (id: string, name: string, u: UsedCashQuote | null, tradeIn?: RfqTradeIn): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: null, status: u ? "quoted" : "invited", declineReason: null, invitedAt: "2026-10-07T00:00:00Z", respondedAt: null, tradeIn: tradeIn ?? null,
    quote: u ? { id: `q${id}`, price: u.sellingPrice, fees: [], totalOtdPrice: 0, vin: "5J6RW2H89NL000001", stockNumber: null, expiresAt: future, submittedAt: "2026-10-07T01:00:00Z", mustHaveAcknowledgement: true, notes: null, used: u } : null }) as unknown as RfqInvite;
const rfqWith = (invites: RfqInvite[]): RfqRequest => ({ id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: "2026-10-07T00:00:00Z", vin: "5J6RW2H89NL000001", stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], quotePrefs: { quoteType: "cash", cash: { zip: "07981" } }, invites }) as unknown as RfqRequest;
const render = (r: RfqRequest, extra = {}) => renderToStaticMarkup(<UsedCompare rfq={r} prefs={r.quotePrefs!} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} onAddTrade={async () => {}} onCopyTrade={async () => {}} busy={false} {...extra} />);

describe("cash compare with a trade-in", () => {
  // Route 10: $40,000 + 2,650 tax + 495 doc = 43,145; trade quoted $18,000, payoff 6,000 → equity 12,000 → 31,145.
  // Bob Johnson: $39,500 + 2,617 + 495 = 42,612; trade still pending → stays 42,612.
  const html = render(rfqWith([
    invite("1", "Route 10 Honda", { ...cash(40000, 2650) }, trade({ allowance: 18000 })),
    invite("2", "Bob Johnson Honda", { ...cash(39500, 2617) }, trade({ allowance: null })),
  ]));
  const colCells = (row: string) => Array.from(html.matchAll(new RegExp(`<tr data-row="${row}">([\\s\\S]*?)</tr>`, "g")))[0]?.[1] ?? "";

  it("adds the three rows directly under Rebates / credits, before Expires and Out the door", () => {
    const labels = Array.from(html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)).map((m) => m[1]);
    const i = labels.indexOf("Rebates / credits");
    assert.deepEqual(labels.slice(i, i + 4), ["Rebates / credits", "Trade-in allowance", "Payoff", "Net trade equity"]);
    assert.equal(labels[labels.length - 1], "Out the door");
  });
  it("the quoted dealer's out the door nets the equity; tax is untouched", () => {
    assert.match(colCells("otd"), /\$31,145/);
    assert.match(colCells("tax"), /\$2,650/);
    assert.match(colCells("netequity"), /−\$12,000/);
    assert.match(colCells("tradeallow"), /\$18,000/);
  });
  it("the pending dealer shows 'Trade value pending' and their out the door does not move", () => {
    assert.match(colCells("tradeallow"), /Trade value pending/);
    assert.match(colCells("otd"), /\$42,612/);
    assert.match(colCells("otd"), /excludes trade/);
  });
  it("negative equity is labelled and added", () => {
    const h = render(rfqWith([invite("1", "Route 10 Honda", cash(40000, 2650), trade({ allowance: 4000, payoff: 9000 }))]));
    assert.match(h, /Negative equity/); assert.match(h, /\+\$5,000/); assert.match(h, /\$48,145/);
  });
  it("Add a trade-in is a secondary button BELOW Counter / Walk away; Choose stays the primary action", () => {
    const h = render(rfqWith([invite("1", "Route 10 Honda", cash(40000, 2650)), invite("2", "Bob Johnson Honda", cash(39500, 2617))]));
    assert.match(h, /data-testid="choose-quote">Choose this quote<\/button><div[^>]*><button[^>]*data-testid="counter-quote">Counter<\/button><button[^>]*data-testid="walk-away">Walk away<\/button><\/div><div[^>]*data-testid="trade-in-actions"><button[^>]*data-testid="add-trade-in">Add a trade-in<\/button>/);
    assert.equal((h.match(/data-testid="add-trade-in"/g) || []).length, 2, "one per dealer column");
    assert.equal((h.match(/Trade values are dealer estimates and may change after inspection\./g) || []).length, 2);
    assert.doesNotMatch(h, /add-trade-in"[^>]*bg-brand-500/, "not a primary button");
  });
  it("once one dealer has a trade, the other column offers it in one click", () => {
    assert.match(html, /Trade-in sent: 2019 Honda Accord EX-L/);
    const h = render(rfqWith([invite("1", "Route 10 Honda", cash(40000, 2650), trade({ allowance: null })), invite("2", "Bob Johnson Honda", cash(39500, 2617))]));
    assert.match(h, /data-testid="copy-trade-in">Send Route 10 Honda&#x27;s trade-in here too/);
  });
  it("no trade rows and no trade UI noise when nobody has a trade", () => {
    const h = render(rfqWith([invite("1", "Route 10 Honda", cash(40000, 2650))]), { onAddTrade: undefined });
    assert.doesNotMatch(h, /Net trade equity|add-trade-in/);
  });
});
