// Configure Quote Request — once the buyer has all 3 VDPs resolved (This exact
// vehicle) and picked must-haves, the wizard shows a 3-way compare: must-haves
// scored per vehicle, the factory build, and everything else that differs.
// Drives the real BiddingWizard in jsdom, same harness as wizardResolve.test.tsx.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const VIN_PRIMARY = "1FTFW1E80PFA00001";
const VIN_ALT1 = "1FTFW1E80PFA00002";
const VIN_ALT2 = "1FTFW1E80PFA00003";
const FREEDOM = { deskId: "1", dealerName: "Freedom Ford", city: "Wayne", state: "NJ", zip: "07470", knownNamed: true, emailOptOut: false };

const MUST_HAVES = ["FX4 Off-Road Package", "Panoramic Vista Roof"];

const ford = (vin: string, over: Record<string, unknown>) => ({
  id: vin, vin, year: 2026, make: "Ford", model: "F-150", trim: "Lariat", bodyType: "Truck", engine: "3.5L V6", drivetrain: "4WD", transmission: "Auto",
  exteriorColor: "Agate Black", interiorColor: "Black", msrp: 61000, dealerPrice: 61000, daysOnLot: 3, status: "in_stock",
  location: { dealerName: "Freedom Ford", city: "Wayne", state: "NJ", distanceMiles: 5, dealerConfirmed: true, dealerSource: "website" },
  packages: [], options: [], features: [], images: [], buildConfidence: "verified_factory", ...over,
});

const primaryVehicle = ford(VIN_PRIMARY, {
  packages: ["FX4 Off-Road Package", "Panoramic Vista Roof", "Max Trailer Tow Package", "Bang & Olufsen Audio"],
});
const alt1Vehicle = ford(VIN_ALT1, {
  exteriorColor: "Oxford White",
  packages: ["FX4 Off-Road Package", "Max Trailer Tow Package", "Adaptive Cruise Package"], // no Panoramic Vista Roof, no B&O; adds Adaptive Cruise
});
const alt2Vehicle = ford(VIN_ALT2, {
  trim: "King Ranch",
  exteriorColor: "Star White Metallic",
  packages: ["FX4 Off-Road Package", "Panoramic Vista Roof", "Max Trailer Tow Package", "Bang & Olufsen Audio", "Massaging Front Seats", "Pro Trailer Backup Assist"],
});

function stubFetch() {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}")) as { paste?: string; vin?: string; url?: string };
    const vin = (body.vin || (body.paste || "").match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0] || "").toUpperCase();
    if (url.startsWith("/api/desk-resolve")) {
      return json({ status: "unique", desk: FREEDOM, via: "website", host: "freedomford.com" });
    }
    if (url.includes("-sticker")) {
      const veh = vin === VIN_PRIMARY ? primaryVehicle : vin === VIN_ALT1 ? alt1Vehicle : vin === VIN_ALT2 ? alt2Vehicle : null;
      if (!veh) return json({ handled: false, notFord: true, vin, error: "unknown" });
      const mustHaveLines = vin === VIN_PRIMARY ? MUST_HAVES : [];
      return json({
        handled: true,
        vin,
        sticker: { status: "released", pdfUrl: "https://example.test/sticker.pdf", msrp: veh.msrp },
        vehicle: veh,
        buildConfidence: "verified_factory",
        mustHaveLines,
        niceToHaveLines: [],
        filterableOptions: (veh.packages as string[]).map((name) => ({ name, code: null, description: name, price: 0 })),
        pdfUrl: "https://example.test/sticker.pdf",
      });
    }
    if (url.startsWith("/api/events/track")) return json({ ok: true });
    if (url.startsWith("/api/status/features")) return json({ rfqSend: true });
    if (url.startsWith("/api/quote-desks")) return json({ desks: {} });
    if (url.startsWith("/api/dealer-contact")) return json({ contacts: {} });
    return json({});
  };
}

