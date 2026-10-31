// The audit's headline finding was that three surfaces answered "can we reach this dealer?" three different ways. These tests pin them to
// one answer: the admin tile (box: reachabilityBucket), the wizard badge (dealerContactStatus / contactStateOf) and quote routing
// (deskFromDealership / deskFromRooftop → inviteRouting) are run over the same directory rows and must agree on every one.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reachabilityBucket, stampGroupDomains } from "./quoteReachable";
import { contactStateOf, dealerContactStatus, dealerIdFrom, matchDirectoryDealership, type DirectoryDealership } from "./dealerContactLookup";
import { deskFromDealership, deskFromRooftop, inviteRouting } from "./quotePackage";
import { buildContactIndex, contactStateFor, contactStatus } from "./dealerContactIndex";
import { toBuyerVehicle } from "./buyerSearch";
import type { InventoryVehicle } from "./inventoryApi";
import { publicDeskFor } from "./publicDesk";
import type { Dealership } from "./dealershipsApi";

let nextId = 1;
function dealer(over: Partial<Dealership> = {}): Dealership {
  const id = String(nextId++);
  return {
    id, dealerName: `Rooftop ${id}`, address: null, city: "Butler", state: "NJ", zipCode: null, phone: null, contactName: null, contactEmail: null,
    notes: null, website: null, domains: [], emailOptOut: false, createdAt: "", updatedAt: "", ...over,
  };
}

const DIRECTORY: Dealership[] = stampGroupDomains([
  dealer({ dealerName: "LaFontaine Chrysler Dodge Jeep Ram of Walled Lake", contactName: "Wendy Wilkins", contactEmail: "wendy@lafontaine.com", website: "lafontainecdjrwalledlake.com" }), // named, valid
  dealer({ dealerName: "Capitol Subaru of Salem", contactEmail: "t.jones@capitolauto.com", website: "capitolsubaru.com" }),                                                 // unnamed personal, valid
  dealer({ dealerName: "Autoplex Hyundai", contactName: "Ray Autoplex", contactEmail: "accessibility@hmausa.com", website: "autoplex-tx.com" }),                              // OEM inbox with a person's name
  dealer({ dealerName: "Houston Hyundai", contactEmail: "ruben@houstonhyundai" }),                                                                                             // no TLD
  dealer({ dealerName: "Ford of Lafayette", contactEmail: "s@leadcrm.com" }),                                                                                                  // lead vendor
  dealer({ dealerName: "Pomeroy Chrysler", contactEmail: "logo@2x.png" }),                                                                                                     // scraped file name
  dealer({ dealerName: "Plain Motors", contactEmail: "info@plainmotors.com" }),                                                                                                // department
  dealer({ dealerName: "Gmail Motors", contactName: "Gina Gmail", contactEmail: "gina@gmail.com" }),                                                                          // public mail
  dealer({ dealerName: "Nissan of Serramonte", contactEmail: "jdoe@goldenstatenissan.com", website: "nissanofserramonte.com" }),                                              // unrelated domain
  dealer({ dealerName: "Sales Desk Toyota", contactEmail: "leads@salesdesktoyota.com" }),                                                                                      // generic sales inbox, valid
  dealer({ dealerName: "Opted Out Honda", contactEmail: "jdoe@optedouthonda.com", emailOptOut: true }),
  dealer({ dealerName: "No Email Kia" }),
  dealer({ dealerName: "Blue Ribbon Chevrolet", contactEmail: "a@rothbardmotors.com", website: "blueribbon.com" }),                                                             // group domain x3 (2+ is enough)
  dealer({ dealerName: "Rothbard Honda", contactEmail: "b@rothbardmotors.com", website: "rothbardhonda.com" }),
  dealer({ dealerName: "Elm Toyota", contactEmail: "c@rothbardmotors.com", website: "elmtoyota.com" }),
]);

