// Live-QA bug 2026-09-16: reopening Configure Quote Request for a second VIN still showed the first VIN's
// car and dealer. This drives the real BiddingWizard in a DOM, through the same open/close pattern
// app/page.tsx uses (a fresh instance per buyer-initiated open), with the network stubbed at fetch.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const VIN_A = "KNDNB4H36T6123456"; // Kia (KN…)
const VIN_B = "2T2HGCEZ9TC38B302"; // Lexus (2T2…)

const vehicle = (vin: string, make: string, model: string, dealerName: string) => ({
  id: vin, vin, year: 2026, make, model, trim: "Base", bodyType: "SUV", engine: "", drivetrain: "AWD", transmission: "Auto", exteriorColor: "White", interiorColor: "Black",
  msrp: 40000, dealerPrice: 40000, daysOnLot: 3, status: "in_stock",
  location: { dealerName, city: "Denville", state: "NJ", zip: "07834", distanceMiles: 5, dealerConfirmed: true },
  packages: [], options: [], features: [], images: [],
});

function stubFetch() {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("-sticker") || url.includes("/api/used-vin")) {
      const body = JSON.parse(String(init?.body || "{}")) as { paste?: string; vin?: string };
      const vin = (body.vin || body.paste || "").trim().toUpperCase();
      if (vin === VIN_A) return json({ vin, vehicle: vehicle(vin, "Kia", "Carnival", "Performance Kia of Denville"), sticker: { status: "released" } });
      if (vin === VIN_B) return json({ vin, vehicle: vehicle(vin, "Lexus", "RX", "Lexus of Route 10"), sticker: { status: "released" } });
      return json({ error: "unknown vin" }, 404);
    }
    if (url.startsWith("/api/status/features")) return json({ rfqSend: true });
    if (url.startsWith("/api/quote-desks")) return json({ desks: {} });
    if (url.startsWith("/api/dealer-contact")) return json({ contacts: {} });
    if (url.startsWith("/api/dealer-responsiveness") || url.startsWith("/api/typical-otd")) return json({});
    return json({}, 404);
  };
}

