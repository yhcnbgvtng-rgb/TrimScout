// The /search filter panel's newer filters (year, mileage, days on market, body style, fuel, drivetrain, transmission, dealer, VIN pattern):
// the pure rules, the request they build, and the real BuyerSearchView in JSDOM with a fake box that does / does not count them.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { filtersToQueryString, unappliedFilters } from "../components/BuyerSearchView";
import { parseBuyerSearchParams } from "./buyerSearchQuery";
import { inventoryQueryString } from "./inventoryApi";
import { cleanBodyStyle, cleanDealerId, cleanVinPattern, daysBandRange, vinMatchesPattern, vinPatternUsable } from "./searchFilters";
import { hasNonFacetFilter } from "./searchLive";

const base = { state: "", make: "Ford", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [], possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "", odometerMin: "", bodyStyle: [], fuel: [], drivetrain: [], transmission: [], dealerIds: [], days: "", vinPattern: "" };

describe("filter values", () => {
  it("cleans a VIN pattern: upper-case, no I/O/Q, only ? and * as wildcards, 17 at most", () => {
    assert.equal(cleanVinPattern("1hgcm*"), "1HGCM*");
    assert.equal(cleanVinPattern("ab-io q%1"), "AB1");
    assert.equal(cleanVinPattern("a**b"), "A*B");
    assert.equal(cleanVinPattern("A".repeat(30)).length, 17);
  });
  it("a pattern needs three real characters, and without a make a literal start or end", () => {
    assert.equal(vinPatternUsable("1H*", true), false);
    assert.equal(vinPatternUsable("1HG*", true), true);
    assert.equal(vinPatternUsable("????????5*", true), false); // one real character
    assert.equal(vinPatternUsable("A?B?C?D", true), true);
    assert.equal(vinPatternUsable("A?B?C?D", false), false); // no literal run of three at either end
    assert.equal(vinPatternUsable("1HGCM*", false), true);
    assert.equal(vinPatternUsable("*123456", false), true);
  });
  it("matches VINs the way the box's LIKE does", () => {
    assert.equal(vinMatchesPattern("1FTFW1E50NFA12345", "1FTFW*"), true);
    assert.equal(vinMatchesPattern("1FTFW1E50NFA12345", "*12345"), true);
    assert.equal(vinMatchesPattern("1FTFW1E50NFA12345", "????????0*"), true);
    assert.equal(vinMatchesPattern("1FTFW1E50NFA12345", "????????9*"), false);
  });
  it("cleans body styles and dealer ids, and maps a days band to min/max", () => {
    assert.equal(cleanBodyStyle("  Crew<Cab>  Pickup/4x4 "), "Crew Cab Pickup/4x4");
    assert.equal(cleanDealerId("0012"), "12");
    assert.equal(cleanDealerId("12a"), "");
    assert.equal(cleanDealerId("0"), "");
    assert.deepEqual(daysBandRange("31-60"), { min: 31, max: 60 });
    assert.deepEqual(daysBandRange("0-7"), { min: undefined, max: 7 });
    assert.deepEqual(daysBandRange("91+"), { min: 91, max: undefined });
    assert.equal(daysBandRange("1-2"), null);
  });
});

