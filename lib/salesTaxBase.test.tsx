// One sales-tax base on every path: selling price + dealer add-ons. Doc fee and title & registration are never taxed.
// Plus NJ's 0.4% surcharge on a new car priced at $45,000+ (dealer-sales-tax-research-2026-10-15.md), and no other state's special rule.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeSalesTax, njLuxurySurchargeApplies, quoteIsNew, salesTaxBase, SALES_TAX_ESTIMATE_NOTE } from "./salesTax";
import { calcSalesTax, normalizeFeeOverrides } from "./feeOverride";
import { applyCashCounter } from "./counterSheet";
import { originalTaxRate, prefillTax } from "./acceptCounter";
import { calculateOtd, getEstimatedTaxRate } from "./otdCalculator";
import type { UsedCashQuote } from "./usedQuote";
import { UsedQuoteForm } from "../components/UsedQuoteForm";

const NJ = "07405"; // 6.625% state rate
const NY = "10001"; // 4%
const ADD = [{ name: "Nitrogen", amount: 400 }];
const quote = (over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({
  kind: "cash", sellingPrice: 40000, addOns: ADD, noAddOns: false, rebates: [], miles: null, stockNumber: "S1", cpo: false, expiresAt: "2099-01-01T00:00:00Z",
  dueAtSigning: [{ name: "Sales tax", amount: 2676.5 }, { name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 660 }], ...over,
});

describe("the shared base", () => {
  it("is selling price + add-ons, and nothing else", () => {
    assert.equal(salesTaxBase(40000, ADD), 40400);
    assert.equal(salesTaxBase(40000, []), 40000);
    assert.equal(salesTaxBase(40000, null), 40000);
    assert.equal(salesTaxBase(null, ADD), 400);
  });
  it("a doc fee or title & registration in the due-at-signing lines never moves the tax", () => {
    const a = applyCashCounter(quote(), { dueAtSigning: [{ name: "Sales tax", amount: 0 }, { name: "Doc fee", amount: 100 }, { name: "Title & registration", amount: 5000 }] }, NJ);
    const b = applyCashCounter(quote(), { dueAtSigning: [{ name: "Sales tax", amount: 0 }, { name: "Doc fee", amount: 900 }, { name: "Title & registration", amount: 1 }] }, NJ);
    assert.equal(a.dueAtSigning[0].amount, b.dueAtSigning[0].amount);
  });
});

describe("every path agrees on the same figure", () => {
  it("quote form calc, server recomputation, counter and the dealer-portal preview all tax price + add-ons", () => {
    const expected = Math.round(40400 * 0.06625 * 100) / 100; // 2676.5
    assert.equal(calcSalesTax(NJ, 40000, ADD), expected, "quote form / form hint");
    const server = normalizeFeeOverrides({ dueAtSigning: quote().dueAtSigning, sellingPrice: 40000, addOns: ADD, zip: NJ, submitted: [] });
    assert.deepEqual(server, { overrides: [], errors: [] }, "server recomputes the same number, so the form's figure needs no override");
    const counter = applyCashCounter(quote({ dueAtSigning: quote().dueAtSigning.map((l) => (l.name === "Sales tax" ? { ...l, amount: 0 } : l)) }), {}, NJ);
    assert.equal(counter.dueAtSigning.find((l) => l.name === "Sales tax")!.amount, expected, "counter");
    const rate = getEstimatedTaxRate("94107");
    const otd = calculateOtd({ msrp: 40000, accessories: 400, docFee: 799, zipCode: "94107" });
    assert.equal(otd.salesTax, Math.round(40400 * rate), "dealer portal preview / calculateOtd taxes add-ons, not the doc fee");
    assert.equal(calculateOtd({ msrp: 40000, accessories: 400, docFee: 5000, zipCode: "94107" }).salesTax, otd.salesTax, "doc fee never taxed");
  });
  it("accept-counter prefill uses the same base: the dealer's own rate on the counter's price + add-ons", () => {
    const before = quote();
    const rate = originalTaxRate(before)!;
    assert.ok(Math.abs(rate - 0.06625) < 1e-9);
    const after = quote({ sellingPrice: 39000, addOns: [{ name: "Nitrogen", amount: 200 }] });
    assert.equal(prefillTax(before, after), Math.round(rate * 39200 * 100) / 100);
    assert.equal(prefillTax(before, quote()), 2676.5, "unchanged base: unchanged tax");
  });
});

describe("New Jersey's 0.4% surcharge", () => {
  it("applies to a new car at $45,000 or more, on the selling price", () => {
    assert.equal(njLuxurySurchargeApplies({ state: "NJ", isNew: true, sellingPrice: 45000 }), true);
    assert.equal(calcSalesTax(NJ, 45000, [], true), 3161.25); // 45,000 × 6.625% + 45,000 × 0.4%
    assert.equal(calcSalesTax(NJ, 50000, ADD, true), 3539, "tax on price + add-ons (3,339) plus the surcharge on the price only (200)");
  });
  it("does not apply under $45,000, to a used car, or outside NJ", () => {
    assert.equal(calcSalesTax(NJ, 44999, [], true), Math.round(44999 * 0.06625 * 100) / 100);
    assert.equal(calcSalesTax(NJ, 60000, [], false), 3975);
    assert.equal(calcSalesTax(NJ, 60000, []), 3975, "unknown condition: no surcharge");
    assert.equal(calcSalesTax(NY, 60000, [], true), 2400, "no other state gets a special rule");
    assert.equal(computeSalesTax({ rate: 0.0635, state: "CT", isNew: true, sellingPrice: 60000 }), 3810);
  });
  it("the counter and the server recompute it the same way", () => {
    const before = quote({ sellingPrice: 50000, addOns: [], noAddOns: true, dueAtSigning: [{ name: "Sales tax", amount: 0 }, { name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 660 }] });
    assert.equal(quoteIsNew(before), true);
    const after = applyCashCounter(before, { sellingPrice: 46000 }, NJ);
    assert.equal(after.dueAtSigning[0].amount, 3231.5, "46,000 × 6.625% + 46,000 × 0.4%");
  });
  it("a used quote (miles on it) carries no surcharge through the counter", () => {
    const used = quote({ sellingPrice: 50000, addOns: [], noAddOns: true, miles: 12000 });
    const after = applyCashCounter(used, { sellingPrice: 48000 }, NJ);
    assert.equal(after.dueAtSigning[0].amount, 3180);
  });
});

describe("the field and its note", () => {
  const prefs = { quoteType: "cash", cash: { zip: NJ, timeline: null } } as const;
  const html = (initial: UsedCashQuote, condition?: "new" | "used") => renderToStaticMarkup(<UsedQuoteForm token="tok12345678" vin="V" stockNumber={null} prefs={prefs} buyerMiles={null} initial={initial} condition={condition} onSubmitted={() => {}} />);
  it("says 'Estimate only. The dealer confirms the tax.' under the sales tax field", () => {
    assert.equal(SALES_TAX_ESTIMATE_NOTE, "Estimate only. The dealer confirms the tax.");
    assert.match(html(quote()), /data-testid="tax-estimate-note">Estimate only\. The dealer confirms the tax\.</);
  });
  it("shows the NJ surcharge in the hint for a new car at $45,000+, and not for a used one", () => {
    const q = quote({ sellingPrice: 50000, addOns: [] });
    assert.match(html(q, "new"), /includes NJ&#x27;s 0\.4% surcharge/);
    assert.doesNotMatch(html(q, "used"), /includes NJ&#x27;s 0\.4% surcharge/, "the hint only; the form now has its own Surcharges section");
  });
  it("keeps the dealer-adjusted flag and the required reason when the amount is changed", () => {
    const f = fs.readFileSync(path.join(process.cwd(), "components/UsedQuoteForm.tsx"), "utf8");
    assert.match(f, /data-overridden=\{adjusted \? "true" : "false"\}/);
    assert.match(f, /fee-reason-\$\{k\}/);
    assert.match(f, /OVERRIDE_REASON_MAX/);
    const r = normalizeFeeOverrides({ dueAtSigning: [{ name: "Sales tax", amount: 2800 }], sellingPrice: 40000, addOns: [], zip: NJ, submitted: [{ key: "sales_tax", reason: "" }] });
    assert.match(r.errors.join(" "), /add a short reason/);
  });
});
