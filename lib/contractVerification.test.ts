import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyContractAgainstBid, type ContractExtractedFields, type WinningBidTerms } from "./contractVerification";

const bid: WinningBidTerms = {
  dealerName: "Battlefield Ford",
  totalOtdPrice: 58372,
  salesTax: 3200,
  dmvFees: 250,
  docFee: 499,
  dealerAccessories: 0,
};

function fields(overrides: Partial<ContractExtractedFields> = {}): ContractExtractedFields {
  return {
    totalOtdPrice: 58372,
    dealerName: "Battlefield Ford, LLC",
    buyerName: null,
    feeLines: [],
    ...overrides,
  };
}

describe("verifyContractAgainstBid", () => {
  it("verifies clean when price matches exactly and dealer name loosely matches", () => {
    const result = verifyContractAgainstBid(fields(), bid);
    assert.equal(result.status, "verified");
    assert.equal(result.priceMatches, true);
    assert.equal(result.dealerNameMatches, true);
    assert.deepEqual(result.flags, []);
  });

  it("flags a contract total higher than the bid as critical — the core 'sneaked-in fee' case", () => {
    const result = verifyContractAgainstBid(fields({ totalOtdPrice: 58372 + 495 }), bid);
    assert.equal(result.status, "flagged");
    assert.equal(result.priceMatches, false);
    const critical = result.flags.find((f) => f.severity === "critical");
    assert.ok(critical, "expected a critical flag");
    assert.match(critical!.message, /\$495/);
    assert.match(critical!.message, /HIGHER/);
  });

  it("allows a one-cent-scale rounding difference but nothing more", () => {
    const tiny = verifyContractAgainstBid(fields({ totalOtdPrice: 58372.4 }), bid);
    assert.equal(tiny.priceMatches, true);
    assert.equal(tiny.status, "verified");

    const real = verifyContractAgainstBid(fields({ totalOtdPrice: 58374 }), bid);
    assert.equal(real.priceMatches, false);
    assert.equal(real.status, "flagged");
  });

  it("flags a lower total as a warning, not critical — not a buyer risk", () => {
    const result = verifyContractAgainstBid(fields({ totalOtdPrice: 58000 }), bid);
    assert.equal(result.status, "flagged");
    assert.equal(result.flags[0].severity, "warning");
    assert.doesNotMatch(result.flags.map((f) => f.message).join(" "), /HIGHER/);
  });

  it("flags a dealer-name mismatch as critical", () => {
    const result = verifyContractAgainstBid(fields({ dealerName: "Some Other Ford Dealership" }), bid);
    assert.equal(result.dealerNameMatches, false);
    assert.equal(result.status, "flagged");
    assert.ok(result.flags.some((f) => f.severity === "critical" && /dealer name/.test(f.message)));
  });

  it("matches loosely on legal-entity suffixes and punctuation, not just exact strings", () => {
    const result = verifyContractAgainstBid(fields({ dealerName: "BATTLEFIELD FORD, INC." }), bid);
    assert.equal(result.dealerNameMatches, true);
  });

  it("needs_review, not falsely verified, when a field couldn't be read at all", () => {
    const noPrice = verifyContractAgainstBid(fields({ totalOtdPrice: null }), bid);
    assert.equal(noPrice.status, "needs_review");
    assert.equal(noPrice.priceMatches, false);

    const noDealer = verifyContractAgainstBid(fields({ dealerName: null }), bid);
    assert.equal(noDealer.status, "needs_review");
  });

  it("never marks verified when there is any flag, even a non-critical one", () => {
    const result = verifyContractAgainstBid(fields({ totalOtdPrice: 58000 }), bid);
    assert.notEqual(result.status, "verified");
  });
});