describe("the request the panel builds", () => {
  it("sends the lists as repeated params, the days band as minDays/maxDays, and the VIN pattern only with a make", () => {
    const sp = new URLSearchParams(filtersToQueryString({ ...base, odometerMin: "10000", bodyStyle: ["SUV", "Pickup"], fuel: ["hybrid"], drivetrain: ["awd", "fwd"], transmission: ["cvt"], dealerIds: ["12", "34"], days: "31-60", vinPattern: "1ft*" }, { limit: 1 }));
    assert.deepEqual(sp.getAll("bodyStyle"), ["SUV", "Pickup"]);
    assert.deepEqual(sp.getAll("drivetrain"), ["awd", "fwd"]);
    assert.deepEqual(sp.getAll("dealerId"), ["12", "34"]);
    assert.equal(sp.get("odometerMin"), "10000");
    assert.equal(sp.get("minDays"), "31");
    assert.equal(sp.get("maxDays"), "60");
    assert.equal(sp.get("vinPattern"), "1FT*");
    assert.equal(new URLSearchParams(filtersToQueryString({ ...base, make: "", vinPattern: "1ft*" })).has("vinPattern"), false);
    assert.equal(new URLSearchParams(filtersToQueryString({ ...base, vinPattern: "1f" })).has("vinPattern"), false);
  });
  it("makes the headline count a server count", () => {
    for (const f of [{ fuel: ["gas"] }, { bodyStyle: ["SUV"] }, { dealerIds: ["3"] }, { days: "0-7" }, { odometerMin: "5000" }, { vinPattern: "1FT*" }]) assert.equal(hasNonFacetFilter({ ...base, ...f }), true, JSON.stringify(f));
    assert.equal(hasNonFacetFilter(base), false);
  });
  it("the search route parses them, drops junk, and forwards them as repeated params", () => {
    const parsed = parseBuyerSearchParams(new URLSearchParams("make=Ford&fuel=hybrid&fuel=rocket&drivetrain=awd&transmission=cvt&dealerId=12&dealerId=x&bodyStyle=SUV&bodyStyle=%3Cb%3E&odometerMin=5000&vinPattern=1ft*&minDays=8&maxDays=30"));
    assert.deepEqual(parsed.query.fuel, ["hybrid"]);
    assert.deepEqual(parsed.query.drivetrain, ["awd"]);
    assert.deepEqual(parsed.query.dealerId, ["12"]);
    assert.deepEqual(parsed.query.bodyStyle, ["SUV", "b"]);
    assert.equal(parsed.query.odometerMin, 5000);
    assert.equal(parsed.query.vinPattern, "1FT*");
    assert.equal(parsed.query.minDays, 8);
    const qs = new URLSearchParams(inventoryQueryString({ make: "Ford", dealerId: ["12", "34"], fuel: ["gas", "hybrid"] }));
    assert.deepEqual(qs.getAll("dealerId"), ["12", "34"]);
    assert.deepEqual(qs.getAll("fuel"), ["gas", "hybrid"]);
    assert.equal(new URLSearchParams(inventoryQueryString({ dealerId: "7" })).get("dealerId"), "7"); // the admin sheet's single store is unchanged
    assert.equal(parseBuyerSearchParams(new URLSearchParams("make=Ford&vinPattern=1F")).query.vinPattern, undefined);
  });
  it("names the filters an older box did not apply", () => {
    const qs = "make=Ford&fuel=gas&bodyStyle=SUV&minDays=8&odometerMin=1";
    assert.deepEqual(unappliedFilters(qs, undefined), ["odometerMin", "bodyStyle", "fuel"]);
    assert.deepEqual(unappliedFilters(qs, ["fuel", "bodyStyle", "odometerMin"]), []);
    assert.deepEqual(unappliedFilters("make=Ford&minDays=8", undefined), []); // minDays/maxDays are old params: not part of the check
  });
});

// ---- the page, in JSDOM ----
let dom: JSDOM;
let calls: Array<{ path: string; sp: URLSearchParams }> = [];
let boxCounts: "full" | "tooBroad" | "old" = "full";
const roots: Array<{ unmount: () => void }> = [];
const mkVehicle = (i: number) => ({ vin: `VIN${String(i).padStart(14, "0")}`, vehicleId: i, year: 2025, make: "Ford", model: "F-150", trim: "XLT", dealerId: 1, dealerName: "D", price: 40000 + i, daysOnLot: i, vdpUrl: null });

function installFetch() {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ path: url.pathname, sp: url.searchParams });
    if (url.pathname === "/api/catalog/facets") return json({ states: [], makes: [{ make: "Ford", n: 500 }], models: [], trims: [] });
    if (url.pathname === "/api/catalog/options") return json({ options: [], exteriorColors: [], interiorColors: ["Black"], interiorColorCounts: [{ color: "Black", n: 300 }] });
    if (url.pathname === "/api/vehicles/facet-counts") {
      if (boxCounts === "old") return json({ supported: false });
      if (boxCounts === "tooBroad") return json({ supported: true, tooBroad: true, cap: 40000 });
      return json({ supported: true, rows: 500, dims: {
        year: [{ v: 2022, n: 100 }, { v: 2023, n: 150 }, { v: 2025, n: 250 }],
        mileage: { width: 10000, top: 150000, hist: [300, 100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        bodyStyle: [{ v: "SUV", n: 200 }, { v: "Pickup", n: 300 }],
        fuel: [{ v: "gas", n: 400 }, { v: "hybrid", n: 90 }, { v: "diesel", n: 0 }],
        drivetrain: [{ v: "awd", n: 250 }, { v: "rwd", n: 100 }],
        transmission: [{ v: "automatic", n: 480 }],
        days: [{ v: "0-7", n: 60 }, { v: "8-30", n: 200 }],
        dealer: [{ id: "12", name: "Metro Ford", n: 80 }, { id: "34", name: "Bay Ford", n: 40 }],
      } });
    }
    if (url.pathname === "/api/vehicles/search") {
      const asked = ["fuel", "bodyStyle", "odometerMin", "drivetrain", "transmission", "dealerId", "vinPattern"].filter((k) => url.searchParams.has(k));
      return json({ vehicles: Array.from({ length: 3 }, (_, i) => mkVehicle(i)), total: 3, totalCapped: false, ...(boxCounts === "old" ? {} : { filtersApplied: asked }) });
    }
    return json({});
  };
}

