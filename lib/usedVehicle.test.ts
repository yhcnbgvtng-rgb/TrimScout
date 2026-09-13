import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CPO_BUILD_COPY, USED_BUILD_COPY, conditionBadge, detectUsedCondition, isUsedCondition, normalizeMiles } from "./usedVehicle";

describe("used-vehicle detection — from the link's own words, never the dealer's page", () => {
  it("reads used / pre-owned / certified / CPO from paths, queries and titles; cpo beats used", () => {
    assert.equal(detectUsedCondition("https://www.scottcars.net/used/Chevrolet/2023-Chevrolet-Tahoe-1GNSKNKD0PR123456"), "used");
    assert.equal(detectUsedCondition("https://dealer.com/inventory/pre-owned-2022-ford-bronco-1FMEE5DP1NLA00001/"), "used");
    assert.equal(detectUsedCondition("https://dealer.com/vdp?condition=preowned&vin=1FMEE5DP1NLA00001"), "used");
    assert.equal(detectUsedCondition("https://dealer.com/certified-pre-owned/2023-cadillac-lyriq"), "cpo");
    assert.equal(detectUsedCondition("https://dealer.com/inventory/cpo-2024-gmc-yukon"), "cpo");
    assert.equal(detectUsedCondition("Certified Pre-Owned 2023 Chevrolet Tahoe LT — Scott Chevrolet"), "cpo");
  });
  it("says nothing for new-car links, VINs, or words that merely contain the letters", () => {
    assert.equal(detectUsedCondition("https://www.scottcars.net/new/Chevrolet/2026-Chevrolet-Tahoe-1GNS6MKD2TR280381"), null);
    assert.equal(detectUsedCondition("1GNS6MKD2TR280381"), null);
    assert.equal(detectUsedCondition("https://dealer.com/inventory/unused-lot-space"), null);
    assert.equal(detectUsedCondition(""), null);
  });
  it("condition helpers", () => {
    assert.equal(isUsedCondition("used"), true);
    assert.equal(isUsedCondition("cpo"), true);
    assert.equal(isUsedCondition("new"), false);
    assert.equal(isUsedCondition(undefined), false);
    assert.equal(conditionBadge("cpo"), "CPO");
    assert.equal(conditionBadge("used"), "USED");
    assert.equal(conditionBadge("new"), null);
    assert.equal(normalizeMiles("34,512"), 34512);
    assert.equal(normalizeMiles(""), null);
    assert.equal(normalizeMiles("-1"), null);
    assert.doesNotMatch(USED_BUILD_COPY + CPO_BUILD_COPY, /factory verified|auction|bid/i);
  });
});

import fs from "node:fs";
import path from "node:path";

describe("wiring — used cars ride the same pipe without a factory build", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("the used route decodes from the VIN (NHTSA) and resolves the desk from inventory/hostname; never a sticker, never the dealer's page", () => {
    const r = read("app/api/used-vin/route.ts");
    assert.match(r, /decodeVinFromNhtsa\(vin\)/);
    assert.match(r, /resolveVehicleDealer\(\{ \.\.\.free\.vehicle, condition \}, resolved, null\)/);
    assert.doesNotMatch(r, /getGmSticker|getFordSticker|extractVinFromDealerPage|fetch\(paste|fetch\(url/);
  });
  it("the client import sends used to /api/used-vin, returns oem: null, dealer_listing_only, with the condition on the vehicle", () => {
    const p = read("lib/pasteImport.ts");
    assert.match(p, /if \(options\.condition\) \{[\s\S]*?fetchImpl\("\/api\/used-vin"/);
    assert.match(p, /oem: null, vehicle: \{ \.\.\.out\.vehicle, condition: options\.condition \}, factoryBuildUnavailable: true, buildConfidence: "dealer_listing_only"/);
  });
  it("Step 1: New | Used toggle (default New), a used link flips it, USED/CPO badges, no alternates / must-haves for used, miles + stock # confirm fields, condition on the payload", () => {
    const w = read("components/BiddingWizard.tsx");
    assert.match(w, /useState<"new" \| UsedCondition>\("new"\)/);
    assert.match(w, /const detected = detectUsedCondition\(raw\);[\s\S]*?setVehicleCondition\(detected\)/);
    assert.match(w, /data-testid="primary-build-badge"[\s\S]*?conditionBadge\(selectedVehicle\.condition\)/);
    assert.match(w, /data-testid="confirm-build-badge"[\s\S]*?conditionBadge\(build\.vehicle\.condition\)/);
    assert.match(w, /\{isUsed \? \(\s*selectedVehicle \? \(\s*<div[^>]*data-testid="used-confirm-fields"/);
    assert.match(w, /isUsedCondition\(v\.condition\) \? \{ condition: v\.condition, mileage: normalizeMiles\(usedMiles\), stockNumber: usedStock\.trim\(\) \|\| null \}/);
    assert.match(w, /setVehicleCondition\("new"\);/);
    // New-car path untouched: the OEM endpoint choice and the must-have picker are still there.
    assert.match(w, /FORD_MUST_HAVE_HEADING/);
    assert.match(read("lib/pasteImport.ts"), /preferredFactoryBuildEndpoint\(raw\) \|\| "\/api\/ford-sticker"/);
  });
});
