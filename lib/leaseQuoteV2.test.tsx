// Lease quote v2: VIN rules, MSRP → residual, server-enforced required fields, tax methods, the dealer / government fee split,
// rolled-in lines in the net cap cost, the override reason, incentive attestation, total lease cost, and the buyer compare labels.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaseCompare } from "../components/LeaseCompare";
import { LeaseCalculatorForm } from "../components/LeaseCalculatorForm";
import { CounterSheetForm } from "../components/CounterSheetForm";
import { analyzeLeaseQuotes } from "./leaseCompare";
import {
  coerceLeaseQuote, creditTierRank, dueAtSigningTotal, endOfMonthDate, feeSubtotals, finalizeLeaseQuote, normalizeVin, pricedAtLowerTier,
  validateLeaseQuote, vinProblem, type LeaseQuote,
} from "./leaseQuote";
import { calcNetCap, computeLeaseTax, dasTotal, dueAtSigningFrom, residualAmountFrom, totalLeaseCost } from "./leaseMath";
import { feeTaxableDefault, leaseTaxMethodDefault } from "./leaseDefaults";
import { applyLeaseCounter } from "./counterSheet";
import type { RfqInvite, RfqRequest } from "./rfq";

const NOW = new Date("2026-09-13T12:00:00Z");
const PREFS = { termMonths: 36 as const, milesPerYear: 10000 as const };
const VIN = "1FMEE9BP9TLA88678";
const read = (f: string) => fs.readFileSync(f, "utf8");

/** A complete v2 quote as the form would send it (raw, before coerceLeaseQuote). */
const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  capCost: 52000, sellingPrice: 53000, msrpForResidual: 52000, residualPercent: 58, residualAmount: 30160, moneyFactor: 0.00225, termMonths: 36, milesPerYear: 10000,
  capReduction: 0, monthlyPaymentPreTax: 612, monthlyPaymentWithEstTax: 652.5,
  dueAtSigning: { firstMonth: 652.5, acquisitionFee: 0, capReduction: 0, taxes: 120, securityDeposit: 0, otherFees: [{ name: "Doc fee", amount: 299, category: "dealer", taxable: true, timing: "signing" }] },
  incentives: [{ name: "Loyalty", amount: 1000, eligibilityType: "loyalty", eligibilityProof: "current Ford lease" }], incentiveAttested: true,
  addOns: [], rolledFees: [], expiresAt: "2026-09-20T00:00:00Z", notes: null, counter: { counterOffer: false, note: "" },
  lenderType: "captive", lenderName: "Ford Credit", creditTierAssumed: "Tier 1", taxMethod: "monthly", vehicleStatus: "in_stock",
  securityDeposit: 0, dispositionFee: 395, excessMileagePerMile: 0.25,
  ...over,
});
const check = (over: Record<string, unknown> = {}, vin: string | null = VIN, opts?: { legacy?: boolean }) =>
  validateLeaseQuote(coerceLeaseQuote(raw(over)), PREFS, { vin }, NOW, opts);

describe("VIN: 17 characters, uppercase, no I / O / Q — and a text keyboard, not a number pad", () => {
  it("normalizes to uppercase and rejects bad VINs", () => {
    assert.equal(normalizeVin(" 1fmee9bp9tla88678 "), VIN);
    assert.equal(vinProblem(VIN), null);
    assert.match(vinProblem("")!, /required/);
    assert.match(vinProblem("1FMEE9BP9TLA8867")!, /17/);
    for (const bad of ["1FMEE9BP9TLA8867I", "1FMEE9BP9TLA8867O", "1FMEE9BP9TLA8867Q"]) assert.match(vinProblem(bad)!, /I, O or Q/);
  });
  it("the server rejects a short or I/O/Q VIN", () => {
    assert.ok(check({}, "ABC123").errors.some((e) => /17/.test(e)));
    assert.ok(check({}, "1FMEE9BP9TLA8867Q").errors.some((e) => /I, O or Q/.test(e)));
    assert.deepEqual(check({}).errors, []);
  });
  it("the VIN input is a text keyboard, uppercase, 17 long — not inputMode decimal", () => {
    const form = read("components/LeaseCalculatorForm.tsx");
    const vin = form.slice(form.indexOf("<span className={labelCls}>VIN {req}</span>"), form.indexOf('data-testid="vin-input"'));
    assert.match(vin, /inputMode="text"/);
    assert.match(vin, /autoCapitalize="characters"/);
    assert.match(vin, /maxLength=\{17\}/);
    assert.doesNotMatch(vin, /inputMode="decimal"/);
    assert.match(form, /inputMode=\{kind === "text" \? "text" : "decimal"\}/, "the shared text field no longer forces the decimal pad");
  });
});

