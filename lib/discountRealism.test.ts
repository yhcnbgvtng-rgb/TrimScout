import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discountPercentOffMsrp, discountRealismWarning } from "./discountRealism";

describe("discountPercentOffMsrp", () => {
  it("computes percent off MSRP", () => {
    assert.equal(discountPercentOffMsrp(50000, 45000), 10);
  });

  it("is null with a missing or non-positive MSRP", () => {
    assert.equal(discountPercentOffMsrp(0, 45000), null);
    assert.equal(discountPercentOffMsrp(-1, 45000), null);
  });

  it("is null with a missing or non-positive target price", () => {
    assert.equal(discountPercentOffMsrp(50000, 0), null);
  });
});

describe("discountRealismWarning — soft warning only, never a block", () => {
  it("is null within a sane band", () => {
    assert.equal(discountRealismWarning(50000, 46000), null);
  });

  it("is null exactly at the threshold", () => {
    assert.equal(discountRealismWarning(50000, 37500), null);
  });

  it("warns, without blocking, above the threshold", () => {
    const warning = discountRealismWarning(50000, 30000);
    assert.match(warning || "", /40% off MSRP/);
    assert.match(warning || "", /can still submit/i);
  });

  it("is null when MSRP is unknown — nothing to compare against", () => {
    assert.equal(discountRealismWarning(0, 30000), null);
  });
});
