import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buyerAliasCode, formatBuyerAlias } from "./buyerAlias";

describe("formatBuyerAlias", () => {
  it("is stable for the same buyer and different for different buyers", () => {
    assert.equal(formatBuyerAlias("42"), formatBuyerAlias(42));
    assert.equal(formatBuyerAlias("42"), formatBuyerAlias(" 42 "));
    assert.notEqual(formatBuyerAlias("42"), formatBuyerAlias("43"));
    assert.notEqual(formatBuyerAlias("42"), formatBuyerAlias("420"));
  });

  it("looks like Buyer #XXXXX and never leaks the raw id", () => {
    const alias = formatBuyerAlias("7");
    assert.match(alias, /^Buyer #[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    assert.equal(alias.includes("#7"), false);
  });

  it("uses no characters that get misread aloud", () => {
    for (let id = 1; id <= 500; id++) {
      assert.doesNotMatch(buyerAliasCode(id) || "", /[01IO]/, `id ${id}`);
    }
  });

  it("does not collide across a realistic run of sequential ids", () => {
    const seen = new Set<string>();
    for (let id = 1; id <= 5000; id++) seen.add(buyerAliasCode(id)!);
    // 32^5 ≈ 33M codes; a handful of collisions in 5k would mean poor mixing.
    assert.ok(seen.size >= 4995, `only ${seen.size} distinct codes for 5000 ids`);
  });

  it("is plain Buyer until there is an account to derive it from", () => {
    assert.equal(formatBuyerAlias(null), "Buyer");
    assert.equal(formatBuyerAlias(undefined), "Buyer");
    assert.equal(formatBuyerAlias(""), "Buyer");
    assert.equal(buyerAliasCode("  "), null);
  });
});
