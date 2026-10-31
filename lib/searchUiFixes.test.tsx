// /search UI fixes on top of the server changes in #665: API paging (nextOffset), one count everywhere, no Days on market, "Price on request",
// colour labels, shared titles, sparse rows, VIN lookup clearing, cross-page VIN dedupe, and the contact filter matching the column rule.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { appendDedupeByVin } from "./onePerVin";
import { rowsPassingContactFilter, contactOnFileDealerIds } from "./contactFilter";
import { buildContactIndex, contactStatus } from "./dealerContactIndex";
import { colorCell, colorFilterOptions, COLOR_NOT_LISTED } from "./colorCode";
import { vehicleTitle } from "./vehicleTitle";
import { needsServerCount } from "./searchLive";
import { HIDDEN_BY_DEFAULT } from "./searchColumns";
import type { Dealership } from "./dealershipsApi";

const dealer = (over: Partial<Dealership>): Dealership =>
  ({ id: "1", dealerName: "Test Motors", address: null, city: "Town", state: "NJ", zipCode: null, phone: null, contactName: null, contactEmail: null, notes: null, website: null, domains: [], emailOptOut: false, createdAt: "", updatedAt: "", ...over }) as Dealership;

describe("pure helpers", () => {
  it("appendDedupeByVin drops a VIN already loaded on an earlier page, and repeats inside the new page", () => {
    const a = [{ vin: "AAA" }, { vin: "BBB" }];
    const out = appendDedupeByVin(a, [{ vin: "bbb" }, { vin: "CCC" }, { vin: "CCC" }, { vin: "" }]);
    assert.deepEqual(out.map((r) => r.vin), ["AAA", "BBB", "CCC", ""]);
  });
  it("the contact filter keeps exactly the rows the Contact column says Yes for, including a car with no dealer id", () => {
    const index = buildContactIndex([
      dealer({ id: "10", dealerName: "Desk Honda", contactEmail: "sales@deskhonda.com" }),
      dealer({ id: "11", dealerName: "Nobody Kia" }),
    ]);
    const cars = [
      { dealerId: "10", dealerName: "Desk Honda", dealerState: "NJ" },
      { dealerId: null, dealerName: "Desk Honda", dealerState: "NJ" }, // missing id: resolved by name + state
      { dealerId: "99999", dealerName: "Desk Honda", dealerState: "NJ" }, // unknown id: same
      { dealerId: "11", dealerName: "Nobody Kia", dealerState: "NJ" },
    ].map((c) => ({ ...c, dealerHasContact: contactStatus(index, c) }));
    assert.deepEqual(cars.map((c) => c.dealerHasContact), [true, true, true, false]);
    assert.equal(rowsPassingContactFilter(cars, true).length, 3);
    assert.equal(rowsPassingContactFilter(cars, false).length, 4);
    assert.deepEqual(contactOnFileDealerIds(index), ["10"]);
  });
  it("blank and code colours read 'Color not listed'; interior options are cleaned like exterior", () => {
    assert.equal(colorCell(null), COLOR_NOT_LISTED);
    assert.equal(colorCell(""), COLOR_NOT_LISTED);
    assert.equal(colorCell("0C7V"), COLOR_NOT_LISTED);
    assert.equal(colorCell("Black"), "Black");
    assert.deepEqual(colorFilterOptions(["Black", "KAD", "WA8555", "Tan"]), ["Black", "Tan"]);
  });
  it("vehicleTitle: the iX3 row and a model equal to the make", () => {
    assert.equal(vehicleTitle({ vin: "WBX33HR02VDA88612", year: 2027, make: "BMW", model: "BMW", trim: "50 xDrive" }), "2027 BMW iX3 50 xDrive");
    assert.equal(vehicleTitle({ year: 2026, make: "BMW", model: "BMW", trim: null }), "2026 BMW");
    assert.equal(vehicleTitle({ year: 2026, make: "Ford", model: "F-150", trim: "XLT" }), "2026 Ford F-150 XLT");
  });
  it("the count comes from the API for any picked make; there is no Days on market column", () => {
    const f = { state: "", make: "BMW", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [], possibleDemo: false, contactOnFile: true, zip: "", radiusMiles: "" };
    assert.equal(needsServerCount(f), true);
    assert.equal(needsServerCount({ ...f, make: "" }), false);
    assert.ok(!HIDDEN_BY_DEFAULT.includes("days"));
  });
  it("the contact tooltip says a valid sales email, not a named contact", () => {
    const src = fs.readFileSync(new URL("../components/search/SearchFilterBar.tsx", import.meta.url), "utf8");
    assert.match(src, /dealer has a valid sales email on file/);
    assert.doesNotMatch(src, /named sales contact/);
  });
});

type Handler = (url: URL) => unknown;
let dom: JSDOM;
let searchHandler: Handler;
let vinHandler: () => Response | Promise<Response>;
const searchCalls: URL[] = [];
const roots: Array<{ unmount: () => void }> = [];
const VIN = "WBX33HR02VDA88612";
const car = (i: number, over: Record<string, unknown> = {}) => ({
  vin: `VIN${String(i).padStart(14, "0")}`, vehicleId: i, year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerId: "1", dealerName: "Dealer", dealerState: "NJ",
  condition: "new", exteriorColor: "Black", interiorColor: "Black", mileage: 10, price: 30000 + i, vdpUrl: null, distanceMiles: null, ...over,
});
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function installFetch() {
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/catalog/facets") return json({ states: [{ state: "NJ", n: 10 }], makes: [{ make: "Toyota", n: 10 }], models: [], trims: [] });
    if (url.pathname === "/api/catalog/options") return json({ options: [], exteriorColors: [], interiorColors: ["Black", "KAD"] });
    if (url.pathname === "/api/vehicles/search") { searchCalls.push(url); return json(searchHandler(url)); }
    if (url.pathname === "/api/vehicles/vin") return vinHandler();
    return json({});
  };
}

