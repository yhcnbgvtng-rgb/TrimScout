import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDealerResponsivenessLabel } from "./dealerResponsiveness";

describe("formatDealerResponsivenessLabel — real numbers only, never a fabricated default", () => {
  it("returns null when there's nothing to show yet (still loading)", () => {
    assert.equal(formatDealerResponsivenessLabel(null), null);
  });

  it("says plainly there's no history yet for a dealer with zero bids, rather than guessing", () => {
    assert.equal(
      formatDealerResponsivenessLabel({ dealerName: "New Dealer", bidCount: 0, avgResponseHours: null }),
      "No response history yet"
    );
  });

  it("treats a null avgResponseHours the same as zero bids, defensively", () => {
    assert.equal(
      formatDealerResponsivenessLabel({ dealerName: "Odd State", bidCount: 3, avgResponseHours: null }),
      "No response history yet"
    );
  });

  it("says 'within the hour' for sub-hour average response times", () => {
    assert.equal(
      formatDealerResponsivenessLabel({ dealerName: "Fast Ford", bidCount: 5, avgResponseHours: 0.5 }),
      "Usually responds within the hour"
    );
  });

  it("formats in hours, singular vs plural, under a day", () => {
    assert.equal(
      formatDealerResponsivenessLabel({ dealerName: "Quick Ford", bidCount: 5, avgResponseHours: 1.2 }),
      "Usually responds within 1 hour"
    );
    assert.equal(
      formatDealerResponsivenessLabel({ dealerName: "Quick Ford", bidCount: 5, avgResponseHours: 5.6 }),
      "Usually responds within 6 hours"
    );
  });

  it("formats in days, singular vs plural, at or above 24 hours", () => {
    assert.equal(
      formatDealerResponsivenessLabel({ dealerName: "Slow Ford", bidCount: 5, avgResponseHours: 24 }),
      "Usually responds within 1 day"
    );
    assert.equal(
      formatDealerResponsivenessLabel({ dealerName: "Slower Ford", bidCount: 5, avgResponseHours: 60 }),
      "Usually responds within 3 days"
    );
  });
});
