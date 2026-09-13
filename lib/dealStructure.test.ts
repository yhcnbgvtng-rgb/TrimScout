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

describe("BiddingWizard step 1 — lease-only preferences", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
  const step1Start = src.indexOf("STEP 1: PAYMENT, VEHICLE & TRADE-IN FLAG");
  const step1End = src.indexOf("STEP 2: DIRECT OFFER");
  const step1 = src.slice(step1Start, step1End);

  it("offers term 24|36|39|48 (default 36) and miles 7,500|10,000|12,000|15,000 — no payment-method chips", () => {
    assert.ok(step1Start >= 0 && step1End > step1Start);
    assert.match(step1, /LEASE_TERMS\.map/);
    assert.match(step1, /LEASE_MILES\.map/);
    assert.match(src, /useState<LeaseTerm>\(DEFAULT_LEASE_TERM\)/);
    assert.match(src, /useState<DealStructureMethod\[\]>\(\["lease"\]\)/);
    assert.doesNotMatch(step1, /DEAL_STRUCTURE_LABELS|toggleDealStructure|aria-pressed=\{isChecked\}/);
    assert.doesNotMatch(step1, /Coins|CreditCard|KeyRound|Layers/);
  });

  it("has no All control or all_three id", () => {
    assert.doesNotMatch(src, /all_three/);
    assert.doesNotMatch(src, /Show Me All 3/);
    assert.doesNotMatch(src, /All 3 Structures/);
    assert.doesNotMatch(step1, /Show Me All/);
  });

  it("Continue needs vehicle + term + miles on step 1, and ≥1 ticked named desk on step 2; timeline is optional", () => {
    assert.match(src, /step === 1 && \(!vehicleImported \|\| !leaseMiles \|\| !leaseTerm\)/);
    assert.match(src, /step === 2 && directOfferMode && confirmedDeskCount === 0/);
    assert.match(src, /directOfferMode && confirmedDeskCount === 0\)\)\)/);
    assert.doesNotMatch(src, /Select your purchase timeline/);
    assert.match(step1, /Timeline <span[^>]*>\(optional\)/);
  });

  it("the request carries the lease prefs and the old payloads still get the buyer's picks", () => {
    assert.match(src, /leasePrefs: \{ termMonths: leaseTerm, milesPerYear: leaseMiles \|\| null, zip:/);
    assert.match(src, /leaseTermMonths: leaseTerm/);
    assert.match(src, /const leaseMileage = leaseMiles \|\| 12000/);
  });
});
