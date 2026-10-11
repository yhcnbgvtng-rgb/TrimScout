// RFQ vehicle step — "I have must-have factory options" checkbox (replaces the collapsible row).
// Drives the real BiddingWizard in jsdom, same harness as factoryOptionsCompare.test.tsx.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const VIN_OPTS = "1FTFW1E80PFA00011";
const VIN_NONE = "1FTFW1E80PFA00012";
const FREEDOM = { deskId: "1", dealerName: "Freedom Ford", city: "Wayne", state: "NJ", zip: "07470", knownNamed: true, emailOptOut: false };
const PKGS = ["FX4 Off-Road Package", "Panoramic Vista Roof", "Max Trailer Tow Package"];

const ford = (vin: string, packages: string[]) => ({
  id: vin, vin, year: 2026, make: "Ford", model: "F-150", trim: "Lariat", bodyType: "Truck", engine: "3.5L V6", drivetrain: "4WD", transmission: "Auto",
  exteriorColor: "Agate Black", interiorColor: "Black", msrp: 61000, dealerPrice: 61000, daysOnLot: 3, status: "in_stock",
  location: { dealerName: "Freedom Ford", city: "Wayne", state: "NJ", distanceMiles: 5, dealerConfirmed: true, dealerSource: "website" },
  packages, options: [], features: [], images: [], buildConfidence: "verified_factory",
});

function stubFetch() {
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}")) as { paste?: string; vin?: string };
    const vin = (body.vin || (body.paste || "").match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0] || "").toUpperCase();
    if (url.startsWith("/api/desk-resolve")) return json({ status: "unique", desk: FREEDOM, via: "website", host: "freedomford.com" });
    if (url.includes("-sticker")) {
      const pk = vin === VIN_OPTS ? PKGS : [];
      return json({
        handled: true, vin, sticker: { status: "released", pdfUrl: "https://example.test/s.pdf", msrp: 61000 },
        vehicle: ford(vin, pk), buildConfidence: "verified_factory", mustHaveLines: [], niceToHaveLines: [],
        filterableOptions: pk.map((name) => ({ name, code: null, description: name, price: 0 })), pdfUrl: "https://example.test/s.pdf",
      });
    }
    if (url.startsWith("/api/status/features")) return json({ rfqSend: true });
    if (url.startsWith("/api/quote-desks")) return json({ desks: {} });
    if (url.startsWith("/api/dealer-contact")) return json({ contacts: {} });
    return json({});
  };
}

