import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contactIdSet, contactStatus, dealerHasContact } from "./dealerContactIndex";

describe("dealer contact index", () => {
  it("a contact means an email; blanks and whitespace don't count", () => {
    assert.equal(dealerHasContact({ contactEmail: "gm@dealer.com" }), true);
    assert.equal(dealerHasContact({ contactEmail: "  " }), false);
    assert.equal(dealerHasContact({ contactEmail: null }), false);
  });
  it("builds the id set from dealers that have one", () => {
    const set = contactIdSet([{ id: "1", contactEmail: "a@x.com" }, { id: "2", contactEmail: null }, { id: "3", contactEmail: "c@x.com" }]);
    assert.deepEqual([...set].sort(), ["1", "3"]);
  });
  it("yes / no / unknown", () => {
    const set = new Set(["1"]);
    assert.equal(contactStatus(set, "1"), true);
    assert.equal(contactStatus(set, "2"), false);
    assert.equal(contactStatus(set, null), null, "no dealer id is unknown, not 'no'");
    assert.equal(contactStatus(null, "1"), null, "directory down is unknown, not 'no'");
  });
});
