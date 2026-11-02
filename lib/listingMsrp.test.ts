import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { distinctMsrp } from "./listingMsrp";
import { discountPct } from "./dealerAnalytics";

describe("distinctMsrp: MSRP repeated from the asking price is not shown", () => {
  it("2021 F-150 Raptor at $64,500 with MSRP $64,500 shows no MSRP and no % off", () => {
    assert.equal(distinctMsrp(64500, 64500), null);
    assert.equal(discountPct(64500, 64500), null);
  });
  it("a real MSRP above the price still shows, with its % off", () => {
    assert.equal(distinctMsrp(70000, 64500), 70000);
    assert.equal(discountPct(70000, 64500), 7.9);
  });
  it("missing, zero or non-numeric values show nothing; a missing price keeps a real MSRP", () => {
    assert.equal(distinctMsrp(null, 64500), null);
    assert.equal(distinctMsrp(0, 64500), null);
    assert.equal(distinctMsrp(undefined, undefined), null);
    assert.equal(distinctMsrp(64500, null), 64500);
  });
});
