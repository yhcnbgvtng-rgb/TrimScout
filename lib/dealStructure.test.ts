import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatDealStructures,
  paymentMethodFromStructures,
  toggleDealStructure,
} from "./dealStructure";

describe("deal structure multi-select", () => {
  it("formats checked methods as Cash + Finance, never an All label", () => {
    assert.equal(formatDealStructures(["cash"]), "Cash");
    assert.equal(formatDealStructures(["finance"]), "Finance");
    assert.equal(formatDealStructures(["lease"]), "Lease");
    assert.equal(formatDealStructures(["cash", "finance"]), "Cash + Finance");
    assert.equal(formatDealStructures(["lease", "cash"]), "Cash + Lease");
    assert.equal(formatDealStructures(["lease", "finance", "cash"]), "Cash + Finance + Lease");
    assert.equal(formatDealStructures([]), "");
    assert.doesNotMatch(formatDealStructures(["cash", "finance", "lease"]), /all 3|show me all/i);
  });

  it("toggles cash, finance, and lease independently and keeps canonical order", () => {
    assert.deepEqual(toggleDealStructure(["cash"], "finance"), ["cash", "finance"]);
    assert.deepEqual(toggleDealStructure(["cash", "finance"], "cash"), ["finance"]);
    assert.deepEqual(toggleDealStructure(["finance"], "lease"), ["finance", "lease"]);
    assert.deepEqual(toggleDealStructure(["cash", "finance", "lease"], "finance"), ["cash", "lease"]);
    assert.deepEqual(toggleDealStructure([], "lease"), ["lease"]);
  });

  it("legacy paymentMethod is the first checked method, never all_three", () => {
    assert.equal(paymentMethodFromStructures(["cash"]), "cash");
    assert.equal(paymentMethodFromStructures(["finance", "lease"]), "finance");
    assert.equal(paymentMethodFromStructures(["cash", "finance", "lease"]), "cash");
    assert.equal(paymentMethodFromStructures([]), "cash");
    assert.notEqual(paymentMethodFromStructures(["cash", "finance", "lease"]), "all_three");
  });
});

describe("BiddingWizard — Step 1 is the vehicle step; Step 2 is quote setup", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
  const step1 = src.slice(src.indexOf("STEP 1: PAYMENT, VEHICLE & TRADE-IN FLAG"), src.indexOf("STEP 2: QUOTE SETUP"));
  const step2 = src.slice(src.indexOf("STEP 2: QUOTE SETUP"), src.indexOf("STEP 3: DIRECT OFFER"));

  it("(1) Step 1 has the vehicle flow and no lease term/miles or payment chips", () => {
    assert.ok(step1.length > 0 && step2.length > 0);
    assert.match(step1, /One car is required to continue/);
    assert.match(step1, /Only send this to dealerships in my state/);
    assert.match(step1, /Add additional vehicles/);
    assert.doesNotMatch(step1, /LEASE_TERMS\.map|LEASE_MILES\.map|Lease preferences|DEAL_STRUCTURE_LABELS|toggleDealStructure/);
    assert.match(src, /STEP_LABELS = \["Vehicle", "Quote setup", "Dealers", "Review & Send"\]/);
  });

  it("(2) Step 2 offers Lease | Finance | Cash as equal options, none assumed, with type-specific prefs", () => {
    assert.match(src, /useState<DealStructureMethod \| null>\(null\)/);
    assert.match(step2, /\["lease", "finance", "cash"\] as const/);
    assert.match(step2, /quoteType === "lease" && \(/);
    assert.match(step2, /LEASE_TERMS\.map/);
    assert.match(step2, /LEASE_MILES\.map/);
    assert.match(step2, /quoteType === "finance" && \(/);
    assert.match(step2, /Down payment/);
    assert.match(step2, /Credit band/);
    assert.match(step2, /No credit pull/);
    assert.match(step2, /Timeline <span[^>]*>\(optional\)/);
    assert.match(src, /useState<LeaseTerm>\(DEFAULT_LEASE_TERM\)/);
  });

  it("(3) the lease path feeds the lease calculator contract unchanged", () => {
    assert.match(src, /leasePrefs: quoteType === "lease" \? \{ termMonths: leaseTerm, milesPerYear: leaseMiles \|\| null, zip:/);
  });

  it("(4) Continue into Step 2 needs the vehicle; out of Step 2 needs the type's required prefs; Step 3 needs ≥1 named desk", () => {
    assert.match(src, /if \(step === 1 && !vehicleImported\) return;/);
    assert.match(src, /if \(step === 2 && !quoteSetupComplete\) return;/);
    assert.match(src, /quoteType === "lease"\s*\? Boolean\(leaseTerm && leaseMiles && zipOk\)/);
    assert.match(src, /quoteType === "finance"\s*\? Boolean\(financeTerm > 0 && downPayment !== "" && Number\.isFinite\(downPaymentNumber\) && downPaymentNumber >= 0 && zipOk\)/);
    assert.match(src, /quoteType === "cash"\s*\? zipOk\s*: false/);
    assert.match(src, /step === 3 && directOfferMode && confirmedDeskCount === 0/);
    assert.match(src, /TOTAL_STEPS = 4/);
  });

  it("has no All control or all_three id", () => {
    assert.doesNotMatch(src, /all_three/);
    assert.doesNotMatch(src, /Show Me All 3/);
  });
});
