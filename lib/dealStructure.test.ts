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

describe("BiddingWizard step 1 payment checkboxes", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
  // Payment method was its own step; it's now merged into step 1 alongside
  // vehicle selection and the trade-in toggle.
  const step1Start = src.indexOf("STEP 1: PAYMENT, VEHICLE & TRADE-IN FLAG");
  const step1End = src.indexOf("STEP 2: DIRECT OFFER");
  const step1 = src.slice(step1Start, step1End);

  it("is a compact checkbox row for Cash, Finance, and Lease", () => {
    assert.ok(step1Start >= 0 && step1End > step1Start);
    assert.match(step1, /type="checkbox"/);
    assert.match(step1, /DEAL_STRUCTURE_LABELS/);
    assert.match(step1, /toggleDealStructure/);
    assert.doesNotMatch(step1, /grid-cols-2 sm:grid-cols-4/);
    assert.doesNotMatch(step1, /ring-1 ring-emerald-500/);
    assert.doesNotMatch(step1, /Coins|CreditCard|KeyRound|Layers/);
  });

  it("has no All control or all_three id", () => {
    assert.doesNotMatch(src, /all_three/);
    assert.doesNotMatch(src, /Show Me All 3/);
    assert.doesNotMatch(src, /All 3 Structures/);
    assert.doesNotMatch(step1, /Show Me All/);
  });

  it("maps requestedStructures as the checked array and requires at least one to Continue", () => {
    assert.match(src, /requestedStructures,/);
    assert.match(src, /dealStructurePreferences:\s*\{\s*requestedStructures,/);
    assert.match(src, /step === 1 && \(requestedStructures\.length === 0 \|\| !vehicleImported \|\| financingSourceMissing\)/);
    assert.match(
      src,
      /disabled=\{\s*\(step === 1 && \(requestedStructures\.length === 0 \|\| !vehicleImported \|\| financingSourceMissing\)\) \|\|/
    );
    assert.match(src, /financeTermMonths: financeTerm/);
    assert.match(src, /formatDealStructures\(requestedStructures\)/);
  });
});
