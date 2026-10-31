// Step 3 desk cards and the Step 4 review, driven through the real BiddingWizard in a DOM (network stubbed).
// Covers: opted-out + advisor address is selectable (blue badge, advisor field), same-named rooftops in two states keep
// separate state, reachable shared-inbox dealers read "Sales contact on file" (not the nameless desk label), no days-on-lot text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

const VIN = "KM8K6CAB0TU123456"; // Hyundai
const vehicle = {
  id: VIN, vin: VIN, year: 2026, make: "Hyundai", model: "Tucson", trim: "SEL", bodyType: "SUV", engine: "", drivetrain: "AWD", transmission: "Auto",
  exteriorColor: "0C7V", interiorColor: "Black", msrp: 40000, dealerPrice: 40000, daysOnLot: 3, status: "in_stock",
  buildConfidence: "dealer_listing_only", condition: "new",
  location: { dealerName: "Smith Hyundai", city: "Flemington", state: "NJ", zip: "08822", distanceMiles: 5, dealerConfirmed: true, deskId: "501" },
  packages: [], options: [], features: [], images: [],
};
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

type Desk = { dealerName: string; found: boolean; contactState: string; knownNamed: boolean; contactName: string | null; role: null; emailMasked: string | null; emailDomain: string | null; emailOptOut: boolean; blockedReason: string | null; blockedMessage: string | null; routing: string };
const desk = (over: Partial<Desk>): Desk => ({ dealerName: "Smith Hyundai", found: true, contactState: "none", knownNamed: false, contactName: null, role: null, emailMasked: null, emailDomain: null, emailOptOut: false, blockedReason: null, blockedMessage: null, routing: "unassigned", ...over });

