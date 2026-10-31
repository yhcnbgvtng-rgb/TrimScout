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
import { deskMatchFromContact } from "./deskResolve";
import { contactStateOf, hasContactOnFile } from "./dealerContactLookup";
import { ADVISOR_EMAIL_PLACEHOLDER, NO_CONTACT_HELPER, SALES_DESK_NO_NAME_LABEL, salesDeskLabel } from "./deskCopy";
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
  it("email with no name: /search No, Step 3 sales desk (no name)", () => {
    assert.equal(searchSays(GLEN), false);
    const d = step3(GLEN);
    assert.equal(d.contactState, "email_only");
    assert.equal(d.routing, "rooftop_inbox", "an unnamed personal mailbox is the dealer's contact: invite goes to it, not to ops");
    assert.equal(d.blockedReason, null);
    assert.equal(salesDeskLabel(d.contactState), SALES_DESK_NO_NAME_LABEL);
  });
  it("no contact: /search No, Step 3 unassigned with the test-drive helper", () => {
    assert.equal(searchSays(NONE), false);
    const d = step3(NONE);
    assert.equal(d.contactState, "none");
    assert.equal(d.routing, "unassigned");
    assert.equal(salesDeskLabel(d.contactState), SALES_DESK_NO_NAME_LABEL);
  });
  it("Glen Motors data shape (regression): never Yes on /search while Step 3 finds no contact", () => {
    assert.equal(contactStateOf(GLEN), "email_only");
    assert.equal(hasContactOnFile(GLEN), false);
    assert.equal(searchSays(GLEN), hasContactOnFile(GLEN));
    assert.equal(step3(GLEN).contactState, "email_only", "Step 3 knows the email exists");
  });
  it("search and Step 3 agree for every state", () => {
    for (const r of directory) assert.equal(searchSays(r), step3(r).contactState === "named", r.dealerName);
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
    assert.equal(toBuyerVehicle(vehicle(empty), null, buildContactIndex(dir)).dealerHasContact, false);
    assert.equal(publicDeskFor(dir, { dealerName: "Twin Ford", state: "NJ" }).contactState, "email_only");
  });
});

describe("top-of-step line uses the same reachable rule", () => {
  const match = (r: Dealership) => deskMatchFromContact(r, step3(r).knownNamed);
  it("named and unnamed reachable dealers are reachable; no email and unverified are not", () => {
    assert.equal(match(NAMED).reachable, true);
    assert.equal(match(GLEN).reachable, true, "an unnamed reachable email still counts");
    assert.equal(match(NONE).reachable, false);
    assert.equal(match(row({ id: "20", dealerName: "Gmail Motors", contactEmail: "gm.sales@gmail.com" })).reachable, false, "unverified");
    assert.equal(match(row({ id: "21", dealerName: "Gone Auto", contactEmail: "sales@gone.com", emailOptOut: true })).reachable, false);
    for (const r of directory) assert.equal(match(r).reachable, step3(r).contactState === "named" || step3(r).contactState === "email_only", r.dealerName);
  });
  it("the wizard line and picker badge key off reachable, and never say no contact for a reachable dealer", () => {
    const src = fs.readFileSync(new URL("../components/BiddingWizard.tsx", import.meta.url), "utf8");
    assert.match(src, /noteDesk\.reachable \? true : noteDesk\.emailOptOut \? null : false/);
    assert.match(src, /d\.reachable \? "Contact on file" : "No sales contact"/);
    assert.doesNotMatch(src, /no named sales contact/);
    assert.doesNotMatch(src, /picked\.knownNamed|linkDesk\.knownNamed/);
  });
});

