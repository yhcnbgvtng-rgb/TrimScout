import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dealerReference, DEALER_REFERENCE_PATTERN } from "./dealerReference";

describe("dealer-facing reference — never the buyer's number, different on every request", () => {
  it("is stable for one invite, differs across invites and requests, and never looks like a TS- deal number", () => {
    const a = dealerReference("17", "14", "k");
    assert.equal(a, dealerReference("17", "14", "k"));
    assert.match(a, DEALER_REFERENCE_PATTERN);
    assert.notEqual(a, dealerReference("17", "15", "k"), "second desk on the same request sees a different number");
    assert.notEqual(a, dealerReference("18", "14", "k"), "same desk on another request sees a different number");
    assert.notEqual(a, dealerReference("17", "14", "other-secret"), "keyed on the server secret");
    assert.doesNotMatch(a, /^TS-/);
  });
  it("wiring: the dealer email, counter email and dealer page carry the dealer reference; the buyer's TS- number never reaches a dealer", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    for (const f of ["lib/inviteOutbox.ts", "app/api/rfqs/[id]/invites/[inviteId]/counter/route.ts", "app/api/quote-invite/context/route.ts"]) {
      const src = read(f);
      assert.match(src, /dealerReference\(/, f);
      assert.doesNotMatch(src, /dealReference: rfq\.dealReference/, `${f} must not hand the buyer's number to the dealer`);
    }
    assert.doesNotMatch(read("app/quote-request/received/page.tsx"), /rfq\.dealReference|dealReference: rfq/);
  });
});
