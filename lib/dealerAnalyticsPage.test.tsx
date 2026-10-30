// Admin Dealer Analytics pages: table sort/search/filters, the group-dealers toggle (includeBuckets=1) and the 503 / 404 / loading states.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import type { DealerAnalyticsRow } from "./dealerAnalyticsTypes";
import { failureKind, filterDealers, sortDealers } from "./dealerAnalyticsPage";

const row = (o: Partial<DealerAnalyticsRow>): DealerAnalyticsRow => ({
  dealerId: 1, dealerName: "Alpha Ford", city: "Newark", state: "NJ", brands: ["Ford"], isGroupBucket: false, makeCount: 1, activeUnits: 10, newUnits: 8, usedUnits: 2,
  pricedUnits: 10, avgPrice: 40000, avgDom: 30, added7d: 1, removed7d: 1, dropUnits7d: 2, dropUnits30d: 4, avgDropUsd7d: null, avgDropPct7d: null, avgDropUsd30d: null, avgDropPct30d: null, ...o,
});
const ROWS = [
  row({ dealerId: 1, dealerName: "Alpha Ford", activeUnits: 10, avgDom: 30 }),
  row({ dealerId: 2, dealerName: "Bravo Toyota", state: "TX", city: "Austin", brands: ["Toyota"], activeUnits: 50, avgDom: null }),
  row({ dealerId: 3, dealerName: "Charlie Motors", state: "NJ", brands: ["Ford", "Toyota"], activeUnits: 30, avgDom: 12 }),
];
const table = (dealers: DealerAnalyticsRow[], extra: object = {}) => ({ day: "2026-10-30", asOf: "2026-10-30T06:00:00Z", includeBuckets: false, bucketCount: 1, hiddenBuckets: 1, dealers, ...extra });

describe("table helpers", () => {
  it("maps statuses to states", () => {
    assert.equal(failureKind(503), "not_built");
    assert.equal(failureKind(404), "not_found");
    assert.equal(failureKind(502), "error");
  });
  it("filters by search, state and make", () => {
    assert.deepEqual(filterDealers(ROWS, { q: "austin", state: "", make: "" }).map((r) => r.dealerId), [2]);
    assert.deepEqual(filterDealers(ROWS, { q: "", state: "NJ", make: "Toyota" }).map((r) => r.dealerId), [3]);
  });
  it("sorts both ways with nulls last", () => {
    assert.deepEqual(sortDealers(ROWS, "avgDom", 1).map((r) => r.dealerId), [3, 1, 2]);
    assert.deepEqual(sortDealers(ROWS, "avgDom", -1).map((r) => r.dealerId), [1, 3, 2]);
    assert.deepEqual(sortDealers(ROWS, "dealerName", -1).map((r) => r.dealerId), [3, 2, 1]);
  });
});