describe("one answer to 'can a quote request reach this dealer'", () => {
  it("tile, wizard badge and quote routing agree on every directory row", () => {
    for (const d of DIRECTORY) {
      const tile = reachabilityBucket({ ...d, emailOptOut: d.emailOptOut });                  // what the box tile counts
      const badge = contactStateOf(d);                                                         // what the wizard / Step 3 / search Contact column read
      const status = dealerContactStatus([d], { dealerName: d.dealerName, state: d.state });  // the wizard's dealer-contact badge
      const named = deskFromDealership(d);
      const desk = named?.knownNamed ? named : deskFromRooftop(d);
      const routes = inviteRouting(desk) !== "unassigned";
      const label = `${d.dealerName} <${d.contactEmail}>`;
      assert.equal(tile === "reachable", routes && !d.emailOptOut, `tile vs routing: ${label}`);
      assert.equal(tile === "reachable", badge === "named" || badge === "email_only", `tile vs contactStateOf: ${label}`);
      if (!d.emailOptOut) {
        assert.equal(tile === "reachable", status.hasEmail, `tile vs wizard hasEmail: ${label}`);
        assert.equal(tile === "unverified", status.emailStatus === "unverified", `tile vs wizard unverified: ${label}`);
        assert.equal(tile === "unverified", badge === "unverified", `tile vs contactStateOf unverified: ${label}`);
      }
    }
  });

  it("the audit's wrong-but-present addresses are not reachable on any surface", () => {
    for (const name of ["Autoplex Hyundai", "Houston Hyundai", "Ford of Lafayette", "Pomeroy Chrysler", "Plain Motors"]) {
      const d = DIRECTORY.find((x) => x.dealerName === name)!;
      assert.equal(reachabilityBucket(d), "none", name);
      assert.equal(contactStateOf(d), "none", name);
      assert.equal(dealerContactStatus([d], { dealerName: name }).emailStatus, "none", name);
      const desk = deskFromDealership(d);
      assert.equal(desk?.email || "", "", `${name} never puts the bad address on a desk`);
      assert.equal(deskFromRooftop(d).email, "", name);
      assert.equal(inviteRouting(deskFromRooftop(d)), "unassigned", name);
    }
  });

  it("an OEM inbox with a person's name beside it is not a named contact (was routed 'named' for 85 rooftops)", () => {
    const d = DIRECTORY.find((x) => x.dealerName === "Autoplex Hyundai")!;
    assert.equal(deskFromDealership(d)?.knownNamed, false);
  });

  it("public mail and an unrelated domain show as Unverified and are not sent to", () => {
    for (const name of ["Gmail Motors", "Nissan of Serramonte"]) {
      const d = DIRECTORY.find((x) => x.dealerName === name)!;
      assert.equal(contactStateOf(d), "unverified", name);
      assert.equal(dealerContactStatus([d], { dealerName: name }).emailStatus, "unverified", name);
      assert.equal(dealerContactStatus([d], { dealerName: name }).hasEmail, false, name);
      assert.equal(inviteRouting(deskFromRooftop(d)), "unassigned", name);
      assert.equal(publicDeskFor(DIRECTORY, { dealerName: name, state: "NJ" }).contactState, "unverified", name);
    }
  });

  it("a valid dealer-domain address with no person's name goes to the rooftop inbox, not the ops queue", () => {
    const d = DIRECTORY.find((x) => x.dealerName === "Capitol Subaru of Salem")!;
    assert.equal(deskFromDealership(d)?.knownNamed, false);
    const desk = deskFromRooftop(d);
    assert.equal(desk.email, "t.jones@capitolauto.com");
    assert.equal(inviteRouting(desk), "rooftop_inbox");
    assert.equal(publicDeskFor(DIRECTORY, { dealerName: d.dealerName, state: "NJ" }).routing, "rooftop_inbox");
  });

  it("a valid group-domain address with no person's name goes to the rooftop inbox too", () => {
    const d = DIRECTORY.find((x) => x.dealerName === "Blue Ribbon Chevrolet")!;
    assert.equal(d.emailInGroupDomain, true);
    assert.equal(inviteRouting(deskFromRooftop(d)), "rooftop_inbox");
  });

  it("a named person on a valid personal mailbox stays 'named'; a generic sales inbox stays a rooftop inbox", () => {
    assert.equal(publicDeskFor(DIRECTORY, { dealerName: "LaFontaine Chrysler Dodge Jeep Ram of Walled Lake", state: "NJ" }).routing, "named");
    assert.equal(publicDeskFor(DIRECTORY, { dealerName: "Sales Desk Toyota", state: "NJ" }).routing, "rooftop_inbox");
  });

  it("an unsubscribed dealer is not reachable and is blocked", () => {
    const pd = publicDeskFor(DIRECTORY, { dealerName: "Opted Out Honda", state: "NJ" });
    assert.equal(pd.blockedReason, "dealer_opted_out");
    assert.equal(contactStateOf(DIRECTORY.find((x) => x.dealerName === "Opted Out Honda")), "none");
  });
});

