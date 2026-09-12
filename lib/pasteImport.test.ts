import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  importPastedFactoryVehicle,
  classifyPaste,
  isDuplicateVehicle,
  hasUsableVehicleBasics,
  MAX_PACKAGE_VEHICLES,
} from "./pasteImport";

const FORD_VIN = "1FMWK8JCXTGB47204";
const BMW_VIN = "5UXTA6C08N9K19282";

/** A fetch that answers with canned JSON per endpoint and records what it was asked. */
function fakeFetch(responses: Record<string, { status?: number; json: unknown }>) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const hit = responses[url];
    if (!hit) return new Response(JSON.stringify({ error: `no fake for ${url}` }), { status: 500 });
    return new Response(JSON.stringify(hit.json), { status: hit.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

function releasedFord(over: Record<string, unknown> = {}) {
  return {
    handled: true,
    vin: FORD_VIN,
    sticker: { status: "released", pdfUrl: "https://example.test/sticker.pdf", msrp: 64705 },
    buildConfidence: "verified_factory",
    vehicle: {
      id: `ford-${FORD_VIN}`,
      vin: FORD_VIN,
      year: 2026,
      make: "Ford",
      model: "Explorer",
      trim: "Tremor",
      msrp: 64705,
      dealerPrice: 0,
      location: { dealerName: "Route 23 Auto Mall", city: "Butler", state: "NJ", distanceMiles: 0 },
      packages: [],
      options: [],
      ...over,
    },
    listingPrice: null,
    mustHaveLines: ["Tremor Package"],
    niceToHaveLines: [],
    filterableOptions: [],
    pdfUrl: "https://example.test/sticker.pdf",
  };
}

describe("importPastedFactoryVehicle — good VIN", () => {
  it("imports a released factory build as verified, with dealer and options", async () => {
    const { impl, calls } = fakeFetch({ "/api/ford-sticker": { json: releasedFord() } });
    const r = await importPastedFactoryVehicle(FORD_VIN, impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.vehicle.year, 2026);
    assert.equal(r.vehicle.model, "Explorer");
    assert.equal(r.vehicle.location.dealerName, "Route 23 Auto Mall");
    assert.equal(r.buildConfidence, "verified_factory");
    assert.equal(r.vehicle.buildConfidence, "verified_factory");
    assert.equal(r.factoryBuildUnavailable, false);
    assert.deepEqual(r.mustHaveLines, ["Tremor Package"]);
    assert.equal(calls[0].url, "/api/ford-sticker");
  });

  it("imports a VIN with no released sticker as dealer-listing-only, not as a failure", async () => {
    const { impl } = fakeFetch({
      "/api/ford-sticker": {
        json: {
          ...releasedFord({ msrp: 0, options: [], packages: [] }),
          sticker: { status: "unreleased", pdfUrl: null, msrp: null },
          buildConfidence: "dealer_listing_only",
          mustHaveLines: [],
          filterableOptions: [],
          pdfUrl: null,
        },
      },
    });
    const r = await importPastedFactoryVehicle(FORD_VIN, impl);
    assert.equal(r.ok, true, "an unreleased sticker with a vehicle must import, not dead-end");
    if (!r.ok) return;
    assert.equal(r.buildConfidence, "dealer_listing_only");
    assert.equal(r.factoryBuildUnavailable, true);
    assert.deepEqual(r.mustHaveLines, []);
  });
});

describe("importPastedFactoryVehicle — good VDP URL", () => {
  it("routes a dealer page URL to the VIN's make and imports the vehicle", async () => {
    const url = `https://www.route23automall.com/new/Ford/2026-Ford-Explorer-${FORD_VIN}.htm`;
    const { impl, calls } = fakeFetch({ "/api/ford-sticker": { json: releasedFord() } });
    const r = await importPastedFactoryVehicle(url, impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.vehicle.vin, FORD_VIN);
    assert.equal(calls[0].body?.paste, url);
  });

  it("follows the cross-make retry when the URL itself has no VIN", async () => {
    const url = "https://www.paulmillerbmw.com/new-inventory/index.htm";
    const { impl, calls } = fakeFetch({
      "/api/ford-sticker": { json: { handled: false, notFord: true, vin: BMW_VIN } },
      "/api/bmw-sticker": {
        json: {
          handled: true,
          vin: BMW_VIN,
          sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" },
          buildConfidence: "dealer_listing_only",
          vehicle: { vin: BMW_VIN, year: 2022, make: "BMW", model: "X5", trim: "xDrive45e", location: { dealerName: "Paul Miller BMW", city: "Wayne", state: "NJ" }, options: [], packages: [] },
          mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: null,
        },
      },
    });
    const r = await importPastedFactoryVehicle(url, impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.vehicle.make, "BMW");
    assert.equal(r.vehicle.location.dealerName, "Paul Miller BMW");
    assert.deepEqual(calls.map((c) => c.url), ["/api/ford-sticker", "/api/bmw-sticker"]);
    assert.equal(calls[1].body?.vin, BMW_VIN);
  });
});

describe("importPastedFactoryVehicle — bad URL", () => {
  it("rejects a malformed link before any fetch, with a reason", async () => {
    const { impl, calls } = fakeFetch({});
    for (const bad of ["htp:/broken", "https://", "not a link at all", "ftp://dealer.example/car"]) {
      const r = await importPastedFactoryVehicle(bad, impl);
      assert.equal(r.ok, false, bad);
      if (r.ok) continue;
      assert.equal(r.reason, "invalid_input", bad);
      assert.match(r.error, /VIN|link|address/i);
    }
    assert.equal(calls.length, 0, "no network call for input we can already reject");
  });

  it("reports a page with no VIN on it as no_vin, never as a vehicle", async () => {
    const { impl } = fakeFetch({
      "/api/ford-sticker": {
        status: 422,
        json: { error: "Could not read a VIN from that page. Paste the 17-character VIN.", handled: true, needsVin: true, dealerBlocked: false },
      },
    });
    const r = await importPastedFactoryVehicle("https://www.somedealer.example/new-inventory/", impl);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "no_vin");
  });

  it("reports a bot-shielded site as blocked", async () => {
    const { impl } = fakeFetch({
      "/api/ford-sticker": {
        status: 422,
        json: { error: "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing.", handled: true, needsVin: true, dealerBlocked: true },
      },
    });
    const r = await importPastedFactoryVehicle("https://www.shielded.example/vdp/1", impl);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "blocked");
    assert.equal(r.dealer, undefined);
    assert.equal(r.listingUrl, undefined);
  });
});