describe("/search UI fixes, rendered", () => {
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
  beforeEach(() => { installFetch(); searchCalls.length = 0; document.body.innerHTML = '<div id="root"></div>'; dom.window.localStorage.clear(); dom.window.history.replaceState(null, "", "/search"); });

  const tick = () => new Promise((r) => setTimeout(r, 30));
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
      await act(async () => { await tick(); await tick(); });
    };
    const text = () => document.body.textContent ?? "";
    return { act, click, btn, search, text };
  }

  it("pages by the API's nextOffset, not by how many rows are on screen", async () => {
    searchHandler = (url) => {
      const offset = Number(url.searchParams.get("offset") || 0);
      if (offset === 0) return { vehicles: Array.from({ length: 24 }, (_, i) => car(i)), total: 60, totalCapped: false, nextOffset: 31 };
      return { vehicles: Array.from({ length: 10 }, (_, i) => car(100 + i)), total: 60, totalCapped: false, nextOffset: null };
    };
    const t = await mount();
    await t.search();
    const sentinelHit = async () => { await t.click(t.btn("Load more vehicles")); };
    await sentinelHit();
    const paged = searchCalls.filter((u) => u.searchParams.get("limit") === "24" && u.searchParams.get("offset"));
    assert.equal(paged.at(-1)!.searchParams.get("offset"), "31", "the next page starts where the API said, not at 24");
    assert.equal(document.querySelector('[data-testid="results-sentinel"]'), null, "nextOffset null ends the list");
  });

  it("one count: header, results line and the Show button all use the API total (capped shows a +)", async () => {
    searchHandler = () => ({ vehicles: Array.from({ length: 5 }, (_, i) => car(i)), total: 293, totalCapped: true, nextOffset: null });
    const t = await mount();
    await t.search();
    assert.match(document.querySelector('[data-testid="live-count"]')!.textContent!, /293\+/);
    assert.match(t.text(), /293\+ vehicles found/);
    assert.doesNotMatch(document.querySelector('[data-testid="live-count"]')!.textContent!, /^10\b/, "not the facet count");
  });

  it("no Days on market column; blank colours, 0 mileage on used and a withheld price render consistently; the iX3 row is titled", async () => {
    searchHandler = () => ({
      vehicles: [
        car(1),
        car(2, { vin: VIN, make: "BMW", model: "BMW", trim: "50 xDrive", year: 2027, exteriorColor: null, interiorColor: "", condition: "used", mileage: 0, price: null, priceSuspect: true }),
        car(3, { year: null, model: null, price: null, dealerName: "Sparse Auto" }),
      ],
      total: 3, totalCapped: false, nextOffset: null,
    });
    const t = await mount();
    await t.search();
    const headers = [...document.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent?.trim().toLowerCase());
    assert.ok(!headers.includes("days on market"));
    const rows = [...document.querySelectorAll('[data-testid="results-scroller"] input[type=checkbox]')].map((c) => c.getAttribute("aria-label"));
    assert.ok(rows.includes("Pick 2027 BMW iX3 50 xDrive for a quote"), String(rows));
    assert.ok(!rows.some((r) => /BMW BMW/.test(r ?? "")));
    const body = t.text();
    assert.ok(body.includes("Price on request"));
    assert.ok(body.includes(COLOR_NOT_LISTED));
    // The sparse row (no year/model/price) is last, ahead of nothing; the withheld-price row is also incomplete but keeps its order after the complete one.
    assert.equal(rows[0], "Pick 2026 Toyota RAV4 XLE for a quote");
    const rowEls = [...document.querySelectorAll('[data-testid="results-scroller"] input[type=checkbox]')];
    const usedRow = rowEls[1].closest("div[style]")!.parentElement!;
    assert.ok(!/\b0\b/.test(usedRow.textContent!.replace(VIN, "")), "used 0 miles is a dash, not 0");
  });

  it("a failed VIN lookup clears the previous result", async () => {
    searchHandler = () => ({ vehicles: [], total: 0, totalCapped: false, nextOffset: null });
    vinHandler = () => json({ kind: "full", vin: VIN, truncated: false, vehicles: [car(9, { vin: VIN })] });
    const t = await mount();
    const input = document.querySelector('input[aria-label="VIN or last 6 to 8 characters"]') as HTMLInputElement;
    const typeVin = async () => t.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, VIN);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await tick();
    });
    await typeVin();
    await t.click(t.btn("Find VIN"));
    assert.ok(document.querySelector('[data-testid="vin-results"]'), "first lookup shows its rows");
    vinHandler = () => json({ error: "boom" }, 500);
    await typeVin();
    await t.click(t.btn("Find VIN"));
    assert.equal(document.querySelector('[data-testid="vin-results"]'), null, "stale rows are gone");
    assert.ok(document.querySelector('[data-testid="vin-error"]'));
  });
});