describe("Configure Quote Request starts fresh on every open", () => {
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

  it("resolving VIN B after VIN A shows B's make and never A's, on Step 1, before Continue", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");

    // The host mirrors app/page.tsx: a session counter bumped on every buyer-initiated open keys the wizard.
    let setOpen!: (v: boolean) => void;
    let bump!: () => void;
    function Host() {
      const [open, _setOpen] = React.useState(false);
      const [session, setSession] = React.useState(0);
      setOpen = _setOpen;
      bump = () => setSession((n) => n + 1);
      return React.createElement(BiddingWizard, { key: session, isOpen: open, onClose: () => _setOpen(false), onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, currentUser: null, onRequireLogin: () => {} });
    }
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { root.render(React.createElement(Host)); });

    const openFresh = async () => { await act(async () => { bump(); setOpen(true); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); await act(async () => { (dom.window.document.querySelector('[data-testid="intent-same_spec"]') as HTMLButtonElement).click(); }); await act(async () => { Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith("Continue"))!.click(); }); };
    const paste = async (vin: string) => {
      const input = dom.window.document.getElementById("primary-link-input") as HTMLInputElement;
      assert.ok(input, "Step 1 paste box is on screen");
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      await act(async () => { setter.call(input, vin); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
      const add = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Add");
      assert.ok(add, "Add button on screen");
      await act(async () => { add.click(); });
      for (let i = 0; i < 20 && !dom.window.document.body.textContent?.includes(`VIN ${vin}`); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    };
    const text = () => dom.window.document.body.textContent || "";

    // Open → resolve A.
    await openFresh();
    assert.equal((dom.window.document.getElementById("primary-link-input") as HTMLInputElement).value, "", "opens with an empty paste box");
    await paste(VIN_A);
    assert.match(text(), /Kia/);
    assert.match(text(), /Carnival/);

    // Close (the header Close button), then open again for B.
    const close = dom.window.document.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    await act(async () => { close.click(); });
    assert.equal(dom.window.document.getElementById("primary-link-input"), null, "closed");
    await openFresh();
    const box = dom.window.document.getElementById("primary-link-input") as HTMLInputElement;
    assert.equal(box.value, "", "second open: empty paste box, no prior VIN");
    assert.doesNotMatch(text(), /Kia|Carnival|Performance Kia/, "second open: nothing of vehicle A on Step 1");
    assert.equal(dom.window.document.querySelector('[data-testid="intent-same_spec"]')?.getAttribute("aria-checked"), "true", "the intent was re-asked and re-chosen — nothing sticky");
    assert.match(text(), /Step 1 of/);

    await paste(VIN_B);
    assert.match(text(), /Lexus/);
    assert.match(text(), /RX/);
    assert.doesNotMatch(text(), /Kia|Carnival|Performance Kia/, "vehicle A's make/model/dealer never reappear");

    // Escape also dismisses and clears the parked draft.
    const backdrop = dom.window.document.querySelector('[data-testid="wizard-backdrop"]') as HTMLElement;
    await act(async () => { backdrop.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(dom.window.document.getElementById("primary-link-input"), null, "Escape closes the wizard");
    assert.equal(dom.window.sessionStorage.length, 0, "no draft survives a dismiss");
    await act(async () => { root.unmount(); });
  });

  it("Step 1: picking an intent loads the VDP fields on Step 1; alternate Continue needs no VIN, same_spec needs a resolved vehicle (2026-09-19)", async () => {
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
    const continueBtn = () => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith("Continue"))!;
    const reason = () => doc.querySelector('[data-testid="continue-reason"]')?.textContent ?? null;

    // Plain-language intent card labels (2026-09-19).
    const sameCard = doc.querySelector('[data-testid="intent-same_spec"]')!;
    const altCard = doc.querySelector('[data-testid="intent-alternate"]')!;
    assert.match(sameCard.textContent!, /This exact vehicle/);
    assert.match(altCard.textContent!, /Open to anything/);
    // The subtext lives in the chip's title tooltip now that the buttons are compact chips.
    assert.match(sameCard.getAttribute("title") || "", /Paste the VIN or dealer link so quotes match this car/);
    assert.match(altCard.getAttribute("title") || "", /No VIN needed — dealers can propose different cars/);
    assert.doesNotMatch(doc.body.textContent!, /same build|I'm open to different vehicles/);

    // On open, same_spec is the default: the VDP fields are already on screen and Continue
    // waits on a resolved vehicle.
    assert.ok(doc.getElementById("primary-link-input"), "VDP fields load on open (same_spec default)");
    assert.equal(continueBtn().disabled, true, "Continue waits on a resolved vehicle");
    assert.equal(reason(), "Add a vehicle to continue");

    // same_spec: the VDP fields load on Step 1 immediately (no reveal substep); Continue
    // then waits on a resolved vehicle.
    await act(async () => { (doc.querySelector('[data-testid="intent-same_spec"]') as HTMLButtonElement).click(); });
    assert.ok(doc.getElementById("primary-link-input"), "same_spec loads the VDP fields on Step 1");
    assert.equal(continueBtn().disabled, true, "same_spec needs a resolved vehicle to continue");
    assert.equal(reason(), "Add a vehicle to continue");

    // alternate: VDP fields still load (optional); Continue enabled with no VIN; no dealer
    // search / What-you-need on Step 1.
    await act(async () => { (doc.querySelector('[data-testid="intent-alternate"]') as HTMLButtonElement).click(); });
    assert.ok(doc.getElementById("primary-link-input"), "alternate keeps the VDP fields visible");
    assert.equal(continueBtn().disabled, true, "alternate also requires the primary VDP to continue");
    assert.equal(reason(), "Add a vehicle to continue");
    assert.equal(doc.querySelector('[data-testid="alt-add-dealer"]'), null, "no dealership search on the alternate Step 1");
    assert.equal(doc.querySelector('[data-testid="alt-must-haves"]'), null, "no What-you-need fields on the alternate lane");

    // Back to same_spec: VDP fields stay, Continue waits on a vehicle again.
    await act(async () => { (doc.querySelector('[data-testid="intent-same_spec"]') as HTMLButtonElement).click(); });
    assert.ok(doc.getElementById("primary-link-input"), "same_spec keeps the VDP fields");
    assert.equal(continueBtn().disabled, true, "same_spec still needs a resolved vehicle to advance");
    await act(async () => { root.unmount(); });
  });

  it("app/page.tsx keys the wizard on a per-open session counter", () => {
    const page = fs.readFileSync("app/page.tsx", "utf8");
    assert.match(page, /key=\{wizardSession\}/);
    assert.match(page, /const openFreshWizard = \(\) => \{ setWizardSession\(\(n\) => n \+ 1\); setIsWizardOpen\(true\); \}/);
    assert.doesNotMatch(page, /onDraftRestored=\{\(\) => openFreshWizard\(\)\}/, "a draft restore reopens the same instance");
    const wizard = fs.readFileSync("components/BiddingWizard.tsx", "utf8");
    assert.match(wizard, /onMouseDown=\{\(e\) => \{ if \(e\.target === e\.currentTarget\) dismiss\(\); \}\}/, "backdrop click dismisses");
    assert.match(wizard, /onClick=\{dismiss\}\s+aria-label="Close"/, "Close button dismisses");
  });
});
