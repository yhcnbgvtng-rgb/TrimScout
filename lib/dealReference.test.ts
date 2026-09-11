import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newDealReference, isDealReference, normalizeDealReference } from "./dealReference";

describe("dealReference", () => {
  it("mints TS-XXXXXX with no ambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const ref = newDealReference();
      assert.match(ref, /^TS-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      assert.equal(isDealReference(ref), true);
    }
  });

  it("does not repeat across a realistic burst", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => newDealReference()));
    assert.equal(seen.size, 2000);
  });

  it("accepts only its own shape when reading one back", () => {
    assert.equal(normalizeDealReference("ts-abc234"), "TS-ABC234");
    assert.equal(normalizeDealReference(" TS-ABC234 "), "TS-ABC234");
    assert.equal(normalizeDealReference("TS-ABC23"), undefined);
    assert.equal(normalizeDealReference("TS-ABC2340"), undefined);
    assert.equal(normalizeDealReference("TS-ABC10I"), undefined); // 1, 0, I excluded
    assert.equal(normalizeDealReference("XX-ABC234"), undefined);
    assert.equal(normalizeDealReference(12345), undefined);
    assert.equal(normalizeDealReference(null), undefined);
  });
});