describe("matching by dealer_id, name + state only as the fallback", () => {
  // Two rows share a name in one state (a duplicate store row): the car's own dealer_id picks its row, the name alone picks the better contact.
  const dup: Dealership[] = stampGroupDomains([
    dealer({ id: "100", dealerName: "Twin Toyota", state: "NJ", contactEmail: null }),
    dealer({ id: "101", dealerName: "Twin Toyota", state: "NJ", contactEmail: "jdoe@twintoyota.com" }),
  ]);

  it("the vehicle's dealer id wins over a name match", () => {
    assert.equal(matchDirectoryDealership(dup, { dealerName: "Twin Toyota", state: "NJ", dealerId: "100" })?.id, "100");
    assert.equal(matchDirectoryDealership(dup, { dealerName: "Twin Toyota", state: "NJ", dealerId: 101 })?.id, "101");
    assert.equal(dealerContactStatus(dup, { dealerName: "Twin Toyota", state: "NJ", dealerId: "100" }).hasEmail, false);
  });

  it("falls back to name + state when there is no id, or the id is not in the directory", () => {
    assert.equal(matchDirectoryDealership(dup, { dealerName: "Twin Toyota", state: "NJ" })?.id, "101");
    assert.equal(matchDirectoryDealership(dup, { dealerName: "Twin Toyota", state: "NJ", dealerId: "999999" })?.id, "101");
    assert.equal(matchDirectoryDealership(dup, { dealerName: "Twin Toyota", state: "NJ", dealerId: null })?.id, "101");
  });

  it("dealerIdFrom accepts a real id and rejects placeholders and junk", () => {
    assert.equal(dealerIdFrom("17014"), "17014");
    assert.equal(dealerIdFrom(17014), "17014");
    assert.equal(dealerIdFrom("pick:twin toyota|nj"), null);
    assert.equal(dealerIdFrom("12; DROP"), null);
    assert.equal(dealerIdFrom(undefined), null);
  });

  it("/search's Contact column uses the car's dealer id as well", () => {
    const index = buildContactIndex(dup);
    assert.equal(contactStatus(index, { dealerName: "Twin Toyota", dealerState: "NJ", dealerId: "100" }), false);
    assert.equal(contactStatus(index, { dealerName: "Twin Toyota", dealerState: "NJ", dealerId: "101" }), false); // reachable but no person's name: not a NAMED contact
    assert.equal(contactStatus(index, { dealerName: "Twin Toyota", dealerState: "NJ" }), false);
  });
});

describe("/search's Contact column says \"Unverified email\", never \"on file\", for an address it cannot tie to the store", () => {
  // BMW of Westlake (OH): the directory holds a Ganley BMW address (rstrecker@ganleybmw.com); no other rooftop shares that domain.
  const westlake = dealer({ id: "7852", dealerName: "BMW of Westlake", state: "OH", contactName: "Jared Jeschelnig", contactEmail: "rstrecker@ganleybmw.com", website: "https://www.bmwofwestlake.com", domains: ["bmwofwestlake.com"] });
  const index = buildContactIndex(stampGroupDomains([westlake, dealer({ dealerName: "Gmail Motors", state: "OH", contactEmail: "gina@gmail.com" })]));

  it("contactStateFor is unverified, by dealer id and by name + state, and contactStatus is not true", () => {
    assert.equal(contactStateFor(index, { dealerName: "BMW of Westlake", dealerState: "OH", dealerId: "7852" }), "unverified");
    assert.equal(contactStateFor(index, { dealerName: "BMW of Westlake", dealerState: "OH" }), "unverified");
    assert.equal(contactStatus(index, { dealerName: "BMW of Westlake", dealerState: "OH", dealerId: "7852" }), false);
    assert.equal(contactStateFor(null, { dealerName: "BMW of Westlake" }), null);
  });

  it("a buyer vehicle carries the state the column renders", () => {
    const car = { vin: "WBA0000000000001", dealerName: "BMW of Westlake", dealerState: "OH", dealerId: "7852", lastSeenAt: new Date().toISOString() } as unknown as InventoryVehicle;
    const v = toBuyerVehicle(car, null, index);
    assert.equal(v.dealerHasContact, false);
    assert.equal(v.dealerContactState, "unverified");
  });
});

describe("a directory-row type check", () => {
  it("DirectoryDealership carries the fields the rule reads", () => {
    const r: DirectoryDealership = { id: "1", dealerName: "X", address: null, city: null, state: null, zipCode: null, phone: null, contactEmail: null, emailOptOut: false, website: null, domains: [], emailInGroupDomain: false };
    assert.equal(contactStateOf(r), "none");
  });
});