describe("Dealer analytics pages", () => {
  let dom: JSDOM;
  const calls: string[] = [];
  let respond: (url: string) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent"]) define(k, w[k]);
    define("IS_REACT_ACT_ENVIRONMENT", true);
    define("self", dom.window);
    define("fetch", async (url: string) => {
      calls.push(url);
      const r = await respond(url);
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    });
  });
  after(() => dom.window.close());

  async function mount(make: (React: typeof import("react")) => React.ReactElement) {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(make(React)); });
    return { host, act, unmount: () => act(async () => root.unmount()) };
  }
  const names = (host: HTMLElement) => Array.from(host.querySelectorAll("tbody tr td:first-child")).map((e) => e.textContent);

  it("shows a skeleton while loading, then the table; header click sorts", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    respond = async () => { await gate; return { status: 200, body: table(ROWS) }; };
    const { default: Page } = await import("../app/admin/dealer-analytics/DealerAnalyticsClient");
    const m = await mount((React) => React.createElement(Page));
    assert.ok(m.host.querySelector('[data-testid="table-skeleton"]'), "skeleton while loading");
    await m.act(async () => { release(); await gate; });
    assert.deepEqual(names(m.host), ["Bravo Toyota", "Charlie Motors", "Alpha Ford"]); // default: in stock, high to low
    const nameHeader = Array.from(m.host.querySelectorAll("th button")).find((b) => b.textContent === "Dealer") as HTMLButtonElement;
    await m.act(async () => { nameHeader.click(); });
    assert.deepEqual(names(m.host), ["Alpha Ford", "Bravo Toyota", "Charlie Motors"]);
    await m.unmount();
  });

  it("search and dropdown filters narrow the rows", async () => {
    respond = () => ({ status: 200, body: table(ROWS) });
    const { default: Page } = await import("../app/admin/dealer-analytics/DealerAnalyticsClient");
    const m = await mount((React) => React.createElement(Page));
    const state = m.host.querySelector('select[aria-label="State"]') as HTMLSelectElement;
    const setSelect = async (el: HTMLSelectElement, v: string) => m.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await setSelect(state, "NJ");
    assert.deepEqual(names(m.host).sort(), ["Alpha Ford", "Charlie Motors"]);
    await setSelect(m.host.querySelector('select[aria-label="Make"]') as HTMLSelectElement, "Toyota");
    assert.deepEqual(names(m.host), ["Charlie Motors"]);
    await m.unmount();
  });

  it("group-dealers toggle refetches with includeBuckets=1", async () => {
    calls.length = 0;
    respond = (url) => ({ status: 200, body: table(url.includes("includeBuckets=1") ? [...ROWS, row({ dealerId: 9, dealerName: "Mega Group", isGroupBucket: true })] : ROWS) });
    const { default: Page } = await import("../app/admin/dealer-analytics/DealerAnalyticsClient");
    const m = await mount((React) => React.createElement(Page));
    assert.equal(calls[0], "/api/admin/dealer-analytics");
    assert.ok(!names(m.host).includes("Mega Group"));
    await m.act(async () => { (m.host.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    assert.equal(calls[calls.length - 1], "/api/admin/dealer-analytics?includeBuckets=1");
    assert.ok(names(m.host).includes("Mega Group"));
    await m.unmount();
  });

  it("503 shows the not-built message", async () => {
    respond = () => ({ status: 503, body: { error: "tables missing" } });
    const { default: Page } = await import("../app/admin/dealer-analytics/DealerAnalyticsClient");
    const m = await mount((React) => React.createElement(Page));
    const msg = m.host.querySelector('[data-testid="state-not_built"]');
    assert.ok(msg);
    assert.match(msg!.textContent!, /Dealer analytics not built yet/);
    assert.match(msg!.textContent!, /First run pending/);
    assert.equal(m.host.querySelector("table"), null);
    await m.unmount();
  });

  it("detail: 404 shows Dealer not found; 503 shows not built; 200 renders summary, changes and market", async () => {
    const { default: Detail } = await import("../app/admin/dealer-analytics/[id]/DealerDetailClient");
    respond = () => ({ status: 404, body: { error: "no" } });
    let m = await mount((React) => React.createElement(Detail, { id: "7" }));
    assert.match(m.host.querySelector('[data-testid="state-not_found"]')!.textContent!, /Dealer not found/);
    await m.unmount();

    respond = () => ({ status: 503, body: {} });
    m = await mount((React) => React.createElement(Detail, { id: "7" }));
    assert.ok(m.host.querySelector('[data-testid="state-not_built"]'));
    await m.unmount();

    respond = (url) => url.endsWith("/market")
      ? { status: 200, body: { day: "2026-10-30", asOf: "x", dealerId: 7, marketIncludesDealer: true, minMarketDealers: 3, overall: { comparableUnits: 12, weightedDeltaPct: -2.5 },
          rows: [{ make: "Ford", model: "F-150", year: 2026, condition: "new", units: 4, avgPrice: 50000, marketUnits: 90, marketDealers: 2, marketAvgPrice: 51000, deltaUsd: -1000, deltaPct: -2, thinMarket: true }] } }
      : { status: 200, body: { day: "2026-10-30", asOf: "x", dealer: { dealerId: 7, dealerName: "Alpha Ford", city: "Newark", state: "NJ", brands: ["Ford"] }, isGroupBucket: false,
          summary: { makeCount: 1, activeUnits: 42, newUnits: 30, usedUnits: 12, pricedUnits: 40, avgPrice: 45000, avgDom: 33, added7d: 3, removed7d: 2, dropUnits7d: 5, dropUnits30d: 9, avgDropUsd7d: null, avgDropPct7d: null, avgDropUsd30d: null, avgDropPct30d: null },
          ageBuckets: null, trend: [], mix: { makes: [], models: [], modelsTruncated: false },
          priceChanges: { total: 1, limit: 25, offset: 0, direction: "all", changes: [{ vin: "V1", changedOn: "2026-10-29", oldPrice: 50000, newPrice: 49000, deltaUsd: -1000, pctChange: -2, year: 2026, make: "Ford", model: "F-150", trim: "XLT", condition: "new", vdpUrl: null, inStock: true }] } } };
    m = await mount((React) => React.createElement(Detail, { id: "7" }));
    assert.equal(m.host.querySelector('[data-testid="dealer-title"]')!.textContent, "Alpha Ford");
    assert.match(m.host.querySelector('[data-testid="price-changes"]')!.textContent!, /2026 Ford F-150 XLT/);
    assert.match(m.host.querySelector('[data-testid="market-overall"]')!.textContent!, /-2\.5%/);
    assert.equal(m.host.querySelector('[data-testid="market-table"] tbody tr')!.className, "opacity-50"); // thin market is greyed
    assert.doesNotMatch(m.host.textContent!, /first seen|last seen/i);
    await m.unmount();
  });
});
