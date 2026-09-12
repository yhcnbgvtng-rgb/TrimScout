import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactDomains, normalizeDealerHost, registrableDomain, resolveDeskFromVdpUrl, resolveDeskWithRedirect, type DeskContact } from "./deskResolve";

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
  row({ id: "7", dealerName: "Paul Miller BMW", city: "Wayne", state: "NJ", website: "https://www.paulmillerbmw.com/", domains: ["shop.pmbmw-wayne.net", "paulmillerbmwnj.com"] }),
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

  it("does not invent a dealer for an unknown host, and seeds no name search from the slug", () => {
    const r = resolveDeskFromVdpUrl("https://www.zephyrmotorsofnowhere.com/new-2026-Ford-F-150-Howell-1FTFW1E80PFA00001", CONTACTS);
    // "Howell" in the path must not bind desk 2, and "zephyrmotorsofnowhere" is not a dealer name.
    assert.deepEqual(r, { status: "none", host: "zephyrmotorsofnowhere.com" });
  });

  it("reports a non-URL as invalid", () => {
    assert.deepEqual(resolveDeskFromVdpUrl("5UX53GP01T9190742", CONTACTS), { status: "invalid" });
  });
});

// ---------------------------------------------------------------------------
// Acceptance: the live Freedom Ford case. The Iselin desk carries only the
// old site (freedomfordnj.com) in its notes; the buyer pastes the new one.
// ---------------------------------------------------------------------------
const FREEDOM_ISELIN = row({
  id: "iselin",
  dealerName: "Freedom Ford (Iselin, NJ)",
  city: "Iselin",
  state: "NJ",
  zipCode: "08830",
  notes: "Website: https://www.freedomfordnj.com/?fmccmp=t1-fd | Brand: Ford",
});
const FREEDOM_TX = row({ id: "tx", dealerName: "Freedom Ford (Greenville, TX)", city: "Greenville", state: "TX", website: "https://www.freedomfordgreenville.net/" });
const BRONCO_VDP = "https://www.freedomfordusa.com/new/Ford/2026-Ford-Bronco-1FMEE9BP9TLA88678.htm";
const noRedirect = async () => ({ finalRegistrable: null, chain: [] as string[] });

describe("Freedom Ford — domain + redirect alias", () => {
  it("contactDomains reads the website column, domains[] and the notes fallback as one key set", () => {
    assert.deepEqual(contactDomains(FREEDOM_ISELIN), ["freedomfordnj.com"]);
    assert.deepEqual(contactDomains({ ...FREEDOM_ISELIN, domains: ["www.freedomfordusa.com"] }), ["freedomfordnj.com", "freedomfordusa.com"]);
    assert.deepEqual(contactDomains({ ...FREEDOM_ISELIN, website: "https://freedomfordusa.com/", domains: ["freedomfordnj.com"] }), ["freedomfordusa.com", "freedomfordnj.com"]);
  });

  it("(1) resolves the Bronco VDP to Freedom Ford (Iselin, NJ) once the new host is in domains[]", () => {
    const r = resolveDeskFromVdpUrl(BRONCO_VDP, [FREEDOM_TX, { ...FREEDOM_ISELIN, domains: ["freedomfordusa.com"] }]);
    assert.equal(r.status, "unique");
    if (r.status === "unique") {
      assert.equal(r.desk.dealerName, "Freedom Ford (Iselin, NJ)");
      assert.equal(r.desk.city, "Iselin");
      assert.equal(r.desk.state, "NJ");
    }
  });

  it("(4) a desk that only knows freedomfordnj.com still matches freedomfordusa.com through the redirect chain", async () => {
    // The pasted host is the NEW one; nothing on file says freedomfordusa.com.
    // The origin's own redirect history is what links the two — the old host
    // 301s to the new one, so a follower of the OLD site lands on the pasted
    // host. We ask the pasted origin where it goes and also where the known
    // sites go: here the pasted origin doesn't move, so the resolver must
    // find the desk via the chain of any site that lands on it.
    const follow = async (host: string) =>
      /freedomfordnj\.com$/.test(host)
        ? { finalRegistrable: "freedomfordusa.com", chain: ["freedomfordnj.com", "freedomfordusa.com"] }
        : { finalRegistrable: null, chain: [registrableDomain(host) || host] };
    const r = await resolveDeskWithRedirect(BRONCO_VDP, [FREEDOM_TX, FREEDOM_ISELIN], () => false, follow);
    assert.equal(r.status, "unique");
    if (r.status === "unique") {
      assert.equal(r.desk.dealerName, "Freedom Ford (Iselin, NJ)");
      assert.equal(r.via, "redirect");
      assert.ok(r.aliasHosts?.includes("freedomfordusa.com") && r.aliasHosts?.includes("freedomfordnj.com"));
    }
  });

  it("(4b) the other direction: pasting the OLD host resolves through its live redirect to a desk that only knows the new one", async () => {
    const follow = async (host: string) =>
      /freedomfordnj\.com$/.test(host)
        ? { finalRegistrable: "freedomfordusa.com", chain: ["freedomfordnj.com", "freedomfordusa.com"] }
        : { finalRegistrable: null, chain: [registrableDomain(host) || host] };
    const onlyNew = { ...FREEDOM_ISELIN, notes: null, website: "https://www.freedomfordusa.com/" };
    const r = await resolveDeskWithRedirect("https://www.freedomfordnj.com/new/Ford/x.htm", [FREEDOM_TX, onlyNew], () => false, follow);
    assert.equal(r.status, "unique");
    if (r.status === "unique") assert.equal(r.via, "redirect");
  });

  it("(3) an unknown host with no redirect stays not-found, and carries no name seed", async () => {
    const r = await resolveDeskWithRedirect("https://www.zephyrmotorsofnowhere.com/new/x", [FREEDOM_TX, FREEDOM_ISELIN], () => false, noRedirect);
    assert.deepEqual(r, { status: "none", host: "zephyrmotorsofnowhere.com" });
  });

  it("never lets the path's brand words bind: a Ford VDP on an unknown host does not become Freedom Ford", async () => {
    const r = await resolveDeskWithRedirect("https://www.somewhere.example/new/Ford/Freedom-Ford-Iselin-1FMEE9BP9TLA88678", [FREEDOM_ISELIN], () => false, noRedirect);
    assert.equal(r.status, "none");
  });
});
