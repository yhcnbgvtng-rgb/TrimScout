import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchDirectoryDealership,
  formatDealershipAddress,
  dealerContactStatus,
  isPlausibleDealerEmail,
  type DirectoryDealership,
} from "./dealerContactLookup";

function row(over: Partial<DirectoryDealership> = {}): DirectoryDealership {
  return {
    dealerName: "Route 23 Auto Mall",
    address: "1301 Route 23 South",
    city: "Butler",
    state: "NJ",
    zipCode: "07405",
    phone: "973-555-0100",
    contactEmail: "sales@route23.example",
    emailOptOut: false,
    ...over,
  };
}

describe("matchDirectoryDealership", () => {
  it("matches through punctuation and suffix differences", () => {
    const dir = [row({ dealerName: "Route 23 Auto Mall, LLC" })];
    assert.ok(matchDirectoryDealership(dir, { dealerName: "route 23 auto mall" }));
  });

  it("prefers the row in the vehicle's own state when a name repeats", () => {
    const dir = [
      row({ state: "PA", city: "Easton", contactEmail: "pa@example.com" }),
      row({ state: "NJ", city: "Butler", contactEmail: "nj@example.com" }),
    ];
    const match = matchDirectoryDealership(dir, { dealerName: "Route 23 Auto Mall", state: "nj" });
    assert.equal(match?.contactEmail, "nj@example.com");
  });

  it("falls back to the first row when no state matches", () => {
    const dir = [row({ state: "PA", contactEmail: "pa@example.com" })];
    const match = matchDirectoryDealership(dir, { dealerName: "Route 23 Auto Mall", state: "NJ" });
    assert.equal(match?.contactEmail, "pa@example.com");
  });

  it("returns null for an unknown or empty name", () => {
    assert.equal(matchDirectoryDealership([row()], { dealerName: "Nowhere Motors" }), null);
    assert.equal(matchDirectoryDealership([row()], { dealerName: "   " }), null);
  });
});

describe("formatDealershipAddress", () => {
  it("builds a full single-line address", () => {
    assert.equal(
      formatDealershipAddress(row()),
      "1301 Route 23 South, Butler, NJ 07405"
    );
  });

  it("skips the parts a row is missing instead of leaving stray punctuation", () => {
    assert.equal(formatDealershipAddress(row({ address: null })), "Butler, NJ 07405");
    assert.equal(formatDealershipAddress(row({ zipCode: null })), "1301 Route 23 South, Butler, NJ");
    assert.equal(
      formatDealershipAddress(row({ address: null, city: null, zipCode: null })),
      "NJ"
    );
  });

  it("is null when there is nothing to show at all", () => {
    assert.equal(
      formatDealershipAddress(row({ address: null, city: null, state: null, zipCode: null })),
      null
    );
    assert.equal(formatDealershipAddress(null), null);
  });
});

describe("dealerContactStatus", () => {
  it("reports a reachable dealer without ever exposing the address", () => {
    const status = dealerContactStatus([row()], { dealerName: "Route 23 Auto Mall", state: "NJ" });
    assert.equal(status.matched, true);
    assert.equal(status.hasEmail, true);
    assert.equal(status.emailOptOut, false);
    assert.equal(status.addressLine, "1301 Route 23 South, Butler, NJ 07405");
    // The buyer is told whether we can reach the dealer, never how.
    assert.equal((status as unknown as Record<string, unknown>).contactEmail, undefined);
    assert.equal(JSON.stringify(status).includes("sales@route23.example"), false);
  });

  it("separates 'no directory row' from 'row with no email'", () => {
    const missing = dealerContactStatus([row()], { dealerName: "Nowhere Motors" });
    assert.equal(missing.matched, false);
    assert.equal(missing.hasEmail, false);

    const noEmail = dealerContactStatus([row({ contactEmail: null })], {
      dealerName: "Route 23 Auto Mall",
    });
    assert.equal(noEmail.matched, true);
    assert.equal(noEmail.hasEmail, false);
    assert.equal(noEmail.addressLine, "1301 Route 23 South, Butler, NJ 07405");
  });

  it("treats a blank email string as no email", () => {
    const status = dealerContactStatus([row({ contactEmail: "   " })], {
      dealerName: "Route 23 Auto Mall",
    });
    assert.equal(status.hasEmail, false);
  });

  it("surfaces an unsubscribed dealer as opted out", () => {
    const status = dealerContactStatus([row({ emailOptOut: true })], {
      dealerName: "Route 23 Auto Mall",
    });
    assert.equal(status.hasEmail, true);
    assert.equal(status.emailOptOut, true);
  });
});

describe("isPlausibleDealerEmail", () => {
  it("accepts an ordinary address", () => {
    assert.equal(isPlausibleDealerEmail("sales@route23.com"), true);
    assert.equal(isPlausibleDealerEmail("  first.last@dealer.co.uk  "), true);
  });

  it("rejects the shapes a buyer is most likely to paste by mistake", () => {
    assert.equal(isPlausibleDealerEmail(""), false);
    assert.equal(isPlausibleDealerEmail("sales"), false);
    assert.equal(isPlausibleDealerEmail("sales@dealer"), false);
    assert.equal(isPlausibleDealerEmail("a b@dealer.com"), false);
    assert.equal(isPlausibleDealerEmail("two@@dealer.com"), false);
    assert.equal(isPlausibleDealerEmail("https://dealer.com/contact"), false);
  });
});
