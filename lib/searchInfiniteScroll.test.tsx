// /search infinite scroll, driven through the real BuyerSearchView in JSDOM with a fake fetch and a fake IntersectionObserver:
// the next page appends when the sentinel nears the end, never two requests at once, the end-of-list line, a retry row on failure
// (no loop), and a filter change goes back to page 1 without losing the picked checkboxes.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const PAGE = 24;
const TOTAL = 60;
const mkVehicle = (i: number) => ({
  vin: `VIN${String(i).padStart(14, "0")}`, vehicleId: i, year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerId: 1, dealerName: "D", price: 30000 + i, daysOnLot: i, vdpUrl: null,
});

let dom: JSDOM;
let searchCalls: URLSearchParams[] = [];
let failNext = false;
let gate: Promise<void> | null = null; // when set, search responses wait until it resolves
const roots: Array<{ unmount: () => void }> = [];
const observers: Array<{ cb: IntersectionObserverCallback; el: Element | null; live: boolean }> = [];

function installFetch() {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/catalog/facets") return json({ states: [], makes: [{ make: "Toyota", n: TOTAL }], models: [], trims: [] });
    if (url.pathname === "/api/catalog/options") return json({ options: [], exteriorColors: [], interiorColors: [] });
    if (url.pathname === "/api/vehicles/search") {
      searchCalls.push(url.searchParams);
      if (failNext && Number(url.searchParams.get("offset") || 0) > 0) { failNext = false; return json({ error: "boom" }, 500); }
      if (gate) await gate;
      const offset = Number(url.searchParams.get("offset") || 0);
      const n = Math.max(0, Math.min(PAGE, TOTAL - offset));
      return json({ vehicles: Array.from({ length: n }, (_, i) => mkVehicle(offset + i)), total: TOTAL, totalCapped: false });
    }
    return json({});
  };
}

