import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { displayTrim, isUnofficialFordTrim, officialTrimOptions, NO_TRIM } from "./fordTrimDisplay";

describe("displayTrim", () => {
  it("shows a dash for the F-150 junk trims seen in production", () => {
    for (const t of ["8 FOOT BED", "AAF Customs Edition", "Inventory Route 23 Auto"]) assert.equal(displayTrim("Ford", "F-150", t), NO_TRIM);
  });
  it("keeps official trims, per model", () => {
    assert.equal(displayTrim("Ford", "F-150", "XLT"), "XLT");
    assert.equal(displayTrim("Ford", "Mustang", "GT Premium"), "GT Premium");
    assert.equal(displayTrim("ford", "Escape", "S"), "S");
    assert.equal(displayTrim("Ford", "Bronco", "Base"), "Base");
  });
  it("a trim that is official for another model is not official here", () => {
    assert.equal(displayTrim("Ford", "Maverick", "King Ranch"), NO_TRIM);
  });
  it("dealer sentences are not official trims, even when they contain one", () => {
    assert.equal(displayTrim("Ford", "F-150", "4X4 CREWCAB XLT"), NO_TRIM);
  });
  it("leaves blanks, other makes, and unprofiled Ford models alone", () => {
    assert.equal(displayTrim("Ford", "F-150", null), null);
    assert.equal(displayTrim("Ford", "F-150", ""), "");
    assert.equal(displayTrim("Honda", "Civic", "8 FOOT BED"), "8 FOOT BED");
    assert.equal(displayTrim("Ford", "Transit", "Cargo Van Weird"), "Cargo Van Weird");
    assert.equal(displayTrim(null, null, "XYZ"), "XYZ");
  });
  it("Super Duty spellings count as Super Duty", () => {
    assert.equal(displayTrim("Ford", "F-250", "Lariat"), "Lariat");
    assert.equal(displayTrim("Ford", "F-350", "Preferred"), NO_TRIM);
  });
});

describe("officialTrimOptions", () => {
  const opts = [{ value: "XLT", n: 5 }, { value: "8 FOOT BED", n: 2 }, { value: "Lariat", n: 3 }, { value: "AAF Customs Edition", n: 1 }];
  it("drops unofficial Ford trims from the list", () => {
    assert.deepEqual(officialTrimOptions("Ford", "F-150", opts).map((o) => o.value), ["XLT", "Lariat"]);
  });
  it("leaves other makes and an unset model untouched", () => {
    assert.equal(officialTrimOptions("Honda", "Civic", opts).length, 4);
    assert.equal(officialTrimOptions("Ford", "", opts).length, 4);
  });
  it("isUnofficialFordTrim is false for blank", () => assert.equal(isUnofficialFordTrim("Ford", "F-150", "  "), false));
});