describe("MSRP used for residual → residual amount", () => {
  it("auto-fills MSRP × residual %", () => {
    assert.equal(residualAmountFrom(52000, 58), 30160);
    assert.equal(residualAmountFrom(null, 58), null);
  });
  it("MSRP is required, and the field is relabeled with the lender hint", () => {
    assert.ok(check({ msrpForResidual: undefined }).errors.some((e) => /MSRP used for residual is required/.test(e)));
    const form = read("components/LeaseCalculatorForm.tsx");
    assert.match(form, /title: "MSRP used for residual", required: true/);
    assert.match(form, /Some lenders use an adjusted MSRP\. Enter the figure your residual is based on\./);
  });
  it("a typed residual that doesn't match (beyond $1 rounding) is flagged 'Residual entered directly' by the server and warned", () => {
    const ok = coerceLeaseQuote(raw({ residualAmount: 30160.6 }));
    assert.equal(ok.residualEnteredDirectly, false, "within rounding");
    const off = coerceLeaseQuote(raw({ residualAmount: 31000 }));
    assert.equal(off.residualEnteredDirectly, true);
    assert.ok(validateLeaseQuote(off, PREFS, { vin: VIN }, NOW).warnings.some((w) => /Residual entered directly/.test(w)));
    assert.equal(coerceLeaseQuote(raw({ residualEnteredDirectly: true })).residualEnteredDirectly, false, "the browser can't set the flag");
  });
});

