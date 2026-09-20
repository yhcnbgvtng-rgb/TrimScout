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
let rav4Sticker: "unreleased" | "released" = "unreleased";
const beacons: Array<{ name: string; props: Record<string, unknown> }> = [];

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
      if (vin === VIN_RAV4 && rav4Sticker === "released") return json({ handled: true, vin, sticker: { status: "released", pdfUrl: "https://example.test/rav4.pdf", msrp: 41000 }, vehicle: vehicle(vin, "Toyota", "RAV4", { msrp: 41000, buildConfidence: "verified_factory" }), buildConfidence: "verified_factory", mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: "https://example.test/rav4.pdf" });
      if (vin === VIN_RAV4) return json({ handled: true, vin, sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" }, vehicle: vehicle(vin, "Toyota", "RAV4", { daysOnLot: 12 }), buildConfidence: "dealer_listing_only", mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: null });
      if (vin === VIN_F150) return json({ handled: true, vin, sticker: { status: "released", pdfUrl: "https://example.test/sticker.pdf", msrp: 61000 }, vehicle: vehicle(vin, "Ford", "F-150", { msrp: 61000, buildConfidence: "verified_factory" }), buildConfidence: "verified_factory", mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: "https://example.test/sticker.pdf" });
      // Every OEM route disowns the Acura → the client falls through to /api/free-vin.
      return json({ handled: false, notFord: true, notGm: true, notToyota: true, notHonda: true, vin, error: `We don't have a factory build for VIN ${vin} yet.` });
    }
    if (url.startsWith("/api/events/track")) { beacons.push(body as unknown as { name: string; props: Record<string, unknown> }); return json({ ok: true }); }
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
    // Every open picks "This exact vehicle"; the VDP fields load on Step 1 right away.
    const openFresh = async () => { await act(async () => { bump(); setOpen(true); }); await tick(); await act(async () => { (dom.window.document.querySelector('[data-testid="intent-same_spec"]') as HTMLButtonElement).click(); }); };
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
    await act(async () => { bump(); setOpen(true); }); await tick();
    assert.equal(doc.querySelector('[data-testid="continue-reason"]')?.textContent, "Choose what you want quoted to continue");
    await act(async () => { (doc.querySelector('[data-testid="intent-same_spec"]') as HTMLButtonElement).click(); });
    // 2026-09-19: picking an intent loads the VDP fields on Step 1 immediately (no reveal
    // substep). same_spec then waits on a resolved vehicle before Continue enables.
    assert.ok(doc.getElementById("primary-link-input"), "VDP fields load as soon as the intent is picked");
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
    // ---- 6. Factory pending is recoverable: the analytics event fired; Try again picks up a build that has since posted.
    await openFresh();
    await paste(URL_RAV4);
    await settle(() => Boolean(doc.querySelector('[data-testid="link-confirm-build"]')));
    await act(async () => { button("Confirm & add")!.click(); });
    await settle(() => Boolean(doc.querySelector('[data-testid="factory-build-pending"]')));
    const pendingBeacon = beacons.find((b) => b.name === "factory_build_pending");
    assert.deepEqual(pendingBeacon?.props, { make: "Toyota", vinPrefix: VIN_RAV4.slice(0, 11), dealerHost: "route22toyota.com" });
    assert.equal(card()!.dataset.dealerShown, "Route 22 Toyota", "rooftop shown while the build is pending");
    assert.equal(continueBtn().disabled, false);
    rav4Sticker = "released";
    await act(async () => { (doc.querySelector('[data-testid="factory-build-retry"]') as HTMLButtonElement).click(); });
    await settle(() => !doc.querySelector('[data-testid="factory-build-pending"]'));
    assert.equal(card()!.dataset.buildState, "factory_verified");
    assert.equal(card()!.dataset.dealerShown, "Route 22 Toyota", "the retry never loses the rooftop");
    assert.equal(card()!.dataset.resolvePath, "url_only");
    assert.ok(beacons.some((b) => b.name === "factory_build_retry"));
    rav4Sticker = "unreleased";

    // ---- 7. Notify me is an honest stub; Save for later & exit keeps the VIN without sending anything.
    await openFresh();
    await paste(URL_RAV4);
    await settle(() => Boolean(doc.querySelector('[data-testid="link-confirm-build"]')));
    await act(async () => { button("Confirm & add")!.click(); });
    await settle(() => Boolean(doc.querySelector('[data-testid="factory-build-pending"]')));
    await act(async () => { (doc.querySelector('[data-testid="factory-build-notify"]') as HTMLButtonElement).click(); });
    assert.match(doc.querySelector('[data-testid="factory-build-notify-ack"]')!.textContent!, /Alerts aren't live yet/);
    assert.ok(beacons.some((b) => b.name === "factory_build_notify_requested"));
    await act(async () => { (doc.querySelector('[data-testid="factory-build-save"]') as HTMLButtonElement).click(); });
    assert.equal(primaryInput(), null, "wizard closed");
    assert.equal(dom.window.sessionStorage.length, 0, "the quote draft is still cleared on exit");
    const parked = JSON.parse(dom.window.localStorage.getItem("trimscout.parkedVehicle.v1")!);
    assert.equal(parked.vin, VIN_RAV4);
    assert.equal(parked.url, URL_RAV4);
    assert.equal(parked.dealerName, "Route 22 Toyota");
    assert.equal(parked.notify, true);
    assert.ok(beacons.some((b) => b.name === "vehicle_saved_for_later"));

    // ---- 8. Next open offers the saved car back; Try again resolves it through the link, rooftop intact.
    await openFresh();
    assert.equal(primaryInput().value, "", "still opens empty — the saved car is an offer, not a restore");
    assert.match(doc.querySelector('[data-testid="parked-vehicle"]')!.textContent!, /2026 Toyota RAV4 XLE · Route 22 Toyota.*you asked to be told/);
    await act(async () => { (doc.querySelector('[data-testid="parked-vehicle-resume"]') as HTMLButtonElement).click(); });
    await settle(() => Boolean(doc.querySelector('[data-testid="link-confirm-build"]')));
    assert.equal(dom.window.localStorage.getItem("trimscout.parkedVehicle.v1"), null, "consumed");
    await act(async () => { button("Confirm & add")!.click(); });
    await settle(() => Boolean(card()));
    assert.equal(card()!.dataset.dealerShown, "Route 22 Toyota");
    assert.ok(beacons.some((b) => b.name === "vehicle_resumed"));
    // Remove works too.
    await openFresh();
    assert.equal(doc.querySelector('[data-testid="parked-vehicle"]'), null);
    await act(async () => { root.unmount(); });
  });
});

