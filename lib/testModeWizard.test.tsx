// Buyer test mode in the quote wizard: only a session flagged testMode (server-derived) sees the test bar and its
// "Walk away from all my test requests" button, is treated as a buyer whatever its role, and gets no
// one-active-request notice. A real buyer sees none of it. Pressing the button posts to the test-mode route.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

describe("quote wizard in buyer test mode", () => {
  let dom: JSDOM;
  const calls: { url: string; method?: string }[] = [];
  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("fetch", async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method });
      const body = String(url).includes("/api/test-mode/walk-all") ? { walked: 2, failed: 0 } : String(url) === "/api/rfqs" ? { rfqs: [{ id: "9", status: "collecting", dealReference: "TS-P3PEMS" }] } : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());

  const mount = async (currentUser: { role: string; testMode?: boolean } | null) => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");
    const { BuyerAccessProvider } = await import("../components/BuyerAccessProvider");
    const el = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(React.createElement(BuyerAccessProvider, { requireLogin: true, children: React.createElement(BiddingWizard, { isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, currentUser: currentUser as never, onRequireLogin: () => {} }) }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return { el, act, unmount: () => act(async () => { root.unmount(); }) };
  };

  it("a test-mode account sees the bar, is not told to sign in as a buyer, and gets no one-request notice", async () => {
    const m = await mount({ role: "admin", testMode: true });
    assert.ok(m.el.querySelector('[data-testid="test-mode-bar"]'));
    assert.match(m.el.querySelector('[data-testid="test-mode-walk-all"]')?.textContent ?? "", /Walk away from all my test requests/);
    assert.doesNotMatch(m.el.querySelector('[data-testid="wizard-auth"]')?.textContent ?? "", /Sign in as buyer/);
    assert.equal(m.el.querySelector('[data-testid="active-request-notice"]'), null);
    await m.unmount();
  });

  it("the button posts to the test-mode route and reports how many were walked", async () => {
    const m = await mount({ role: "admin", testMode: true });
    const btn = m.el.querySelector('[data-testid="test-mode-walk-all"]') as HTMLButtonElement;
    await m.act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); });
    assert.ok(calls.some((c) => c.url === "/api/test-mode/walk-all" && c.method === "POST"));
    assert.match(m.el.querySelector('[data-testid="test-mode-note"]')?.textContent ?? "", /Walked away from 2 test requests/);
    await m.unmount();
  });

  it("a real buyer sees no test bar, and still gets the one-request notice", async () => {
    const m = await mount({ role: "buyer" });
    assert.equal(m.el.querySelector('[data-testid="test-mode-bar"]'), null);
    assert.equal(m.el.querySelector('[data-testid="test-mode-walk-all"]'), null);
    assert.ok(m.el.querySelector('[data-testid="active-request-notice"]'));
    await m.unmount();
  });

  it("an admin without test mode is still told to sign in as a buyer, and no test bar", async () => {
    const m = await mount({ role: "admin" });
    assert.equal(m.el.querySelector('[data-testid="test-mode-bar"]'), null);
    assert.match(m.el.querySelector('[data-testid="wizard-auth"]')?.textContent ?? "", /Sign in as buyer/);
    await m.unmount();
  });
});
