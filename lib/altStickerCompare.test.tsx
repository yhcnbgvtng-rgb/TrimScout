// Configure Quote Request, Compare factory options, Chevrolet alternates (2026-10-29): when the two alternates are seated the
// wizard asks GM's sticker route for each one and says where each stands — "Checking factory sticker…" while pending,
// "Sticker not published by GM yet" when unreleased — and a car whose sticker comes back is scored. Seeded from the search
// picks, so the inventory row's trim is shown rather than the VIN decoder's. Drives the real BiddingWizard in jsdom.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { resetAltStickerCache } from "./altSticker";

const PICK = "3GCUKFEL8TG425466";
const ALT_UNRELEASED = "3GCUKFE80TG438076";
const ALT_LATE = "3GCUKFE81TG358091";
const MUST_HAVE = "Z71 Off-Road Package";
const DESK = { deskId: "1", dealerName: "Beck Chevrolet GMC", city: "Dallas", state: "TX", zip: "75201", knownNamed: true, emailOptOut: false };

const chevy = (vin: string, over: Record<string, unknown> = {}) => ({
  id: vin, vin, year: 2026, make: "Chevrolet", model: "Silverado 1500", trim: "Trail Boss - LT", bodyType: "Truck", engine: "", drivetrain: "4WD", transmission: "Auto",
  exteriorColor: "Summit White", interiorColor: "Jet Black", msrp: 61000, dealerPrice: 61000, daysOnLot: 3, status: "in_stock",
  location: { dealerName: "Beck Chevrolet GMC", city: "Dallas", state: "TX", distanceMiles: 5, dealerConfirmed: true, dealerSource: "website" },
  packages: [], options: [], features: [], images: [], buildConfidence: "dealer_listing_only", ...over,
});
const base = { handled: true, niceToHaveLines: [], pdfUrl: null };
const released = (vin: string, packages: string[]) => ({ ...base, vin, sticker: { status: "released", pdfUrl: null, msrp: 61000 }, buildConfidence: "verified_factory", mustHaveLines: vin === PICK ? [MUST_HAVE] : [], filterableOptions: packages.map((name) => ({ name, code: null, description: name, price: 0 })), vehicle: chevy(vin, { packages, buildConfidence: "verified_factory" }) });
const unreleased = (vin: string) => ({ ...base, vin, sticker: { status: "unreleased", pdfUrl: null, msrp: null }, buildConfidence: "dealer_listing_only", mustHaveLines: [], filterableOptions: [], vehicle: chevy(vin) });

const stickerCalls: Record<string, number> = {};
let releaseLate!: () => void;
const lateGate = new Promise<void>((r) => { releaseLate = r; });

function stubFetch() {
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}")) as { paste?: string; vin?: string };
    const vin = (body.vin || (body.paste || "").match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0] || "").toUpperCase();
    if (url.startsWith("/api/desk-resolve")) return json({ status: "unique", desk: DESK, via: "website", host: "beck.test" });
    if (url === "/api/gm-sticker") {
      stickerCalls[vin] = (stickerCalls[vin] || 0) + 1;
      if (vin === PICK) return json(released(vin, [MUST_HAVE]));
      if (vin === ALT_UNRELEASED) return json(unreleased(vin));
      // The late alternate: unreleased when seated; its second ask (the compare's check) waits, then GM has published it.
      if (stickerCalls[vin] === 1) return json(unreleased(vin));
      await lateGate;
      return json(released(vin, [MUST_HAVE]));
    }
    if (url.startsWith("/api/status/features")) return json({ rfqSend: true });
    if (url.startsWith("/api/quote-desks")) return json({ desks: {} });
    if (url.startsWith("/api/dealer-contact")) return json({ contacts: {} });
    return json({});
  };
}

describe("Compare factory options — Chevrolet alternates get a sticker check", () => {
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
    resetAltStickerCache();
  });
  after(() => dom.window.close());

  it("shows checking, then 'not published yet', then scores the alternate once GM publishes it", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");
    const seed = [PICK, ALT_UNRELEASED, ALT_LATE].map((vin, i) => ({ vin, vdpUrl: null, condition: "new" as const, dealerId: String(i + 1), dealerName: `Dealer ${i + 1}`, dealerState: "TX", trim: "LT Trail Boss" }));
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(BiddingWizard, { isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, initialIntent: "same_spec", seedVehicles: seed, currentUser: null, onRequireLogin: () => {} }));
    });
    const doc = dom.window.document;
    const text = () => doc.body.textContent || "";
    const tick = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
    const settle = async (pred: () => boolean) => { for (let i = 0; i < 80 && !pred(); i++) await tick(); assert.ok(pred(), "settled"); };

    await settle(() => Boolean(doc.querySelector('[data-testid="factory-options-compare"]')));
    const panel = () => (doc.querySelector('[data-testid="factory-options-compare"]') as HTMLElement).textContent || "";
    const cells = () => Array.from(doc.querySelectorAll('[data-testid="compare-unverified"]')).map((e) => e.textContent);

    // Both alternates are real cars with no read sticker yet; the late one's check is still waiting on GM.
    await settle(() => cells().includes("Checking factory sticker…"));
    assert.ok(cells().includes("Sticker not published by GM yet"), "the unreleased alternate says so");
    assert.doesNotMatch(panel(), /no factory record|Can't verify/);

    // Alternates without a sticker show our inventory row's trim, not the VIN decoder's spelling.
    assert.equal((panel().match(/Silverado 1500 LT Trail Boss/g) || []).length, 2);

    // GM publishes it: the late alternate is verified and scored; the unreleased one is left alone.
    releaseLate();
    await settle(() => !cells().includes("Checking factory sticker…"));
    await settle(() => /1 of 1/.test(panel()));
    assert.deepEqual(cells(), ["Sticker not published by GM yet"]);
    assert.equal((panel().match(/Silverado 1500 LT Trail Boss/g) || []).length, 1, "the verified alternate now carries the sticker's own trim, like the favorite");

    // Each alternate was asked about when seated and once more by the check — never again, however often the page re-rendered.
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(stickerCalls[ALT_UNRELEASED], 2);
    assert.equal(stickerCalls[ALT_LATE], 2);
    assert.equal(stickerCalls[PICK], 1, "the favorite already has its sticker and is not asked again");
    await act(async () => { root.unmount(); });
  });
});
