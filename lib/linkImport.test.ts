import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachLinkToVehicle, dealerSourceLabel, hasVinResolvedDealer, isPlausibleVin, resolveVdpLink, searchDealers, type DeskMatch } from "./linkImport";
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
  it("passes through 'none' with no desk and no search seed", async () => {
    const { impl } = fakeFetch({ "/api/desk-resolve": { json: { status: "none", host: "zephyr.example" } } });
    const r = await resolveVdpLink("https://zephyr.example/vdp/1", impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.desk, null);
    assert.deepEqual(r.candidates, []);
    assert.equal("suggestedQuery" in r, false);
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

  it("uses the link's desk only when the VIN named no dealership", () => {
    const v = attachLinkToVehicle(base, { url: URL_WITH_VIN, desk: DESK, deskSource: "listing_domain" });
    assert.equal(v.dealerUrl, URL_WITH_VIN);
    assert.equal(v.location.dealerName, "Bachrodt BMW");
    assert.equal(v.location.deskId, "1");
    assert.equal(v.location.dealerSource, "listing_domain");
    assert.equal(v.buyerConfirmed, true);
    assert.equal(v.buildConfidence, "dealer_listing_only", "a person's confirmation never upgrades the build");
    assert.equal(v.dealerPrice, 0, "no advertised price is carried");
  });

  it("never overwrites a VIN-resolved dealer with the link's", () => {
    for (const dealerSource of ["inventory", "window_sticker"] as const) {
      const fromVin = { ...base, location: { ...base.location, dealerName: "Route 23 Auto Mall", state: "NJ", dealerSource } } as Vehicle;
      const v = attachLinkToVehicle(fromVin, { url: URL_WITH_VIN, desk: DESK, deskSource: "listing_domain" });
      assert.equal(v.location.dealerName, "Route 23 Auto Mall", dealerSource);
      assert.equal(v.location.dealerSource, dealerSource);
      assert.equal(v.dealerUrl, URL_WITH_VIN, "the link itself is still recorded");
    }
  });

  it("lets the buyer's own explicit pick replace either", () => {
    const fromVin = { ...base, location: { ...base.location, dealerName: "Route 23 Auto Mall", state: "NJ", dealerSource: "window_sticker" } } as Vehicle;
    const v = attachLinkToVehicle(fromVin, { url: URL_WITH_VIN, desk: DESK, deskSource: "buyer_picked" });
    assert.equal(v.location.dealerName, "Bachrodt BMW");
    assert.equal(v.location.dealerSource, "buyer_picked");
  });

  it("leaves an empty dealer empty when there is nothing to fall back to", () => {
    const v = attachLinkToVehicle(base, { url: URL_WITH_VIN, desk: null, deskSource: "listing_domain" });
    assert.equal(v.location.dealerName, "");
    assert.equal(v.location.dealerSource, "unknown");
  });
});

describe("hasVinResolvedDealer / dealerSourceLabel", () => {
  it("counts only inventory and window-sticker sources as VIN-derived", () => {
    const at = (dealerSource: string, dealerName = "X") =>
      hasVinResolvedDealer({ location: { dealerName, city: "", state: "", distanceMiles: 0, dealerSource } } as unknown as Vehicle);
    assert.equal(at("inventory"), true);
    assert.equal(at("window_sticker"), true);
    assert.equal(at("listing_domain"), false);
    assert.equal(at("buyer_picked"), false);
    assert.equal(at("inventory", ""), false);
  });
  it("labels every source the buyer can see", () => {
    assert.equal(dealerSourceLabel("inventory"), "matched from the VIN");
    assert.equal(dealerSourceLabel("window_sticker"), "from the factory window sticker");
    assert.equal(dealerSourceLabel("listing_domain"), "from the listing link");
    assert.equal(dealerSourceLabel("buyer_picked"), "picked by you");
    assert.equal(dealerSourceLabel("unknown"), "");
  });
});