async function open(deskFor: () => Desk) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  const w = dom.window as unknown as Record<string, unknown>;
  const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "sessionStorage", "localStorage"]) define(k, w[k]);
  define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
  define("IS_REACT_ACT_ENVIRONMENT", true);
  define("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("-sticker") || url.includes("/api/used-vin")) return json({ vin: VIN, vehicle, sticker: { status: "unreleased" }, stickerPending: true, stickerPendingNote: "Window sticker isn't available for Hyundai on TrimScout — details come from the VIN decode; the dealer confirms the exact build when they quote." });
    if (url.startsWith("/api/status/features")) return json({ rfqSend: true, outboundDealerEmail: true, dealStages: true, banner: null });
    if (url.startsWith("/api/quote-desks")) {
      const asked = JSON.parse(String(init?.body || "{}")).dealers as Array<{ dealerName: string }>;
      return json({ desks: asked.map((d) => ({ ...deskFor(), dealerName: d.dealerName })) });
    }
    if (url.startsWith("/api/dealer-contact")) return json({ results: [] });
    return json({}, 404);
  });
  const React = (await import("react")).default;
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { BiddingWizard } = await import("../components/BiddingWizard");
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(React.createElement(BiddingWizard, { key: Math.random(), isOpen: true, onClose: () => {}, onSubmitBidRequest: () => {}, vehicles: [], preselectedVehicle: null, currentUser: null, onRequireLogin: () => {} })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const doc = dom.window.document;
  const settle = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const button = (label: string) => Array.from(doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(label));
  const click = async (el: Element | null | undefined) => { assert.ok(el, "element present"); await act(async () => { (el as HTMLElement).click(); }); };
  const input = doc.getElementById("primary-link-input") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, VIN); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  await click(button("Add"));
  for (let i = 0; i < 20 && !doc.body.textContent?.includes(`VIN ${VIN}`); i++) await settle(10);
  const type = async (el: HTMLInputElement, value: string) => act(async () => { setter.call(el, value); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  return { dom, doc, root, act, button, click, settle, type, text: () => doc.body.textContent || "" };
}

// Step 3 → Step 4: a ZIP, no trade-in, Continue.
async function toStep4(t: Awaited<ReturnType<typeof open>>) {
  const zip = Array.from(t.doc.querySelectorAll<HTMLInputElement>("input")).find((i) => i.inputMode === "numeric" && i.maxLength === 5) || t.doc.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
  assert.ok(zip, "ZIP field");
  await t.type(zip!, "08822");
  const skip = Array.from(t.doc.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Skip" && !b.closest(".quote-intro"));
  if (skip) await t.click(skip);
  await t.click(t.button("Continue"));
  await t.settle(30);
}

describe("wizard desk cards", () => {
  it("Step 1 names the vehicle's own make, hides paint codes, and shows no days-on-lot text", async () => {
    const t = await open(() => desk({}));
    const text = t.text();
    assert.doesNotMatch(text, /on the lot|days on|first seen/i);
    assert.doesNotMatch(text, /for Kia/);
    assert.doesNotMatch(text, /0C7V/, "a bare paint code never shows as a colour");
    assert.match(text, /Window sticker isn't available for Hyundai on TrimScout/, "the note names the vehicle's own make");
    assert.match(text, /2026 Hyundai Tucson SEL/, "title keeps the model");
    await t.act(async () => { t.root.unmount(); });
    t.dom.window.close();
  });

  it("an opted-out dealer: blue badge + advisor field; a usable advisor address makes it selectable and ticked", async () => {
    const t = await open(() => desk({ emailOptOut: true, blockedReason: "dealer_opted_out", blockedMessage: "This dealership asked us to stop emailing them." }));
    await t.click(t.button("Continue"));
    await t.click(t.doc.querySelector('[data-testid="quote-type-cash_finance"]'));
    await t.click(t.button("Continue"));
    await t.settle(30);
    const row = t.doc.querySelector('[data-testid="dealer-contact-row"]');
    assert.ok(row, "dealer card renders in Step 3");
    const badge = row!.querySelector('[data-testid="contact-missing"]')!;
    assert.ok(badge, "opted-out badge");
    assert.match(badge.className, /sky/);
    assert.doesNotMatch(badge.className, /amber/);
    const box = row!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.equal(box.disabled, true, "locked until an advisor is added");
    const email = row!.querySelector('input[type="email"]') as HTMLInputElement;
    await t.type(email, "jane.doe@smithhyundai.com");
    assert.equal((row!.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled, false, "selectable");
    assert.equal((row!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked, true, "ticked");
    assert.ok(row!.querySelector('[data-testid="contact-added"]'), "Advisor added");
    await t.type(email, "sales@smithhyundai.com");
    assert.equal((row!.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled, true, "a shared inbox does not unlock it");
    assert.equal(row!.querySelector('[data-testid="contact-added"]'), null);
    await t.act(async () => { t.root.unmount(); });
    t.dom.window.close();
  });

  it("an unassigned dealer says 'To: Sales desk'; a reachable shared inbox says 'Sales contact on file' in Step 3 and in the Step 4 review", async () => {
    let current = desk({});
    const t = await open(() => current);
    await t.click(t.button("Continue"));
    await t.click(t.doc.querySelector('[data-testid="quote-type-cash_finance"]'));
    await t.click(t.button("Continue"));
    await t.settle(30);
    const step3 = t.doc.querySelector('[data-testid="dealer-contact-list"]')!.textContent || "";
    assert.match(step3, /To: Sales desk · Smith Hyundai/);
    assert.match(step3, /Sales desk \(no contact name on file\)/i);
    await toStep4(t);
    const review = t.text();
    assert.match(review, /Step 4 of 4/);
    assert.match(review, /What happens next: dealers reply on your TrimScout deal page and you get an email\. Nothing is shared with a dealer until you accept a quote\./);
    assert.match(review, /A request, not a bid/);
    assert.match(review, /Sales desk \(no contact name on file\)/i, "unassigned keeps the desk label");
    assert.doesNotMatch(review, /on the lot|days on/i);
    await t.act(async () => { t.root.unmount(); });
    t.dom.window.close();
    current = desk({ contactState: "email_only", routing: "rooftop_inbox", emailMasked: "s•••@smithhyundai.com" });
    const u = await open(() => current);
    await u.click(u.button("Continue"));
    await u.click(u.doc.querySelector('[data-testid="quote-type-cash_finance"]'));
    await u.click(u.button("Continue"));
    await u.settle(30);
    const list = u.doc.querySelector('[data-testid="dealer-contact-list"]')!.textContent || "";
    assert.match(list, /Sales contact on file/);
    await toStep4(u);
    const reviewU = u.text();
    assert.match(reviewU, /Step 4 of 4/);
    assert.match(reviewU, /Sales contact on file/, "Step 4 review shows a contact on file for a reachable rooftop");
    assert.doesNotMatch(reviewU, /no contact name on file/i);
    assert.match(list, /s•••@smithhyundai\.com/, "masked email shown when one exists");
    assert.doesNotMatch(list, /no contact name on file/i);
    await u.act(async () => { u.root.unmount(); });
    u.dom.window.close();
  });
});