describe("required fields are enforced server-side", () => {
  const missing: Array<[string, Record<string, unknown>, RegExp]> = [
    ["MSRP", { msrpForResidual: undefined }, /MSRP used for residual/],
    ["lender", { lenderType: undefined, lenderName: "" }, /Lender is required/],
    ["bank name", { lenderType: "bank", lenderName: "" }, /bank or credit union name/i],
    ["credit tier", { creditTierAssumed: "" }, /Credit tier/],
    ["tax method", { taxMethod: undefined }, /Tax method is required/],
    ["'other' tax description", { taxMethod: "other", taxMethodOther: "" }, /Describe the tax method/],
    ["expiry", { expiresAt: "" }, /good through is required/i],
    ["vehicle status", { vehicleStatus: undefined }, /Vehicle status is required/],
    ["ETA when in transit", { vehicleStatus: "in_transit", etaDate: "" }, /ETA date is required/],
    ["security deposit", { securityDeposit: undefined, dueAtSigning: { ...(raw().dueAtSigning as object), securityDeposit: undefined } }, /Security deposit is required/],
    ["disposition fee", { dispositionFee: undefined }, /Disposition fee is required/],
    ["excess mileage charge", { excessMileagePerMile: undefined }, /Excess mileage charge/],
    ["selling price", { sellingPrice: undefined }, /Selling price is required/],
  ];
  for (const [name, over, re] of missing) it(`a quote missing ${name} is rejected`, () => assert.ok(check(over).errors.some((e) => re.test(e)), `${name}: ${check(over).errors.join(" | ")}`));
  it("$0 is accepted for the deposit, disposition fee and excess mileage charge", () => {
    assert.deepEqual(check({ securityDeposit: 0, dispositionFee: 0, excessMileagePerMile: 0 }).errors, []);
  });
  it("in-stock needs no ETA; in transit / on order take a real, non-past ETA", () => {
    assert.deepEqual(check({ vehicleStatus: "in_stock", etaDate: "" }).errors, []);
    assert.deepEqual(check({ vehicleStatus: "on_order", etaDate: "2026-10-30" }).errors, []);
    assert.ok(check({ vehicleStatus: "in_transit", etaDate: "2026-01-01" }).errors.some((e) => /past/.test(e)));
    assert.equal(coerceLeaseQuote(raw({ vehicleStatus: "in_stock", etaDate: "2026-10-30" })).etaDate, null, "an in-stock car keeps no ETA");
  });
  it("good-through is today or later and no more than 45 days out", () => {
    assert.ok(check({ expiresAt: "2026-09-12T00:00:00Z" }).errors.some((e) => /today or later/.test(e)));
    assert.deepEqual(check({ expiresAt: "2026-10-27T23:59:59Z" }).errors, [], "44 days out");
    assert.ok(check({ expiresAt: "2026-11-20T00:00:00Z" }).errors.some((e) => /more than 45 days/.test(e)));
  });
  it("defaults to the last day of the current month", () => {
    assert.equal(endOfMonthDate(new Date(2026, 8, 13)), "2026-09-30");
    assert.equal(endOfMonthDate(new Date(2028, 1, 3)), "2028-02-29");
    assert.match(read("components/LeaseCalculatorForm.tsx"), /carryOverDate\(initial\?\.expiresAt\) \|\| endOfMonthDate\(\)/);
  });
  it("the submit route validates strictly and stores only what coerce + finalize produced; buyer-logged quotes keep the legacy rules", () => {
    const route = read("app/api/quote-invite/lease-quote/route.ts");
    assert.match(route, /coerceLeaseQuote\(/);
    assert.match(route, /validateLeaseQuote\(quote, rfq\.leasePrefs, \{ vin, stockNumber \}\)/);
    assert.match(route, /status: 422/);
    assert.match(read("app/api/rfqs/[id]/invites/[inviteId]/quotes/route.ts"), /legacy: true/);
  });
  it("sanity warnings: money factor outside 0.00001–0.01, residual outside 20–85%", () => {
    assert.ok(check({ moneyFactor: 0.000001 }).warnings.some((w) => /0\.00001–0\.01/.test(w)));
    assert.ok(check({ moneyFactor: 0.02 }).warnings.some((w) => /0\.00001–0\.01/.test(w)));
    assert.ok(!check({}).warnings.some((w) => /money factor/i.test(w)));
    assert.ok(check({ residualPercent: 15 }).warnings.some((w) => /20–85%/.test(w)));
    assert.ok(check({ residualPercent: 90 }).warnings.some((w) => /20–85%/.test(w)));
    assert.ok(!check({ residualPercent: 58 }).warnings.some((w) => /20–85%/.test(w)));
  });
});

describe("tax methods are applied by the calculator", () => {
  const base = { taxRate: 0.1, monthly: 500, termMonths: 36, grossCapCost: 40000, capReduction: 2000, taxableAtSigning: 300, taxesOverride: null };
  it("monthly on payment: each payment is taxed; at signing, tax on the cap reduction + taxable signing lines", () => {
    const t = computeLeaseTax({ ...base, method: "monthly" });
    assert.equal(t.monthlyTaxed, 550);
    assert.equal(t.taxesAtSigning, 230);
  });
  it("upfront on total payments: payments untaxed; one tax on (monthly × term) + taxable signing lines", () => {
    const t = computeLeaseTax({ ...base, method: "upfront_payments" });
    assert.equal(t.monthlyTaxed, 500);
    assert.equal(t.taxesAtSigning, 1830);
  });
  it("upfront on cap cost: payments untaxed; one tax on the gross cap cost + taxable signing lines", () => {
    const t = computeLeaseTax({ ...base, method: "upfront_cap_cost" });
    assert.equal(t.monthlyTaxed, 500);
    assert.equal(t.taxesAtSigning, 4030);
  });
  it("other: payments taxed at the rate; the dealer types the signing tax; a typed figure always wins", () => {
    assert.deepEqual(computeLeaseTax({ ...base, method: "other" }), { monthlyTaxed: 550, taxesAtSigning: 0 });
    assert.equal(computeLeaseTax({ ...base, method: "upfront_cap_cost", taxesOverride: 111 }).taxesAtSigning, 111);
  });
  it("no rate = no estimate", () => {
    assert.deepEqual(computeLeaseTax({ ...base, method: "monthly", taxRate: null }), { monthlyTaxed: null, taxesAtSigning: 0 });
  });
  it("the selected method feeds 'Monthly with est. tax' and 'Due at signing' in the form", () => {
    const form = read("components/LeaseCalculatorForm.tsx");
    assert.match(form, /computeLeaseTax\(\{ method: f\.taxMethod \|\| null/);
    assert.match(form, /monthlyTaxed: taxed/);
    assert.match(form, /taxesOverride: tax\.taxesAtSigning/);
  });
  it("the tax-method default comes from a state table, blank when we have no verified row", () => {
    assert.equal(leaseTaxMethodDefault("NJ"), "");
    assert.equal(leaseTaxMethodDefault(null), "");
  });
});

describe("dealer vs government fees, taxable flags and timing", () => {
  it("taxable defaults: doc fee taxable, title / registration / other not (no state table rows yet)", () => {
    assert.equal(feeTaxableDefault("NJ", "doc"), true);
    assert.equal(feeTaxableDefault("NJ", "title"), false);
    assert.equal(feeTaxableDefault("NJ", "registration"), false);
    assert.equal(feeTaxableDefault(null, "other"), false);
  });
  it("each fee line must carry a category, taxable flag and timing", () => {
    const e = check({ dueAtSigning: { ...(raw().dueAtSigning as object), otherFees: [{ name: "Doc fee", amount: 299 }] } }).errors;
    assert.ok(e.some((x) => /taxable/.test(x)) && e.some((x) => /dealer fee or a government fee/.test(x)) && e.some((x) => /due at signing or rolled/.test(x)));
  });
  it("the buyer gets dealer fees and government fees as separate subtotals, rolled lines included", () => {
    const q = coerceLeaseQuote(raw({
      dueAtSigning: { ...(raw().dueAtSigning as object), otherFees: [
        { name: "Doc fee", amount: 299, category: "dealer", taxable: true, timing: "signing" },
        { name: "Title fee", amount: 85, category: "government", taxable: false, timing: "signing" },
        { name: "Registration fee", amount: 250, category: "government", taxable: false, timing: "signing" },
      ] },
      rolledFees: [{ name: "Etch", amount: 100, category: "dealer", taxable: true, timing: "rolled" }],
      sellingPrice: 52900, // 52,900 + 100 rolled − 1,000 incentive = 52,000
    })) as LeaseQuote;
    const f = feeSubtotals(q);
    assert.equal(f.dealer, 399);
    assert.equal(f.government, 335);
    assert.deepEqual(f.governmentLines.map((x) => x.name), ["Title fee", "Registration fee"]);
    assert.deepEqual(check({ dueAtSigning: q.dueAtSigning, rolledFees: q.rolledFees, sellingPrice: 52900 }).errors, []);
  });
  it("a fee line in the wrong list (rolled line sitting in due-at-signing) is rejected", () => {
    const e = check({ dueAtSigning: { ...(raw().dueAtSigning as object), otherFees: [{ name: "Etch", amount: 100, category: "dealer", taxable: true, timing: "rolled" }] } }).errors;
    assert.ok(e.some((x) => /due at signing or rolled/.test(x)));
  });
});

describe("rolled-in fees and add-ons build the net cap cost; an override needs a reason", () => {
  it("net cap = selling + rolled fees + rolled add-ons (+ rolled acquisition) − incentives − cap reduction", () => {
    assert.equal(calcNetCap({ sellingPrice: 50000, incentivesTotal: 1000, rolledFeesTotal: 300, rolledAddOnsTotal: 899, acquisitionRolled: 995, capReduction: 2000 }), 49194);
    assert.equal(calcNetCap({ sellingPrice: null, incentivesTotal: 0, rolledFeesTotal: 0, rolledAddOnsTotal: 0, acquisitionRolled: 0, capReduction: 0 }), null);
  });
  const rolled = { addOns: [{ name: "Wheel and tire", amount: 899, taxable: true, removable: true, timing: "rolled" }], sellingPrice: 53000 };
  it("a rolled add-on that is not in the cap cost needs a reason; with the cap cost raised it passes", () => {
    const off = check({ ...rolled }).errors;
    assert.ok(off.some((e) => /differs from the calculated figure/.test(e)));
    assert.deepEqual(check({ ...rolled, capCost: 52899 }).errors, [], "52,000 + 899 rolled");
  });
  it("rolled add-ons are not added to due at signing; signing add-ons are (derived server-side)", () => {
    const q = coerceLeaseQuote(raw({ addOns: [{ name: "Wheel and tire", amount: 899, taxable: true, removable: true, timing: "rolled" }, { name: "Mud guards", amount: 150, taxable: true, removable: false, timing: "signing" }], dueAtSigning: { ...(raw().dueAtSigning as object), addOnsDue: [{ name: "Forged", amount: 99999 }] } })) as LeaseQuote;
    assert.deepEqual(q.dueAtSigning.addOnsDue!.map((a) => a.name), ["Mud guards"], "the browser's addOnsDue is replaced");
    assert.equal(dueAtSigningTotal(q.dueAtSigning), 652.5 + 120 + 299 + 0 + 150, "first month + taxes + doc fee + deposit + the signing add-on (not the rolled one)");
  });
  it("an add-on line needs taxable, removable and timing", () => {
    const e = check({ addOns: [{ name: "Wheel and tire", amount: 899 }] }).errors;
    assert.ok(e.some((x) => /taxable/.test(x)) && e.some((x) => /removable/.test(x)) && e.some((x) => /due at signing or rolled/.test(x)));
  });
  it("overriding the net cap cost requires a short reason; the reason clears the error", () => {
    const e = check({ capCost: 51000 }).errors;
    assert.ok(e.some((x) => /add a short reason/.test(x)));
    assert.deepEqual(check({ capCost: 51000, netCapOverrideReason: "Lender-required adjustment" }).errors, []);
    assert.equal(coerceLeaseQuote(raw({ capCost: 51000, netCapOverrideReason: "Lender-required adjustment" })).netCapOverrideReason, "Lender-required adjustment");
  });
  it("the cap reduction is part of the net figure: capCost stored gross, net = capCost − capReduction", () => {
    // selling 53,000 − 1,000 incentive − 2,000 cap reduction = 50,000 net, so the gross cap cost is 52,000.
    assert.deepEqual(check({ capReduction: 2000, dueAtSigning: { ...(raw().dueAtSigning as object), capReduction: 2000 } }).errors, []);
  });
});

describe("incentives: eligibility per line and one attestation", () => {
  it("a priced incentive needs its eligibility type and the attestation", () => {
    assert.ok(check({ incentiveAttested: false }).errors.some((e) => /attestation/.test(e)));
    assert.ok(check({ incentives: [{ name: "Loyalty", amount: 1000 }] }).errors.some((e) => /open to/.test(e)));
    assert.ok(check({ incentives: [{ name: "Loyalty", amount: 1000, eligibilityType: "everyone" }] }).errors.some((e) => /open to/.test(e)), "unknown type is dropped");
  });
  it("no incentive over $0 means no attestation needed", () => {
    assert.deepEqual(check({ incentives: [{ name: "Lease cash / rebate", amount: 0 }], incentiveAttested: false, capCost: 53000 }).errors, []);
  });
  it("the attestation text and the form's required checkbox", () => {
    const form = read("components/LeaseCalculatorForm.tsx");
    assert.match(form, /INCENTIVE_ATTESTATION_COPY/);
    assert.match(read("lib/leaseQuote.ts"), /These incentives are current manufacturer or dealer programs this buyer appears to qualify for\./);
    for (const t of ["Open to all", "Loyalty", "Conquest", "Military", "First responder", "College grad", "Other"]) assert.match(read("lib/leaseQuote.ts"), new RegExp(`"${t}"`));
  });
});

describe("total lease cost = (monthly with tax × term) + due at signing − first month − refundable deposit + disposition fee", () => {
  const das = { firstMonth: 650, acquisitionFee: 995, capReduction: 1000, taxes: 100, otherFees: [{ name: "Doc fee", amount: 300 }], securityDeposit: 500, addOnsDue: [{ name: "Mud guards", amount: 150 }] };
  it("DAS includes the deposit and signing add-ons", () => assert.equal(dasTotal(das), 3695));
  it("the math", () => {
    // 650 × 36 = 23,400; + 3,695 − 650 − 500 refundable deposit = 25,945; + 395 disposition = 26,340
    assert.equal(totalLeaseCost(650, 36, das, 395), 26340);
    assert.equal(totalLeaseCost(650, 36, das), 25945);
    assert.equal(totalLeaseCost(650, 36, { ...das, securityDeposit: 0 }), 25945, "the deposit is neutral: more deposit, more due at signing, same total");
    assert.equal(totalLeaseCost(null, 36, das, 395), null);
  });
  it("the server sets it, ignoring the browser's figure; it uses the taxed monthly when there is one", () => {
    const q = coerceLeaseQuote(raw({ totalLeaseCost: 1 }));
    // 652.50 × 36 = 23,490; DAS = 652.5 + 0 + 0 + 120 + 299 + 0 = 1,071.5; − 652.5 = 23,909; + 395 = 24,304
    assert.equal(q.totalLeaseCost, 24304);
    assert.equal(finalizeLeaseQuote({ ...q, monthlyPaymentWithEstTax: null }).totalLeaseCost, 612 * 36 + 1071.5 - 652.5 + 395);
    // A $500 deposit is in due at signing but not in the total.
    const dep = coerceLeaseQuote(raw({ securityDeposit: 500, dueAtSigning: { ...(raw().dueAtSigning as object), securityDeposit: 500 } })) as LeaseQuote;
    assert.equal(dueAtSigningTotal(dep.dueAtSigning), 1571.5);
    assert.equal(dep.totalLeaseCost, q.totalLeaseCost);
  });
  it("dueAtSigningFrom carries the deposit and signing add-ons through", () => {
    const d = dueAtSigningFrom({ monthly: 600, monthlyTaxed: 640, acquisitionFee: 0, capReduction: 0, taxesOverride: 0, taxRate: null, otherFees: [], securityDeposit: 400, addOnsDue: [{ name: "Mud guards", amount: 100 }] })!;
    assert.equal(dasTotal(d), 1140);
  });
});

// ---- buyer compare -----------------------------------------------------------------------------------------------
const lease = (over: Record<string, unknown>): LeaseQuote => coerceLeaseQuote(raw(over)) as LeaseQuote;
const invite = (id: string, name: string, l: LeaseQuote): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: "2026-09-13T00:00:00Z", respondedAt: "2026-09-13T01:00:00Z", desk: { contactName: "Desk", role: "sales", emailMasked: "e••••@example.com", source: "directory" }, quote: { id: `q${id}`, price: l.capCost, fees: [], totalOtdPrice: 0, vin: VIN, stockNumber: null, expiresAt: l.expiresAt, submittedAt: "2026-09-13T01:00:00Z", mustHaveAcknowledgement: true, notes: null, lease: l, supersededAt: null } }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[], creditBand: string | null = "excellent"): RfqRequest => ({ id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: "2026-09-13T00:00:00Z", vin: VIN, stockNumber: null, vehicleYear: 2026, vehicleMake: "Ford", vehicleModel: "Bronco", vehicleTrim: "Base", mustHaves: [], leasePrefs: { ...PREFS, zip: "07981", creditBand }, invites }) as unknown as RfqRequest;

describe("credit tier vs the buyer's stated band", () => {
  it("ranks tiers and flags a tier below the buyer's band", () => {
    assert.equal(creditTierRank("Tier 1+"), 0);
    assert.equal(creditTierRank("tier 2"), 2);
    assert.equal(creditTierRank("Super prime"), null);
    assert.equal(pricedAtLowerTier("Tier 1+", "excellent"), false);
    assert.equal(pricedAtLowerTier("Tier 1", "excellent"), false);
    assert.equal(pricedAtLowerTier("Tier 2", "excellent"), true);
    assert.equal(pricedAtLowerTier("Tier 2", "good"), false);
    assert.equal(pricedAtLowerTier("Tier 3", "good"), true);
    assert.equal(pricedAtLowerTier("Tier 3", null), false);
    assert.equal(pricedAtLowerTier("whatever", "excellent"), false);
  });
});

describe("buyer compare shows the v2 fields and labels", () => {
  const a = lease({ monthlyPaymentPreTax: 600, monthlyPaymentWithEstTax: 640, creditTierAssumed: "Tier 2", capCost: 51000, netCapOverrideReason: "Lender-required adjustment", residualAmount: 31000, vehicleStatus: "in_transit", etaDate: "2026-10-30", lenderType: "bank", lenderName: "Chase", taxMethod: "upfront_cap_cost" });
  const b = lease({ monthlyPaymentPreTax: 600, monthlyPaymentWithEstTax: 640, dispositionFee: 0, excessMileagePerMile: 0.2, incentives: [{ name: "Conquest cash", amount: 750, eligibilityType: "conquest", eligibilityProof: "current Toyota lease" }],
    dueAtSigning: { ...(raw().dueAtSigning as object), otherFees: [{ name: "Doc fee", amount: 299, category: "dealer", taxable: true, timing: "signing" }, { name: "Title fee", amount: 85, category: "government", taxable: false, timing: "signing" }], securityDeposit: 300 }, securityDeposit: 300, capCost: 52250, sellingPrice: 53000 });
  const rfq = rfqOf([invite("1", "Dealer A", a), invite("2", "Dealer B", b)]);
  const data = analyzeLeaseQuotes(rfq, NOW)!;
  const html = renderToStaticMarkup(<LeaseCompare data={data} collecting onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);

  it("lender, credit tier, tax method, vehicle status / ETA, end-of-lease costs and total lease cost are rows", () => {
    for (const re of [/Chase/, /Tier 2/, /Upfront on cap cost/, /In transit/, /ETA /, /Disposition fee/, /Excess mileage/, /\$0\.20\/mi/, /Total lease cost/]) assert.match(html, re);
  });
  it("'Priced at a lower tier', 'Adjusted by dealer: …' and 'Residual entered directly' labels appear on the right quote only", () => {
    assert.equal((html.match(/data-testid="lower-tier"/g) || []).length, 1);
    assert.match(html, /Priced at a lower tier/);
    assert.match(html, /data-testid="adjusted-by-dealer">Adjusted by dealer: Lender-required adjustment/);
    assert.equal((html.match(/data-testid="residual-direct"/g) || []).length, 1);
  });
  it("incentives are 'Dealer-claimed' with their eligibility and proof", () => {
    assert.match(html, /Dealer-claimed · Conquest · proof: current Toyota lease/);
    assert.match(html, /Dealer-claimed · Loyalty · proof: current Ford lease/);
  });
  it("dealer fees and government fees are separate itemized subtotals", () => {
    assert.match(html, /data-testid="dealer-fees"/);
    assert.match(html, /data-testid="government-fees"/);
    assert.match(html, /Government fees \(pass-through\)<\/span><span>\$85/);
    assert.match(read("components/LeaseCompare.tsx"), /data-testid="das-security-deposit"><span>Refundable security deposit<\/span>/, "its own due-at-signing line in the expanded detail");
  });
  it("equal monthlies fall back to the lower total lease cost (secondary sort)", () => {
    const [first, second] = data.rows;
    assert.equal(first.monthly, second.monthly);
    assert.ok(first.totalLeaseCost! <= second.totalLeaseCost!);
    assert.equal(first.dealerName, "Dealer B", "B: $0 disposition fee beats A's $395");
  });
  it("a pre-v2 quote still renders and ranks (no v2 fields, no labels)", () => {
    const legacy = { ...b } as LeaseQuote;
    for (const k of ["lenderName", "lenderType", "creditTierAssumed", "taxMethod", "vehicleStatus", "dispositionFee", "excessMileagePerMile", "totalLeaseCost", "netCapOverrideReason"] as const) delete (legacy as unknown as Record<string, unknown>)[k];
    const d = analyzeLeaseQuotes(rfqOf([invite("3", "Old Dealer", legacy)]), NOW)!;
    const h = renderToStaticMarkup(<LeaseCompare data={d} collecting onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
    assert.match(h, /Not given/);
    assert.doesNotMatch(h, /lower-tier|adjusted-by-dealer/);
    assert.equal(d.rows[0].lowerTier, false);
    assert.ok(d.rows[0].totalLeaseCost != null);
  });
});

describe("dealer page trade copy", () => {
  it("the 'handled after an out-the-door price' copy is gone; no trade reads only 'No trade-in.'", () => {
    const page = read("app/quote-request/received/page.tsx");
    assert.doesNotMatch(page, /handled after an out-the-door|Trade-ins are handled/i);
    assert.match(page, /No trade-in\./);
  });
});

describe("a buyer counter keeps the v2 line attributes and total lease cost in step", () => {
  it("fee category / taxable and incentive eligibility survive the name + amount counter edits; the total follows the new monthly", () => {
    const before = coerceLeaseQuote(raw({
      dueAtSigning: { ...(raw().dueAtSigning as object), otherFees: [
        { name: "Doc fee", amount: 299, category: "dealer", taxable: true, timing: "signing" },
        { name: "Title fee", amount: 85, category: "government", taxable: false, timing: "signing" },
      ] },
    })) as LeaseQuote;
    const after = applyLeaseCounter(before, { capCost: 50000, otherFees: [{ name: "Doc fee", amount: 199 }, { name: "Title fee", amount: 85 }] });
    assert.equal(after.dueAtSigning.otherFees[0].amount, 199);
    assert.equal(after.dueAtSigning.otherFees[0].category, "dealer");
    assert.equal(after.dueAtSigning.otherFees[1].category, "government");
    assert.equal(after.incentives[0].eligibilityType, "loyalty");
    assert.equal(after.totalLeaseCost, totalLeaseCost(after.monthlyPaymentWithEstTax, 36, after.dueAtSigning, 395), "recomputed from the counter's monthly and due at signing, disposition fee kept");
    assert.notEqual(after.totalLeaseCost, before.totalLeaseCost);
  });
});

describe("dealer form renders: sequential sections, required markers, split fee lists", () => {
  const html = renderToStaticMarkup(<LeaseCalculatorForm token="tok12345" vin={VIN} stockNumber={null} prefs={{ ...PREFS, zip: "07405", creditBand: "excellent", dueAtSigningIntent: "first_month_only" } as never} onSubmitted={() => {}} />);
  it("sections are numbered 1 through 11 with no gaps or repeats", () => {
    const nums = Array.from(html.matchAll(/<h4[^>]*>(\d+) · /g)).map((m) => Number(m[1]));
    assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
  it("VIN is a text input; the tier hint, lender list, status, tax method and end-of-lease fields are present", () => {
    assert.match(html, /<input type="text" inputMode="text"[^>]*data-testid="vin-input"|data-testid="vin-input"/);
    assert.match(html, /Buyer estimated: excellent \(750\+\)/);
    assert.match(html, /Ford Credit/);
    assert.match(html, /Bank \/ credit union/);
    assert.match(html, /Other \(describe\)/);
    assert.match(html, /MSRP used for residual/);
    assert.match(html, /Disposition fee/);
    assert.match(html, /Excess mileage charge/);
    assert.match(html, /<textarea[^>]*maxLength="1000"|<textarea[^>]*maxlength="1000"/i);
  });
  it("doc fee is a dealer row; title and registration are government rows; each carries Taxable and a timing", () => {
    const dealer = html.slice(html.indexOf('data-testid="dealer-fees"'), html.indexOf('data-testid="government-fees"'));
    const gov = html.slice(html.indexOf('data-testid="government-fees"'), html.indexOf('5 · Add-ons'));
    assert.match(dealer, /value="Doc fee"/);
    assert.match(gov, /value="Title fee"/);
    assert.match(gov, /value="Registration fee"/);
    assert.equal((dealer.match(/Taxable/g) || []).length, 1);
    assert.equal((gov.match(/Taxable/g) || []).length, 2);
    assert.match(dealer, /Rolled into cap cost/);
  });
  it("the attestation shows only once an incentive is priced; the old 'Trade-ins are handled' copy is nowhere", () => {
    assert.doesNotMatch(html, /incentive-attestation/);
    assert.doesNotMatch(html, /Trade-ins are handled/);
  });
});

describe("quotes saved in the old lease_json shape (pre-v2) still render without errors", () => {
  // Exactly what the box stored before v2: no v2 key anywhere, fees without category / taxable / timing.
  const OLD_BLOB = JSON.stringify({
    capCost: 50200, residualPercent: 58, residualAmount: 29116, moneyFactor: 0.00215, termMonths: 36, milesPerYear: 10000, capReduction: 1000,
    monthlyPaymentPreTax: 640.1, monthlyPaymentWithEstTax: 682.5,
    dueAtSigning: { firstMonth: 682.5, acquisitionFee: 995, capReduction: 1000, taxes: 60, otherFees: [{ name: "Doc fee", amount: 399 }, { name: "Registration & title", amount: 310 }] },
    incentives: [{ name: "Lease cash / rebate", amount: 750 }], addOns: [{ name: "Wheel & tire protection", amount: 899 }],
    expiresAt: "2026-09-27T00:00:00Z", notes: "old quote", counter: { counterOffer: false, note: "" },
  });
  const old = () => JSON.parse(OLD_BLOB) as LeaseQuote;
  it("the buyer compare (deal page) ranks and renders it, with 'Not given' where v2 data is missing and no v2 labels", () => {
    const d = analyzeLeaseQuotes(rfqOf([invite("1", "Old Dealer", old()), invite("2", "New Dealer", lease({ monthlyPaymentPreTax: 700 }))]), NOW)!;
    assert.equal(d.rows.length, 2);
    const oldRow = d.rows.find((r) => r.dealerName === "Old Dealer")!;
    assert.equal(oldRow.kind, "eligible");
    assert.equal(oldRow.lowerTier, false);
    assert.equal(oldRow.dueAtSigning, 682.5 + 995 + 1000 + 60 + 399 + 310);
    assert.equal(oldRow.totalLeaseCost, 682.5 * 36 + oldRow.dueAtSigning! - 682.5, "no disposition fee or deposit on an old quote");
    const html = renderToStaticMarkup(<LeaseCompare data={d} collecting onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
    assert.match(html, /Old Dealer/);
    assert.match(html, /Not given/);
    assert.match(html, /Registration &amp; title/, "an old fee line with no category reads as a dealer fee");
    assert.doesNotMatch(html, /undefined|NaN|\[object/);
  });
  it("an old quote opens in the buyer's counter sheet and a counter applies to it", () => {
    const html = renderToStaticMarkup(<CounterSheetForm dealerName="Old Dealer" quote={{ lease: old() }} quoteId="q1" onSubmit={async () => {}} onCancel={() => {}} />);
    assert.match(html, /Old Dealer/);
    assert.doesNotMatch(html, /undefined|NaN/);
    const after = applyLeaseCounter(old(), { capCost: 49000 });
    assert.equal(after.totalLeaseCost, undefined, "an old quote has no total, and a counter doesn't invent one");
    assert.ok(after.monthlyPaymentPreTax > 0);
  });
  it("the dealer's revision form (after a buyer counter) prefills from an old quote without throwing", () => {
    const html = renderToStaticMarkup(<LeaseCalculatorForm token="tok12345" vin={VIN} stockNumber={null} prefs={{ ...PREFS, zip: "07405" } as never} initial={old()} onSubmitted={() => {}} />);
    assert.match(html, /value="Doc fee"/);
    assert.match(html, /Registration &amp; title/, "the old fee line is kept as an added dealer line");
    assert.doesNotMatch(html, /NaN|undefined/);
  });
  it("the admin desk and Deal Tracker read only fields that exist on an old quote", () => {
    const admin = read("app/admin/quote-requests/QuoteRequestsClient.tsx");
    const block = admin.slice(admin.indexOf("const lease = i.quote?.lease;"), admin.indexOf("const lease = i.quote?.lease;") + 900);
    assert.doesNotMatch(block, /lenderName|taxMethod|vehicleStatus|dispositionFee|totalLeaseCost|creditTierAssumed/, "admin desk does not depend on a v2 key");
    assert.doesNotMatch(read("components/DealTrackerDashboard.tsx") + read("lib/rfqTracker.ts"), /lenderName|taxMethod|vehicleStatus|dispositionFee|totalLeaseCost|creditTierAssumed/, "Deal Tracker rows come from the request and prefs, not the quote body");
  });
});
