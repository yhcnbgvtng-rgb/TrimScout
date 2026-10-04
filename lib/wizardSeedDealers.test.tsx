// Picked cars (2-3) open the "other vehicles" quote. Its "Dealerships to ask" list used to start empty even when
// the directory had a contact for a picked car's store; now those stores are prefilled. Real wizard in a DOM,
// network stubbed at fetch.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const desk = (id: string, dealerName: string, state: string, knownNamed: boolean) => ({ deskId: id, dealerName, city: "Town", state, zip: null, knownNamed, emailOptOut: false });
const DIRECTORY = [desk("a", "Howell, INC.", "MS", true), desk("b", "Quiet Motors", "NJ", false)];

const deskLookups: Array<Array<{ dealerName: string; state: string }>> = [];

describe("picked cars prefill the dealership list", () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
    const w = dom.window as unknown as Record<string, unknown>;
    const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
    define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
    define("IS_REACT_ACT_ENVIRONMENT", true);
    define("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/dealer-search")) {
        const q = String(JSON.parse(String(init?.body || "{}")).q || "").toLowerCase();
        return json({ matches: DIRECTORY.filter((d) => d.dealerName.toLowerCase().includes(q.split(",")[0])) });
      }
      if (url.startsWith("/api/quote-desks")) { deskLookups.push(JSON.parse(String(init?.body || "{}")).dealers); return json({ desks: [] }); }
      return json({}, 404);
    });
  });
  after(() => dom.window.close());

  it("adds the store with a named contact, skips the one without, ", async () => {
    const React = (await import("react")).default;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BiddingWizard } = await import("../components/BiddingWizard");
    const seed = [
      { vin: "1FTFW1E5XPFA10001", vdpUrl: null, dealerName: "Howell, INC.", dealerState: "MS" },
      { vin: "1FTFW1E5XPFA10002", vdpUrl: null, dealerName: "Quiet Motors", dealerState: "NJ" },
    ];
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { root.render(React.createElement(BiddingWizard, { isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, currentUser: null, onRequireLogin: () => {}, initialIntent: "alternate", seedVehicles: seed })); });
    // The list itself renders on Step 3; the wizard looks up desks for exactly the stores in it, so that request shows what was prefilled.
    for (let i = 0; i < 20 && !deskLookups.length; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    assert.equal(deskLookups.length > 0, true, "the prefilled store was looked up as a dealership in the list");
    const asked = deskLookups[deskLookups.length - 1].map((d) => d.dealerName);
    assert.deepEqual(asked, ["Howell, INC."], "the store with a named contact is in; the one without is not");
    await act(async () => { root.unmount(); });
  });
});
