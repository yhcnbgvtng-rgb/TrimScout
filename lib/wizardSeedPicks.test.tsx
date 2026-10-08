// Buyer search -> "Request a quote" -> Step 1: three ticked cars must all end up in Step 1's three slots, for NEW and for
// USED cars alike (used cars used to stop at car 1: "Used requests are one car"). Drives the real BiddingWizard in jsdom with
// fetch stubbed — the same harness as wizardResolve — from the seed the search page's bottom bar writes. Nothing is sent.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { toPick } from "./buyerPicks";
import { QUOTE_SEED_KEY, QUOTE_SEED_LANE, seedDealersFrom, takeQuoteSeed, writeQuoteSeed } from "./quoteSeed";

const NEW_VINS = ["2T36CRAV0TW113785", "2T36CRAV1TC046311", "2T36CRAV1TC046373"];
const USED_VINS = ["2T3F1RFV4LC084047", "2T3P1RFV3MC200019", "2T3P1RFV9SW528394"];
// Real search rows carry the dealer's listing link; a used link says "/used/" in its path.
const row = (vin: string, condition: "new" | "used" | "cpo", dealer = "a") => toPick({ vin, dealerId: "1", dealerName: `Dealer ${dealer}`, dealerState: "OH", year: 2026, make: "Toyota", model: "RAV4", trim: null, mileage: null, price: 30000, vdpUrl: `https://www.dealer${dealer}.com/viewdetails/${condition === "new" ? "new" : "used"}/${vin.toLowerCase()}/rav4`, condition });
const desk = (host: string) => { const d = host.replace(/^www\.dealer/, "").replace(/\.com$/, ""); return { deskId: d, dealerName: `Dealer ${d}`, city: "Youngstown", state: "OH", zip: "44503", knownNamed: false, emailOptOut: false }; };

const vehicle = (vin: string, over: Record<string, unknown> = {}) => ({
  id: vin, vin, year: 2024, make: "Toyota", model: "RAV4", trim: "LE", bodyType: "SUV", engine: "", drivetrain: "AWD", transmission: "Auto", exteriorColor: "White", interiorColor: "Black",
  msrp: 0, dealerPrice: 0, daysOnLot: 3, status: "in_stock",
  location: { dealerName: "Dealer a", city: "Youngstown", state: "OH", distanceMiles: 0, dealerConfirmed: false, dealerSource: "unknown" },
  packages: [], options: [], features: [], images: [], ...over,
});

