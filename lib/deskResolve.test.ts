import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDealerHost, registrableDomain, resolveDeskFromVdpUrl, type DeskContact } from "./deskResolve";

const row = (o: Partial<DeskContact> & { id: string; dealerName: string }): DeskContact => ({
  city: null,
  state: null,
  zipCode: null,
  contactName: null,
  contactEmail: null,
  emailOptOut: false,
  notes: null,
  ...o,
});

const CONTACTS: DeskContact[] = [
  row({ id: "1", dealerName: "Bachrodt BMW", city: "Rockford", state: "IL", zipCode: "61112", notes: "Website: https://www.loubachrodtbmw.com | Brand: BMW", contactName: "Charlie Hansmeyer", contactEmail: "chansmeyer@bachrodt.com" }),
  row({ id: "2", dealerName: "Howell, INC.", city: "Summit", state: "MS", notes: "Website: https://howellgmc.com/" }),
  // Group site shared by two rooftops.
  row({ id: "3", dealerName: "Cochran Chevrolet", city: "Zelienople", state: "PA", website: "https://www.cochran.com/" }),
  row({ id: "4", dealerName: "Cochran Chevrolet of Ohio", city: "Youngstown", state: "OH", website: "https://www.cochran.com/" }),
  // No website; only a sales email on a dealer domain.
  row({ id: "5", dealerName: "Route 23 Auto Mall", city: "Butler", state: "NJ", contactEmail: "sales.mgr@route23automall.com" }),
  // No website, consumer mailbox — must never key on gmail.
  row({ id: "6", dealerName: "Gmail Motors", contactEmail: "bob@gmail.com" }),
  // A vanity host mapped by alias to a rooftop whose canonical site is elsewhere.
  row({ id: "7", dealerName: "Paul Miller BMW", city: "Wayne", state: "NJ", website: "https://www.paulmillerbmw.com/", hostAliases: ["shop.pmbmw-wayne.net", "paulmillerbmwnj.com"] }),
];

describe("normalizeDealerHost / registrableDomain", () => {
  it("lower-cases, strips www and inventory-style prefixes, keys on the registrable domain", () => {
    assert.deepEqual(normalizeDealerHost("https://WWW.LouBachrodtBMW.com/new-Rockford-2026-BMW-X3"), { host: "loubachrodtbmw.com", registrable: "loubachrodtbmw.com" });
    assert.deepEqual(normalizeDealerHost("https://inventory.example.com/vdp/1"), { host: "example.com", registrable: "example.com" });
    assert.deepEqual(normalizeDealerHost("https://www1.shop.example.com/x"), { host: "example.com", registrable: "example.com" });
    assert.deepEqual(normalizeDealerHost("https://ford.example.com/x"), { host: "ford.example.com", registrable: "example.com" });
    assert.equal(registrableDomain("www.dealer.co.uk"), "dealer.co.uk");
  });
  it("returns null for anything that is not a URL", () => {
    assert.equal(normalizeDealerHost("5UX53GP01T9190742"), null);
    assert.equal(normalizeDealerHost(""), null);
  });
});

describe("resolveDeskFromVdpUrl", () => {
  it("binds a known host to its desk from the website on file, without fetching anything", () => {
    const r = resolveDeskFromVdpUrl("https://www.loubachrodtbmw.com/new-Rockford-2026-BMW-X3-5UX53GP01T9190742", CONTACTS, (c) => c.id === "1");
    assert.equal(r.status, "unique");
    if (r.status !== "unique") return;
    assert.equal(r.via, "website");
    assert.equal(r.desk.deskId, "1");
    assert.equal(r.desk.dealerName, "Bachrodt BMW");
    assert.equal(r.desk.knownNamed, true);
    assert.equal("email" in r.desk, false);
  });

  it("matches an inventory subdomain of a known site", () => {
    const r = resolveDeskFromVdpUrl("https://inventory.howellgmc.com/new/x", CONTACTS);
    assert.equal(r.status, "unique");
    if (r.status === "unique") assert.equal(r.desk.deskId, "2");
  });

  it("does not auto-bind a site shared by two rooftops", () => {
    const r = resolveDeskFromVdpUrl("https://www.cochran.com/inventory/new/123", CONTACTS);
    assert.equal(r.status, "ambiguous");
    if (r.status === "ambiguous") assert.deepEqual(r.candidates.map((c) => c.deskId), ["3", "4"]);
  });

  it("falls back to the sales email's domain when no website is on file", () => {
    const r = resolveDeskFromVdpUrl("https://www.route23automall.com/new/Ford/x.htm", CONTACTS);
    assert.equal(r.status, "unique");
    if (r.status === "unique") {
      assert.equal(r.via, "email_domain");
      assert.equal(r.desk.deskId, "5");
    }
  });

  it("never keys on a consumer mailbox domain", () => {
    const r = resolveDeskFromVdpUrl("https://gmail.com/anything", CONTACTS);
    assert.equal(r.status, "none");
  });

  it("honors host aliases, exact host first", () => {
    const a = resolveDeskFromVdpUrl("https://shop.pmbmw-wayne.net/vdp/9", CONTACTS);
    assert.equal(a.status, "unique");
    if (a.status === "unique") assert.equal(a.desk.deskId, "7");
    const b = resolveDeskFromVdpUrl("https://specials-page.paulmillerbmwnj.com/new/x", CONTACTS);
    assert.equal(b.status, "unique");
    if (b.status === "unique") assert.equal(b.via, "alias_domain");
  });

  it("does not invent a dealer for an unknown host; suggests the site name for the picker only", () => {
    const r = resolveDeskFromVdpUrl("https://www.zephyrmotorsofnowhere.com/new-2026-Ford-F-150-Howell-1FTFW1E80PFA00001", CONTACTS);
    assert.equal(r.status, "none");
    if (r.status === "none") {
      // "Howell" in the path must not bind desk 2.
      assert.equal(r.suggestedQuery, "zephyrmotorsofnowhere");
    }
  });

  it("reports a non-URL as invalid", () => {
    assert.deepEqual(resolveDeskFromVdpUrl("5UX53GP01T9190742", CONTACTS), { status: "invalid" });
  });
});