describe("Compare factory options — after all 3 VDPs resolve with must-haves picked (2026-09-20)", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("fetch", stubFetch());
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());

  it("shows the compare panel only once all 3 vehicles resolve and must-haves are picked, scored correctly", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");

    let setOpen!: (v: boolean) => void;
    function Host() {
      const [open, _setOpen] = React.useState(false);
      setOpen = _setOpen;
      return React.createElement(BiddingWizard, { key: 1, isOpen: open, onClose: () => _setOpen(false), onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, currentUser: null, onRequireLogin: () => {} });
    }
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { root.render(React.createElement(Host)); });
    await act(async () => { setOpen(true); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const doc = dom.window.document;
    const text = () => doc.body.textContent || "";
    const tick = async (n = 1) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
    const settle = async (pred: () => boolean) => { for (let i = 0; i < 60 && !pred(); i++) await tick(); assert.ok(pred(), "settled"); };
    const setVal = async (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      await act(async () => { setter.call(el, value); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    };
    const addNear = (input: HTMLInputElement) => {
      const row = (input.closest("div")!.parentElement)!; // the "flex gap-2" row: input wrapper + Add button
      return Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Add")!;
    };

    // same_spec is the default on open.
    assert.equal(doc.querySelector('[data-testid="intent-same_spec"]')?.getAttribute("aria-checked"), "true");
    assert.equal(doc.querySelector('[data-testid="factory-options-compare"]'), null, "no compare panel before any vehicle resolves");

    // Primary resolves — brings its own must-haves (mustHaveLines) with it.
    const primaryInput = doc.getElementById("primary-link-input") as HTMLInputElement;
    await setVal(primaryInput, VIN_PRIMARY);
    await act(async () => { addNear(primaryInput).click(); });
    await settle(() => text().includes("2026 Ford F-150 Lariat"));
    assert.equal(doc.querySelector('[data-testid="factory-options-compare"]'), null, "still no compare panel — only 1 of 3 VDPs in");

    // Alternate 1 resolves.
    const alt1Input = doc.querySelector('input[aria-label="Alternate 1"]') as HTMLInputElement;
    await setVal(alt1Input, VIN_ALT1);
    await act(async () => { addNear(alt1Input).click(); });
    await settle(() => text().includes("Oxford White") || Boolean(doc.querySelector('[data-dealer-shown]')));
    assert.equal(doc.querySelector('[data-testid="factory-options-compare"]'), null, "still no compare panel — only 2 of 3 VDPs in");

    // Alternate 2 resolves — now all 3 VDPs are in and must-haves are picked.
    const alt2Input = doc.querySelector('input[aria-label="Alternate 2"]') as HTMLInputElement;
    await setVal(alt2Input, VIN_ALT2);
    await act(async () => { addNear(alt2Input).click(); });
    await settle(() => Boolean(doc.querySelector('[data-testid="factory-options-compare"]')));

    const panel = doc.querySelector('[data-testid="factory-options-compare"]') as HTMLElement;
    const panelText = panel.textContent || "";

    // Must-haves: both selected names appear, scored against each vehicle's own factory record.
    assert.match(panelText, /FX4 Off-Road Package/);
    assert.match(panelText, /Panoramic Vista Roof/);
    assert.match(panelText, /2 of 2/, "primary: has both must-haves");
    assert.match(panelText, /1 of 2/, "alternate 1: missing Panoramic Vista Roof");
    // Two vehicles score "2 of 2" (primary + alternate 2) and exactly one scores "1 of 2".
    assert.equal((panelText.match(/2 of 2/g) || []).length, 2);
    assert.equal((panelText.match(/1 of 2/g) || []).length, 1);

    // Factory build: the differing trim and colors are called out.
    assert.match(panelText, /King Ranch/);
    assert.match(panelText, /Oxford White/);
    assert.match(panelText, /Star White Metallic/);

    // Other differences: alt 1 is missing a non-must-have package and adds one; alt 2 adds two.
    assert.match(panelText, /Bang & Olufsen Audio/, "alt 1's non-must-have miss is named");
    assert.match(panelText, /Adaptive Cruise Package/, "alt 1's extra package is named");
    assert.match(panelText, /Massaging Front Seats/);
    assert.match(panelText, /Pro Trailer Backup Assist/);

    // Never a composite "deal score" — only the facts above.
    assert.doesNotMatch(panelText, /deal score|overall score|% match/i);
    await act(async () => { root.unmount(); });
  });
});

describe("Compare 'Other differences' chips — +N more expands in place, per column", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());

  it("collapses to 2 chips + a button; expand shows all, 'Show less' collapses, focus stays, glyphs cleaned", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { FactoryOptionsCompare } = await import("../components/BiddingWizard");
    const primary = ford(VIN_PRIMARY, { packages: ["▤DUAL VALVE SHOCKS", "A1", "B2", "C3", "Last Pkg"] });
    const alt1 = ford(VIN_ALT1, { packages: ["X1", "X2", "X3", "XLast"] });
    const alt2 = ford(VIN_ALT2, { packages: ["▤DUAL VALVE SHOCKS", "A1", "B2", "C3", "Last Pkg"] });
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(FactoryOptionsCompare as never, { primary, alt1, alt2, mustHaves: [], stickerStates: {} }));
    });
    const doc = dom.window.document;
    const btn = (k: string) => doc.querySelector(`[data-testid="compare-${k}-toggle"]`) as HTMLButtonElement | null;
    const text = () => doc.body.textContent || "";

    // alt1 (column 0): 5 missing → 2 shown, button "+3 more missing"; 4 extra → "+2 more added".
    const m0 = btn("missing-0")!;
    assert.equal(m0.tagName, "BUTTON");
    assert.equal(m0.getAttribute("aria-expanded"), "false");
    assert.equal(m0.textContent, "+3 more missing");
    assert.match(text(), /DUAL VALVE SHOCKS/);
    assert.doesNotMatch(text(), /▤/, "stray glyph is never displayed");
    assert.doesNotMatch(text(), /Last Pkg/, "hidden option not shown while collapsed");
    assert.equal(btn("extra-0")!.textContent, "+2 more added");
    assert.equal(btn("missing-1"), null, "alt2 has nothing missing → no button");

    m0.focus();
    await act(async () => { m0.click(); });
    assert.match(text(), /Last Pkg/, "every hidden option shown once expanded");
    assert.equal(btn("missing-0")!.getAttribute("aria-expanded"), "true");
    assert.equal(btn("missing-0")!.textContent, "Show less");
    assert.equal(doc.activeElement, btn("missing-0"), "focus stays on the control");
    assert.equal(btn("extra-0")!.getAttribute("aria-expanded"), "false", "columns/rows expand independently");
    assert.doesNotMatch(text(), /XLast/);

    await act(async () => { btn("missing-0")!.click(); });
    assert.doesNotMatch(text(), /Last Pkg/, "collapses again");
    assert.equal(btn("missing-0")!.textContent, "+3 more missing");
    assert.equal(doc.activeElement, btn("missing-0"));
    await act(async () => { root.unmount(); });
  });
});
