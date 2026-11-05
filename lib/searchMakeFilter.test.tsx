// /search sidebar: only the six biggest makes show until "Show all makes"; the make search covers every make; a picked make stays
// visible; counts, selection and Clear all still work. Buyer-facing wording is "Color" (American), never "Colour".
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const MAKES = [
  ["Ford", 90], ["Toyota", 80], ["Chevrolet", 70], ["Honda", 60], ["BMW", 50], ["Kia", 40],
  ["Audi", 30], ["Volvo", 20], ["Porsche", 10], ["Lotus", 5],
].map(([label, count]) => ({ value: String(label), label: String(label), count: Number(count) }));
// Deliberately not in count order, to prove the ranking is by count, not list position.
const SHUFFLED = [MAKES[6], MAKES[0], MAKES[9], MAKES[3], MAKES[1], MAKES[8], MAKES[5], MAKES[2], MAKES[7], MAKES[4]];
const TOP6 = ["Ford", "Toyota", "Chevrolet", "Honda", "BMW", "Kia"];

let dom: JSDOM;
const roots: Array<{ unmount: () => void }> = [];

describe("sidebar make filter and Color wording", () => {
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/search" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent"]) define(k, w[k]);
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());
  afterEach(() => { for (const r of roots.splice(0)) r.unmount(); });

  const tick = () => new Promise((r) => setTimeout(r, 10));
  async function mount(initialMake = "") {
    const React = (await import("react")).default;
    (globalThis as { React?: unknown }).React = React;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { SearchFilterSidebar } = await import("../components/search/SearchFilterSidebar");
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root")!);
    roots.push(root);
    const empty = { state: "", make: initialMake, model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [] as string[], possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "" };
    function Host() {
      const [filters, setFilters] = React.useState(empty);
      return React.createElement(SearchFilterSidebar, {
        filters, setFilters, setMake: (make: string) => setFilters((f) => ({ ...f, make })), setModel: () => {},
        stateOptions: [], makeOptions: SHUFFLED, modelOptions: [], trimOptions: [], facetsFailed: false, facetsLoading: false,
        catalogOptions: [], catalogOptionsLoading: false, optionsEmptyMessage: "", exteriorColors: ["Black"], interiorColors: ["Tan"],
        clearAll: () => setFilters({ ...empty, make: "" }), contactFilterOn: false, blockedReason: null, dirty: false, searchLoading: false, submitSearch: () => {},
        live: { value: 1 }, excludedHidden: 0, drawerOpen: false, setDrawerOpen: () => {},
      } as never);
    }
    await act(async () => { root.render(React.createElement(Host)); await tick(); });
    const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await tick(); }); };
    const type = async (el: HTMLInputElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        await tick();
      });
    };
    const pills = () => [...document.querySelectorAll('ul[aria-label="Makes"] button')];
    const makes = () => pills().map((b) => b.textContent!.replace(/\d[\d,]*$/, "").trim());
    const toggle = () => [...document.querySelectorAll("button")].find((b) => /^(Show all makes|Show fewer)$/.test(b.textContent?.trim() ?? ""));
    const box = () => document.querySelector('input[aria-label="Search makes"]') as HTMLInputElement;
    return { click, type, pills, makes, toggle, box };
  }

  it("shows only the top six makes by count, with counts, and a Show all makes control", async () => {
    const t = await mount();
    assert.deepEqual(t.makes(), TOP6);
    assert.match(document.querySelector('ul[aria-label="Makes"]')!.textContent ?? "", /Ford90/);
    assert.equal(t.toggle()?.textContent?.trim(), "Show all makes");
    assert.equal(t.toggle()?.getAttribute("aria-expanded"), "false");
  });

  it("Show all makes expands inline, becomes Show fewer, and collapses back", async () => {
    const t = await mount();
    await t.click(t.toggle()!);
    assert.equal(t.makes().length, 10);
    assert.equal(t.toggle()?.textContent?.trim(), "Show fewer");
    await t.click(t.toggle()!);
    assert.equal(t.makes().length, 6);
    assert.equal(t.toggle()?.textContent?.trim(), "Show all makes");
  });

  it("searching makes searches the full list, not only the six visible", async () => {
    const t = await mount();
    await t.type(t.box(), "lotus");
    assert.deepEqual(t.makes(), ["Lotus"]);
    assert.equal(t.toggle(), undefined, "no expand control while searching");
    await t.type(t.box(), "");
    assert.equal(t.makes().length, 6);
  });

  it("a selected make outside the top six stays visible; clicking again clears it", async () => {
    const t = await mount();
    await t.click(t.toggle()!);
    await t.click(t.pills().find((b) => b.textContent!.startsWith("Lotus"))!);
    await t.click(t.toggle()!); // collapse
    assert.equal(t.makes().length, 7);
    assert.ok(t.makes().includes("Lotus"));
    const lotus = t.pills().find((b) => b.textContent!.startsWith("Lotus"))!;
    assert.equal(lotus.getAttribute("aria-pressed"), "true");
    await t.click(lotus);
    assert.deepEqual(t.makes(), TOP6);
  });

  it("Clear all removes the selection and the list returns to the top six", async () => {
    const t = await mount("Porsche");
    assert.ok(t.makes().includes("Porsche"));
    const clear = [...document.querySelectorAll("button")].find((b) => /^Clear all/i.test(b.textContent?.trim() ?? ""));
    assert.ok(clear, "Clear all is offered while a make is picked");
    await t.click(clear!);
    assert.deepEqual(t.makes(), TOP6);
  });

  it('says "Color", never "Colour", anywhere a buyer reads it', async () => {
    await mount();
    assert.doesNotMatch(document.body.innerHTML, /colour/i);
    const titles = [...document.querySelectorAll("button[aria-expanded]")].map((b) => b.textContent?.trim());
    assert.ok(titles.includes("Color"));
  });
});
