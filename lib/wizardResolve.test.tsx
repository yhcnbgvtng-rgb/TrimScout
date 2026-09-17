// Live-QA resolve hardening (wave150, 2026-09-16): a dealer VDP link that carries the VIN resolves
// with one click, a car with no factory build says so instead of just going amber, a paste that
// fails leaves Continue off with a reason, and a bare VIN pasted after a link keeps the link's store.
// Drives the real BiddingWizard in jsdom with fetch stubbed; the same harness as wizardFreshOpen.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const VIN_RAV4 = "2T36CRAVXTC39J403"; // Route 22 Toyota — Toyota is free-decode only (factory pending)
const VIN_F150 = "1FTFW1E80PFA00001"; // a released Ford sticker
const VIN_ADX = "3HDSA2H70TM713712"; // Key Acura — no OEM route claims it
const URL_RAV4 = `https://www.route22toyota.com/viewdetails/new/${VIN_RAV4.toLowerCase()}/2026-toyota-rav4-sport-utility`;
const URL_F150 = `https://www.freedomford.com/new/Ford/2026-Ford-F-150-${VIN_F150}.htm`;
const URL_NO_VIN = "https://www.route22toyota.com/viewdetails/new/2026-toyota-rav4-sport-utility";

const ROUTE22 = { deskId: "6339", dealerName: "Route 22 Toyota", city: "Hillside", state: "NJ", zip: "07205", knownNamed: false, emailOptOut: false };
const FREEDOM = { deskId: "1", dealerName: "Freedom Ford", city: "Wayne", state: "NJ", zip: "07470", knownNamed: true, emailOptOut: false };

const vehicle = (vin: string, make: string, model: string, over: Record<string, unknown> = {}) => ({
  id: vin, vin, year: 2026, make, model, trim: "XLE", bodyType: "SUV", engine: "", drivetrain: "AWD", transmission: "Auto", exteriorColor: "White", interiorColor: "Black",
  msrp: 0, dealerPrice: 0, daysOnLot: 0, status: "in_stock",
  location: { dealerName: "", city: "", state: "", distanceMiles: 0, dealerConfirmed: false, dealerSource: "unknown" },
  packages: [], options: [], features: [], images: [], ...over,
});

let adxRoute: "fail" | "free" = "fail";

