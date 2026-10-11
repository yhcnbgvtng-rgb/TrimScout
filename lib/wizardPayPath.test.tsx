// Step 2 asks one question after the VDPs: "Lease or buy?" with two tiles, Lease and Cash / Finance. This drives the real
// BiddingWizard in a DOM (network stubbed) from Step 1 to Step 3 to see what a buyer sees.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const VIN = "2T2HGCEZ9TC38B302"; // Lexus
const vehicle = {
  id: VIN, vin: VIN, year: 2026, make: "Lexus", model: "RX", trim: "Base", bodyType: "SUV", engine: "", drivetrain: "AWD", transmission: "Auto", exteriorColor: "White", interiorColor: "Black",
  msrp: 40000, dealerPrice: 40000, daysOnLot: 3, status: "in_stock",
  location: { dealerName: "Lexus of Route 10", city: "Denville", state: "NJ", zip: "07834", distanceMiles: 5, dealerConfirmed: true },
  packages: [], options: [], features: [], images: [],
};
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

let stagesOn = true;
describe("Step 2: Lease or Cash / Finance", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("-sticker") || url.includes("/api/used-vin")) return json({ vin: VIN, vehicle, sticker: { status: "released" } });
      if (url.startsWith("/api/status/features")) return json({ rfqSend: true, outboundDealerEmail: true, dealStages: stagesOn, banner: null });
      if (url.startsWith("/api/quote-desks")) return json({ desks: {} });
      if (url.startsWith("/api/dealer-contact")) return json({ contacts: {} });
      return json({}, 404);
    });
    define("IS_REACT_ACT_ENVIRONMENT", true);
  });
  after(() => dom.window.close());

  it("offers exactly Lease and Cash / Finance, assumes neither, then shows the four buy-path stages and never finance locks", async () => {
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
    const click = async (el: Element | null | undefined) => { assert.ok(el, "element present"); await act(async () => { (el as HTMLElement).click(); }); };
    const button = (label: string) => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(label));

    // Step 1: paste the VDP, then Continue.
    const input = doc.getElementById("primary-link-input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, VIN); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    await click(button("Add"));
    for (let i = 0; i < 20 && !doc.body.textContent?.includes(`VIN ${VIN}`); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await click(button("Continue"));
    assert.match(doc.body.textContent || "", /Lease or buy\?/, "Step 2 asks one question");

    const lease = doc.querySelector('[data-testid="quote-type-lease"]');
    const buy = doc.querySelector('[data-testid="quote-type-cash_finance"]');
    assert.ok(lease && buy, "two tiles");
    assert.equal(doc.querySelectorAll('[role="radiogroup"][aria-label="Lease or buy"] [role="radio"]').length, 2);
    assert.equal(lease!.textContent, "Lease"); assert.equal(buy!.textContent, "Cash / Finance");
    assert.equal(doc.querySelector('[data-testid="quote-type-finance"]'), null, "no separate Finance tile");
    assert.equal(doc.querySelector('[data-testid="quote-type-cash"]'), null, "no separate Cash tile");
    assert.equal(lease!.getAttribute("aria-checked"), "false"); assert.equal(buy!.getAttribute("aria-checked"), "false");
    assert.equal(button("Continue")?.disabled, true, "nothing assumed: Continue waits for a choice");
    assert.equal(doc.querySelector('[data-testid="buy-path-stages"]'), null);

    await click(buy);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    assert.equal(buy!.getAttribute("aria-checked"), "true"); assert.equal(lease!.getAttribute("aria-checked"), "false");
    const stages = doc.querySelector('[data-testid="buy-path-stages"]')!;
    assert.ok(stages);
    const items = Array.from(stages.querySelectorAll("li")).map((li) => li.textContent);
    assert.equal(items.length, 4);
    assert.match(items[0]!, /out-the-door \(OTD\) price/); assert.match(items[1]!, /trade-in/); assert.match(items[2]!, /True OTD = OTD minus trade-in value/); assert.match(items[3]!, /cash, or ask the dealer for a finance quote/);
    assert.equal(button("Continue")?.disabled, false);

    // Step 3 for the buy path: the OTD stage only; no term, down payment or credit band.
    await click(button("Continue"));
    const text = doc.body.textContent || "";
    assert.match(text, /Out-the-door price/);
    assert.match(text, /no finance terms yet/);
    assert.doesNotMatch(text, /Credit band|Down payment|Loan term/i);

    // Back, then Lease still goes to the lease flow.
    await click(button("Back"));
    await click(doc.querySelector('[data-testid="quote-type-lease"]'));
    assert.equal(doc.querySelector('[data-testid="buy-path-stages"]'), null, "the stage list belongs to the buy path only");
    await click(button("Continue"));
    assert.match(doc.body.textContent || "", /Lease|term|miles/i);
    await act(async () => { root.unmount(); });
  });
});

describe("Step 2 while the staged flow is not live (FEATURE_DEAL_STAGES off)", () => {
  it("still offers the two tiles, but does not promise stages that the server can't run", async () => {
    stagesOn = false;
    const dom2 = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
    const w = dom2.window as unknown as Record<string, unknown>;
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");
    const root = createRoot(dom2.window.document.getElementById("root")!);
    await act(async () => { root.render(React.createElement(BiddingWizard, { key: 2, isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, currentUser: null, onRequireLogin: () => {} })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const doc = dom2.window.document;
    const input = doc.getElementById("primary-link-input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(dom2.window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, VIN); input.dispatchEvent(new dom2.window.Event("input", { bubbles: true })); });
    const button = (label: string) => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(label));
    await act(async () => { button("Add")!.click(); });
    for (let i = 0; i < 20 && !doc.body.textContent?.includes(`VIN ${VIN}`); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await act(async () => { button("Continue")!.click(); });
    await act(async () => { (doc.querySelector('[data-testid="quote-type-cash_finance"]') as HTMLElement).click(); });
    assert.equal(doc.querySelector('[data-testid="buy-path-stages"]'), null, "no four-stage promise while the flag is off");
    assert.match(doc.body.textContent || "", /starts with dealers quoting the out-the-door price/);
    assert.equal(button("Continue")?.disabled, false);
    await act(async () => { root.unmount(); });
    dom2.window.close();
    stagesOn = true;
  });
});
