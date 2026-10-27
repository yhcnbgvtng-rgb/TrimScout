// The redesigned /search: Vehicle ID and Days on market start hidden (back via the Columns menu), buyers never get a first/last-seen
// column, the top row is eight dropdowns with Trim and Factory options locked until a make is picked, and counts under 1,000 are exact.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { ALWAYS_VISIBLE, HIDDEN_BY_DEFAULT, toggleColumn, visibleColumnKeys } from "./searchColumns";
import { BUYER_COUNT_CAP } from "./buyerSearchQuery";

describe("column defaults", () => {
  const cols = ["pick", "days", "vehicleId", "vin", "year", "price"].map((key) => ({ key }));
  it("hides Days on market and Vehicle ID until the shopper turns them on", () => {
    assert.deepEqual([...HIDDEN_BY_DEFAULT].sort(), ["days", "vehicleId"]);
    assert.deepEqual(visibleColumnKeys(cols, null), ["pick", "vin", "year", "price"]);
    assert.deepEqual(visibleColumnKeys(cols, toggleColumn(null, "vehicleId")), ["pick", "vehicleId", "vin", "year", "price"]);
  });
  it("can hide other columns, never the pick checkbox, and no crawl-date column exists", () => {
    assert.deepEqual(visibleColumnKeys(cols, toggleColumn(null, "price")), ["pick", "vin", "year"]);
    assert.ok(ALWAYS_VISIBLE.includes("pick"));
    assert.ok(visibleColumnKeys(cols, ["pick"]).includes("pick"));
  });
});

describe("count cap", () => {
  it("counts exactly below 1,000", () => assert.equal(BUYER_COUNT_CAP, 1000));
});

const TOTAL = 3;
let dom: JSDOM;
const roots: Array<{ unmount: () => void }> = [];

function installFetch() {
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/catalog/facets") return json({ states: [{ state: "NJ", n: 3 }], makes: [{ make: "Toyota", n: TOTAL }], models: [], trims: [] });
    if (url.pathname === "/api/catalog/options") return json({ options: [], exteriorColors: [], interiorColors: [] });
    if (url.pathname === "/api/vehicles/search") {
      const vehicles = Array.from({ length: TOTAL }, (_, i) => ({ vin: `VIN${i}`.padEnd(17, "0"), vehicleId: i + 1, year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerId: 1, dealerName: "D", price: 30000 + i, daysOnLot: i, vdpUrl: null }));
      return json({ vehicles, total: TOTAL, totalCapped: false });
    }
    return json({});
  };
}

describe("/search page, rendered", () => {
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
  afterEach(() => { for (const r of roots.splice(0)) r.unmount(); });
  beforeEach(() => { installFetch(); document.body.innerHTML = '<div id="root"></div>'; dom.window.localStorage.clear(); dom.window.history.replaceState(null, "", "/search"); });

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
    const search = async () => {
      const label = [...document.querySelectorAll("label")].find((l) => l.textContent?.trim() === "Make") as HTMLLabelElement;
      await click(document.getElementById(label.htmlFor)!);
      await click([...document.querySelectorAll('[role="option"]')].find((e) => e.textContent?.startsWith("Toyota"))!);
      await click(btn("Show"));
    };
    const headers = () => [...document.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent?.trim().toLowerCase());
    return { click, btn, search, headers };
  }

  it("the top row is Location, Make, Model, Trim, Year, Price, Factory options, More; Trim and Factory options are locked until a make is picked", async () => {
    const t = await mount();
    const row = document.querySelector('[role="group"][aria-label="Filters"]')!;
    const labels = [...row.children].map((c) => c.querySelector("label, span")?.textContent?.trim());
    assert.deepEqual(labels.map((l) => l?.replace(/^Paid /, "")), ["Location", "Make", "Model", "Trim", "Year", "Price", "Factory options", "More"]);
    for (const name of ["Model", "Trim", "Factory options"]) {
      const cell = [...row.children].find((c) => c.querySelector("label, span")?.textContent?.trim().replace(/^Paid /, "") === name)!;
      assert.equal(cell.querySelector("input"), null, `${name} has no input until a make is picked`);
      assert.match(cell.textContent ?? "", /Pick a make/);
    }
    await t.search();
    const trim = [...row.children].find((c) => c.querySelector("label")?.textContent?.trim() === "Trim")!;
    assert.ok(trim.querySelector("input"), "Trim unlocks with a make");
  });

  it("Vehicle ID and Days on market are hidden by default, return from the Columns menu, and no first/last-seen column ever exists", async () => {
    const t = await mount();
    await t.search();
    const base = t.headers();
    assert.ok(base.includes("vin") && base.includes("price"));
    assert.ok(!base.includes("vehicle id"), "Vehicle ID hidden");
    assert.ok(!base.includes("days on market"), "Days on market hidden");
    await t.click(t.btn("Columns"));
    const menu = document.querySelector('[role="menu"][aria-label="Columns"]')!;
    const items = [...menu.querySelectorAll("label")].map((l) => l.textContent?.trim().toLowerCase());
    assert.ok(items.includes("vehicle id") && items.includes("days on market"), "both are offered in the menu");
    assert.ok(!items.some((i) => /first|last/.test(i ?? "") && /seen/.test(i ?? "")), "no seen-date column offered");
    const box = [...menu.querySelectorAll("label")].find((l) => l.textContent?.trim() === "Vehicle ID")!.querySelector("input")!;
    await t.click(box);
    assert.ok(t.headers().includes("vehicle id"), "turning it on shows the column");
    assert.ok(!t.headers().some((h) => /seen/.test(h ?? "")), "never a seen-date column");
    assert.doesNotMatch(document.body.textContent ?? "", /(first|last)[ _]?seen/i);
  });
});