describe("/search infinite scroll", () => {
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/search" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("IS_REACT_ACT_ENVIRONMENT", true);
    // next-auth opens a BroadcastChannel; Node's real one keeps the test process alive after the suite.
    define("BroadcastChannel", class { postMessage() {} close() {} addEventListener() {} removeEventListener() {} });
    define("self", dom.window);
    class FakeIO {
      rec: { cb: IntersectionObserverCallback; el: Element | null; live: boolean };
      constructor(cb: IntersectionObserverCallback) { this.rec = { cb, el: null, live: true }; observers.push(this.rec); }
      observe(el: Element) { this.rec.el = el; }
      disconnect() { this.rec.live = false; }
      unobserve() {}
      takeRecords() { return []; }
    }
    define("IntersectionObserver", FakeIO);
    (dom.window as unknown as Record<string, unknown>).IntersectionObserver = FakeIO;
    (dom.window.HTMLElement.prototype as unknown as { scrollTo: unknown }).scrollTo = function (this: HTMLElement) { this.scrollTop = 0; };
  });
  after(() => dom.window.close());
  afterEach(() => { for (const r of roots.splice(0)) r.unmount(); });
  beforeEach(() => { searchCalls = []; failNext = false; gate = null; observers.length = 0; installFetch(); document.body.innerHTML = '<div id="root"></div>'; dom.window.history.replaceState(null, "", "/search"); });

  const tick = () => new Promise((r) => setTimeout(r, 20));
  async function mount() {
    const React = (await import("react")).default;
    (globalThis as { React?: unknown }).React = React; // the CJS next-auth build expects a global React
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
    const { SessionProvider } = createRequire(import.meta.url)("next-auth/react") as typeof import("next-auth/react"); // the same (CJS) copy the component loads
    const { BuyerSearchView } = await import("../components/BuyerSearchView");
    const root = createRoot(document.getElementById("root")!);
    roots.push(root);
    const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
    await act(async () => { root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(SessionProvider as never, { session: null } as never, React.createElement(BuyerSearchView)))); await tick(); });
    const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await tick(); }); };
    const btn = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;
    // Pick the Toyota make (an option in the Make dropdown), then press the green "Show N vehicles" button.
    const makeLabel = [...document.querySelectorAll("label")].find((l) => l.textContent?.trim() === "Make") as HTMLLabelElement;
    await click(document.getElementById(makeLabel.htmlFor)!);
    const makeOption = [...document.querySelectorAll('[role="option"]')].find((e) => e.textContent?.startsWith("Toyota")) as HTMLButtonElement;
    await click(makeOption);
    await click(btn("Show"));
    const hitSentinel = async () => {
      const live = observers.filter((o) => o.live && o.el);
      await act(async () => { for (const o of live) o.cb([{ isIntersecting: true, target: o.el! } as IntersectionObserverEntry], {} as IntersectionObserver); await tick(); });
    };
    const rows = () => document.querySelectorAll('[data-testid="results-scroller"] input[type=checkbox]').length;
    return { act, click, btn, hitSentinel, rows, root };
  }

  it("shows page 1, then appends the next page when the sentinel is reached, with no Load more button", async () => {
    const t = await mount();
    assert.equal(t.rows(), PAGE);
    assert.equal(searchCalls.length, 1);
    assert.ok(![...document.querySelectorAll("button")].some((b) => b.textContent === "Load more"), "old button gone");
    await t.hitSentinel();
    assert.equal(t.rows(), PAGE * 2);
    assert.equal(searchCalls[1].get("offset"), String(PAGE));
  });

  it("never fires two requests at once, even if the sentinel fires twice while one is in flight", async () => {
    const t = await mount();
    let release!: () => void;
    gate = new Promise<void>((r) => { release = r; });
    const before = searchCalls.length;
    // Two hits in the same tick, then a third while that request is still pending: only one page request may exist.
    const hit = async () => { await t.act(async () => { for (const o of observers.filter((x) => x.live && x.el)) o.cb([{ isIntersecting: true, target: o.el! } as IntersectionObserverEntry], {} as IntersectionObserver); await tick(); }); };
    await t.act(async () => { for (const o of observers.filter((x) => x.live && x.el)) { const e = [{ isIntersecting: true, target: o.el! } as IntersectionObserverEntry]; o.cb(e, {} as IntersectionObserver); o.cb(e, {} as IntersectionObserver); } await tick(); });
    await hit();
    assert.equal(searchCalls.length - before, 1, "exactly one page request while it is pending");
    assert.ok(document.querySelector('[data-testid="results-loading-more"]'), "spinner row while fetching");
    await t.act(async () => { release(); await tick(); });
    assert.equal(t.rows(), PAGE * 2);
  });

  it("stops at the end: spinner gone, 'All N vehicles shown.', no sentinel, no further requests", async () => {
    const t = await mount();
    await t.hitSentinel();
    await t.hitSentinel();
    assert.equal(t.rows(), TOTAL);
    assert.match(document.querySelector('[data-testid="results-end"]')!.textContent!, /All 60 vehicles shown\./);
    assert.equal(document.querySelector('[data-testid="results-sentinel"]'), null);
    const n = searchCalls.length;
    await t.hitSentinel();
    assert.equal(searchCalls.length, n);
  });

  it("a failed page shows 'Couldn't load more — retry', keeps the rows, does not loop, and retry works", async () => {
    const t = await mount();
    failNext = true;
    await t.hitSentinel();
    assert.equal(t.rows(), PAGE, "rows kept");
    const err = document.querySelector('[data-testid="results-more-error"]')!;
    assert.match(err.textContent!, /Couldn.t load more/);
    const n = searchCalls.length;
    await t.hitSentinel();
    await tick();
    assert.equal(searchCalls.length, n, "no auto-retry loop");
    await t.click(err.querySelector("button")!);
    assert.equal(t.rows(), PAGE * 2);
  });

  it("keeps picked checkboxes while pages are added, and a new search resets to page 1 (offset 0)", async () => {
    const t = await mount();
    const box = () => document.querySelector('[data-testid="results-scroller"] input[type=checkbox]') as HTMLInputElement;
    await t.click(box());
    assert.equal(box().checked, true);
    await t.hitSentinel();
    assert.equal(box().checked, true, "pick survives the append");
    assert.equal(t.rows(), PAGE * 2);
    // Change the sort in the More panel, press Search: back to one page, starting at offset 0.
    await t.click(t.btn("More"));
    const sort = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "price:asc"))!;
    await t.act(async () => {
      const set = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
      set.call(sort, "price:asc"); sort.dispatchEvent(new dom.window.Event("change", { bubbles: true })); await tick();
    });
    await t.click(t.btn("Show"));
    const last = searchCalls[searchCalls.length - 1];
    assert.equal(last.get("offset"), null, "page 1 again");
    assert.equal(last.get("sort"), "price:asc");
    assert.equal(t.rows(), PAGE);
    assert.equal(box().checked, true, "the pick is still ticked");
  });

  it("offers a hidden fallback button for keyboard and screen-reader users", async () => {
    const t = await mount();
    const fb = t.btn("Load more vehicles");
    assert.ok(fb, "fallback present");
    assert.match(fb.className, /sr-only/);
    await t.click(fb);
    assert.equal(t.rows(), PAGE * 2);
  });
});
