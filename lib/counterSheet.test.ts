import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCashCounter, applyFinanceCounter, applyLeaseCounter, changedKeys, counterDiff, counterSheetSummary, impliedTaxRate, isDocFee, validateCounterSheet } from "./counterSheet";
import { dasTotal, monthlyPreTax } from "./leaseMath";
import type { LeaseQuote } from "./leaseQuote";
import { cashOutTheDoor, financeMonthly, type UsedCashQuote, type UsedFinanceQuote } from "./usedQuote";

// A dealer's lease as the calculator writes it: cap already nets the $1,000 incentive.
const lease: LeaseQuote = {
  capCost: 58000, residualPercent: 55, residualAmount: 33000, moneyFactor: 0.0025, termMonths: 36, milesPerYear: 12000, capReduction: 2000,
  monthlyPaymentPreTax: 0, monthlyPaymentWithEstTax: null,
  dueAtSigning: { firstMonth: 0, acquisitionFee: 995, capReduction: 2000, taxes: 132.5, otherFees: [{ name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 420 }] },
  incentives: [{ name: "Lease cash", amount: 1000 }], addOns: [{ name: "Wheel & tire protection", amount: 899 }],
  expiresAt: "2026-10-01T00:00:00Z", notes: null, counter: { counterOffer: false, note: "" },
};
lease.monthlyPaymentPreTax = monthlyPreTax({ netCap: 56000, residualAmount: 33000, moneyFactor: 0.0025, termMonths: 36 })!; // 861.39
lease.monthlyPaymentWithEstTax = Math.round(lease.monthlyPaymentPreTax * 1.06625 * 100) / 100;
lease.dueAtSigning.firstMonth = lease.monthlyPaymentWithEstTax;

describe("lease counter — price-side edits, the dealer's own factors, the payment recomputed", () => {
  it("lowering the cap cost lowers the payment by the dealer's own math; everything locked is byte-identical", () => {
    const after = applyLeaseCounter(lease, { capCost: 56500 });
    assert.equal(after.capCost, 56500);
    assert.equal(after.monthlyPaymentPreTax, monthlyPreTax({ netCap: 54500, residualAmount: 33000, moneyFactor: 0.0025, termMonths: 36 }));
    assert.ok(after.monthlyPaymentPreTax < lease.monthlyPaymentPreTax);
    for (const k of ["moneyFactor", "residualPercent", "residualAmount", "termMonths", "milesPerYear", "expiresAt"] as const) assert.equal(after[k], lease[k], k);
    assert.equal(after.dueAtSigning.acquisitionFee, 995);
    assert.equal(after.dueAtSigning.firstMonth, after.monthlyPaymentWithEstTax, "first month follows the new taxed monthly");
    assert.equal(impliedTaxRate(lease)! > 0.066 && impliedTaxRate(lease)! < 0.067, true);
    assert.equal(changedKeys({ kind: "lease", before: lease, after }).join(","), "capCost");
    assert.deepEqual(validateCounterSheet({ kind: "lease", before: lease, after }), []);
  });
  it("a bigger incentive lowers the cap by the difference; more cash down lowers the payment and moves DAS with its tax", () => {
    const after = applyLeaseCounter(lease, { incentives: [{ name: "Lease cash", amount: 1000 }, { name: "Loyalty", amount: 750 }], capReduction: 3000 });
    assert.equal(after.capCost, 57250);
    assert.equal(after.dueAtSigning.capReduction, 3000);
    assert.ok(Math.abs(after.dueAtSigning.taxes - 3000 * 0.06625) < 0.05, "tax on cap reduction scales because the dealer's figure was exactly that");
    assert.ok(dasTotal(after.dueAtSigning)! > dasTotal(lease.dueAtSigning)!);
    assert.deepEqual(changedKeys({ kind: "lease", before: lease, after }).sort(), ["capCost", "capReduction", "incentive:Loyalty"]);
  });
  it("striking an add-on and lowering the doc fee: listed lines change, the payment doesn't (add-ons sit outside the calculator's payment)", () => {
    const after = applyLeaseCounter(lease, { addOns: [{ name: "Wheel & tire protection", amount: 0 }], otherFees: [{ name: "Doc fee", amount: 499 }, { name: "Title & registration", amount: 420 }] });
    assert.equal(after.monthlyPaymentPreTax, lease.monthlyPaymentPreTax);
    assert.equal(after.dueAtSigning.otherFees[0].amount, 499);
    const rows = counterDiff({ kind: "lease", before: lease, after, changed: [] });
    assert.equal(rows.find((r) => r.key === "fee:Doc fee")!.delta, -300);
    assert.equal(rows.find((r) => r.key === "addOn:Wheel & tire protection")!.after, 0);
    assert.match(counterSheetSummary({ kind: "lease", before: lease, after, changed: changedKeys({ kind: "lease", before: lease, after }) }), /Wheel & tire protection struck · Doc fee −\$300 → \$861\.39\/mo \(was \$861\.39\/mo\)/);
  });
  it("direction rules: no raising price/fees/add-ons, no shrinking a rebate, no touching locked lines, at least one change", () => {
    const up = { ...lease, capCost: 59000 };
    assert.match(validateCounterSheet({ kind: "lease", before: lease, after: up }).join(" "), /can lower this, not raise it/);
    const mf = { ...lease, moneyFactor: 0.001 };
    assert.match(validateCounterSheet({ kind: "lease", before: lease, after: mf }).join(" "), /Money factor is set by the lender/);
    const term = { ...lease, termMonths: 39 };
    assert.match(validateCounterSheet({ kind: "lease", before: lease, after: term }).join(" "), /Term \(months\) is set by the lender/);
    const lessRebate = applyLeaseCounter(lease, { incentives: [{ name: "Lease cash", amount: 500 }] });
    assert.match(validateCounterSheet({ kind: "lease", before: lease, after: lessRebate }).join(" "), /can add to a rebate, not shrink it/);
    assert.match(validateCounterSheet({ kind: "lease", before: lease, after: applyLeaseCounter(lease, {}) }).join(" "), /Change at least one number/);
  });
});

