/** Nov 1 SAFE MODE buyer test: wiring checks for the wizard cap, the dealer quote sheet and the trade draft poll. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const wizard = read("components/BiddingWizard.tsx");
const sheet = read("components/UsedQuoteForm.tsx");
const rfqsRoute = read("app/api/rfqs/route.ts");
const invitesRoute = read("app/api/rfqs/[id]/invites/route.ts");
const hook = read("components/trade/useTradeDraft.ts");

describe("invite cap: one rule on both sides", () => {
  it("the invites route and GET /api/rfqs compute the cap the same way, test mode included", () => {
    for (const src of [rfqsRoute, invitesRoute]) {
      assert.match(src, /reputationInviteCap\(buyerRfqStrikeCount\(.*\{ testMode: isBuyerTestMode\(/);
    }
    assert.match(rfqsRoute, /inviteCap/);
  });
  it("the wizard never promises more dealerships than the cap lets through", () => {
    assert.match(wizard, /Math\.min\(confirmedOrImportedCount, inviteCap\)/);
    assert.match(wizard, /limit \$\{inviteCap\} per request/);
  });
});

describe("dealer quote sheet", () => {
  it("% of MSRP is the selling price over MSRP, without the doc fee", () => {
    assert.match(sheet, /const pctOfMsrp = sellingPrice != null && msrpNum != null && msrpNum > 0 \? Math\.round\(\(sellingPrice \/ msrpNum\) \* 1000\) \/ 10 : null;/);
    const price = 38_500, doc = 400, msrp = 42_900;
    assert.equal(Math.round((price / msrp) * 1000) / 10, 89.7);
    assert.notEqual(Math.round(((price + doc) / msrp) * 1000) / 10, 89.7);
  });
  it("a failed submit scrolls to and focuses the problem, inside a live region", () => {
    assert.match(sheet, /role="alert" aria-live="assertive"/);
    assert.match(sheet, /scrollIntoView/);
    assert.match(sheet, /target\.focus/);
    assert.match(sheet, /data-testid="no-add-ons"/);
    assert.match(sheet, /if \(errors\.length\) \{ setSubmitAttempt/);
  });
});

describe("trade draft polling", () => {
  it("uses the backoff, pauses when the tab is hidden and stops once sent", () => {
    assert.match(hook, /nextPollDelay\(quiet\)/);
    assert.match(hook, /visibilitychange/);
    assert.match(hook, /\|\| sent\) return/);
    assert.doesNotMatch(hook, /setInterval/);
  });
});
