// /search Color filter: the Exterior / Interior lists only ever come from the make/model-scoped catalog call, never the all-makes
// catalog, and the previous scope's colors never linger while a new scope loads. "Any" is always first.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { withPicked } from "../components/search/SearchFilterSidebar";

describe("withPicked", () => {
  it("keeps an active pick selectable and does not duplicate a listed one", () => {
    assert.deepEqual(withPicked(["Black"], "Red"), ["Red", "Black"]);
    assert.deepEqual(withPicked(["Black", "Red"], "Red"), ["Black", "Red"]);
    assert.deepEqual(withPicked(["Black"], ""), ["Black"]);
  });
});

let dom: JSDOM;
const roots: Array<{ unmount: () => void }> = [];
const optionCalls: string[] = [];

function installFetch() {
  optionCalls.length = 0;
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/catalog/facets") return json({ states: [], makes: [{ make: "Chevrolet", n: 3 }], models: [{ model: "Equinox", n: 3 }], trims: [] });
    if (url.pathname === "/api/catalog/options") {
      optionCalls.push(url.search);
      // The all-makes catalog is the huge unscoped list; only a scoped call gets the short one.
      return url.searchParams.get("make")
        ? json({ options: [], exteriorColors: ["Black", "Cajun Red Tintcoat", "Gray Metallic"], interiorColors: ["Jet Black"] })
        : json({ options: [], exteriorColors: ["Accelerate Yellow", "Zircon"], interiorColors: ["Zebra"] });
    }
    if (url.pathname === "/api/vehicles/search") return json({ vehicles: [], total: 0, totalCapped: false });
    return json({});
  };
}

describe("/search Color options, rendered", () => {
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
  beforeEach(() => { installFetch(); document.body.innerHTML = '<div id="root"></div>'; dom.window.localStorage.clear(); });

  const tick = () => new Promise((r) => setTimeout(r, 30));
  async function mount(path: string) {
    dom.window.history.replaceState(null, "", path);
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
    await act(async () => { root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(SessionProvider as never, { session: null } as never, React.createElement(BuyerSearchView)))); await tick(); await tick(); });
    const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await tick(); }); };
    // The Color accordion starts closed.
    const header = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("Color"));
    if (header && header.getAttribute("aria-expanded") === "false") await click(header);
    const optionsOf = (label: string) => {
      const l = [...document.querySelectorAll("label")].find((x) => x.textContent?.trim() === label);
      const sel = l ? document.getElementById(l.getAttribute("for")!) as HTMLSelectElement | null : null;
      return sel ? [...sel.options].map((o) => o.textContent) : null;
    };
    return { optionsOf };
  }

  it("with a make set, Exterior and Interior list only the scoped colors, Any first", async () => {
    const { optionsOf } = await mount("/search?make=Chevrolet&model=Equinox");
    assert.ok(optionCalls.some((q) => q.includes("make=Chevrolet") && q.includes("model=Equinox")), optionCalls.join(","));
    assert.deepEqual(optionsOf("Exterior color"), ["Any", "Black", "Cajun Red Tintcoat", "Gray Metallic"]);
    assert.deepEqual(optionsOf("Interior color"), ["Any", "Jet Black"]);
  });

  it("with no make, the all-makes catalog is never fetched or offered: only Any", async () => {
    const { optionsOf } = await mount("/search");
    assert.equal(optionCalls.length, 0, optionCalls.join(","));
    assert.deepEqual(optionsOf("Exterior color"), ["Any"]);
    assert.deepEqual(optionsOf("Interior color"), ["Any"]);
  });
});
