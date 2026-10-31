import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COLOR_NOT_LISTED, colorFilterOptions, exteriorColorDisplay, isColorCode } from "./colorCode";

describe("isColorCode", () => {
  it("flags the BMW / MINI paint codes seen live on box2 (2026-10-30)", () => {
    for (const c of ["0c7v", "0C7V", "0475", "0490", "0C6m", "0a96", "490", "0300", "0C3b"]) assert.equal(isColorCode(c), true, c);
  });
  it("leaves real colour names alone", () => {
    for (const c of ["Black", "White", "Gray", "Red", "Alpine White", "Black Sapphire Metallic", "Agave Green", "Blue"]) assert.equal(isColorCode(c), false, c);
  });
  it("treats blank / null as not a code", () => {
    for (const c of [null, undefined, "", "  "]) assert.equal(isColorCode(c), false);
  });
  it("needs 3-5 characters", () => {
    assert.equal(isColorCode("A1"), false);
    assert.equal(isColorCode("A1B2C3"), false);
  });
});

describe("exteriorColorDisplay", () => {
  it("shows Color not listed for a code and the name otherwise", () => {
    assert.equal(exteriorColorDisplay("0c7v"), COLOR_NOT_LISTED);
    assert.equal(exteriorColorDisplay("Alpine White"), "Alpine White");
    assert.equal(exteriorColorDisplay(null), "");
  });
});

describe("colorFilterOptions", () => {
  it("keeps codes and blanks out of the colour filter", () => {
    assert.deepEqual(colorFilterOptions(["0475", "Alpine White", "", "0C7V", "Black"]), ["Alpine White", "Black"]);
  });
});