describe("Step 3 copy", () => {
  it("uses the agreed strings", () => {
    assert.equal(SALES_DESK_NO_NAME_LABEL, "Sales desk (no contact name on file)");
    assert.equal(NO_CONTACT_HELPER, "Went on a test drive? Enter the sales advisor's details below.");
  });
  it("the To line has a masked email for an unnamed reachable dealer, and the address itself is never exposed", () => {
    const d = step3(GLEN);
    assert.equal(d.contactState, "email_only");
    assert.match(d.emailMasked || "", /^j•+@glentoyota\.com$/);
    assert.ok(!JSON.stringify(d).includes("jforkins"));
    assert.equal(step3(NAMED).emailMasked, "m•••••@namedhonda.com".replace("•••••", "•".repeat(5)));
    assert.equal(step3(NONE).emailMasked, null);
  });
  it("the green badge is on for named and email-only dealers, off for unverified and none; advisor field and helper only for those", () => {
    const src = fs.readFileSync(new URL("../components/BiddingWizard.tsx", import.meta.url), "utf8");
    const card = src.slice(src.indexOf('data-testid="dealer-contact-list"'));
    const rules = card.slice(0, card.indexOf("</ul>"));
    // Reachable dealers take the first branch, so they never reach the blue badge, the test-drive helper or the advisor input.
    assert.ok(rules.indexOf("data-testid=\"contact-on-file\"") < rules.indexOf("data-testid=\"contact-desk\""));
    assert.match(rules, /\{desk && onFile \? \(\s*<p[^>]*data-testid="to-line"/);
    assert.match(rules, /\) : desk \? \(\s*<div className="space-y-1" data-testid="add-adviser">/);
    assert.match(rules, /data-testid="contact-unverified"/);
  });
  it("the wizard renders them for the right states", () => {
    const src = fs.readFileSync(new URL("../components/BiddingWizard.tsx", import.meta.url), "utf8");
    assert.match(src, /→ \{salesDeskLabel\(desk\.contactState\)\}/);
    assert.match(src, /\(desk\.contactState === "named" \|\| desk\.contactState === "email_only"\) && !desk\.blockedReason/, "any reachable email gets the green badge");
    assert.match(src, /To: <span className="font-semibold">Sales<\/span> · \{dealer\.dealerName\}/, "no name: To: Sales · dealer");
    assert.match(src, /: NO_CONTACT_HELPER\}/);
    assert.match(src, /placeholder=\{optedOut \? "Sales advisor email" : ADVISOR_EMAIL_PLACEHOLDER\}/);
    assert.equal(ADVISOR_EMAIL_PLACEHOLDER, "Sales advisor email (optional)");
    assert.equal(salesDeskLabel("none"), SALES_DESK_NO_NAME_LABEL, "every non-named dealer gets the one badge");
    assert.doesNotMatch(src, /"Dealership sales desk"/);
  });
});

describe("real box2 rows (read-only snapshot 2026-10-10)", () => {
  // The box2 snapshot is 4 rows; the live directory stamps group domains from all ~18k (listDealerships → stampGroupDomains). BMW of Roseville's
  // autonation.com address is shared by dozens of AutoNation rooftops there, which a 4-row sample cannot show — so say so on the row.
  const rows = (JSON.parse(fs.readFileSync(new URL("./fixtures/box2-dealer-rows.json", import.meta.url), "utf8")) as Dealership[]).map((r) =>
    /@autonation\.com$/i.test(r.contactEmail || "") ? { ...r, emailInGroupDomain: true } : r
  );
  const idx = buildContactIndex(rows);
  const both = (dealerName: string, state: string) => ({
    search: toBuyerVehicle({ dealerId: "x", dealerName, dealerCity: "", dealerState: state } as InventoryVehicle, null, idx).dealerHasContact,
    step3: publicDeskFor(rows, { dealerName, state }),
  });
  it("Bayside CDJR (Bayside, NY): the VA store of the same name is not its contact", () => {
    const { search, step3 } = both("Bayside Chrysler Dodge Jeep Ram", "NY");
    assert.equal(search, false);
    assert.equal(step3.contactState, "none");
    assert.equal(salesDeskLabel(step3.contactState), SALES_DESK_NO_NAME_LABEL);
  });
  it("Bayside CDJR in VA still finds its own unnamed email as a desk, not a contact", () => {
    const { search, step3 } = both("Bayside Chrysler Dodge Jeep Ram", "VA");
    assert.equal(search, false);
    assert.equal(step3.contactState, "email_only");
  });
  it("Bayside Annapolis (a name, but only a leads@ mailbox) is a desk on both sides", () => {
    const { search, step3 } = both("Bayside Chrysler Dodge Jeep Ram Annapolis", "MD");
    assert.equal(search, false);
    assert.equal(step3.contactState, "email_only");
  });
  it("BMW of Roseville (email, no name): No on /search, sales desk in Step 3", () => {
    const { search, step3 } = both("BMW of Roseville", "CA");
    assert.equal(search, false);
    assert.equal(step3.contactState, "email_only");
    assert.equal(step3.knownNamed, false);
  });
  it("search and Step 3 agree for every row and every state", () => {
    for (const r of rows) for (const st of [r.state || "", "NY", "CA"]) {
      const { search, step3 } = both(r.dealerName, st);
      assert.equal(search, step3.contactState === "named", `${r.dealerName} ${st}`);
    }
  });
});
