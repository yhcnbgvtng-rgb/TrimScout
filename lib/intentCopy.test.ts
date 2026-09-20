import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LANE_COPY, type RfqLane } from "./alternateAsk";

describe("Step 1 intent card copy (2026-09-19)", () => {
  it("uses plain buyer language mapped to the same_spec / alternate enums", () => {
    assert.equal(LANE_COPY.same_spec.title, "A vehicle with specific options");
    assert.equal(LANE_COPY.same_spec.help, "Paste the VIN or dealer link so quotes match this car.");
    assert.equal(LANE_COPY.alternate.title, "Open to anything");
    assert.equal(LANE_COPY.alternate.help, "No VIN needed — dealers can propose different cars.");
  });

  it("drops the old labels and never uses bid/auction language", () => {
    for (const lane of ["same_spec", "alternate"] as RfqLane[]) {
      const text = `${LANE_COPY[lane].title} ${LANE_COPY[lane].help}`;
      assert.doesNotMatch(text, /same build|I'm open to different vehicles/);
      assert.doesNotMatch(text, /\bbid\b|auction/i);
    }
  });
});