describe("Step 1 asks the quote intent before the VIN (2026-09-17)", () => {
  let dom: JSDOM;
  const fetched: string[] = [];
  const events: string[] = [];
  before(() => {
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("IS_REACT_ACT_ENVIRONMENT", true);
    const inner = stubFetch();
    define("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetched.push(url);
      if (url.startsWith("/api/dealer-search")) return new Response(JSON.stringify({ matches: [{ deskId: "6339", dealerName: "Route 22 Toyota", city: "Hillside", state: "NJ", zip: "07205", knownNamed: false, emailOptOut: false }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/events/track")) { events.push(String(init?.body)); return new Response("{}"); }
      return inner(input, init);
    });
  });
  after(() => dom.window.close());

  it("path B continues with no VIN and no sticker call; path A still needs the car; switching works both ways", async () => {
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
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const doc = dom.window.document;
    const text = () => doc.body.textContent || "";
    const setVal = async (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      await act(async () => { setter.call(el, value); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    };
    const continueBtn = () => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith("Continue"))!;
    const reason = () => doc.querySelector('[data-testid="continue-reason"]')?.textContent;

    // 1. Intent first — no VIN box yet.
    assert.ok(doc.querySelector('[data-testid="intent-picker"]'), "intent choice on screen");
    assert.equal(doc.getElementById("primary-link-input"), null, "no VIN / link box until an intent is chosen");
    assert.equal(continueBtn().disabled, true);
    assert.equal(reason(), "Choose what you want quoted to continue");
    assert.match(text(), /Paste the VIN or dealer link so quotes match this car/);
    assert.match(text(), /No VIN needed — dealers can propose different cars/);

    // 2. Path B (alternate): picking the intent loads the VDP fields on Step 1 immediately,
    //    but they are OPTIONAL — Continue stays enabled with no VIN, and no What-you-need shows.
    fetched.length = 0;
    await act(async () => { (doc.querySelector('[data-testid="intent-alternate"]') as HTMLButtonElement).click(); });
    assert.ok(events.some((e) => e.includes('"rfq_intent_selected"') && e.includes('"alternate"')), "rfq_intent_selected { intent: alternate }");
    assert.ok(doc.getElementById("primary-link-input"), "alternate loads the VDP fields on Step 1 (optional)");
    assert.equal(continueBtn().disabled, false, "alternate: VDP optional, Continue stays enabled with no VIN");
    assert.equal(doc.querySelector('[data-testid="alt-must-haves"]'), null, "no What-you-need on the alternate lane");

    // 3. Pasting a VDP on alternate free-decodes only — /api/free-vin, never an OEM -sticker
    //    route, and no factory-build/sticker UI.
    adxRoute = "free";
    fetched.length = 0;
    await setVal(doc.getElementById("primary-link-input") as HTMLInputElement, VIN_ADX);
    await act(async () => { Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Add")!.click(); });
    for (let i = 0; i < 40 && !text().includes("Acura"); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    assert.ok(fetched.some((u) => u.includes("/api/free-vin")), "alternate resolve uses the free decode");
    assert.ok(!fetched.some((u) => u.includes("-sticker")), "no OEM window-sticker route on the alternate lane");
    assert.equal(doc.querySelector('[data-testid="factory-build-pending"]'), null, "no factory-build/sticker UI on alternate");

    // 4. Switch to same_spec: VDP fields stay, but a resolved car is required again.
    await act(async () => { (doc.querySelector('[data-testid="intent-same_spec"]') as HTMLButtonElement).click(); });
    assert.ok(doc.getElementById("primary-link-input"), "same_spec keeps the VDP fields");
    assert.equal(continueBtn().disabled, true, "same_spec requires a resolved vehicle again");
    assert.equal(reason(), "Add a vehicle to continue");
    await act(async () => { root.unmount(); });
  });
});