const fin: UsedFinanceQuote = {
  kind: "finance", sellingPrice: 42000, dueAtSigning: [{ name: "Sales tax", amount: 2782 }, { name: "Doc fee", amount: 699 }, { name: "Title & registration", amount: 380 }], addOns: [{ name: "Etch", amount: 399 }], noAddOns: false, rebates: [{ name: "Bonus cash", amount: 500 }],
  miles: null, stockNumber: "A1", cpo: false, expiresAt: "2026-10-01T00:00:00Z", notes: null,
  downPayment: 5000, amountFinanced: 40760, apr: 6.9, termMonths: 60, monthlyPaymentPreTax: financeMonthly(40760, 6.9, 60)!, monthlyPaymentWithEstTax: null, lenderName: "Acura Financial",
};

describe("finance counter — amount financed moves by the delta, payment at the dealer's APR and term", () => {
  it("price down + more down payment + add-on struck + doc fee down", () => {
    const after = applyFinanceCounter(fin, { sellingPrice: 41000, downPayment: 6000, addOns: [{ name: "Etch", amount: 0 }], dueAtSigning: [{ name: "Sales tax", amount: 2782 }, { name: "Doc fee", amount: 499 }, { name: "Title & registration", amount: 380 }] });
    assert.equal(after.amountFinanced, 40760 - 1000 - 1000 - 399 - 200);
    assert.equal(after.monthlyPaymentPreTax, financeMonthly(after.amountFinanced, 6.9, 60));
    assert.equal(after.apr, 6.9); assert.equal(after.termMonths, 60); assert.equal(after.lenderName, "Acura Financial");
    assert.equal(after.noAddOns, true);
    assert.deepEqual(validateCounterSheet({ kind: "finance", before: fin, after }), []);
    assert.deepEqual(changedKeys({ kind: "finance", before: fin, after }).sort(), ["addOn:Etch", "downPayment", "fee:Doc fee", "sellingPrice"]);
  });
  it("tax and title are locked; APR/term can't move; a raised price is refused", () => {
    const tax = applyFinanceCounter(fin, { dueAtSigning: [{ name: "Sales tax", amount: 1000 }, { name: "Doc fee", amount: 699 }, { name: "Title & registration", amount: 380 }] });
    assert.match(validateCounterSheet({ kind: "finance", before: fin, after: tax }).join(" "), /Fee: Sales tax is set by the lender or the state/);
    assert.match(validateCounterSheet({ kind: "finance", before: fin, after: { ...fin, apr: 3.9 } }).join(" "), /APR is set by the lender/);
    assert.match(validateCounterSheet({ kind: "finance", before: fin, after: applyFinanceCounter(fin, { sellingPrice: 43000 }) }).join(" "), /Selling price: a counter can lower this/);
  });
});

const cash: UsedCashQuote = { kind: "cash", sellingPrice: 58900, dueAtSigning: [{ name: "Sales tax", amount: 3902 }, { name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 420 }], addOns: [{ name: "Nitrogen + etch", amount: 499 }], noAddOns: false, rebates: [], miles: null, stockNumber: "T1", cpo: false, expiresAt: "2026-10-01T00:00:00Z", notes: null };

describe("cash counter — OTD = selling price + add-ons + mandatory fees + tax − rebates, recomputed", () => {
  it("price down, add-on struck, rebate added", () => {
    const after = applyCashCounter(cash, { sellingPrice: 57500, addOns: [{ name: "Nitrogen + etch", amount: 0 }], rebates: [{ name: "Loyalty", amount: 500 }] });
    assert.equal(cashOutTheDoor(after), 57500 + 3902 + 799 + 420 - 500);
    const rows = counterDiff({ kind: "cash", before: cash, after, changed: [] });
    const otd = rows.find((r) => r.key === "otd")!;
    assert.equal(otd.before, cashOutTheDoor(cash));
    assert.equal(otd.delta, -(1400 + 499 + 500));
    assert.equal(rows.find((r) => r.key === "fee:Sales tax")!.locked, true);
    assert.equal(rows.find((r) => r.key === "fee:Doc fee")!.locked, false);
    assert.deepEqual(validateCounterSheet({ kind: "cash", before: cash, after }), []);
    assert.match(counterSheetSummary({ kind: "cash", before: cash, after, changed: changedKeys({ kind: "cash", before: cash, after }) }), /Selling price −\$1,400 · Nitrogen \+ etch struck · Loyalty −\$500 → \$62,121 \(was \$64,520\)/);
  });
  it("isDocFee picks the doc line only", () => {
    assert.equal(isDocFee("Doc fee"), true); assert.equal(isDocFee("Documentation fee"), true); assert.equal(isDocFee("Dealer prep"), true);
    assert.equal(isDocFee("Title & registration"), false); assert.equal(isDocFee("Sales tax"), false);
  });
});