describe("importPastedFactoryVehicle — open to confirm (bot-shielded page)", () => {
  const url = "https://www.paulmillerbmw.com/new/BMW/2026-BMW-X5-12345.htm";

  it("carries the store and the link when the page kept the VIN from us", async () => {
    const { impl } = fakeFetch({
      "/api/bmw-sticker": {
        status: 422,
        json: {
          error: "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing.",
          handled: true,
          needsVin: true,
          dealerBlocked: true,
          dealer: { name: "Paul Miller BMW", city: "Wayne", state: "NJ" },
          listingUrl: url,
        },
      },
    });
    const r = await importPastedFactoryVehicle(url, impl);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "blocked");
    assert.deepEqual(r.dealer, { name: "Paul Miller BMW", city: "Wayne", state: "NJ" });
    assert.equal(r.listingUrl, url);
  });

  it("flags a vehicle built without the page as pageUnread so the UI asks the buyer", async () => {
    const { impl } = fakeFetch({
      "/api/bmw-sticker": {
        json: {
          handled: true,
          vin: BMW_VIN,
          sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" },
          buildConfidence: "dealer_listing_only",
          vehicle: { vin: BMW_VIN, year: 2022, make: "BMW", model: "X5", trim: "xDrive45e", location: { dealerName: "Paul Miller BMW", city: "Wayne", state: "NJ" }, options: [], packages: [], dealerUrl: url },
          mustHaveLines: [],
          niceToHaveLines: [],
          filterableOptions: [],
          pdfUrl: null,
          pageUnread: true,
        },
      },
    });
    const r = await importPastedFactoryVehicle(`https://www.paulmillerbmw.com/new-Wayne-2022-BMW-X5-${BMW_VIN}`, impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.pageUnread, true);
    assert.equal(r.vehicle.location.dealerName, "Paul Miller BMW");
    assert.equal(r.buildConfidence, "dealer_listing_only");
  });

  it("a normally-read page is not pageUnread", async () => {
    const { impl } = fakeFetch({ "/api/ford-sticker": { json: releasedFord() } });
    const r = await importPastedFactoryVehicle(FORD_VIN, impl);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.pageUnread, false);
  });

  it("sends a buyer-supplied VIN with the same link, routed by the VIN's make", async () => {
    const { impl, calls } = fakeFetch({
      "/api/bmw-sticker": {
        json: {
          handled: true,
          vin: BMW_VIN,
          sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" },
          buildConfidence: "dealer_listing_only",
          vehicle: { vin: BMW_VIN, year: 2022, make: "BMW", model: "X5", trim: "xDrive45e", location: { dealerName: "Paul Miller BMW", city: "Wayne", state: "NJ" }, options: [], packages: [] },
          mustHaveLines: [],
          niceToHaveLines: [],
          filterableOptions: [],
          pdfUrl: null,
          pageUnread: true,
        },
      },
    });
    const r = await importPastedFactoryVehicle(url, impl, { vin: BMW_VIN.toLowerCase() });
    assert.equal(r.ok, true);
    // The URL alone says nothing about the make; the VIN decides the route.
    assert.equal(calls[0].url, "/api/bmw-sticker");
    assert.deepEqual(calls[0].body, { paste: url, vin: BMW_VIN });
  });

  it("refuses a malformed buyer-supplied VIN before any network call", async () => {
    const { impl, calls } = fakeFetch({});
    const r = await importPastedFactoryVehicle(url, impl, { vin: "5UXTA6C08N9K1928O" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "invalid_input");
    assert.equal(calls.length, 0);
  });

  it("still refuses a duplicate when the VIN was supplied by the buyer", async () => {
    const { impl, calls } = fakeFetch({});
    const r = await importPastedFactoryVehicle(url, impl, { vin: BMW_VIN, existingVehicles: [{ vin: BMW_VIN }] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "duplicate");
    assert.equal(calls.length, 0);
  });
});

