/**
 * /search's "Contact on file" column and Step 3's desk lookup must agree: both resolve the dealership the same way
 * and apply the one shared rule (an active, deliverable email — not unsubscribed). Regression: Glen Motors, Fair Lawn
 * NJ has an email and no contact name — /search said "Yes" while Step 3 said it had no contact.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildContactIndex } from "./dealerContactIndex";
import { toBuyerVehicle } from "./buyerSearch";
import { publicDeskFor } from "./publicDesk";
import { contactStateOf, hasContactOnFile } from "./dealerContactLookup";
import { NO_CONTACT_HELPER, SALES_DESK_NO_NAME_LABEL, salesDeskLabel } from "./deskCopy";
import type { Dealership } from "./dealershipsApi";
import type { InventoryVehicle } from "./inventoryApi";

function row(over: Partial<Dealership>): Dealership {
  return { id: "1", dealerName: "Test Motors", address: null, city: "Town", state: "NJ", zipCode: null, phone: null, contactName: null, contactEmail: null, notes: null, website: null, domains: [], emailOptOut: false, createdAt: "", updatedAt: "", ...over };
}
const GLEN = row({
  id: "6329", dealerName: "Glen Motors, Inc.", city: "Fair Lawn", state: "NJ", zipCode: "07410", contactName: null,
  contactEmail: "jforkins@glentoyota.com", website: "https://www.glentoyota.com", domains: ["glentoyota.com"],
  notes: "Website: https://www.glentoyota.com | Source: Toyota nationwide dealer API + staff-page crawl | no staff page found | jforkins@glentoyota.com (dealership contact (DealerRater reply)) | Brand: Toyota",
});
const NAMED = row({ id: "2", dealerName: "Named Honda", contactName: "Maria Lopez", contactEmail: "mlopez@namedhonda.com" });
const NONE = row({ id: "3", dealerName: "Nobody Kia" });

function vehicle(r: Dealership): InventoryVehicle {
  return { dealerId: r.id, dealerName: r.dealerName.replace(/,? Inc\.$/, ""), dealerCity: r.city, dealerState: r.state } as InventoryVehicle;
}
const directory = [GLEN, NAMED, NONE];
const index = buildContactIndex(directory);
const searchSays = (r: Dealership) => toBuyerVehicle(vehicle(r), null, index).dealerHasContact;
const step3 = (r: Dealership) => publicDeskFor(directory, { dealerName: vehicle(r).dealerName, state: r.state || "" });

describe("one rule for contact on file", () => {
  it("named contact: /search Yes, Step 3 named", () => {
    assert.equal(searchSays(NAMED), true);
    const d = step3(NAMED);
    assert.equal(d.contactState, "named");
    assert.equal(d.routing, "named");
    assert.equal(d.knownNamed, true);
  });
  it("email with no name: /search Yes, Step 3 sales desk (no name)", () => {
    assert.equal(searchSays(GLEN), true);
    const d = step3(GLEN);
    assert.equal(d.contactState, "email_only");
    assert.equal(d.routing, "rooftop_inbox", "the invite goes to the email on file, greeted as the Sales team");
    assert.equal(d.blockedReason, null);
    assert.equal(salesDeskLabel(d.contactState), SALES_DESK_NO_NAME_LABEL);
  });
  it("no contact: /search No, Step 3 unassigned with the test-drive helper", () => {
    assert.equal(searchSays(NONE), false);
    const d = step3(NONE);
    assert.equal(d.contactState, "none");
    assert.equal(d.routing, "unassigned");
    assert.equal(salesDeskLabel(d.contactState), "Dealership sales desk");
  });
  it("Glen Motors data shape (regression): never Yes on /search while Step 3 finds no contact", () => {
    assert.equal(contactStateOf(GLEN), "email_only");
    assert.equal(hasContactOnFile(GLEN), true);
    assert.equal(searchSays(GLEN), hasContactOnFile(GLEN));
    assert.equal(step3(GLEN).contactState, "email_only", "Step 3 knows the email exists");
  });
  it("search and Step 3 agree for every state", () => {
    for (const r of directory) assert.equal(searchSays(r), step3(r).contactState !== "none", r.dealerName);
  });
  it("an unsubscribed dealer is No on /search and blocked in Step 3", () => {
    const gone = row({ id: "9", dealerName: "Gone Auto", contactEmail: "sales@gone.com", emailOptOut: true });
    assert.equal(toBuyerVehicle(vehicle(gone), null, buildContactIndex([gone])).dealerHasContact, false);
    const d = publicDeskFor([gone], { dealerName: "Gone Auto", state: "NJ" });
    assert.equal(d.contactState, "none");
    assert.equal(d.blockedReason, "dealer_opted_out");
  });
  it("duplicate rows for one store: both sides pick the one with a contact", () => {
    const empty = row({ id: "10", dealerName: "Twin Ford" });
    const full = row({ id: "11", dealerName: "Twin Ford", contactEmail: "bob@twinford.com" });
    const dir = [empty, full];
    assert.equal(toBuyerVehicle(vehicle(empty), null, buildContactIndex(dir)).dealerHasContact, true);
    assert.equal(publicDeskFor(dir, { dealerName: "Twin Ford", state: "NJ" }).contactState, "email_only");
  });
});

describe("Step 3 copy", () => {
  it("uses the agreed strings", () => {
    assert.equal(SALES_DESK_NO_NAME_LABEL, "Sales desk (no contact name on file)");
    assert.equal(NO_CONTACT_HELPER, "Went on a test drive? Enter the sales advisor's details below.");
  });
  it("the wizard renders them for the right states", () => {
    const src = fs.readFileSync(new URL("../components/BiddingWizard.tsx", import.meta.url), "utf8");
    assert.match(src, /→ \{salesDeskLabel\(desk\.contactState\)\}/);
    assert.match(src, /desk\.contactState === "none"\s*\? NO_CONTACT_HELPER\s*: EMAIL_ONLY_HELPER/);
    assert.doesNotMatch(src, /"Dealership sales desk"/, "the old label survives only inside salesDeskLabel");
  });
});