function stubFetch() {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}")) as { paste?: string; vin?: string; url?: string };
    const vin = (body.vin || (body.paste || "").match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0] || "").toUpperCase();
    if (url.startsWith("/api/desk-resolve")) {
      const host = new URL(body.url || "").hostname.replace(/^www\./, "");
      if (host === "route22toyota.com") return json({ status: "unique", desk: ROUTE22, via: "website", host });
      if (host === "freedomford.com") return json({ status: "unique", desk: FREEDOM, via: "website", host });
      return json({ status: "none", host });
    }
    if (url.startsWith("/api/free-vin")) {
      if (adxRoute === "fail") return json({ error: "We couldn't find a vehicle with this VIN: " + vin + ". Copy it straight from the listing and try again.", handled: true, needsVin: true, vin }, 422);
      return json({ handled: true, vin, sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" }, vehicle: vehicle(vin, "Acura", "ADX", { daysOnLot: 9 }), buildConfidence: "dealer_listing_only", mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: null });
    }
    if (url.includes("-sticker")) {
      if (vin === VIN_RAV4) return json({ handled: true, vin, sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" }, vehicle: vehicle(vin, "Toyota", "RAV4", { daysOnLot: 12 }), buildConfidence: "dealer_listing_only", mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: null });
      if (vin === VIN_F150) return json({ handled: true, vin, sticker: { status: "released", pdfUrl: "https://example.test/sticker.pdf", msrp: 61000 }, vehicle: vehicle(vin, "Ford", "F-150", { msrp: 61000, buildConfidence: "verified_factory" }), buildConfidence: "verified_factory", mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: "https://example.test/sticker.pdf" });
      // Every OEM route disowns the Acura → the client falls through to /api/free-vin.
      return json({ handled: false, notFord: true, notGm: true, notToyota: true, notHonda: true, vin, error: `We don't have a factory build for VIN ${vin} yet.` });
    }
    if (url.startsWith("/api/status/features")) return json({ rfqSend: true });
    if (url.startsWith("/api/quote-desks")) return json({ desks: {} });
    if (url.startsWith("/api/dealer-contact")) return json({ contacts: {} });
    return json({});
  };
}

describe("Configure Quote Request — vehicle resolve hardening", () => {
  let dom: JSDOM;
  const logs: string[] = [];
  before(() => {
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("fetch", stubFetch());
    define("IS_REACT_ACT_ENVIRONMENT", true);
    const info = console.info;
    console.info = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); info(...args); };
  });
  after(() => dom.window.close());

  it("drives every path through the real wizard", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");

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
    const doc = dom.window.document;
    const text = () => doc.body.textContent || "";
    const tick = async (n = 1) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
    const settle = async (pred: () => boolean) => { for (let i = 0; i < 40 && !pred(); i++) await tick(); assert.ok(pred(), "settled"); };
    const openFresh = async () => { await act(async () => { bump(); setOpen(true); }); await tick(); };
    const setInput = async (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      await act(async () => { setter.call(el, value); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    };
    const primaryInput = () => doc.getElementById("primary-link-input") as HTMLInputElement;
    const button = (label: string) => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
    const paste = async (value: string) => {
      await setInput(primaryInput(), value);
      await act(async () => { button("Add")!.click(); });
    };
    const continueBtn = () => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith("Continue"))!;
    const card = () => doc.querySelector<HTMLElement>('[data-testid="primary-vehicle-card"]');

    // ---- 1. A dealer VDP with the VIN in the path: one click, no retyping, rooftop from the VDP.
    await openFresh();
    assert.equal(continueBtn().disabled, true);
    assert.equal(doc.querySelector('[data-testid="continue-reason"]')?.textContent, "Add a vehicle to continue");
    await paste(URL_F150);
    await settle(() => Boolean(doc.querySelector('[data-testid="link-confirm-build"]')));
    const vinBox = doc.querySelector<HTMLInputElement>('input[placeholder="17-character VIN"]')!;
    assert.equal(vinBox.value, VIN_F150, "VIN auto-filled from the link");
    assert.match(text(), /2026 Ford F-150/);
    assert.match(text(), /Freedom Ford/);
    assert.equal(doc.querySelector('[data-testid="continue-reason"]')?.textContent, "Confirm the vehicle above to continue");
    await act(async () => { button("Confirm & add")!.click(); });
    await settle(() => Boolean(card()));
    assert.equal(card()!.dataset.resolvePath, "url_only");
    assert.equal(card()!.dataset.dealerFromVdp, "true");
    assert.equal(card()!.dataset.dealerShown, "Freedom Ford");
    assert.equal(card()!.dataset.buildState, "factory_verified");
    assert.equal(doc.querySelector('[data-testid="factory-build-state"]'), null, "a real sticker needs no explanation");
    assert.ok(card()!.className.includes("border-emerald-500/40"), "green card");
    assert.equal(continueBtn().disabled, false);
    assert.ok(logs.some((l) => l.includes('"resolvePath":"url_only"') && l.includes('"dealerFromVdp":true') && l.includes('"dealerShown":"Freedom Ford"')), "resolve logged");

    // ---- 2. Factory pending: Toyota resolves on the free decode; the card is green, the state is a line.
    await openFresh();
    await paste(URL_RAV4);
    await settle(() => Boolean(doc.querySelector('[data-testid="link-confirm-build"]')));
    assert.match(doc.querySelector('[data-testid="confirm-build-state"]')!.textContent!, /Factory build not published yet.*on the lot 12 days/);
    await act(async () => { button("Confirm & add")!.click(); });
    await settle(() => Boolean(card()));
    assert.equal(card()!.dataset.resolvePath, "factory_pending");
    assert.equal(card()!.dataset.dealerFromVdp, "true");
    assert.equal(card()!.dataset.dealerShown, "Route 22 Toyota");
    assert.ok(card()!.className.includes("border-emerald-500/40"), "the primary is green like an alternate");
    assert.match(doc.querySelector('[data-testid="factory-build-state"]')!.textContent!, /Factory build not published yet — details come from the VIN decode.*on the lot 12 days/);
    assert.equal(continueBtn().disabled, false, "a real car with a pending build still continues; the dealer confirms the build");

    // ---- 3. No OEM claims the VIN and the catch-all can't build it: Continue stays off, with a reason.
    await openFresh();
    await paste(VIN_ADX);
    await settle(() => /couldn't find a vehicle with this VIN/.test(text()));
    assert.equal(card(), null);
    assert.equal(continueBtn().disabled, true);
    assert.equal(doc.querySelector('[data-testid="continue-reason"]')?.textContent, "Fix the vehicle paste to continue");
    assert.ok(logs.some((l) => l.includes('"resolvePath":"fail"') && l.includes(VIN_ADX)));

    // ---- 3b. Same VIN once the catch-all knows it: imports, factory pending, no dealer (bare VIN).
    adxRoute = "free";
    await openFresh();
    await paste(VIN_ADX);
    await settle(() => Boolean(card()));
    assert.match(text(), /2026 Acura ADX/);
    assert.equal(card()!.dataset.resolvePath, "factory_pending");
    assert.equal(card()!.dataset.dealerFromVdp, "false");
    assert.match(doc.querySelector('[data-testid="factory-build-state"]')!.textContent!, /on the lot 9 days/);

    // ---- 4. A link with no VIN in it, then the VIN pasted bare: the link's store sticks.
    await openFresh();
    await paste(URL_NO_VIN);
    await settle(() => /Confirm the vehicle and the dealership/.test(text()));
    assert.match(text(), /Route 22 Toyota/);
    await act(async () => { button("Cancel")!.click(); });
    await paste(VIN_RAV4);
    await settle(() => Boolean(card()));
    assert.equal(card()!.dataset.dealerShown, "Route 22 Toyota", "rooftop kept from the original link");
    assert.equal(card()!.dataset.dealerFromVdp, "true");
    assert.equal(card()!.dataset.resolvePath, "factory_pending");

    // ---- 5. Regression: the next open starts empty (the sticky-vehicle fix).
    await openFresh();
    assert.equal(primaryInput().value, "");
    assert.equal(card(), null);
    assert.doesNotMatch(text(), /RAV4|Route 22|F-150|Freedom Ford|ADX/);
    await act(async () => { root.unmount(); });
  });
});
