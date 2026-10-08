// REQUIRE_BUYER_LOGIN in the quote wizard: with login required a signed-out visitor sees Sign in / Sign up
// in the wizard header; with it off, no sign-in prompt appears (the email field on the last step takes over).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

describe("quote wizard header auth links", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("fetch", async () => new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } }));
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());

  const render = async (requireLogin: boolean, currentUser: { role: string } | null): Promise<string> => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");
    const { BuyerAccessProvider } = await import("../components/BuyerAccessProvider");
    const el = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        React.createElement(
          BuyerAccessProvider,
          { requireLogin, children: React.createElement(BiddingWizard, { isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, currentUser: currentUser as never, onRequireLogin: () => {} }) },
        ),
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const text = el.querySelector('[data-testid="wizard-auth"]')?.textContent ?? "";
    await act(async () => { root.unmount(); });
    return text;
  };

  it("flag ON (default): signed-out visitors are offered Sign in / Sign up", async () => {
    const text = await render(true, null);
    assert.match(text, /Sign in/);
    assert.match(text, /Sign up/);
  });

  it("flag OFF: signed-out visitors see no sign-in or sign-up prompt in the wizard", async () => {
    const text = await render(false, null);
    assert.doesNotMatch(text, /Sign in|Sign up/);
  });

  it("flag OFF: a signed-in dealer is still told to sign in as a buyer", async () => {
    const text = await render(false, { role: "dealer" });
    assert.match(text, /Sign in as buyer/);
  });
});
