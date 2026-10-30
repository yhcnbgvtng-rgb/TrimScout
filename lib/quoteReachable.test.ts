import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyContactEmail,
  contactEmailWriteProblem,
  isQuoteReachable,
  reachabilityBucket,
  stampGroupDomains,
} from "./quoteReachable";

// Fixtures mirror the patterns the 2026-10-30 "Sales email on file" audit found in the live directory (names and domains are the
// real shapes; the mailbox owners are invented).
const lafontaine = { dealerName: "LaFontaine Chrysler Dodge Jeep Ram of Walled Lake", website: "https://www.lafontainecdjrwalledlake.com", domains: ["lafontainecdjrwalledlake.com"] };

describe("contactEmailWriteProblem — what may never be stored", () => {
  it("refuses the department mailboxes", () => {
    for (const box of ["accessibility", "info", "contact", "customerservice", "customer.service", "bdc", "parts", "service", "noreply", "no-reply", "Customer_Service"]) {
      assert.match(contactEmailWriteProblem(`${box}@lafontaine.com`) || "", /department mailbox/, box);
    }
  });

  it("refuses OEM, lead-vendor and placeholder domains, subdomains included", () => {
    for (const d of ["hmausa.com", "leadcrm.com", "eleadtrack.net", "dealeremail.com", "newsales.leads.cmdlr.com", "crm.eautodealerhub.com"]) {
      assert.match(contactEmailWriteProblem(`jdoe@${d}`) || "", /vendor or manufacturer domain/, d);
    }
  });

  it("refuses scraped file names and malformed addresses", () => {
    assert.match(contactEmailWriteProblem("logo@2x.png") || "", /file name/);
    assert.match(contactEmailWriteProblem("ruben@houstonhyundai") || "", /not a valid/);
    assert.match(contactEmailWriteProblem("a@b.com; c@d.com") || "", /not a valid/);
    assert.match(contactEmailWriteProblem("two words@dealer.com") || "", /not a valid/);
  });

  it("lets blank, ordinary and merely-unverified addresses through", () => {
    assert.equal(contactEmailWriteProblem(""), null);
    assert.equal(contactEmailWriteProblem("   "), null);
    assert.equal(contactEmailWriteProblem(null), null);
    assert.equal(contactEmailWriteProblem("jdoe@lafontaine.com"), null);
    assert.equal(contactEmailWriteProblem("sales@lafontaine.com"), null);
    assert.equal(contactEmailWriteProblem("someone@gmail.com"), null); // unverified, not invalid
  });
});

