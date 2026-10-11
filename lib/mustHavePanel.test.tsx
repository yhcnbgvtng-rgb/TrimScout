// RFQ must-have panel layout — chips on top, first 6 options, "Show all N options" expands in place, summary by Continue.
// Drives the real BiddingWizard in jsdom, same harness as factoryOptionsCompare.test.tsx.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const VIN_OPTS = "1FTFW1E80PFA00011";
const VIN_NONE = "1FTFW1E80PFA00012";
const FREEDOM = { deskId: "1", dealerName: "Freedom Ford", city: "Wayne", state: "NJ", zip: "07470", knownNamed: true, emailOptOut: false };
const PKGS = Array.from({ length: 9 }, (_, i) => `Option ${i + 1} Package`);

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

describe("Must-have panel layout", () => {
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

  it("shows chips, only the first 6 options, no inner scroll box, and expands in place", async () => {
    const t = await open(VIN_OPTS);
    await t.click(t.toggle());
    const panel = t.panel()!;
    assert.equal(panel.querySelector(".overflow-y-auto"), null, "no inner scroll box");
    assert.equal(panel.querySelectorAll('[data-testid="must-have-options"] input[type="checkbox"]').length, 6);
    assert.equal(t.doc.querySelector('[data-testid="must-have-chips"]'), null, "no chips until something is picked");
    const more = t.doc.querySelector('[data-testid="must-have-show-all"]')!;
    assert.match(more.textContent || "", /Show all 9 options/);
    await t.click(more);
    assert.equal(t.panel()!.querySelectorAll('[data-testid="must-have-options"] input[type="checkbox"]').length, 9);
    assert.match(t.doc.querySelector('[data-testid="must-have-show-all"]')!.textContent || "", /Show fewer/);
    await t.act(async () => { t.root.unmount(); });
  });

  it("selected options become removable chips and a summary sits next to Continue", async () => {
    const t = await open(VIN_OPTS);
    await t.click(t.toggle());
    assert.equal(t.doc.querySelector('[data-testid="must-have-summary"]'), null);
    const boxes = () => Array.from(t.panel()!.querySelectorAll('[data-testid="must-have-options"] input[type="checkbox"]'));
    await t.click(boxes()[0]);
    await t.click(boxes()[1]);
    await t.click(boxes()[2]);
    assert.equal(t.doc.querySelectorAll('[data-testid="must-have-chips"] > span').length, 3);
    assert.equal(t.doc.querySelector('[data-testid="must-have-summary"]')!.textContent, "3 must-haves selected");
    await t.click(t.doc.querySelector('[data-testid="must-have-chip-remove"]')!);
    assert.equal(t.doc.querySelectorAll('[data-testid="must-have-chips"] > span').length, 2);
    assert.equal(t.doc.querySelector('[data-testid="must-have-summary"]')!.textContent, "2 must-haves selected");
    await t.click(t.doc.querySelector('[data-testid="must-have-chip-remove"]')!);
    assert.equal(t.doc.querySelector('[data-testid="must-have-summary"]')!.textContent, "1 must-have selected");
    await t.act(async () => { t.root.unmount(); });
  });
});