const sent: Array<{ url: string; body: any }> = [];
let activeRfqs: unknown[] = [];
let lastZip = "";
function stubFetch() {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}")) as { paste?: string; vin?: string };
    const vin = (body.vin || (body.paste || "").match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0] || "").toUpperCase();
    if (url.startsWith("/api/desk-resolve")) { const host = new URL((JSON.parse(String(init?.body || "{}")) as { url: string }).url).hostname; return json({ status: "unique", desk: desk(host), via: "website", host }); }
    if (url.startsWith("/api/free-vin") || url.startsWith("/api/used-vin")) return json({ handled: true, vin, sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" }, vehicle: vehicle(vin), buildConfidence: "dealer_listing_only", mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: null });
    if (url.includes("-sticker")) return json({ handled: false, notFord: true, notGm: true, notToyota: true, notHonda: true, vin, error: "no factory build" });
    if (url.startsWith("/api/status/features")) return json({ rfqSend: true });
    if (url === "/api/rfqs" && !init?.method) return json({ rfqs: activeRfqs });
    if (url.startsWith("/api/rfqs")) { sent.push({ url, body }); return json({ rfq: { id: "rfq-test" }, invite: { stage: "sent" } }); }
    if (url.startsWith("/api/quote-desks")) {
      const asked = (JSON.parse(String(init?.body || "{}")).dealers || []) as Array<{ dealerName: string }>;
      return json({ desks: asked.map((d) => ({ dealerName: d.dealerName, found: true, knownNamed: true, contactName: "Sam Seller", role: "sales_manager", emailMasked: "s***@x.com", emailDomain: "x.com", emailOptOut: false, blockedReason: null, blockedMessage: null, routing: "named" })) });
    }
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

  it("picked cars always open the specific-vehicle lane (Open to anything would drop the cars from the request)", () => {
    assert.equal(QUOTE_SEED_LANE, "same_spec");
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

    async function run(picks: ReturnType<typeof row>[], toStep3 = false, send = false, user: object | null = null) {
      const React = (await import("react")).default;
      const { act } = await import("react");
      const { createRoot } = await import("react-dom/client");
      const { BiddingWizard } = await import("../components/BiddingWizard");
      const seed = picks.map((p) => ({ vin: p.vin, vdpUrl: p.vdpUrl, condition: p.condition, dealerId: p.dealerId, dealerName: p.dealerName, dealerState: p.dealerState }));
      const root = createRoot(dom.window.document.getElementById("root")!);
      await act(async () => {
        root.render(React.createElement(BiddingWizard, { isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, initialIntent: QUOTE_SEED_LANE, seedVehicles: seed, currentUser: user ? (user as never) : send ? ({ id: "u1", name: "T", email: "t@example.com", role: "buyer", phone: "", zipCode: "44503", savedVehicleIds: [] } as never) : null, onRequireLogin: () => {} }));
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
      if (toStep3) {
        const next = () => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith("Continue"))!;
        await act(async () => { next().click(); });
        await tick();
        const cash = Array.from(doc.querySelectorAll<HTMLElement>('[role="radio"]')).find((b) => /^Cash/.test(b.textContent?.trim() || ""))!;
        await act(async () => { cash.click(); });
        await tick();
        await act(async () => { next().click(); });
        await tick();
      }
      lastZip = doc.querySelector<HTMLInputElement>('input[placeholder="ZIP"]')?.value ?? "";
      if (send) {
        const zip = doc.querySelector<HTMLInputElement>('input[placeholder="ZIP"]')!;
        await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(zip, "44503"); zip.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
        // The trade-in toggle defaults off, so there is nothing to answer on Step 3.
        assert.equal(doc.querySelector('[data-testid="trade-toggle"]')?.getAttribute("aria-checked"), "false");
        const cont = Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith("Continue"))!;
        await act(async () => { cont.click(); });
        await tick();
        const go = Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => /^Request (a quote|quotes from)/.test(b.textContent?.trim() || ""));
        assert.ok(go && !go.disabled, "send button is on step 4");
        await act(async () => { go.click(); });
        for (let i = 0; i < 10; i++) await tick();
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

    it("three picks at three dealers: Step 3 lists all three dealers, no 'Search dealerships'", async () => {
      const text = await run([row(USED_VINS[0], "used", "a"), row(USED_VINS[1], "used", "b"), row(USED_VINS[2], "used", "c")], true);
      for (const d of ["Dealer a", "Dealer b", "Dealer c"]) assert.ok(text.includes(d), `${d} is prefilled`);
      assert.doesNotMatch(text, /Search dealerships/);
    });

    it("two picks at the same dealer list that dealer once", async () => {
      const text = await run([row(NEW_VINS[0], "new", "a"), row(NEW_VINS[1], "new", "a"), row(NEW_VINS[2], "new", "b")], true);
      assert.equal((text.match(/Dealer a/g) || []).length, 1, "Dealer a is listed once");
      assert.ok(text.includes("Dealer b"));
    });

    for (const [label, vins, cond] of [["new", NEW_VINS, "new"], ["used", USED_VINS, "used"]] as const) {
      it(`${label} picks with no listing link: dealers still prefill from the hand-off, and the request carries 3 cars with condition`, async () => {
        const picks = vins.map((v, i) => ({ ...row(v, cond, "abc"[i]), vdpUrl: null }));
        sent.length = 0;
        const text = await run(picks, true, true);
        for (const d of ["Dealer a", "Dealer b", "Dealer c"]) assert.ok(text.includes(d), `${d} is prefilled`);
        assert.doesNotMatch(text, /Search dealerships/);
        const rfq = sent.find((c) => c.url === "/api/rfqs");
        assert.ok(rfq, "an RFQ was posted to the (stubbed) API");
        assert.equal(rfq.body.lane, "same_spec");
        const pastes = rfq.body.linkPastes as Array<{ vin: string; dealerName: string; condition?: string }>;
        assert.deepEqual(pastes.map((p) => p.vin).sort(), [...vins].sort());
        assert.deepEqual(pastes.map((p) => p.dealerName).sort(), ["Dealer a", "Dealer b", "Dealer c"]);
        for (const p of pastes) assert.equal(p.condition, cond === "new" ? undefined : "used", "per-car condition (new is the unmarked default)");
      });
    }

    it("a new car picked beside used ones is left out and the note says so", async () => {
      const text = await run([row(USED_VINS[0], "used"), row(NEW_VINS[0], "new"), row(USED_VINS[1], "used")]);
      assert.ok(text.includes(USED_VINS[0]) && text.includes(USED_VINS[1]));
      assert.ok(!text.includes(NEW_VINS[0]));
      assert.match(text, /all new or all used, so 1 other car you picked wasn't added/);
    });

    it("a car left out does not use up a slot: the next car lands in Alternate 1, not Alternate 2", async () => {
      const text = await run([row(USED_VINS[0], "used", "a"), row(NEW_VINS[0], "new", "b"), row(USED_VINS[1], "used", "c")]);
      assert.ok(text.includes(USED_VINS[1]), "the third pick is seated");
      assert.match(text, /Alternate 1 — added/i);
      assert.doesNotMatch(text, /Alternate 2 — added/i);
    });

    const buyer = (zipCode: string) => ({ id: "u1", name: "T", email: "t@example.com", role: "buyer", phone: "", zipCode, savedVehicleIds: [] });
    it("the ZIP on the buyer's account starts in the ZIP box on Step 3 (editable)", async () => {
      await run(USED_VINS.map((v, i) => row(v, "used", "abc"[i])), true, false, buyer("07002"));
      assert.equal(lastZip, "07002");
    });
    it("no usable ZIP on the account leaves the box empty, and a guest gets nothing", async () => {
      await run([row(USED_VINS[0], "used", "a")], true, false, buyer("n/a"));
      assert.equal(lastZip, "");
      await run([row(USED_VINS[0], "used", "a")], true);
      assert.equal(lastZip, "");
    });

    it("a buyer with an active request is told so up front, with its deal number and a link", async () => {
      activeRfqs = [{ id: "32", status: "collecting", dealReference: "TS-ABC123" }];
      try {
        const text = await run([row(USED_VINS[0], "used", "a")], false, false, buyer("07002"));
        assert.match(text, /You already have an active request \(TS-ABC123\)/);
        assert.match(text, /View it/);
      } finally { activeRfqs = []; }
      const none = await run([row(USED_VINS[0], "used", "a")], false, false, buyer("07002"));
      assert.doesNotMatch(none, /You already have an active request/);
    });
  });
});
