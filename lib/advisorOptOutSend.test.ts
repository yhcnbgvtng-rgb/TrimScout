import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { withBuyerAdvisor } from "./inviteDesk";
import type { DealerDesk } from "./quotePackage";
import { noStickerNote } from "./listingFeedStickerRoute";

const optedOutNamed: DealerDesk = { dealerName: "Freedom Ford", dealerState: "NJ", contactName: "Pat Lee", role: "sales", email: "pat.lee@freedomford.com", emailDomain: "freedomford.com", source: "directory", knownNamed: true, emailOptOut: true };
const named: DealerDesk = { ...optedOutNamed, emailOptOut: false };
const base = { dealerName: "Freedom Ford", dealerState: "NJ" };

describe("opted-out dealer + the buyer's own advisor address", () => {
  it("sends to the advisor alone: never the dealership's own or opted-out address", () => {
    for (const row of [optedOutNamed, null]) {
      const d = withBuyerAdvisor(row, { ...base, providedEmail: "Jane.Doe@freedomford.com", rowOptedOut: true })!;
      assert.equal(d.email, "jane.doe@freedomford.com");
      assert.equal(d.source, "buyer");
      assert.equal(d.emailOptOut, false);
      assert.notEqual(d.email, optedOutNamed.email);
    }
  });
  it("without a usable advisor address the opt-out stands (none, blank, shared inbox)", () => {
    for (const providedEmail of [undefined, null, "", "  ", "sales@freedomford.com"]) {
      const d = withBuyerAdvisor(optedOutNamed, { ...base, providedEmail, rowOptedOut: true })!;
      assert.equal(d.emailOptOut, true, String(providedEmail));
      assert.equal(d.email, optedOutNamed.email);
    }
  });
  it("a named, not-opted-out contact keeps the request over a typed address", () => {
    assert.equal(withBuyerAdvisor(named, { ...base, providedEmail: "jane.doe@freedomford.com" })!.email, named.email);
  });
});

describe("window-sticker pending note", () => {
  it("names the vehicle's make, and the route passes the decoded vehicle's make rather than its own", () => {
    assert.match(noStickerNote("Hyundai"), /^Window sticker isn't available for Hyundai on TrimScout/);
    const src = fs.readFileSync(new URL("./listingFeedStickerRoute.ts", import.meta.url), "utf8");
    assert.match(src, /noStickerNote\(free\.vehicle\?\.make\?\.trim\(\) \|\| make\.label\)/);
  });
});
