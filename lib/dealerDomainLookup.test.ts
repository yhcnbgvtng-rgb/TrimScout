import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dealershipDomain,
  domainCandidates,
  hostnameFromUrl,
  identityFromDealership,
  indexDealershipsByDomain,
  matchDealershipByUrl,
  normalizeDomain,
  websiteFromNotes,
} from "./dealerDomainLookup";

const DIRECTORY = [
  {
    dealerName: "Lou Bachrodt BMW",
    city: "Rockford",
    state: "IL",
    zipCode: "61108",
    notes: "Title: General Manager | Website: https://www.loubachrodtbmw.com/ | Source: https://www.loubachrodtbmw.com/staff/ | Brand: BMW",
  },
  {
    dealerName: "Paul Miller BMW",
    city: "Wayne",
    state: "NJ",
    zipCode: "07470",
    notes: "Website: https://www.paulmillerbmw.com/",
  },
  // A group that runs two rooftops off one site — only the state can tell them apart.
  { dealerName: "Cochran Chevrolet", city: "Zelienople", state: "PA", zipCode: "16063", notes: "Website: https://www.cochran.com/" },
  { dealerName: "Cochran Chevrolet of Ohio", city: "Youngstown", state: "OH", zipCode: "44512", notes: "Website: https://www.cochran.com/" },
  { dealerName: "No Site Motors", city: "Nowhere", state: "KS", zipCode: null, notes: "unreachable - 403" },
  { dealerName: "Column Motors", city: "Austin", state: "TX", zipCode: null, notes: null, website: "https://columnmotors.com" },
];

describe("hostnameFromUrl / normalizeDomain", () => {
  it("strips scheme, path, port and www", () => {
    assert.equal(hostnameFromUrl("https://www.loubachrodtbmw.com/new-Rockford-2026-BMW-X3-5UX53GP01T9190742"), "loubachrodtbmw.com");
    assert.equal(hostnameFromUrl("http://WWW.Example.COM:8080/x?y=1"), "example.com");
    assert.equal(hostnameFromUrl("inventory.example.com/vdp"), "inventory.example.com");
  });
  it("rejects non-URLs", () => {
    assert.equal(hostnameFromUrl(""), null);
    assert.equal(hostnameFromUrl("5UX53GP01T9190742"), null);
    assert.equal(normalizeDomain("localhost"), null);
  });
});

describe("websiteFromNotes / dealershipDomain", () => {
  it("reads the crawl's Website: field out of the pipe-separated notes", () => {
    assert.equal(websiteFromNotes(DIRECTORY[0].notes), "https://www.loubachrodtbmw.com/");
    assert.equal(websiteFromNotes("no site here"), null);
    assert.equal(websiteFromNotes(null), null);
  });
  it("prefers a real website column when one exists", () => {
    assert.equal(dealershipDomain(DIRECTORY[5]), "columnmotors.com");
    assert.equal(dealershipDomain(DIRECTORY[4]), null);
  });
});

describe("domainCandidates", () => {
  it("tries the exact host, then each parent down to the registrable domain", () => {
    assert.deepEqual(domainCandidates("www.inventory.example.com"), ["inventory.example.com", "example.com"]);
    assert.deepEqual(domainCandidates("example.com"), ["example.com"]);
    assert.deepEqual(domainCandidates("nope"), []);
  });
});

describe("matchDealershipByUrl", () => {
  it("names the rooftop from a VDP link's hostname", () => {
    const row = matchDealershipByUrl(DIRECTORY, "https://www.loubachrodtbmw.com/new-Rockford-2026-BMW-X3-30+xDrive-5UX53GP01T9190742");
    assert.equal(row?.dealerName, "Lou Bachrodt BMW");
  });
  it("matches an inventory subdomain to the dealer's main site", () => {
    assert.equal(matchDealershipByUrl(DIRECTORY, "https://inventory.paulmillerbmw.com/new/x")?.dealerName, "Paul Miller BMW");
  });
  it("won't guess between two rooftops on one shared site without a state", () => {
    assert.equal(matchDealershipByUrl(DIRECTORY, "https://www.cochran.com/inventory/new"), null);
    assert.equal(matchDealershipByUrl(DIRECTORY, "https://www.cochran.com/inventory/new", { state: "oh" })?.dealerName, "Cochran Chevrolet of Ohio");
  });
  it("returns null for a site nobody in the directory owns", () => {
    assert.equal(matchDealershipByUrl(DIRECTORY, "https://www.cars.com/vehicledetail/123"), null);
    assert.equal(matchDealershipByUrl(DIRECTORY, "not a url"), null);
  });
  it("indexes a directory instance once", () => {
    assert.equal(indexDealershipsByDomain(DIRECTORY), indexDealershipsByDomain(DIRECTORY));
    assert.equal(indexDealershipsByDomain(DIRECTORY).get("cochran.com")?.length, 2);
  });
});

describe("identityFromDealership", () => {
  it("produces the page-identity shape, tagged as coming from the directory", () => {
    assert.deepEqual(identityFromDealership(DIRECTORY[0]), {
      name: "Lou Bachrodt BMW",
      city: "Rockford",
      state: "IL",
      zip: "61108",
      source: "directory_domain",
    });
  });
});
