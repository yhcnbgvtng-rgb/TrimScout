import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildContactIndex, contactStatus } from "./dealerContactIndex";
import type { Dealership } from "./dealershipsApi";

function row(over: Partial<Dealership>): Dealership {
  return { id: "1", dealerName: "Test Motors", address: null, city: "Town", state: "NJ", zipCode: null, phone: null, contactName: null, contactEmail: null, notes: null, website: null, domains: [], emailOptOut: false, createdAt: "", updatedAt: "", ...over };
}

describe("dealer contact index (search Contact column)", () => {
  it("yes / no / unknown", () => {
    const idx = buildContactIndex([row({ contactEmail: "a@testmotors.com" }), row({ id: "2", dealerName: "Empty Auto" })]);
    assert.equal(contactStatus(idx, { dealerName: "Test Motors", dealerState: "NJ" }), true);
    assert.equal(contactStatus(idx, { dealerName: "Empty Auto", dealerState: "NJ" }), false);
    assert.equal(contactStatus(idx, { dealerName: "Not In Directory", dealerState: "NJ" }), false, "no row = no contact");
    assert.equal(contactStatus(idx, { dealerName: "", dealerState: "NJ" }), null, "no dealer name is unknown, not 'no'");
    assert.equal(contactStatus(null, { dealerName: "Test Motors" }), null, "directory down is unknown, not 'no'");
  });
  it("blank, malformed and unsubscribed emails are not a contact", () => {
    const idx = buildContactIndex([
      row({ id: "1", dealerName: "Blank Auto", contactEmail: "   " }),
      row({ id: "2", dealerName: "Bad Auto", contactEmail: "not-an-email" }),
      row({ id: "3", dealerName: "Gone Auto", contactEmail: "sales@gone.com", emailOptOut: true }),
    ]);
    for (const dealerName of ["Blank Auto", "Bad Auto", "Gone Auto"]) assert.equal(contactStatus(idx, { dealerName, dealerState: "NJ" }), false, dealerName);
  });
});
