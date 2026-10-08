import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cashOutTheDoor, type UsedCashQuote } from "./usedQuote";
import { parseAllowance, parseTradeInRequest, tradeOutTheDoor } from "./rfqTradeIn";

// $40,000 car, NJ tax 6.625% on the FULL price ($2,650), doc + title fees, one add-on, one rebate.
const cash: UsedCashQuote = {
  kind: "cash", sellingPrice: 40000, noAddOns: false, miles: null, stockNumber: null, cpo: false, expiresAt: "2026-12-01T00:00:00Z",
  dueAtSigning: [{ name: "NJ sales tax", amount: 2650 }, { name: "Doc fee", amount: 495 }, { name: "Title & registration", amount: 355 }],
  addOns: [{ name: "Nitrogen tires", amount: 200 }],
  rebates: [{ name: "Loyalty cash", amount: 500 }],
};
const BASE = 40000 + 2650 + 495 + 355 + 200 - 500; // 43,200

describe("out the door with a trade-in", () => {
  it("base is price + fees + tax + add-ons − rebates", () => assert.equal(cashOutTheDoor(cash), BASE));

  it("no trade-in: unchanged", () => {
    const r = tradeOutTheDoor(BASE, null);
    assert.equal(r.status, "none"); assert.equal(r.total, BASE);
  });

  it("positive equity comes off the total", () => {
    // allowance 18,000, payoff 6,000 → +12,000 equity
    const r = tradeOutTheDoor(BASE, { allowance: 18000, payoff: 6000 });
    assert.equal(r.status, "quoted"); assert.equal(r.netEquity, 12000); assert.equal(r.negativeEquity, false);
    assert.equal(r.total, BASE - 12000);
  });

  it("no payoff: the whole allowance is equity", () => {
    const r = tradeOutTheDoor(BASE, { allowance: 9500.5, payoff: null });
    assert.equal(r.netEquity, 9500.5); assert.equal(r.total, 33699.5);
  });

  it("negative equity is ADDED to the total and flagged", () => {
    // allowance 15,000, payoff 19,000 → −4,000
    const r = tradeOutTheDoor(BASE, { allowance: 15000, payoff: 19000 });
    assert.equal(r.netEquity, -4000); assert.equal(r.negativeEquity, true);
    assert.equal(r.total, BASE + 4000);
  });

  it("break-even equity changes nothing and is not 'negative'", () => {
    const r = tradeOutTheDoor(BASE, { allowance: 7000, payoff: 7000 });
    assert.equal(r.netEquity, 0); assert.equal(r.negativeEquity, false); assert.equal(r.total, BASE);
  });

  it("pending: no dealer value yet → total stays exactly the dealer's quote, no equity shown", () => {
    for (const payoff of [null, 12000]) {
      const r = tradeOutTheDoor(BASE, { allowance: null, payoff });
      assert.equal(r.status, "pending"); assert.equal(r.total, BASE); assert.equal(r.netEquity, null); assert.equal(r.negativeEquity, false);
    }
    assert.equal(tradeOutTheDoor(BASE, { allowance: undefined, payoff: 5000 }).status, "pending");
  });

  it("a $0 allowance is a real quote, not pending", () => {
    const r = tradeOutTheDoor(BASE, { allowance: 0, payoff: 3000 });
    assert.equal(r.status, "quoted"); assert.equal(r.total, BASE + 3000);
  });

  it("sales tax stays on the full price: the trade never changes the dealer's tax line", () => {
    // TODO(tax) in rfqTradeIn.ts: no trade-in tax credit until per-state rules are decided.
    const taxless = tradeOutTheDoor(BASE - 2650, { allowance: 18000, payoff: 0 }).total;
    const withTax = tradeOutTheDoor(BASE, { allowance: 18000, payoff: 0 }).total;
    assert.equal(withTax - taxless, 2650, "the full $2,650 tax is still in the total");
  });

  it("rounds to cents", () => {
    assert.equal(tradeOutTheDoor(100.1, { allowance: 0.2, payoff: null }).total, 99.9);
  });
});

describe("trade-in form validation", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const ok = { vin: "1HGCM82633A004352", mileage: "62,000".replace(",", ""), condition: "good" };

  it("a VIN alone is enough, with mileage and condition", () => {
    const r = parseTradeInRequest(ok, now);
    assert.ok(r.ok); if (r.ok) { assert.equal(r.tradeIn.vin, "1HGCM82633A004352"); assert.equal(r.tradeIn.payoff, null); assert.equal(r.tradeIn.photoCount, 0); }
  });
  it("without a VIN it needs year, make, model AND trim", () => {
    assert.ok(!parseTradeInRequest({ mileage: 5, condition: "fair", year: 2019, make: "Honda", model: "Civic" }, now).ok);
    assert.ok(parseTradeInRequest({ mileage: 5, condition: "fair", year: 2019, make: "Honda", model: "Civic", trim: "EX" }, now).ok);
  });
  it("rejects a bad VIN, missing mileage and unknown condition", () => {
    assert.ok(!parseTradeInRequest({ ...ok, vin: "NOTAVIN" }, now).ok);
    assert.ok(!parseTradeInRequest({ ...ok, mileage: "" }, now).ok);
    assert.ok(!parseTradeInRequest({ ...ok, condition: "very_good" }, now).ok);
  });
  it("payoff and lender are optional; zero payoff is stored as none", () => {
    const r = parseTradeInRequest({ ...ok, payoff: "$14,250", lender: "Chase" }, now);
    assert.ok(r.ok); if (r.ok) { assert.equal(r.tradeIn.payoff, 14250); assert.equal(r.tradeIn.lender, "Chase"); }
    const z = parseTradeInRequest({ ...ok, payoff: "0" }, now);
    assert.ok(z.ok); if (z.ok) assert.equal(z.tradeIn.payoff, null);
  });
  it("caps photos at 6 and only takes image data URLs", () => {
    const img = "data:image/jpeg;base64,/9j/4AAQ";
    assert.ok(parseTradeInRequest({ ...ok, photos: Array(6).fill(img) }, now).ok);
    assert.ok(!parseTradeInRequest({ ...ok, photos: Array(7).fill(img) }, now).ok);
    assert.ok(!parseTradeInRequest({ ...ok, photos: ["https://evil.example/x.jpg"] }, now).ok);
  });
  it("keeps contact info out of the note", () => {
    assert.ok(!parseTradeInRequest({ ...ok, note: "call me 201-555-0100" }, now).ok);
    assert.ok(parseTradeInRequest({ ...ok, note: "Small door ding, new tires" }, now).ok);
  });
  it("dealer allowance: blank stays pending, negative is refused", () => {
    assert.deepEqual(parseAllowance(""), { ok: true, allowance: null });
    assert.deepEqual(parseAllowance("$12,500"), { ok: true, allowance: 12500 });
    assert.equal(parseAllowance("-1").ok, false);
  });
});
