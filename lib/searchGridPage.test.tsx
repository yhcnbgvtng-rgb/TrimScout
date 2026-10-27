// The /search grid through the real page in JSDOM, against a fake box: phone cards + the Filters bottom sheet, and the desktop paid-options hover.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

let dom: JSDOM;
let calls: Array<{ path: string; sp: URLSearchParams }> = [];
let phone = false;
const roots: Array<{ unmount: () => void }> = [];
const mkVehicle = (i: number) => ({
  vin: `VIN${String(i).padStart(14, "0")}`, vehicleId: i, year: 2025, make: "Ford", model: "F-150", trim: "XLT", dealerId: 1, dealerName: "Metro Ford", dealerState: "FL", condition: "new",
  mileage: 10, price: 40000 + i, daysOnLot: 5, vdpUrl: null, bodyStyle: "Pickup", engine: "3.5L V6", transmission: "Automatic", exteriorColor: "Blue", interiorColor: "Black", distanceMiles: null,
  options: [{ name: "Tow Package", price: 650, kind: "factory" }, { name: "Sunroof", price: 1200, kind: "factory" }, { name: "Floor Mats", price: 0, kind: "factory" }],
});

function installFetch() {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ path: url.pathname, sp: url.searchParams });
    if (url.pathname === "/api/catalog/facets") return json({ states: [{ state: "FL", n: 500 }], makes: [{ make: "Ford", n: 500 }, { make: "Kia", n: 250 }], models: [], trims: [] });
    if (url.pathname === "/api/catalog/options") return json({ options: [], exteriorColors: [], interiorColors: [] });
    if (url.pathname === "/api/vehicles/facet-counts") return json({ supported: false });
    if (url.pathname === "/api/vehicles/search") return json({ vehicles: Array.from({ length: 3 }, (_, i) => mkVehicle(i)), total: 3, totalCapped: false });
    return json({});
  };
}

describe("/search grid, through the real page", () => {
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/search" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("cancelAnimationFrame", (id: number) => clearTimeout(id));
    define("IS_REACT_ACT_ENVIRONMENT", true);
    define("BroadcastChannel", class { postMessage() {} close() {} addEventListener() {} removeEventListener() {} });
    define("self", dom.window);
    class FakeIO { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } }
    define("IntersectionObserver", FakeIO);
    (dom.window as unknown as Record<string, unknown>).IntersectionObserver = FakeIO;
    (dom.window.HTMLElement.prototype as unknown as { scrollTo: unknown }).scrollTo = function (this: HTMLElement) { this.scrollTop = 0; };
    (dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: !phone, addEventListener() {}, removeEventListener() {} });
  });
  after(() => dom.window.close());
  afterEach(() => { for (const r of roots.splice(0)) r.unmount(); });
  beforeEach(() => { calls = []; phone = false; installFetch(); document.body.innerHTML = '<div id="root"></div>'; dom.window.history.replaceState(null, "", "/search?make=Ford"); });

  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
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
    await act(async () => { await tick(400); });
    const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await tick(); }); };
    return { act, click };
  }

  it("on a phone the results are cards, not a table, and the Filters button opens the same column filters as a bottom sheet with 'Show N vehicles'", async () => {
    phone = true;
    const t = await mount();
    assert.ok(!document.querySelector('[data-testid="results-scroller"]'), "no table on a phone");
    assert.equal(document.querySelectorAll('[data-testid="result-cards"] article').length, 3);
    assert.match(document.querySelector("article")!.textContent!, /2025 Ford F-150/);
    await t.click(document.querySelector('[data-testid="open-filter-sheet"]')!);
    const sheet = document.querySelector('[data-testid="filter-sheet"]')!;
    assert.ok(sheet, "sheet is open");
    for (const name of ["Make", "Model", "Price", "Days on market", "Year"]) assert.ok([...sheet.querySelectorAll("button")].some((b) => b.textContent?.startsWith(name)), name);
    assert.match(document.querySelector('[data-testid="show-n"]')!.textContent!, /^Show [\d,]+ vehicle/);
    // Picking inside the sheet changes the draft; closing it shows the results.
    await t.click([...sheet.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Price"))!);
    await t.click(document.querySelector('[data-testid="show-n"]')!);
    assert.ok(!document.querySelector('[data-testid="filter-sheet"]'), "sheet closed");
  });

  it("the phone never shows a first-seen or last-seen date", async () => {
    phone = true;
    await mount();
    assert.doesNotMatch(document.body.textContent!, /last seen|first seen/i);
  });

  it("on a desktop the paid-options count has the priced list on hover (paid rows only)", async () => {
    const t = await mount();
    const cell = document.querySelector('[data-testid="paid-count"]')!;
    assert.equal(cell.textContent, "2");
    await t.act(async () => { cell.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); (cell as HTMLElement).dispatchEvent(new dom.window.MouseEvent("mouseenter")); await tick(); });
    const list = document.querySelector('[data-testid="paid-list"]')!;
    assert.ok(list, "hover list shown");
    assert.match(list.textContent!, /Tow Package\+\$650/);
    assert.match(list.textContent!, /Sunroof\+\$1,200/);
    assert.doesNotMatch(list.textContent!, /Floor Mats/);
  });

  it("the Columns menu hides a column and keeps it in the URL", async () => {
    const t = await mount();
    assert.ok(document.querySelector('[data-testid="col-year"]'));
    await t.click([...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Columns"))!);
    const year = [...document.querySelectorAll("label")].find((l) => l.textContent === "Year")!.querySelector("input")!;
    await t.click(year);
    assert.ok(!document.querySelector('[data-testid="col-year"]'));
    assert.match(window.location.search, /cols=-year/);
  });

  it("Days on market and Vehicle ID are off by default and come back from the Columns menu", async () => {
    const t = await mount();
    assert.ok(!document.querySelector('[data-testid="col-days"]'));
    assert.ok(!document.querySelector('[data-testid="col-vehicleId"]'));
    await t.click([...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Columns"))!);
    const box = (name: string) => [...document.querySelectorAll("label")].find((l) => l.textContent === name)!.querySelector("input")!;
    await t.click(box("Days on market"));
    await t.click(box("Vehicle ID"));
    assert.ok(document.querySelector('[data-testid="col-days"]'));
    assert.ok(document.querySelector('[data-testid="col-vehicleId"]'));
    assert.match(window.location.search, /cols=[^&]*%2Bdays|cols=[^&]*\+days|cols=\+days/);
  });
});