describe("classifyContactEmail", () => {
  it("valid: the mail domain belongs to the store's site, even when it is not identical", () => {
    assert.equal(classifyContactEmail({ ...lafontaine, contactEmail: "jdoe@lafontaine.com" }).status, "valid");
    // 6+ shared leading letters: capitolauto.com vs capitolsubaru.com, dutchmillerauto.com vs dutchmillerclt.com
    assert.equal(classifyContactEmail({ dealerName: "Capitol Subaru of Salem", website: "capitolsubaru.com", contactEmail: "t@capitolauto.com" }).status, "valid");
    assert.equal(classifyContactEmail({ dealerName: "Dutch Miller Kia – Charlotte", domains: ["dutchmillerclt.com"], contactEmail: "t@dutchmillerauto.com" }).status, "valid");
    assert.equal(classifyContactEmail({ dealerName: "RUSSELL & SMITH MAZDA", website: "russellsmithmazda.com", contactEmail: "t@russellsmith.com" }).status, "valid");
    // a distinctive word from the name when no site is on file
    assert.equal(classifyContactEmail({ dealerName: "Lexus of Route 10", contactEmail: "eruby@lexusofroute10.com" }).status, "valid");
  });

  it("valid: a generic sales inbox on the store's domain is still reachable", () => {
    assert.equal(isQuoteReachable({ ...lafontaine, contactEmail: "leads@lafontaine.com" }), true);
  });

  it("invalid: accessibility@hmausa.com on a Hyundai store (stored on 111 rooftops)", () => {
    const c = classifyContactEmail({ dealerName: "Autoplex Hyundai", website: "autoplex-tx.com", contactEmail: "accessibility@hmausa.com" });
    assert.equal(c.status, "invalid");
    assert.equal(isQuoteReachable({ dealerName: "Autoplex Hyundai", website: "autoplex-tx.com", contactEmail: "accessibility@hmausa.com" }), false);
  });

  it("invalid: lead-vendor domain, scraped .png, department inbox, no TLD", () => {
    assert.equal(classifyContactEmail({ dealerName: "Ford of Lafayette", contactEmail: "s@leadcrm.com" }).status, "invalid");
    assert.equal(classifyContactEmail({ dealerName: "Ford of Lafayette", contactEmail: "logo@2x.png" }).status, "invalid");
    assert.equal(classifyContactEmail({ dealerName: "Ford of Lafayette", contactEmail: "info@fordoflafayette.com" }).status, "invalid");
    assert.equal(classifyContactEmail({ dealerName: "Houston Hyundai", contactEmail: "ruben@houstonhyundai" }).status, "invalid");
  });

  it("unverified: public mail, and a domain nothing ties to the store", () => {
    const pub = classifyContactEmail({ ...lafontaine, contactEmail: "jdoe@gmail.com" });
    assert.deepEqual(pub, { status: "unverified", reason: "public_domain" });
    const unrelated = classifyContactEmail({ dealerName: "Nissan of Serramonte", website: "nissanofserramonte.com", contactEmail: "jdoe@goldenstatenissan.com" });
    assert.deepEqual(unrelated, { status: "unverified", reason: "unrelated_domain" });
    assert.equal(isQuoteReachable({ dealerName: "Nissan of Serramonte", website: "nissanofserramonte.com", contactEmail: "jdoe@goldenstatenissan.com" }), false);
  });

  it("valid: the same unrelated domain once 2+ rooftops share it (a dealer group's own)", () => {
    const rows = ["Blue Ribbon Chevrolet Buick GMC", "Elm Street Honda", "Pine Valley Toyota"].map((dealerName) => ({ dealerName, website: "somethingelse.com", contactEmail: "jdoe@rothbardmotors.com" }));
    const stamped = stampGroupDomains(rows);
    assert.ok(stamped.every((r) => r.emailInGroupDomain));
    assert.ok(stamped.every((r) => isQuoteReachable(r)));
    // a lone rooftop on a domain is not a group
    const one = stampGroupDomains(rows.slice(0, 1));
    assert.ok(one.every((r) => !r.emailInGroupDomain && !isQuoteReachable(r)));
    // and a vendor or public domain never becomes a "group" however many rows use it
    const hm = stampGroupDomains(Array.from({ length: 5 }, (_, i) => ({ dealerName: `Hyundai ${i}`, contactEmail: "x@hmausa.com" })));
    assert.ok(hm.every((r) => !r.emailInGroupDomain));
    const gm = stampGroupDomains(Array.from({ length: 5 }, (_, i) => ({ dealerName: `Dealer ${i}`, contactEmail: "x@gmail.com" })));
    assert.ok(gm.every((r) => !r.emailInGroupDomain));
  });

  it("none: blank, whitespace, null", () => {
    for (const contactEmail of ["", "   ", null, undefined]) assert.equal(classifyContactEmail({ ...lafontaine, contactEmail }).status, "none");
  });

  it("an unsubscribed dealer is never reachable", () => {
    const c = { ...lafontaine, contactEmail: "jdoe@lafontaine.com", emailOptOut: true };
    assert.equal(isQuoteReachable(c), false);
    assert.equal(reachabilityBucket(c), "none");
  });

  it("buckets: reachable / unverified / none", () => {
    assert.equal(reachabilityBucket({ ...lafontaine, contactEmail: "jdoe@lafontaine.com" }), "reachable");
    assert.equal(reachabilityBucket({ ...lafontaine, contactEmail: "jdoe@gmail.com" }), "unverified");
    assert.equal(reachabilityBucket({ ...lafontaine, contactEmail: "accessibility@hmausa.com" }), "none");
    assert.equal(reachabilityBucket({ ...lafontaine, contactEmail: "" }), "none");
  });
});
