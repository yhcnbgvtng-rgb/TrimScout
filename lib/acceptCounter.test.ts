import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptableCashCounter, acceptedOutTheDoor, buildAcceptedQuote, originalTaxRate, prefillTax, verifyAcceptedQuote } from "./acceptCounter";
import { applyCashCounter } from "./counterSheet";
import { buildDealerUnsubscribedNotice, buildCounterAcceptedNotice } from "./dealerEmail";
import type { BuyerCounter } from "./rfq";
import { validateUsedQuote, type UsedCashQuote } from "./usedQuote";

// 6.625% NJ tax on price + add-ons: (30,000 + 1,000) × 0.06625 = 2,053.75
const quoted: UsedCashQuote = {
  kind: "cash", sellingPrice: 30000, addOns: [{ name: "Nitrogen tires", amount: 1000 }], noAddOns: false, rebates: [],
  dueAtSigning: [{ name: "Sales tax", amount: 2053.75 }, { name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 420 }],
  miles: null, stockNumber: "T123", cpo: false, expiresAt: "2099-01-01T00:00:00.000Z", notes: null,
};
const counterOf = (edits: Parameters<typeof applyCashCounter>[1], zip: string | null = null): BuyerCounter => ({
  againstQuoteId: "q1", sentAt: "2026-10-10T12:00:00.000Z", note: null,
  sheet: { kind: "cash", before: quoted, after: applyCashCounter(quoted, edits, zip), changed: [] },
});
const asSubmitted = (c: BuyerCounter, tax: number) => buildAcceptedQuote(c.sheet!.after as UsedCashQuote, tax, c.sentAt);

describe("accepting a buyer's counter", () => {
  it("no price change: the counter is accepted as-is and tax stays as quoted", () => {
    const c = counterOf({ addOns: [{ name: "Nitrogen tires", amount: 1000 }], dueAtSigning: quoted.dueAtSigning.map((l) => (l.name === "Doc fee" ? l : l)) });
    const after = c.sheet!.after as UsedCashQuote;
    assert.equal(prefillTax(quoted, after), 2053.75);
    const q = asSubmitted(c, prefillTax(quoted, after));
    assert.deepEqual(verifyAcceptedQuote(q, c), []);
    assert.equal(acceptedOutTheDoor(q), acceptedOutTheDoor(quoted));
    assert.ok(q.counterAccepted && q.counterAccepted.counterSentAt === c.sentAt);
  });

  it("price change: tax is prefilled at the original rate, the dealer may edit only tax, and the OTD follows", () => {
    const c = counterOf({ sellingPrice: 29000 });
    const after = c.sheet!.after as UsedCashQuote;
    assert.ok(Math.abs(originalTaxRate(quoted)! - 0.06625) < 1e-9);
    const tax = prefillTax(quoted, after); // (29,000 + 1,000) × 6.625%
    assert.equal(tax, 1987.5);
    assert.deepEqual(verifyAcceptedQuote(asSubmitted(c, tax), c), []);
    const edited = asSubmitted(c, 1950); // dealer edits tax down
    assert.deepEqual(verifyAcceptedQuote(edited, c), []);
    assert.equal(acceptedOutTheDoor(edited), 29000 + 1000 + 1950 + 799 + 420);
    assert.equal(edited.dueAtSigning.find((l) => l.name === "Doc fee")!.amount, 799);
  });

  it("a tampered line is rejected: price, doc fee, title & registration, add-ons, tax name, expiry", () => {
    const c = counterOf({ sellingPrice: 29000 });
    const good = asSubmitted(c, 1987.5);
    const tamper = (f: (q: UsedCashQuote) => UsedCashQuote) => verifyAcceptedQuote(f(structuredClone(good)), c);
    assert.ok(tamper((q) => ({ ...q, sellingPrice: 29500 })).length, "price");
    assert.ok(tamper((q) => ({ ...q, dueAtSigning: q.dueAtSigning.map((l) => (l.name === "Doc fee" ? { ...l, amount: 899 } : l)) })).length, "doc fee");
    assert.ok(tamper((q) => ({ ...q, dueAtSigning: q.dueAtSigning.map((l) => (l.name === "Title & registration" ? { ...l, amount: 0 } : l)) })).length, "title");
    assert.ok(tamper((q) => ({ ...q, addOns: [] })).length, "add-ons");
    assert.ok(tamper((q) => ({ ...q, dueAtSigning: [...q.dueAtSigning, { name: "Market adjustment", amount: 500 }] })).length, "extra fee");
    assert.ok(tamper((q) => ({ ...q, dueAtSigning: q.dueAtSigning.map((l) => (l.name === "Sales tax" ? { ...l, amount: -5 } : l)) })).length, "negative tax");
    assert.ok(tamper((q) => ({ ...q, expiresAt: "2099-06-01T00:00:00.000Z" })).length, "expiry");
    assert.ok(verifyAcceptedQuote(undefined, c).length, "nothing submitted");
  });

  it("the Accept button needs a cash counter: hidden with no counter, a lease/finance ask, or a legacy non-sheet counter", () => {
    const cashPrefs = { quoteType: "cash", cash: { zip: "07981" } } as const;
    assert.equal(acceptableCashCounter(cashPrefs, null), null);
    assert.equal(acceptableCashCounter(cashPrefs, { againstQuoteId: "q1", sentAt: "x", targetMonthlyMax: 500 } as BuyerCounter), null);
    assert.equal(acceptableCashCounter({ quoteType: "finance", finance: { termMonths: 60, downPayment: 0, creditBand: "good", zip: "07981" } } as never, counterOf({ sellingPrice: 29000 })), null);
    assert.ok(acceptableCashCounter(cashPrefs, counterOf({ sellingPrice: 29000 })));
  });

  it("the buyer notice says 'Dealer accepted your counter' with the final OTD, under SAFE MODE", () => {
    const n = buildCounterAcceptedNotice({ dealerName: "Acme Toyota", vehicle: "2026 Toyota RAV4", outTheDoor: 33157, rfqUrl: "https://example.com/rfq/1" });
    assert.match(n.subject, /^\[SAFE MODE\] Dealer accepted your counter/);
    assert.match(n.html, /\$33,157\.00/);
    assert.match(n.html, /SAFE MODE/);
    assert.match(buildDealerUnsubscribedNotice("x").subject, /SAFE MODE/);
  });
  it("a struck add-on ($0 in the counter) is dropped, so the accepted quote validates", () => {
    const c = counterOf({ addOns: [{ name: "Nitrogen tires", amount: 0 }] });
    const q = asSubmitted(c, 1900);
    assert.deepEqual(q.addOns, []);
    assert.equal(q.noAddOns, true);
    assert.deepEqual(verifyAcceptedQuote(q, c), []);
    assert.equal(validateUsedQuote(q, { quoteType: "cash" } as never, { vin: "1".repeat(17), stockNumber: "T123", condition: "new" }).errors.length, 0);
  });
});
