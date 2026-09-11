import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  revisedOtd,
  stateGivesTradeInTaxCredit,
  estimateRegistrationFees,
  NO_TRADE_IN_TAX_CREDIT_STATES,
} from "./tradeInMath";

describe("stateGivesTradeInTaxCredit", () => {
  it("gives the credit in the common case and withholds it in the listed states", () => {
    assert.equal(stateGivesTradeInTaxCredit("NJ"), true);
    assert.equal(stateGivesTradeInTaxCredit("tx"), true);
    for (const s of NO_TRADE_IN_TAX_CREDIT_STATES) {
      assert.equal(stateGivesTradeInTaxCredit(s), false, s);
    }
  });

  it("assumes the common case when the state is unknown", () => {
    assert.equal(stateGivesTradeInTaxCredit(""), true);
    assert.equal(stateGivesTradeInTaxCredit(null), true);
    assert.equal(stateGivesTradeInTaxCredit("USA"), true);
  });
});

describe("revisedOtd", () => {
  const base = { quotedOtdPrice: 50_000, taxRate: 0.06625, registrationState: "NJ" };

  it("taxes the price net of the trade-in where the state allows it", () => {
    const r = revisedOtd({ ...base, appraisal: { allowance: 20_000, loanPayoff: 0 } });
    assert.equal(r.tradeInTaxCredit, true);
    assert.equal(r.taxableAmount, 30_000);
    assert.equal(r.salesTax, Math.round(30_000 * 0.06625)); // 1988
    assert.equal(r.salesTaxWithoutTradeIn, Math.round(50_000 * 0.06625)); // 3313
    assert.equal(r.taxSavedByTradeIn, r.salesTaxWithoutTradeIn - r.salesTax);
  });

  it("taxes the full price in a no-credit state", () => {
    const r = revisedOtd({ ...base, registrationState: "CA", taxRate: 0.0882, appraisal: { allowance: 20_000, loanPayoff: 0 } });
    assert.equal(r.tradeInTaxCredit, false);
    assert.equal(r.taxableAmount, 50_000);
    assert.equal(r.taxSavedByTradeIn, 0);
  });

  it("applies positive equity against what's due", () => {
    const r = revisedOtd({ ...base, appraisal: { allowance: 20_000, loanPayoff: 12_000 } });
    assert.equal(r.tradeInEquity, 8_000);
    assert.equal(r.amountDue, r.totalBeforeTradeIn - 8_000);
  });

  it("adds negative equity to what's due", () => {
    const r = revisedOtd({ ...base, appraisal: { allowance: 10_000, loanPayoff: 15_000 } });
    assert.equal(r.tradeInEquity, -5_000);
    assert.equal(r.amountDue, r.totalBeforeTradeIn + 5_000);
    // The tax credit is on the allowance, not the equity — a loan doesn't
    // change what the state considers the trade worth.
    assert.equal(r.taxableAmount, 40_000);
  });

  it("registration matches calculateOtd's estimate exactly", () => {
    assert.equal(estimateRegistrationFees(50_000), Math.round(50_000 * 0.011 + 220));
    const r = revisedOtd({ ...base, appraisal: { allowance: 0, loanPayoff: 0 } });
    assert.equal(r.registrationFees, estimateRegistrationFees(50_000));
  });

  it("never goes below zero and never taxes a negative amount", () => {
    const r = revisedOtd({ ...base, appraisal: { allowance: 80_000, loanPayoff: 0 } });
    assert.equal(r.taxableAmount, 0);
    assert.equal(r.salesTax, 0);
    assert.equal(r.amountDue, 0);
  });

  it("treats garbage numbers as zero rather than NaN", () => {
    const r = revisedOtd({ quotedOtdPrice: NaN, taxRate: NaN, registrationState: "NJ", appraisal: { allowance: NaN, loanPayoff: -5 } });
    assert.equal(r.quotedOtdPrice, 0);
    assert.equal(r.salesTax, 0);
    assert.equal(r.loanPayoff, 0);
    assert.equal(Number.isNaN(r.amountDue), false);
  });

  it("with no trade-in at all reduces to the plain OTD", () => {
    const r = revisedOtd({ ...base, appraisal: { allowance: 0, loanPayoff: 0 } });
    assert.equal(r.amountDue, r.totalBeforeTradeIn);
    assert.equal(r.taxSavedByTradeIn, 0);
  });
});
