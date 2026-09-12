import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachLinkToVehicle, isPlausibleVin, resolveVdpLink, searchDealers, type DeskMatch } from "./linkImport";
import type { Vehicle } from "./types";

function fakeFetch(routes: Record<string, { status?: number; json: unknown }>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const hit = routes[url];
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit.json), { status: hit.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

const DESK: DeskMatch = { deskId: "1", dealerName: "Bachrodt BMW", city: "Rockford", state: "IL", zip: "61112", knownNamed: true, emailOptOut: false };
const URL_WITH_VIN = "https://www.loubachrodtbmw.com/new-Rockford-2026-BMW-X3-30+xDrive-5UX53GP01T9190742";

describe("resolveVdpLink", () => {
  it("asks only the desk resolver — never the pasted page — and reads the VIN from the URL text", async () => {
    const { impl, calls } = fakeFetch({ "/api/desk-resolve": { json: { status: "unique", via: "website", host: "loubachrodtbmw.com", desk: DESK } } });
    const r = await resolveVdpLink(URL_WITH_VIN, impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.vinFromUrl, "5UX53GP01T9190742");
    assert.equal(r.desk?.deskId, "1");
    assert.deepEqual(calls.map((c) => c.url), ["/api/desk-resolve"]);
    assert.equal(calls[0].body.url, URL_WITH_VIN);
  });
  it("surfaces an ambiguous site as candidates with no desk bound", async () => {
    const { impl } = fakeFetch({ "/api/desk-resolve": { json: { status: "ambiguous", host: "cochran.com", candidates: [DESK, { ...DESK, deskId: "2", dealerName: "Bachrodt Buick GMC" }] } } });
    const r = await resolveVdpLink("https://www.cochran.com/new/x", impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.desk, null);
    assert.equal(r.candidates.length, 2);
    assert.equal(r.vinFromUrl, null);
  });
  it("passes through 'none' with the picker seed", async () => {
    const { impl } = fakeFetch({ "/api/desk-resolve": { json: { status: "none", host: "zephyr.example", suggestedQuery: "zephyr" } } });
    const r = await resolveVdpLink("https://zephyr.example/vdp/1", impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.desk, null);
    assert.equal(r.suggestedQuery, "zephyr");
  });
  it("reports a rejected paste as an error", async () => {
    const { impl } = fakeFetch({ "/api/desk-resolve": { status: 422, json: { status: "invalid", error: "Not a vehicle page." } } });
    const r = await resolveVdpLink("https://cars.com/x", impl);
    assert.deepEqual(r, { ok: false, error: "Not a vehicle page." });
  });
});

describe("searchDealers", () => {
  it("posts name and zip and returns the matches", async () => {
    const { impl, calls } = fakeFetch({ "/api/dealer-search": { json: { matches: [DESK] } } });
    const hits = await searchDealers(" Bachrodt ", "61108", impl);
    assert.deepEqual(hits, [DESK]);
    assert.deepEqual(calls[0].body, { q: "Bachrodt", zip: "61108" });
  });
});

describe("isPlausibleVin", () => {
  it("accepts 17 VIN characters and rejects I/O/Q or the wrong length", () => {
    assert.equal(isPlausibleVin("5ux53gp01t9190742"), true);
    assert.equal(isPlausibleVin("5UX53GP01T919074O"), false);
    assert.equal(isPlausibleVin("5UX53GP01T91907"), false);
  });
});

describe("attachLinkToVehicle", () => {
  const base = {
    vin: "5UX53GP01T9190742",
    year: 2026,
    make: "BMW",
    model: "X3",
    trim: "30 xDrive",
    dealerPrice: 0,
    msrp: 52000,
    buildConfidence: "dealer_listing_only",
    location: { dealerName: "", city: "", state: "", distanceMiles: 0, dealerSource: "unknown" },
  } as unknown as Vehicle;

  it("stamps the link, the buyer's price and the desk, and marks the buyer's confirmation", () => {
    const v = attachLinkToVehicle(base, { url: URL_WITH_VIN, price: 51995.4, desk: DESK, deskSource: "listing_domain" });
    assert.equal(v.dealerUrl, URL_WITH_VIN);
    assert.equal(v.dealerPrice, 51995);
    assert.equal(v.location.dealerName, "Bachrodt BMW");
    assert.equal(v.location.state, "IL");
    assert.equal(v.location.deskId, "1");
    assert.equal(v.location.dealerSource, "listing_domain");
    assert.equal(v.location.dealerConfirmed, true);
    assert.equal(v.buyerConfirmed, true);
    assert.equal(v.buildConfidence, "dealer_listing_only", "a person's confirmation never upgrades the build");
  });
  it("leaves the vehicle's own dealer alone when no desk was chosen", () => {
    const withSticker = { ...base, location: { ...base.location, dealerName: "Route 23 Auto Mall", dealerSource: "window_sticker" } } as Vehicle;
    const v = attachLinkToVehicle(withSticker, { url: URL_WITH_VIN, price: null, desk: null, deskSource: "buyer_picked" });
    assert.equal(v.location.dealerName, "Route 23 Auto Mall");
    assert.equal(v.location.dealerSource, "window_sticker");
    assert.equal(v.dealerPrice, 0);
  });
});
