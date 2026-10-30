// Configure Quote Request, Compare factory options, Chevrolet alternates (2026-10-29): the sticker read when each alternate is
// seated is the only GM ask for that VIN, the compare says where each stands ("Sticker not published by GM yet" when
// unreleased), a sticker-verified alternate is scored, and "Trail Boss - LT" vs "LT Trail Boss" is not flagged as a different
// trim. Seeded from the search picks, so the inventory row's trim is shown for an alternate with no sticker. Drives the real
// BiddingWizard in jsdom.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { resetAltStickerCache } from "./altSticker";

const PICK = "3GCUKFEL8TG425466";
const ALT_UNRELEASED = "3GCUKFE80TG438076";
const ALT_VERIFIED = "3GCUKFE81TG358091";
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

  it("asks GM once per VIN, scores a verified alternate, and does not call a re-spelled trim a difference", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");
    const seed = [PICK, ALT_UNRELEASED, ALT_VERIFIED].map((vin, i) => ({ vin, vdpUrl: null, condition: "new" as const, dealerId: String(i + 1), dealerName: `Dealer ${i + 1}`, dealerState: "TX", trim: "LT Trail Boss" }));
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(React.createElement(BiddingWizard, { isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, initialIntent: "same_spec", seedVehicles: seed, currentUser: null, onRequireLogin: () => {} }));
    });
    const doc = dom.window.document;
    const tick = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
    const settle = async (pred: () => boolean) => { for (let i = 0; i < 80 && !pred(); i++) await tick(); assert.ok(pred(), "settled"); };

    await settle(() => Boolean(doc.querySelector('[data-testid="factory-options-compare"]')));
    const panel = () => (doc.querySelector('[data-testid="factory-options-compare"]') as HTMLElement).textContent || "";
    const cells = () => Array.from(doc.querySelectorAll('[data-testid="compare-unverified"]')).map((e) => e.textContent);
    await settle(() => cells().length === 1);

    // The unreleased alternate says so; the other was read at seat time and is scored against the favorite's must-have.
    assert.deepEqual(cells(), ["Sticker not published by GM yet"]);
    assert.match(panel(), /1 of 1/);
    assert.doesNotMatch(panel(), /no factory record|Can't verify/);

    // Each card keeps its own spelling, and neither spelling is flagged as a difference from the favorite's.
    const trimCells = Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="factory-options-compare"] div')).filter((e) => e.children.length === 0 && /^(LT Trail Boss|Trail Boss - LT)$/.test(e.textContent || ""));
    assert.ok(trimCells.some((e) => e.textContent === "LT Trail Boss") && trimCells.some((e) => e.textContent === "Trail Boss - LT"), "both spellings are shown as they are");
    assert.equal(trimCells.filter((e) => e.className.includes("text-amber-300")).length, 0, "no trim cell is highlighted as different");

    // However often the page re-renders, GM was asked about each VIN exactly once — the seat-time read is the check.
    for (let i = 0; i < 5; i++) await tick();
    assert.deepEqual(stickerCalls, { [PICK]: 1, [ALT_UNRELEASED]: 1, [ALT_VERIFIED]: 1 });
    await act(async () => { root.unmount(); });
  });
});