describe("/search More filters, through the real page", () => {
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
    class FakeIO { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } }
    define("IntersectionObserver", FakeIO);
    (dom.window as unknown as Record<string, unknown>).IntersectionObserver = FakeIO;
    (dom.window.HTMLElement.prototype as unknown as { scrollTo: unknown }).scrollTo = function (this: HTMLElement) { this.scrollTop = 0; };
  });
  after(() => dom.window.close());
  afterEach(() => { for (const r of roots.splice(0)) r.unmount(); });
  beforeEach(() => { calls = []; boxCounts = "full"; installFetch(); document.body.innerHTML = '<div id="root"></div>'; dom.window.history.replaceState(null, "", "/search"); });

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
    const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await tick(); }); };
    const wait = async (ms = 320) => { await act(async () => { await tick(ms); }); };
    const group = (label: string) => document.querySelector(`[role="group"][aria-label="${label}"]`);
    const chip = (label: string, text: string) => [...(group(label)?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.startsWith(text)) as HTMLButtonElement | undefined;
    await click(chip("Make", "Ford")!);
    return { click, wait, group, chip };
  }
  const openMore = async (h: Awaited<ReturnType<typeof mount>>) => { await h.click([...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("More filters")) as HTMLButtonElement); await h.wait(); };

  it("shows each group with live counts, hides zero-count chips, and lists the dealers", async () => {
    const h = await mount();
    await h.wait();
    await openMore(h);
    assert.ok(calls.some((c) => c.path === "/api/vehicles/facet-counts" && c.sp.get("make") === "Ford"));
    assert.match(h.chip("Fuel type", "Hybrid")!.textContent!, /90/);
    assert.equal(h.chip("Fuel type", "Diesel"), undefined); // 0 cars: not offered
    assert.match(h.chip("Body style", "Pickup")!.textContent!, /300/);
    assert.match(h.chip("Drivetrain", "AWD")!.textContent!, /250/);
    assert.match(h.chip("Days on market", "Under a week")!.textContent!, /60/);
    assert.match(h.chip("Dealer", "Metro Ford")!.textContent!, /80/);
    assert.match(h.chip("Interior colour", "Black")!.textContent!, /300/);
    assert.ok(document.querySelector('[data-testid="mileage-sparkline"]'));
    assert.ok(document.querySelector('[data-testid="year-sparkline"]'));
  });

  it("a pick becomes a removable pill, goes to the box, and is counted by the headline search", async () => {
    const h = await mount();
    await h.wait();
    await openMore(h);
    await h.click(h.chip("Fuel type", "Hybrid")!);
    await h.click(h.chip("Dealer", "Metro Ford")!);
    await h.wait();
    const pills = [...document.querySelectorAll('[aria-label="Active filters"] li')].map((li) => li.textContent);
    assert.ok(pills.some((t) => t?.includes("Hybrid")), String(pills));
    assert.ok(pills.some((t) => t?.includes("Metro Ford")), String(pills));
    const count = calls.filter((c) => c.path === "/api/vehicles/search" && c.sp.get("limit") === "1").pop();
    assert.deepEqual(count?.sp.getAll("fuel"), ["hybrid"]);
    assert.deepEqual(count?.sp.getAll("dealerId"), ["12"]);
    assert.match(window.location.search, /fuel=hybrid/);
    assert.match(window.location.search, /dealerId=12/);
    await h.click(document.querySelector('[aria-label="Remove Hybrid"]')!);
    assert.doesNotMatch(window.location.search, /fuel=/);
  });

  it("a too-broad set still offers the fixed choices, without numbers", async () => {
    boxCounts = "tooBroad";
    const h = await mount();
    await h.wait();
    await openMore(h);
    assert.ok(h.chip("Fuel type", "Hybrid"));
    assert.doesNotMatch(h.chip("Fuel type", "Hybrid")!.textContent!, /\d/);
    assert.equal(h.group("Body style"), null); // open-ended lists need the counts
    assert.match(document.body.textContent!, /Pick a model for a number on each choice/);
  });

  it("an older box hides the groups that need it, and a shared link's filters are reported as not applied", async () => {
    boxCounts = "old";
    dom.window.history.replaceState(null, "", "/search?make=Ford&fuel=gas&bodyStyle=SUV");
    const h = await mount();
    await h.wait();
    await openMore(h);
    assert.equal(h.group("Fuel type"), null);
    assert.equal(h.group("Drivetrain"), null);
    assert.ok(h.group("Days on market")); // an old param the box already honours
    const note = document.querySelector('[data-testid="unapplied-note"]');
    assert.ok(note, "the page says the filters were not applied");
    assert.match(note!.textContent!, /Body style/);
    assert.match(note!.textContent!, /Fuel type/);
  });
});
