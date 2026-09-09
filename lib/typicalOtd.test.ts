import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTypicalOtdLabel } from "./typicalOtd";

describe("formatTypicalOtdLabel — real numbers only, never a fabricated default", () => {
  it("returns null when there's nothing to show yet (still loading)", () => {
    assert.equal(formatTypicalOtdLabel(null), null);
  });

  it("says plainly there's not enough history below the minimum sample size", () => {
    assert.equal(
      formatTypicalOtdLabel({ make: "Ford", model: "Bronco", sampleSize: 2, avgDiscountPercent: 8 }),
      "Not enough quote history yet for this model"
    );
  });

  it("treats a null avgDiscountPercent the same as too small a sample, defensively", () => {
    assert.equal(
      formatTypicalOtdLabel({ make: "Ford", model: "Bronco", sampleSize: 10, avgDiscountPercent: null }),
      "Not enough quote history yet for this model"
    );
  });

  it("formats the real average once the sample size is large enough", () => {
    assert.equal(
      formatTypicalOtdLabel({ make: "Ford", model: "Bronco", sampleSize: 5, avgDiscountPercent: 6.37 }),
      "Typical OTD for this model: 6.4% off MSRP (based on 5 recent quotes)"
    );
  });

  it("rounds to one decimal place", () => {
    assert.equal(
      formatTypicalOtdLabel({ make: "Porsche", model: "911", sampleSize: 3, avgDiscountPercent: 3.0 }),
      "Typical OTD for this model: 3% off MSRP (based on 3 recent quotes)"
    );
  });
});
