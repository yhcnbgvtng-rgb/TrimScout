import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FINANCE_APR_PERCENT,
  calculateLeaseHackrEstimate,
  defaultTermsForVehicles,
  estimatedFinanceMonthly,
  estimatedLeaseMonthly,
  mergeVehicleTerms,
  replaceVehicleTerms,
  roundEstimateDollars,
} from "./dealTerms";
import type { LeaseDealTerms, Vehicle } from "./types";

function car(vin: string, price: number, msrp: number): Pick<Vehicle, "vin" | "dealerPrice" | "msrp"> {
  return { vin, dealerPrice: price, msrp };
}

describe("per-VIN deal terms", () => {
  it("finance estimate is standard amortization", () => {
    const monthly = roundEstimateDollars(estimatedFinanceMonthly(40000, 4000, 60, 6.9));
    assert.equal(monthly, 711);
  });

  it("lease estimate uses cap cost, residual, term, and money factor", () => {
    const monthly = roundEstimateDollars(estimatedLeaseMonthly(50000, 55, 36, 0.0025));
    assert.equal(monthly, 819);
  });

  it("defaults each VIN from its own advertised price, not another car's terms", () => {
    const terms = defaultTermsForVehicles(
      [car("1FMWK8JCXTGB47204", 58000, 64000), car("1FMWK8JC7TGB81309", 50000, 0)],
      { requestedStructures: ["cash", "finance"], financeTermMonths: 60, downPayment: 5000 }
    );
    assert.equal(terms.length, 2);
    assert.equal(terms[0].cash?.offerPrice, 58000);
    assert.equal(terms[1].cash?.offerPrice, 50000);
    assert.equal(terms[0].finance?.sellingPrice, 58000);
    assert.equal(terms[1].finance?.sellingPrice, 50000);
    assert.equal(terms[0].finance?.aprPercent, DEFAULT_FINANCE_APR_PERCENT);
    assert.equal(terms[0].lease, undefined);
  });

  it("replaceVehicleTerms updates one VIN without copying onto another", () => {
    const initial = defaultTermsForVehicles(
      [car("1FMWK8JCXTGB47204", 58000, 64000), car("1FMWK8JC7TGB81309", 50000, 0)],
      { requestedStructures: ["cash"] }
    );
    const next = replaceVehicleTerms(initial, {
      vin: "1FMWK8JCXTGB47204",
      cash: { offerPrice: 55555 },
    });
    assert.equal(next[0].cash?.offerPrice, 55555);
    assert.equal(next[1].cash?.offerPrice, 50000);
  });

  it("mergeVehicleTerms keeps existing edits when seeding a new VIN", () => {
    const favorite = car("1FMWK8JCXTGB47204", 58000, 64000);
    const other = car("1FMWK8JC7TGB81309", 50000, 0);
    const existing = defaultTermsForVehicles([favorite], { requestedStructures: ["cash"] });
    existing[0].cash = { offerPrice: 11111 };
    const merged = mergeVehicleTerms([favorite, other], existing, { requestedStructures: ["cash"] });
    assert.equal(merged[0].cash?.offerPrice, 11111);
    assert.equal(merged[1].cash?.offerPrice, 50000);
  });
});

function lease(overrides: Partial<LeaseDealTerms> = {}): LeaseDealTerms {
  return {
    capCost: 50000,
    dueAtSigning: 0,
    termMonths: 36,
    milesPerYear: 12000,
    moneyFactor: 0.0025,
    residualPercent: 55,
    rebates: 0,
    acquisitionFee: 895,
    dispositionFee: 395,
    salesTaxPercent: 8,
    taxMethod: "monthly",
    ...overrides,
  };
}

describe("LeaseHackr-style lease estimate", () => {
  it("rolls the acquisition fee into cap cost and taxes the monthly payment by default", () => {
    const est = calculateLeaseHackrEstimate(lease());
    assert.ok(est);
    assert.equal(est.netCapCost, 50895);
    assert.equal(Math.round(est.baseMonthly), 833);
    assert.equal(Math.round(est.totalMonthly), 900);
    assert.equal(est.upfrontTax, 0);
    assert.equal(Math.round(est.estimatedDueAtSigning), 900);
  });

  it("taxes the cap cost upfront instead of the monthly payment when requested", () => {
    const est = calculateLeaseHackrEstimate(lease({ taxMethod: "upfront" }));
    assert.ok(est);
    assert.equal(Math.round(est.totalMonthly), 833);
    assert.equal(Math.round(est.upfrontTax), 4072);
    assert.equal(Math.round(est.estimatedDueAtSigning), 4905);
  });

  it("cap cost reduction and rebates both reduce net cap cost, lowering the payment", () => {
    const est = calculateLeaseHackrEstimate(lease({ dueAtSigning: 3000, rebates: 1000 }));
    assert.ok(est);
    assert.equal(est.netCapCost, 46895);
    assert.equal(Math.round(est.totalMonthly), 829);
    assert.equal(Math.round(est.estimatedDueAtSigning), 3829);
  });

  it("returns null when the underlying lease math can't produce a payment", () => {
    assert.equal(calculateLeaseHackrEstimate(lease({ capCost: 0, acquisitionFee: 0 })), null);
  });
});
