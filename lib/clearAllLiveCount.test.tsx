// /search: "Clear all" resets the applied search and its results together with the filters, and the headline count's eased value
// stays between its two ends (never negative, never past the real total).
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { easedCount } from "../components/search/LiveCount";

describe("easedCount", () => {
  it("runs from start to target", () => {
    assert.equal(easedCount(10, 100, 0), 10);
    assert.equal(easedCount(10, 100, 1), 100);
    assert.equal(easedCount(100, 10, 1), 10);
    const mid = easedCount(10, 100, 0.5);
    assert.ok(mid > 10 && mid < 100);
  });
  it("a negative progress (frame timestamp before the start time) cannot push it below the start or below 0", () => {
    for (const p of [-0.01, -0.1, -1, -50]) {
      assert.equal(easedCount(3, 1000, p), 3);
      assert.equal(easedCount(0, 500, p), 0);
    }
  });
  it("progress past 1 cannot overshoot the target", () => {
    for (const p of [1.01, 2, 1e9, Infinity]) {
      assert.equal(easedCount(10, 100, p), 100);
      assert.equal(easedCount(100, 10, p), 10);
    }
  });
  it("is always inside [min(start,target), max(start,target)] and >= 0 across a sweep, including NaN and negative inputs", () => {
    for (const [s, t] of [[0, 0], [0, 1], [1, 0], [3, 1000], [1000, 3], [160, 12], [-5, 20], [20, -5], [NaN, 40], [40, NaN]] as Array<[number, number]>) {
      const ts = Number.isFinite(t) ? Math.max(0, t) : 0;
      const ss = Number.isFinite(s) ? Math.max(0, s) : ts;
      for (let p = -2; p <= 3; p += 0.05) {
        const v = easedCount(s, t, p);
        assert.ok(v >= 0, `${s}->${t} p=${p} gave ${v}`);
        assert.ok(v >= Math.min(ss, ts) && v <= Math.max(ss, ts), `${s}->${t} p=${p} gave ${v}`);
        assert.ok(Number.isInteger(v));
      }
    }
  });
});

const TOTAL = 3;
let dom: JSDOM;
const roots: Array<{ unmount: () => void }> = [];
let searchDelay: Promise<void> | null = null;
let searchCalls = 0;

function installFetch() {
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/catalog/facets") return json({ states: [{ state: "NJ", n: 3 }], makes: [{ make: "Toyota", n: TOTAL }], models: [], trims: [] });
    if (url.pathname === "/api/catalog/options") return json({ options: [], exteriorColors: [], interiorColors: [] });
    if (url.pathname === "/api/vehicles/search") {
      searchCalls++;
      if (searchDelay) await searchDelay;
      const vehicles = Array.from({ length: TOTAL }, (_, i) => ({ vin: `VIN${i}`.padEnd(17, "0"), vehicleId: i + 1, year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerId: 1, dealerName: "D", price: 30000 + i, daysOnLot: i, vdpUrl: null }));
      return new Response(JSON.stringify({ vehicles, total: TOTAL, totalCapped: false }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return json({});
  };
}

describe("/search Clear all, rendered", () => {
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/search" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("IS_REACT_ACT_ENVIRONMENT", true);
    define("BroadcastChannel", class { postMessage() {} close() {} addEventListener() {} removeEventListener() {} });
    define("self", dom.window);
    define("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } });
    (dom.window.HTMLElement.prototype as unknown as { scrollTo: unknown }).scrollTo = function (this: HTMLElement) { this.scrollTop = 0; };
  });
  after(() => dom.window.close());
  afterEach(() => { for (const r of roots.splice(0)) r.unmount(); searchDelay = null; });
  beforeEach(() => { searchCalls = 0; installFetch(); document.body.innerHTML = '<div id="root"></div>'; dom.window.localStorage.clear(); dom.window.history.replaceState(null, "", "/search"); });

  const tick = () => new Promise((r) => setTimeout(r, 20));
  async function mount() {
    const React = (await import("react")).default;
    (globalThis as { React?: unknown }).React = React;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
    const { SessionProvider } = createRequire(import.meta.url)("next-auth/react") as typeof import("next-auth/react");
    const { BuyerSearchView } = await import("../components/BuyerSearchView");
    const root = createRoot(document.getElementById("root")!);
    roots.push(root);
    const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
    await act(async () => { root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(SessionProvider as never, { session: null } as never, React.createElement(BuyerSearchView)))); await tick(); });
    const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await tick(); }); };
    const btn = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;
    const pickMake = () => click([...document.querySelectorAll('ul[aria-label="Makes"] button')].find((e) => e.textContent?.startsWith("Toyota"))!);
    const search = async () => { await pickMake(); await click(btn("Show")); };
    const rows = () => (document.body.textContent?.match(/VIN\d0{10,}/g) ?? []).length;
    return { act, click, btn, search, pickMake, rows };
  }

  it("Clear all drops the results, the empty-state prompt returns, the chips and the URL reset", async () => {
    const t = await mount();
    await t.search();
    assert.match(document.body.textContent ?? "", /3 vehicles found/);
    assert.ok(t.rows() >= 1, "result rows are on screen");
    assert.ok(window.location.search.includes("make=Toyota"));
    await t.click(t.btn("Clear all"));
    assert.doesNotMatch(document.body.textContent ?? "", /vehicles found/, "no stale count");
    assert.equal(t.rows(), 0, "no stale inventory rows");
    assert.match(document.body.textContent ?? "", /Pick a make/, "back to the empty state");
    assert.equal(document.querySelector('[data-testid="selected-bar"]')?.textContent?.includes("Toyota") ?? false, false, "make chip gone");
    assert.ok(!window.location.search.includes("make="), "URL cleared");
  });

  it("a search still in flight when Clear all is pressed does not paint results afterwards", async () => {
    const t = await mount();
    let release!: () => void;
    searchDelay = new Promise<void>((r) => { release = r; });
    await t.pickMake();
    await t.click(t.btn("Show"));
    assert.ok(searchCalls >= 1);
    await t.click(t.btn("Clear all"));
    await t.act(async () => { release(); await tick(); });
    assert.equal(t.rows(), 0, "the late response was dropped");
    assert.doesNotMatch(document.body.textContent ?? "", /vehicles found|Searching/);
  });

  it("searching again after Clear all works", async () => {
    const t = await mount();
    await t.search();
    await t.click(t.btn("Clear all"));
    await t.search();
    assert.match(document.body.textContent ?? "", /3 vehicles found/);
  });
});
