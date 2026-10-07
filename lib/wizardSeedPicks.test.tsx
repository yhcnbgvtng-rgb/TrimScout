// Buyer search -> "Request a quote" -> Step 1: three ticked cars must all end up in Step 1's three slots, for NEW and for
// USED cars alike (used cars used to stop at car 1: "Used requests are one car"). Drives the real BiddingWizard in jsdom with
// fetch stubbed — the same harness as wizardResolve — from the seed the search page's bottom bar writes. Nothing is sent.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { toPick } from "./buyerPicks";
import { QUOTE_SEED_KEY, seedDealersFrom, takeQuoteSeed, writeQuoteSeed } from "./quoteSeed";

const NEW_VINS = ["2T36CRAV0TW113785", "2T36CRAV1TC046311", "2T36CRAV1TC046373"];
const USED_VINS = ["2T3F1RFV4LC084047", "2T3P1RFV3MC200019", "2T3P1RFV9SW528394"];
// Real search rows carry the dealer's listing link; a used link says "/used/" in its path.
const row = (vin: string, condition: "new" | "used" | "cpo") => toPick({ vin, dealerId: "1", dealerName: "A Toyota", dealerState: "OH", year: 2026, make: "Toyota", model: "RAV4", trim: null, mileage: null, price: 30000, vdpUrl: `https://www.atoyota.com/viewdetails/${condition === "new" ? "new" : "used"}/${vin.toLowerCase()}/rav4`, condition });
const DESK = { deskId: "1", dealerName: "A Toyota", city: "Youngstown", state: "OH", zip: "44503", knownNamed: false, emailOptOut: false };

const vehicle = (vin: string, over: Record<string, unknown> = {}) => ({
  id: vin, vin, year: 2024, make: "Toyota", model: "RAV4", trim: "LE", bodyType: "SUV", engine: "", drivetrain: "AWD", transmission: "Auto", exteriorColor: "White", interiorColor: "Black",
  msrp: 0, dealerPrice: 0, daysOnLot: 3, status: "in_stock",
  location: { dealerName: "A Toyota", city: "Youngstown", state: "OH", distanceMiles: 0, dealerConfirmed: false, dealerSource: "unknown" },
  packages: [], options: [], features: [], images: [], ...over,
});

function stubFetch() {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}")) as { paste?: string; vin?: string };
    const vin = (body.vin || (body.paste || "").match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0] || "").toUpperCase();
    if (url.startsWith("/api/desk-resolve")) return json({ status: "unique", desk: DESK, via: "website", host: "atoyota.com" });
    if (url.startsWith("/api/free-vin") || url.startsWith("/api/used-vin")) return json({ handled: true, vin, sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" }, vehicle: vehicle(vin), buildConfidence: "dealer_listing_only", mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: null });
    if (url.includes("-sticker")) return json({ handled: false, notFord: true, notGm: true, notToyota: true, notHonda: true, vin, error: "no factory build" });
    if (url.startsWith("/api/status/features")) return json({ rfqSend: true });
    if (url.startsWith("/api/quote-desks")) return json({ desks: {} });
    if (url.startsWith("/api/dealer-contact")) return json({ contacts: {} });
    return json({});
  };
}

describe("seedDealersFrom", () => {
  it("dedupes by store, caps at 3, keeps pick order, skips nameless", () => {
    const d = (dealerId: string | null, dealerName: string, dealerState: string | null) => ({ dealerId, dealerName, dealerState });
    const out = seedDealersFrom([d("1", "A Toyota", "oh"), d("1", "A Toyota", "OH"), d(null, "B Ford", "TX"), d(null, "b ford", "tx"), d(null, "", "CA"), d("4", "C Kia", null), d("5", "D Audi", "NY")]);
    assert.deepEqual(out.map((x) => x.dealerName), ["A Toyota", "B Ford", "C Kia"]);
    assert.equal(out[0].state, "OH");
  });
});

