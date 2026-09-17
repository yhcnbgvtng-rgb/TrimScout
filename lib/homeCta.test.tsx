// Buyer QA 2026-09-16: the header / hero "Request a Quote" CTAs didn't open Configure Quote Request
// (the header one only switched to the intro view — a no-op when already there); the tracker's
// empty-state button did. Every CTA now goes through one opener with its placement logged.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { TRACKED_EVENTS, quoteCtaProps } from "./analytics";

describe("Request a Quote CTAs — one wizard, every placement", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("IS_REACT_ACT_ENVIRONMENT", true);
    // next/link reads `self` at module load.
    define("self", dom.window);
  });
  after(() => dom.window.close());

  it("header, mobile-menu, hero and intro-footer buttons call the opener with their placement — never a view switch", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { Navbar } = await import("../components/Navbar");
    const { BidProgramIntro } = await import("../components/BidProgramIntro");

    const opened: string[] = [];
    const toggled: string[] = [];
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Navbar, { user: null, activeDealCount: 0, currentView: "bid_program", onToggleView: (v: string) => toggled.push(v), onRequestQuote: (p: string) => opened.push(p), onOpenAuthModal: () => {}, onLogout: () => {} }),
          React.createElement(BidProgramIntro, { onStartWizard: (p: string) => opened.push(p), onViewDemoDealRoom: () => {} })
        )
      );
    });
    const doc = dom.window.document;
    const click = async (testId: string) => {
      const el = doc.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
      assert.ok(el, `${testId} on screen`);
      await act(async () => { el!.click(); });
    };
    await click("cta-request-quote-header");
    await click("cta-request-quote-hero");
    await click("cta-request-quote-intro-footer");
    // The mobile drawer CTA appears once the drawer is open.
    const toggle = Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => /menu/i.test(b.getAttribute("aria-label") || ""));
    if (toggle) {
      await act(async () => { toggle.click(); });
      await click("cta-request-quote-mobile");
      assert.deepEqual(opened, ["header", "hero", "intro_footer", "mobile_menu"]);
    } else {
      assert.deepEqual(opened, ["header", "hero", "intro_footer"]);
    }
    assert.deepEqual(toggled, [], "a Request a Quote CTA never just switches views");
    await act(async () => { root.unmount(); });
  });

  it("page.tsx routes every placement through requestQuoteFromCta → the same wizard opener, with the analytics event", () => {
    const page = fs.readFileSync("app/page.tsx", "utf8");
    assert.match(page, /const requestQuoteFromCta = \(placement: QuoteCtaPlacement\) => \{\s*trackEvent\("cta_request_quote_click", quoteCtaProps\(placement, Boolean\(currentUser\)\)\);\s*handleOpenFlexibleWizard\(\);/);
    assert.match(page, /onRequestQuote=\{\(placement\) => requestQuoteFromCta\(placement\)\}/, "header CTA");
    assert.match(page, /onStartWizard=\{\(placement\) => requestQuoteFromCta\(placement\)\}/, "hero + intro footer");
    assert.match(page, /onStartNewBid=\{\(\) => requestQuoteFromCta\("tracker_empty"\)\}/, "tracker empty state");
    // The wizard is mounted at the page level, so it opens over any view — no route change needed.
    assert.match(page, /<BiddingWizard\s+key=\{wizardSession\}\s+isOpen=\{isWizardOpen\}/);
    const tracker = fs.readFileSync("components/DealTrackerDashboard.tsx", "utf8");
    assert.match(tracker, /data-testid="cta-request-quote-tracker-empty"/);
    assert.ok((TRACKED_EVENTS as readonly string[]).includes("cta_request_quote_click"));
    assert.deepEqual(quoteCtaProps("hero", false), { placement: "hero", signedIn: false });
  });

  it("logged-out path is documented in code: guest walks Step 1, the sign-in gate is at Send and the draft survives it", () => {
    const wizard = fs.readFileSync("components/BiddingWizard.tsx", "utf8");
    assert.match(wizard, /if \(!currentUser\) \{[\s\S]*?setSubmitError\("Sign in as a buyer to send this request — your vehicle, preferences and dealers stay as they are\."\);\s*openAuth\("sign_in"\);/);
  });
});
