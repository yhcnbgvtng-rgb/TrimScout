import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aprFromMf, dasTotal, dueAtSigningFrom, effectiveMonthly, monthlyPreTax, monthlyWithTax, netCapCost, num, residualAmountFrom, totalLeaseCost } from "./leaseMath";

describe("leaseMath — blank until the inputs exist, then the standard lease formula", () => {
  it("parses money-ish text and treats blank/junk as null, never 0", () => {
    assert.equal(num("$52,000"), 52000);
    assert.equal(num("0.00225"), 0.00225);
    assert.equal(num("58%"), 58);
    assert.equal(num(""), null);
    assert.equal(num("abc"), null);
    assert.equal(num(undefined), null);
  });

  it("every derived figure is null until its inputs are real — no $0 monthly, no $0 DAS", () => {
    assert.equal(netCapCost({ capCost: null, capReduction: 0, incentivesTotal: 0 }), null);
    assert.equal(residualAmountFrom(null, 58), null);
    assert.equal(monthlyPreTax({ netCap: 50000, residualAmount: 30000, moneyFactor: null, termMonths: 36 }), null);
    assert.equal(monthlyPreTax({ netCap: 50000, residualAmount: 30000, moneyFactor: 0.002, termMonths: null }), null);
    assert.equal(monthlyWithTax(null, 0.06625), null);
    assert.equal(dueAtSigningFrom({ monthly: null, monthlyTaxed: null, acquisitionFee: 695, capReduction: 0, taxesOverride: null, taxRate: null, otherFees: [] }), null);
    assert.equal(totalLeaseCost(null, 36, null), null);
    assert.equal(aprFromMf(null), null);
  });

  it("worked example: $52,000 cap, $1,000 incentive, 58% of $55,000 MSRP residual, MF .00225, 36 mo, NJ tax", () => {
    const netCap = netCapCost({ capCost: 52000, capReduction: 0, incentivesTotal: 1000 });
    assert.equal(netCap, 51000);
    const residual = residualAmountFrom(55000, 58);
    assert.equal(residual, 31900);
    const monthly = monthlyPreTax({ netCap, residualAmount: residual, moneyFactor: 0.00225, termMonths: 36 });
    // depreciation (51000−31900)/36 = 530.56; rent (51000+31900)×.00225 = 186.53 → 717.08
    assert.equal(monthly, 717.08);
    assert.equal(monthlyWithTax(monthly, 0.06625), 764.59);
    assert.equal(aprFromMf(0.00225), 5.4);
    const das = dueAtSigningFrom({ monthly, monthlyTaxed: 764.59, acquisitionFee: 695, capReduction: 0, taxesOverride: null, taxRate: 0.06625, otherFees: [{ name: "Doc fee", amount: 299 }] });
    assert.deepEqual(das, { firstMonth: 764.59, acquisitionFee: 695, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 299 }] });
    assert.equal(dasTotal(das), 1758.59);
    const total = totalLeaseCost(monthly, 36, das);
    assert.equal(total, 717.08 * 36 + 1758.59 - 764.59);
    assert.equal(effectiveMonthly(total, 36), Math.round((total! / 36) * 100) / 100);
  });

  it("cap reduction is taxed up front by default; a typed taxes figure wins", () => {
    const d = dueAtSigningFrom({ monthly: 500, monthlyTaxed: null, acquisitionFee: 0, capReduction: 2000, taxesOverride: null, taxRate: 0.06625, otherFees: [] });
    assert.equal(d?.taxes, 132.5);
    const o = dueAtSigningFrom({ monthly: 500, monthlyTaxed: null, acquisitionFee: 0, capReduction: 2000, taxesOverride: 99, taxRate: 0.06625, otherFees: [] });
    assert.equal(o?.taxes, 99);
    assert.equal(dueAtSigningFrom({ monthly: 500, monthlyTaxed: null, acquisitionFee: 0, capReduction: 0, taxesOverride: null, taxRate: null, otherFees: [{ name: "", amount: 50 }] })?.otherFees.length, 0, "unnamed fees are dropped");
  });
});

import fs from "node:fs";
import path from "node:path";

describe("wiring — lease deals record dealer quotes through the calculator sheet, cash/finance keep the price form", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  const page = read("app/rfq/[id]/page.tsx");
  const sheet = read("components/LeaseCalculatorSheet.tsx");
  const route = read("app/api/rfqs/[id]/invites/[inviteId]/quotes/route.ts");

  it("InviteRow branches on rfq.leasePrefs", () => {
    assert.match(page, /mode === "quote" && rfq\.leasePrefs && \([\s\S]*?<LeaseCalculatorSheet/);
    assert.match(page, /mode === "quote" && !rfq\.leasePrefs && \([\s\S]*?<QuoteIntakeForm/);
  });

  it("the sheet has the five sections, starts blank, and never carries third-party branding or auction copy", () => {
    for (const h of ["1 · Deal inputs", "2 · Lease terms", "3 · Tax context", "4 · Results", "Quote details"]) assert.match(sheet, new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(sheet, /msrp: "",\s*capCost: "",\s*capReduction: "",\s*acquisitionFee: "",\s*termMonths: "",\s*milesPerYear: "",\s*residualPercent: "",\s*residualAmount: "",\s*moneyFactor: ""/);
    assert.match(sheet, /expiresAt: "",/);
    assert.match(sheet, /validateLeaseQuote\(quote, prefs/);
    assert.match(sheet, /overMaxCashDue\(d\.das, prefs\)/);
    assert.doesNotMatch(sheet, /leasehackr|LH score|auction|\bbid\b/i);
    // Render helpers, not nested components — inputs must keep focus while typing.
    assert.doesNotMatch(sheet, /<Field |<ItemList |<Out /);
  });

  it("the buyer-side quotes route validates a lease body with the shared contract and refuses price-only entries on lease deals", () => {
    assert.match(route, /if \(rfq\.leasePrefs\) \{[\s\S]*?if \(!body\.lease[\s\S]*?status: 422/);
    assert.match(route, /validateLeaseQuote\(quote, rfq\.leasePrefs/);
    assert.match(route, /lease,\s*\}\);/);
  });
});