describe("buyer search seed -> Step 1", () => {
  it("the bottom bar's seed keeps each car's condition", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    writeQuoteSeed(store, [row(USED_VINS[0], "used"), row(NEW_VINS[0], "new"), row(USED_VINS[1], "cpo")]);
    assert.ok(store.getItem(QUOTE_SEED_KEY));
    assert.deepEqual(takeQuoteSeed(store).map((c) => c.condition), ["used", "new", "cpo"]);
  });

  describe("real wizard", () => {
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

    async function run(picks: ReturnType<typeof row>[], opts: { toStep3?: boolean } = {}) {
      const React = (await import("react")).default;
      const { act } = await import("react");
      const { createRoot } = await import("react-dom/client");
      const { BiddingWizard } = await import("../components/BiddingWizard");
      const seed = picks.map((p) => ({ vin: p.vin, vdpUrl: p.vdpUrl, condition: p.condition, dealerId: p.dealerId, dealerName: p.dealerName, dealerState: p.dealerState }));
      const root = createRoot(dom.window.document.getElementById("root")!);
      await act(async () => {
        root.render(React.createElement(BiddingWizard, { isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, initialIntent: "alternate", seedVehicles: seed, currentUser: null, onRequireLogin: () => {} }));
      });
      const doc = dom.window.document;
      const tick = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
      const button = (label: string) => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
      // Each car waits for the previous car's confirm panel: confirm whenever one is showing, until nothing more appears.
      for (let i = 0; i < 60; i++) {
        await tick();
        const confirm = button("Confirm & add");
        if (confirm) await act(async () => { confirm.click(); });
      }
      if (opts.toStep3) {
        for (let i = 0; i < 4 && !doc.querySelector('[data-testid="alternate-dealers"]'); i++) {
          const cash = doc.querySelector<HTMLButtonElement>('[data-testid="quote-type-cash"]');
          if (cash) await act(async () => { cash.click(); });
          const next = Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => /^(Continue|Next)/.test(b.textContent?.trim() || "") && !b.disabled);
          if (!next) break;
          await act(async () => { next.click(); });
          await tick();
        }
      }
      const text = doc.body.textContent || "";
      await act(async () => { root.unmount(); });
      return text;
    }

    for (const [label, vins, cond] of [["new", NEW_VINS, "new"], ["used", USED_VINS, "used"]] as const) {
      it(`three ${label} cars reach Step 1`, async () => {
        const text = await run(vins.map((v) => row(v, cond)));
        for (const v of vins) assert.ok(text.includes(v), `${label} car ${v} is on Step 1`);
        assert.doesNotMatch(text, /Used requests are one car/);
        assert.doesNotMatch(text, /weren't added|wasn't added/);
      });
    }

    for (const [label, vins, cond] of [["new", NEW_VINS, "new"], ["used", USED_VINS, "used"]] as const) {
      it(`${label} picks at three stores prefill Dealerships to ask`, async () => {
        const stores = [["1", "A Toyota", "OH"], ["2", "B Honda", "TX"], ["3", "C Kia", "FL"]] as const;
        const picks = vins.map((v, i) => toPick({ ...row(v, cond), dealerId: stores[i][0], dealerName: stores[i][1], dealerState: stores[i][2] }));
        const text = await run(picks, { toStep3: true });
        for (const s of stores) assert.ok(text.includes(s[1]), `${s[1]} is listed`);
        assert.doesNotMatch(text, /Search dealerships/);
      });
    }

    it("a new car picked beside used ones is left out and the note says so", async () => {
      const text = await run([row(USED_VINS[0], "used"), row(NEW_VINS[0], "new"), row(USED_VINS[1], "used")]);
      assert.ok(text.includes(USED_VINS[0]) && text.includes(USED_VINS[1]));
      assert.ok(!text.includes(NEW_VINS[0]));
      assert.match(text, /all new or all used, so 1 other car you picked wasn't added/);
    });
  });
});
