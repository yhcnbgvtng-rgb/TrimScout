import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TAX_AS_QUOTED_NOTE, TAX_PROMPT_COPY, TAX_UPDATE_NOTE, counterPriceChanged, isLockedFee, applyCashCounter, applyFinanceCounter, applyLeaseCounter, changedKeys, counterDiff, counterSheetSummary, impliedTaxRate, isDocFee, validateCounterSheet } from "./counterSheet";
import { dasTotal, monthlyPreTax } from "./leaseMath";
import type { LeaseQuote } from "./leaseQuote";
import { cashOutTheDoor, financeMonthly, type UsedCashQuote, type UsedFinanceQuote } from "./usedQuote";

// A dealer's lease as the calculator writes it: cap already nets the $1,000 incentive.
const lease: LeaseQuote = {
  capCost: 58000, residualPercent: 55, residualAmount: 33000, moneyFactor: 0.0025, termMonths: 36, milesPerYear: 12000, capReduction: 2000,
  monthlyPaymentPreTax: 0, monthlyPaymentWithEstTax: null,
  dueAtSigning: { firstMonth: 0, acquisitionFee: 995, capReduction: 2000, taxes: 132.5, otherFees: [{ name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 420 }, { name: "Electronic filing fee", amount: 85 }] },
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
  it("a bigger incentive lowers the cap by the difference; more cash down lowers the payment and moves DAS (tax stays as quoted)", () => {
    const after = applyLeaseCounter(lease, { incentives: [{ name: "Lease cash", amount: 1000 }, { name: "Loyalty", amount: 750 }], capReduction: 3000 });
    assert.equal(after.capCost, 57250);
    assert.equal(after.dueAtSigning.capReduction, 3000);
    assert.equal(after.dueAtSigning.taxes, 132.5, "tax is not recalculated on the buyer's side");
    assert.ok(dasTotal(after.dueAtSigning)! > dasTotal(lease.dueAtSigning)!);
    assert.deepEqual(changedKeys({ kind: "lease", before: lease, after }).sort(), ["capCost", "capReduction", "incentive:Loyalty"]);
  });
  it("striking an add-on and lowering the electronic fee: listed lines change, the payment doesn't (add-ons sit outside the calculator's payment)", () => {
    const after = applyLeaseCounter(lease, { addOns: [{ name: "Wheel & tire protection", amount: 0 }], otherFees: [{ name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 420 }, { name: "Electronic filing fee", amount: 25 }] });
    assert.equal(after.monthlyPaymentPreTax, lease.monthlyPaymentPreTax);
    assert.equal(after.dueAtSigning.otherFees[2].amount, 25);
    const rows = counterDiff({ kind: "lease", before: lease, after, changed: [] });
    assert.equal(rows.find((r) => r.key === "fee:Electronic filing fee")!.delta, -60);
    assert.equal(rows.find((r) => r.key === "addOn:Wheel & tire protection")!.after, 0);
    assert.match(counterSheetSummary({ kind: "lease", before: lease, after, changed: changedKeys({ kind: "lease", before: lease, after }) }), /Wheel & tire protection struck · Electronic filing fee −\$60 → \$861\.39\/mo \(was \$861\.39\/mo\)/);
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
  kind: "finance", sellingPrice: 42000, dueAtSigning: [{ name: "Sales tax", amount: 2782 }, { name: "Doc fee", amount: 699 }, { name: "Title & registration", amount: 380 }, { name: "Electronic filing fee", amount: 150 }], addOns: [{ name: "Etch", amount: 399 }], noAddOns: false, rebates: [{ name: "Bonus cash", amount: 500 }],
  miles: null, stockNumber: "A1", cpo: false, expiresAt: "2026-10-01T00:00:00Z", notes: null,
  downPayment: 5000, amountFinanced: 40760, apr: 6.9, termMonths: 60, monthlyPaymentPreTax: financeMonthly(40760, 6.9, 60)!, monthlyPaymentWithEstTax: null, lenderName: "Acura Financial",
};

describe("finance counter — amount financed moves by the delta, payment at the dealer's APR and term", () => {
  it("price down + more down payment + add-on struck + doc fee down", () => {
    const after = applyFinanceCounter(fin, { sellingPrice: 41000, downPayment: 6000, addOns: [{ name: "Etch", amount: 0 }], dueAtSigning: [{ name: "Sales tax", amount: 2782 }, { name: "Doc fee", amount: 699 }, { name: "Title & registration", amount: 380 }, { name: "Electronic filing fee", amount: 100 }] });
    assert.equal(after.amountFinanced, 40760 - 1000 - 1000 - 399 - 50);
    assert.equal(after.monthlyPaymentPreTax, financeMonthly(after.amountFinanced, 6.9, 60));
    assert.equal(after.apr, 6.9); assert.equal(after.termMonths, 60); assert.equal(after.lenderName, "Acura Financial");
    assert.equal(after.noAddOns, true);
    assert.deepEqual(validateCounterSheet({ kind: "finance", before: fin, after }), []);
    assert.deepEqual(changedKeys({ kind: "finance", before: fin, after }).sort(), ["addOn:Etch", "downPayment", "fee:Electronic filing fee", "sellingPrice"]);
  });
  it("tax and title are locked; APR/term can't move; a raised price is refused", () => {
    const tax = applyFinanceCounter(fin, { dueAtSigning: [{ name: "Sales tax", amount: 1000 }, { name: "Doc fee", amount: 699 }, { name: "Title & registration", amount: 380 }] });
    assert.match(validateCounterSheet({ kind: "finance", before: fin, after: tax }).join(" "), /Fee: Sales tax is set by the lender or the state/);
    assert.match(validateCounterSheet({ kind: "finance", before: fin, after: { ...fin, apr: 3.9 } }).join(" "), /APR is set by the lender/);
    assert.match(validateCounterSheet({ kind: "finance", before: fin, after: applyFinanceCounter(fin, { sellingPrice: 43000 }) }).join(" "), /Selling price: a counter can lower this/);
  });
});

const cash: UsedCashQuote = { kind: "cash", sellingPrice: 58900, dueAtSigning: [{ name: "Sales tax", amount: 3902 }, { name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 420 }, { name: "Electronic filing fee", amount: 150 }], addOns: [{ name: "Nitrogen + etch", amount: 499 }], noAddOns: false, rebates: [], miles: null, stockNumber: "T1", cpo: false, expiresAt: "2026-10-01T00:00:00Z", notes: null };

describe("cash counter — OTD = selling price + add-ons + mandatory fees + tax − rebates, recomputed", () => {
  it("price down, add-on struck, rebate added", () => {
    const after = applyCashCounter(cash, { sellingPrice: 57500, addOns: [{ name: "Nitrogen + etch", amount: 0 }], rebates: [{ name: "Loyalty", amount: 500 }] });
    assert.equal(cashOutTheDoor(after), 57500 + 3902 + 799 + 420 + 150 - 500);
    const rows = counterDiff({ kind: "cash", before: cash, after, changed: [] });
    const otd = rows.find((r) => r.key === "otd")!;
    assert.equal(otd.before, cashOutTheDoor(cash));
    assert.equal(otd.delta, -(1400 + 499 + 500));
    assert.equal(rows.find((r) => r.key === "fee:Sales tax")!.locked, true);
    assert.equal(rows.find((r) => r.key === "fee:Doc fee")!.locked, true, "doc fee is fixed now");
    assert.equal(rows.find((r) => r.key === "fee:Electronic filing fee")!.locked, false);
    assert.deepEqual(validateCounterSheet({ kind: "cash", before: cash, after }), []);
    assert.match(counterSheetSummary({ kind: "cash", before: cash, after, changed: changedKeys({ kind: "cash", before: cash, after }) }), /Selling price −\$1,400 · Nitrogen \+ etch struck · Loyalty −\$500 → \$62,271 \(was \$64,670\)/);
  });
  it("isDocFee picks the doc line only", () => {
    assert.equal(isDocFee("Doc fee"), true); assert.equal(isDocFee("Documentation fee"), true); assert.equal(isDocFee("Dealer prep"), true);
    assert.equal(isDocFee("Title & registration"), false); assert.equal(isDocFee("Sales tax"), false);
  });
});

describe("locked lines — sales tax, title & registration and the doc fee are fixed, on the client sheet and the server check", () => {
  for (const name of ["Sales tax", "Title & registration", "Doc fee"]) {
    it(`${name}: lowering, raising or striking it is refused (cash)`, () => {
      const base = cash.dueAtSigning.find((l) => l.name === name)!.amount;
      for (const amount of [base - 100, base + 100, 0]) {
        const lines = cash.dueAtSigning.map((l) => (l.name === name ? { ...l, amount } : l));
        const errs = validateCounterSheet({ kind: "cash", before: cash, after: applyCashCounter(cash, { dueAtSigning: lines, sellingPrice: 57000 }) });
        assert.ok(errs.some((e) => e.includes(`Fee: ${name} is set by the lender or the state`)), `${name} → ${amount}: ${errs.join(" | ")}`);
      }
    });
    it(`${name}: locked on a finance quote`, () => {
      const base = fin.dueAtSigning.find((l) => l.name === name)!.amount;
      const after = applyFinanceCounter(fin, { dueAtSigning: fin.dueAtSigning.map((l) => (l.name === name ? { ...l, amount: base - 50 } : l)) });
      assert.match(validateCounterSheet({ kind: "finance", before: fin, after }).join(" "), /is set by the lender or the state/);
    });
  }
  it("lease: the doc fee and title are fixed, and so is the sales tax at signing", () => {
    const doc = applyLeaseCounter(lease, { otherFees: lease.dueAtSigning.otherFees.map((f) => (f.name === "Doc fee" ? { ...f, amount: 499 } : f)) });
    assert.match(validateCounterSheet({ kind: "lease", before: lease, after: doc }).join(" "), /Fee: Doc fee is set by the lender or the state/);
    const title = applyLeaseCounter(lease, { otherFees: lease.dueAtSigning.otherFees.filter((f) => f.name !== "Title & registration") });
    assert.match(validateCounterSheet({ kind: "lease", before: lease, after: title }).join(" "), /Title & registration is set by the lender or the state/);
    const tax = { ...applyLeaseCounter(lease, { capCost: 57000 }), dueAtSigning: { ...lease.dueAtSigning, taxes: 10 } };
    assert.match(validateCounterSheet({ kind: "lease", before: lease, after: tax }).join(" "), /Taxes due at signing is set by the lender or the state/);
  });
  it("isLockedFee: tax, title/registration and doc are locked; electronic and other named fees are not", () => {
    for (const n of ["Sales tax", "Title & registration", "Doc fee", "Documentation fee"]) assert.equal(isLockedFee(n), true, n);
    for (const n of ["Electronic filing fee", "Nitrogen fill", "Courier fee"]) assert.equal(isLockedFee(n), false, n);
  });
  it("sales tax is not recalculated on the buyer's side: a price counter leaves every tax line and the OTD tax as quoted", () => {
    const after = applyCashCounter(cash, { sellingPrice: 55000 });
    assert.equal(after.dueAtSigning.find((l) => l.name === "Sales tax")!.amount, 3902);
    const otd = counterDiff({ kind: "cash", before: cash, after, changed: [] }).find((r) => r.key === "otd")!;
    assert.equal(otd.note, TAX_AS_QUOTED_NOTE);
    assert.equal(otd.after, 55000 + 3902 + 799 + 420 + 150 + 499);
    const l2 = applyLeaseCounter(lease, { capCost: 56000, capReduction: 3000 });
    assert.equal(l2.dueAtSigning.taxes, lease.dueAtSigning.taxes);
  });
});

describe("other named fees can be lowered or struck; they can't be raised or invented", () => {
  it("lowering and striking the electronic fee are accepted (cash, finance, lease)", () => {
    for (const amount of [60, 0]) {
      const c = applyCashCounter(cash, { dueAtSigning: cash.dueAtSigning.map((l) => (l.name === "Electronic filing fee" ? { ...l, amount } : l)) });
      assert.deepEqual(validateCounterSheet({ kind: "cash", before: cash, after: c }), [], `cash ${amount}`);
      const f = applyFinanceCounter(fin, { dueAtSigning: fin.dueAtSigning.map((l) => (l.name === "Electronic filing fee" ? { ...l, amount } : l)) });
      assert.deepEqual(validateCounterSheet({ kind: "finance", before: fin, after: f }), [], `finance ${amount}`);
      const l = applyLeaseCounter(lease, { otherFees: lease.dueAtSigning.otherFees.map((x) => (x.name === "Electronic filing fee" ? { ...x, amount } : x)) });
      assert.deepEqual(validateCounterSheet({ kind: "lease", before: lease, after: l }), [], `lease ${amount}`);
    }
  });
  it("raising an existing fee or adding a new one is refused", () => {
    const up = applyCashCounter(cash, { dueAtSigning: cash.dueAtSigning.map((l) => (l.name === "Electronic filing fee" ? { ...l, amount: 400 } : l)) });
    assert.match(validateCounterSheet({ kind: "cash", before: cash, after: up }).join(" "), /Electronic filing fee: a counter can lower this, not raise it/);
    const added = applyCashCounter(cash, { dueAtSigning: [...cash.dueAtSigning, { name: "Courier fee", amount: 20 }], sellingPrice: 57000 });
    assert.match(validateCounterSheet({ kind: "cash", before: cash, after: added }).join(" "), /Courier fee: a counter can lower this/);
  });
  it("the 'change at least one number' check still fires with nothing edited", () => {
    assert.match(validateCounterSheet({ kind: "cash", before: cash, after: applyCashCounter(cash, {}) }).join(" "), /Change at least one number/);
  });
});

describe("a price change flags the sales tax for the dealer", () => {
  it("counterPriceChanged: only the buyer's price ask counts (a bigger lease incentive alone does not)", () => {
    assert.equal(counterPriceChanged({ kind: "cash", before: cash, after: applyCashCounter(cash, { sellingPrice: 57000 }) }), true);
    assert.equal(counterPriceChanged({ kind: "cash", before: cash, after: applyCashCounter(cash, { rebates: [{ name: "Loyalty", amount: 500 }] }) }), false);
    assert.equal(counterPriceChanged({ kind: "lease", before: lease, after: applyLeaseCounter(lease, { capCost: 56500 }) }), true);
    assert.equal(counterPriceChanged({ kind: "lease", before: lease, after: applyLeaseCounter(lease, { incentives: [{ name: "Lease cash", amount: 1000 }, { name: "Loyalty", amount: 750 }] }) }), false);
    assert.equal(counterPriceChanged(null), false);
  });
  it("copy and wiring: buyer note under the price, dealer prompt blocks submit until tax is edited or confirmed", async () => {
    assert.equal(TAX_UPDATE_NOTE, "Sales tax will be updated by the dealer when they respond.");
    assert.equal(TAX_PROMPT_COPY, "Price changed — update sales tax before sending");
    assert.equal(TAX_AS_QUOTED_NOTE, "tax shown as quoted; dealer will update");
    const fs = await import("node:fs");
    const form = fs.readFileSync("components/CounterSheetForm.tsx", "utf8");
    assert.match(form, /counterPriceChanged\(sheet\) \? <span[^>]*data-testid="tax-update-note">\{TAX_UPDATE_NOTE\}/);
    for (const f of ["components/UsedQuoteForm.tsx", "components/LeaseCalculatorForm.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      assert.match(src, /counterPriceChanged\(counterSheet\) && !taxConfirmed/, f);
      assert.match(src, /\.\.\.\(taxPending \? \[TAX_PROMPT_COPY\] : \[\]\)/, f);
      assert.match(src, /if \(errors\.length\) return;/, f);
      assert.match(src, /<TaxUpdatePrompt pending=\{taxPending\}/, f);
    }
    const page = fs.readFileSync("app/quote-request/received/page.tsx", "utf8");
    assert.equal((page.match(/counterSheet=\{ctx\.buyerCounter\?\.sheet \?\? null\}/g) || []).length, 2, "both dealer forms get the buyer's counter");
  });
});

describe("line comments are gone", () => {
  it("no 'Comment on a line' section, state or API field anywhere", async () => {
    const fs = await import("node:fs");
    const form = fs.readFileSync("components/CounterSheetForm.tsx", "utf8");
    assert.doesNotMatch(form, /Comment on a line|line-comments|lineNote/i);
    assert.match(form, /Note to the dealer \(optional\)/);
    for (const f of ["lib/buyerCounter.ts", "lib/counterSheet.ts", "app/api/rfqs/[id]/invites/[inviteId]/counter/route.ts"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /lineNotes?|lineComments?/i, f);
    assert.match(form, /Sales tax, title &amp; registration and doc fee stay as quoted\. Price and other fees can only go down, add-ons can be lowered or struck, rebates added\./);
  });
});