describe("importPastedFactoryVehicle — unsupported host", () => {
  it("names the host and asks for the dealer's own page, without fetching", async () => {
    const { impl, calls } = fakeFetch({});
    for (const url of [
      "https://www.youtube.com/watch?v=abc123",
      "https://www.google.com/search?q=2026+ford+explorer",
      "https://www.facebook.com/marketplace/item/123",
      "https://m.facebook.com/marketplace/item/123",
      "https://www.craigslist.org/cto/d/2019-honda/12345.html",
    ]) {
      const r = await importPastedFactoryVehicle(url, impl);
      assert.equal(r.ok, false, url);
      if (r.ok) continue;
      assert.equal(r.reason, "unsupported_host", url);
      assert.match(r.error, /isn't a dealer listing/);
    }
    assert.equal(calls.length, 0);
  });

  it("does not mistake a dealer's own domain for an unsupported one", () => {
    for (const url of [
      "https://www.loubachrodtbmw.com/new-Rockford-2026-BMW-X3-30+xDrive-5UX53GP01T9190742",
      "https://www.paulmillerbmw.com/new-inventory/index.htm",
      "https://capitolford.com/inventory/new/",
    ]) {
      assert.equal(classifyPaste(url).kind, "url", url);
    }
  });
});

describe("importPastedFactoryVehicle — duplicate links", () => {
  it("refuses a VIN already in the package before fetching", async () => {
    const { impl, calls } = fakeFetch({});
    const r = await importPastedFactoryVehicle(FORD_VIN, impl, { existingVehicles: [{ vin: FORD_VIN }, null] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "duplicate");
    assert.match(r.error, new RegExp(FORD_VIN));
    assert.equal(calls.length, 0);
  });

  it("refuses the same car pasted as a URL the second time", async () => {
    const url = `https://www.route23automall.com/new/Ford/2026-Ford-Explorer-${FORD_VIN}.htm`;
    const { impl, calls } = fakeFetch({});
    const r = await importPastedFactoryVehicle(url, impl, { existingVehicles: [{ vin: FORD_VIN.toLowerCase() }] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "duplicate");
    assert.equal(calls.length, 0);
  });

  it("catches a duplicate that only surfaces after the cross-make retry", async () => {
    // The URL has no VIN in it; only the first route's answer reveals it.
    const url = "https://www.paulmillerbmw.com/new-inventory/index.htm";
    const { impl, calls } = fakeFetch({
      "/api/ford-sticker": { json: { handled: false, notFord: true, vin: BMW_VIN } },
    });
    const r = await importPastedFactoryVehicle(url, impl, { existingVehicles: [{ vin: BMW_VIN }] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "duplicate");
    assert.equal(calls.length, 1, "no second fetch once the VIN is known to be a duplicate");
  });

  it("isDuplicateVehicle ignores blanks and is case-insensitive", () => {
    assert.equal(isDuplicateVehicle(FORD_VIN, [null, undefined, { vin: "" }]), false);
    assert.equal(isDuplicateVehicle(FORD_VIN.toLowerCase(), [{ vin: FORD_VIN }]), true);
    assert.equal(isDuplicateVehicle("short", [{ vin: "short" }]), false);
  });

  it("caps the package at three vehicles", () => {
    assert.equal(MAX_PACKAGE_VEHICLES, 3);
  });
});

describe("importPastedFactoryVehicle — never '0 Ford F-150'", () => {
  it("rejects a vehicle whose year the parser missed, with a parse_failed reason", async () => {
    const { impl } = fakeFetch({
      "/api/ford-sticker": { json: releasedFord({ year: 0, model: "F-150", trim: "" }) },
    });
    const r = await importPastedFactoryVehicle(FORD_VIN, impl);
    assert.equal(r.ok, false, "a year-0 vehicle is a parser miss, not a car");
    if (r.ok) return;
    assert.equal(r.reason, "parse_failed");
    assert.match(r.error, new RegExp(FORD_VIN));
    assert.doesNotMatch(r.error, /0 Ford/);
  });

  it("hasUsableVehicleBasics draws the line at a real year and a make", () => {
    assert.equal(hasUsableVehicleBasics({ year: 2026, make: "Ford" }), true);
    assert.equal(hasUsableVehicleBasics({ year: 0, make: "Ford" }), false);
    assert.equal(hasUsableVehicleBasics({ year: 2026, make: "" }), false);
    assert.equal(hasUsableVehicleBasics({ year: 1979, make: "Ford" }), false);
    assert.equal(hasUsableVehicleBasics(null), false);
  });
});