describe("Must-have factory options checkbox", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("fetch", stubFetch());
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());

  async function open(vin: string, confirmAnswer = true) {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");
    const doc = dom.window.document;
    let confirmCalls = 0;
    (dom.window as unknown as { confirm: () => boolean }).confirm = () => { confirmCalls++; return confirmAnswer; };
    let setOpen!: (v: boolean) => void;
    function Host() {
      const [o, _o] = React.useState(false);
      setOpen = _o;
      return React.createElement(BiddingWizard, { key: 1, isOpen: o, onClose: () => _o(false), onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, currentUser: null, onRequireLogin: () => {} });
    }
    const root = createRoot(doc.getElementById("root")!);
    await act(async () => { root.render(React.createElement(Host)); });
    await act(async () => { setOpen(true); });
    const tick = async () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const settle = async (pred: () => boolean) => { for (let i = 0; i < 60 && !pred(); i++) await tick(); assert.ok(pred(), "settled"); };
    const input = doc.getElementById("primary-link-input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, vin); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    const row = input.closest("div")!.parentElement!;
    await act(async () => { Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Add")!.click(); });
    await settle(() => Boolean(doc.querySelector('[data-testid="must-have-toggle"]')));
    const toggle = () => doc.querySelector('[data-testid="must-have-toggle"]') as HTMLButtonElement;
    const panel = () => doc.querySelector('[data-testid="must-have-panel"]');
    const click = async (el: Element) => act(async () => { (el as HTMLElement).click(); });
    return { doc, act, root, toggle, panel, click, confirms: () => confirmCalls };
  }

  it("is an off switch by default with no panel; turning it on shows the list and the N of M count", async () => {
    const t = await open(VIN_OPTS);
    assert.equal(t.toggle().getAttribute("role"), "switch");
    // A native <button type="button"> is focusable and toggles on Space/Enter in browsers.
    assert.equal(t.toggle().tagName, "BUTTON");
    assert.equal(t.toggle().getAttribute("type"), "button");
    assert.doesNotMatch(t.toggle().className, /bg-brand-500/, "no green while off");
    assert.equal(t.toggle().getAttribute("aria-checked"), "false");
    assert.equal(t.toggle().disabled, false);
    assert.equal(t.panel(), null);
    assert.equal(t.toggle().getAttribute("aria-expanded"), "false");
    await t.click(t.toggle());
    assert.equal(t.toggle().getAttribute("aria-checked"), "true");
    assert.equal(t.toggle().getAttribute("aria-expanded"), "true");
    assert.match(t.toggle().className, /bg-brand-500/, "green accent while on");
    assert.ok(t.panel());
    assert.match(t.panel()!.textContent || "", /FX4 Off-Road Package/);
    assert.match(t.doc.querySelector('[data-testid="must-have-count"]')!.textContent || "", /0 of 3 selected/);
    await t.act(async () => { t.root.unmount(); });
  });

  it("unchecking with no picks collapses without a prompt; with picks it confirms and clears", async () => {
    const t = await open(VIN_OPTS);
    await t.click(t.toggle());
    await t.click(t.toggle());
    assert.equal(t.confirms(), 0);
    assert.equal(t.panel(), null);

    await t.click(t.toggle());
    const box = t.panel()!.querySelector('input[type="checkbox"]')!;
    await t.click(box);
    assert.match(t.doc.querySelector('[data-testid="must-have-count"]')!.textContent || "", /1 of 3 selected/);
    await t.click(t.toggle());
    assert.equal(t.confirms(), 1, "asked before discarding a pick");
    assert.equal(t.toggle().getAttribute("aria-checked"), "false");
    assert.equal(t.panel(), null);
    await t.click(t.toggle());
    assert.match(t.doc.querySelector('[data-testid="must-have-count"]')!.textContent || "", /0 of 3 selected/, "pick was cleared");
    await t.act(async () => { t.root.unmount(); });
  });

  it("declining the confirm keeps the list and selections", async () => {
    const t = await open(VIN_OPTS, false);
    await t.click(t.toggle());
    await t.click(t.panel()!.querySelector('input[type="checkbox"]')!);
    await t.click(t.toggle());
    assert.equal(t.confirms(), 1);
    assert.equal(t.toggle().getAttribute("aria-checked"), "true");
    assert.match(t.doc.querySelector('[data-testid="must-have-count"]')!.textContent || "", /1 of 3 selected/);
    await t.act(async () => { t.root.unmount(); });
  });

  it("is disabled with an explanation when the vehicle has no policy options", async () => {
    const t = await open(VIN_NONE);
    assert.equal(t.toggle().disabled, true);
    assert.equal(t.toggle().getAttribute("aria-checked"), "false");
    assert.equal(t.panel(), null);
    assert.match(t.doc.querySelector('[data-testid="must-have-section"]')!.textContent || "", /No factory options on file for this vehicle/);
    await t.act(async () => { t.root.unmount(); });
  });

  it("saves the checkbox state with the parked request draft", async () => {
    const t = await open(VIN_OPTS);
    await t.click(t.toggle());
    const src = (await import("node:fs")).readFileSync(new URL("../components/BiddingWizard.tsx", import.meta.url), "utf8");
    assert.match(src, /mustHavePackages,\n\s+wantsMustHaves,/, "wantsMustHaves is part of draftState");
    assert.match(src, /pick<boolean>\("wantsMustHaves", setWantsMustHaves\)/, "and is restored from the draft");
    await t.act(async () => { t.root.unmount(); });
  });
});
