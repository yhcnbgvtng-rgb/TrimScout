// "You must be signed in as a buyer." leads somewhere: a Sign in link to the buyer sign-in with a callbackUrl back to the same
// page (and selected dealer if it is in the URL); a signed-in dealer is told so and offered "Sign in as a buyer" instead.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buyerSignInHref, buyerSignInMode, currentCallbackUrl, isBuyerOnlyMessage, safeCallbackUrl } from "./buyerSignIn";
import { BuyerSignInLink } from "../components/BuyerSignInLink";
import { DealThreadPanel } from "../components/DealThreadPanel";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const MSG = "You must be signed in as a buyer.";

describe("link target and callbackUrl", () => {
  it("goes to the home sign-in with the page as an encoded callbackUrl", () => {
    assert.equal(buyerSignInHref("/rfq/17"), "/?login=1&callbackUrl=%2Frfq%2F17");
  });
  it("keeps the selected dealer conversation when it is in the URL", () => {
    const back = currentCallbackUrl("/rfq/17", "?dealer=3");
    assert.equal(back, "/rfq/17?dealer=3");
    assert.equal(buyerSignInHref(back), "/?login=1&callbackUrl=%2Frfq%2F17%3Fdealer%3D3");
  });
  it("is just the path when there is no query", () => assert.equal(currentCallbackUrl("/rfq/17", ""), "/rfq/17"));
  it("refuses off-site and malformed callbackUrls", () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "/\\evil", "rfq/17", "", null, undefined, "/a\nb"]) {
      assert.equal(safeCallbackUrl(bad as string), null, String(bad));
      assert.equal(buyerSignInHref(bad as string), "/?login=1");
    }
  });
});

describe("message detection and role mode", () => {
  it("matches every buyer-only wording", () => {
    for (const m of [MSG, "You must be signed in as a buyer to send an RFQ.", "You must be signed in as a buyer to submit a request."]) assert.ok(isBuyerOnlyMessage(m));
    assert.ok(!isBuyerOnlyMessage("Could not load the conversation."));
    assert.ok(!isBuyerOnlyMessage(null));
  });
  it("signed out or unknown: sign in; any other role: switch account", () => {
    assert.equal(buyerSignInMode(null), "sign_in");
    assert.equal(buyerSignInMode(undefined), "sign_in");
    assert.equal(buyerSignInMode("buyer"), "sign_in");
    assert.equal(buyerSignInMode("dealer"), "switch_account");
    assert.equal(buyerSignInMode("admin"), "switch_account");
  });
});

describe("BuyerSignInLink", () => {
  it("renders nothing for other messages", () => {
    assert.equal(renderToStaticMarkup(<BuyerSignInLink message="Could not load." role={null} returnTo="/rfq/17" />), "");
  });
  it("signed out: a plain Sign in link to the buyer sign-in page, back to this RFQ", () => {
    const html = renderToStaticMarkup(<BuyerSignInLink message={MSG} role={null} returnTo="/rfq/17?dealer=3" />);
    assert.match(html, /href="\/\?login=1&amp;callbackUrl=%2Frfq%2F17%3Fdealer%3D3"/);
    assert.match(html, />Sign in</);
    assert.doesNotMatch(html, /signed in as a/i);
  });
  it("signed in as a dealer: says so and offers Sign in as a buyer with the same target", () => {
    const html = renderToStaticMarkup(<BuyerSignInLink message={MSG} role="dealer" returnTo="/rfq/17" />);
    assert.match(html, /You(?:'|&#x27;)re signed in as a dealer\./);
    assert.match(html, />Sign in as a buyer</);
    assert.match(html, /href="\/\?login=1&amp;callbackUrl=%2Frfq%2F17"/);
  });
});

describe("the RFQ dealer conversation panel", () => {
  it("shows the link inside the existing warning styling when the thread says buyer-only", () => {
    // The warning is set after a failed load, so assert the wiring and the unchanged class list in source.
    const src = read("components/DealThreadPanel.tsx");
    assert.match(src, /text-\[11px\] text-amber-200">\{error\}<BuyerSignInLink message=\{error\} role=\{signedInRole\} \/><\/p>/);
    assert.match(src, /\{sendError\}<BuyerSignInLink message=\{sendError\} role=\{signedInRole\} \/>/);
    const html = renderToStaticMarkup(<DealThreadPanel endpoint="/x" viewer="buyer" seenKey="k" heading="Alpha" signedInRole="dealer" initial={{ viewer: "buyer", entries: [], canPost: false, readOnlyReason: null, finalAccepted: false, messaging: true, otherParty: "Alpha" }} />);
    assert.ok(html.includes("deal-thread"));
  });
  it("the RFQ page passes the session role to the panel", () => {
    assert.match(read("app/rfq/[id]/page.tsx"), /signedInRole=\{sessionStatus === "authenticated"/);
  });
});

describe("the sign-in page honours callbackUrl", () => {
  it("home reads login + callbackUrl, validates it, and returns there after sign-in", () => {
    const home = read("app/page.tsx");
    assert.match(home, /safeCallbackUrl\(params\.get\("callbackUrl"\)\)/);
    assert.match(home, /onSignedIn=\{\(\) => \{ if \(signInCallbackUrl\) window\.location\.assign\(signInCallbackUrl\)/);
    assert.match(read("components/AuthModal.tsx"), /callbackUrl: callbackUrl \|\| "\/"/);
  });
  it("every client surface that shows a buyer-only API error carries the link", () => {
    for (const f of ["components/StagedDeals.tsx", "components/AddTradeInPrompt.tsx", "components/RfqInviteDraft.tsx", "components/DealEngagementPanel.tsx", "components/LeaseQuoteSheet.tsx", "components/trade/BuyerTradeConfirm.tsx", "app/rfq/[id]/page.tsx"]) {
      assert.match(read(f), /<BuyerSignInLink message=/, f);
    }
  });
});
