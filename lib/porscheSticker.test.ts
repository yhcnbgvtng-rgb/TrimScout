import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importPastedFactoryVehicle, preferredFactoryBuildEndpoint } from "./pasteImport";
import { isPorscheVin, looksLikePorschePaste } from "./oemWmi";
import {
  PORSCHE_OPTION_CODES,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getPorscheBuild,
  porscheBuildFromMarketCheck,
  porscheBuildToVehicle,
  unknownCodeName,
} from "./porscheSticker";

// Shapes captured live from MarketCheck on 2026-09-04 for a real 2026 Macan
// (Paul Miller Porsche, NJ), trimmed to the fields the parser reads.
const VIN = "WP1AA2A53TLB07942";
const SEARCH_ROW = {
  id: "abc123-mc-listing",
  vin: VIN,
  price: 74255,
  msrp: 73260,
  vdp_url: "https://www.paulmillerporsche.com/new/Porsche/2026-Porsche-Macan-x.htm",
  exterior_color: "0q0q",
  interior_color: "Black",
  dealer: { name: "Paul Miller Porsche", city: "Parsippany", state: "NJ", zip: "07054" },
  build: { year: 2026, make: "Porsche", model: "Macan", trim: "T", version: "T", body_type: "SUV", transmission: "Automatic", drivetrain: "4WD", engine: "2.0L I4" },
};
const DETAIL = {
  ...SEARCH_ROW,
  extra: {
    options_packages: ["PU5", "3FU", "1NP", "Q2J", "4A4", "4D3", "8IU", "KA6", "7Y1"],
    high_value_features: [
      { category: "Interior", description: "Panoramic Sun/Moonroof", type: "Optional" },
      { category: "Interior", description: "Heated/Cooled Seats", type: "Optional" },
      { category: "Safety & Driver Assist", description: "360 View Parking Device", type: "Optional" },
      { category: "Infotainment", description: "Premium Speakers", type: "Standard" },
      { category: "Interior", description: "Leather Seats", type: "Standard" },
    ],
    options: ["Navigation System", "Sound Package Plus", "Heated Steering Wheel", "Surround View"],
    features: ["Navigation system", "Power moonroof"],
  },
};

describe("Porsche WMI + paste routing", () => {
  it("WP0/WP1 are Porsche; nothing else is", () => {
    assert.equal(isPorscheVin(VIN), true);
    assert.equal(isPorscheVin("WP0AB2A98SS160032"), true);
    assert.equal(isPorscheVin("1FMWK8JCXTGB47204"), false);
    assert.equal(isPorscheVin("WAUZZAF42NA091482"), false, "Audi shares the VW group, not the WMI");
  });

  it("a pasted Porsche VIN or dealer URL routes to /api/porsche-sticker", () => {
    assert.equal(preferredFactoryBuildEndpoint(VIN), "/api/porsche-sticker");
    assert.equal(
      preferredFactoryBuildEndpoint("https://www.paulmillerporsche.com/new/Porsche/2026-Porsche-Macan-x.htm"),
      "/api/porsche-sticker"
    );
    assert.equal(looksLikePorschePaste("2026 Porsche Macan"), true);
    assert.equal(preferredFactoryBuildEndpoint("1FMWK8JCXTGB47204"), "/api/ford-sticker", "Ford still routes to Ford");
  });
});

describe("porscheBuildFromMarketCheck", () => {
  it("turns options_packages into named, coded factory options — prices only where known", () => {
    const build = porscheBuildFromMarketCheck(VIN, SEARCH_ROW, DETAIL);
    assert.equal(build.status, "found");
    assert.equal(build.model, "Macan");
    assert.equal(build.trim, "T");
    assert.equal(build.year, 2026);
    assert.equal(build.msrp, 73260);
    assert.equal(build.listingPrice, 74255);
    assert.deepEqual(build.optionCodes, ["PU5", "3FU", "1NP", "Q2J", "4A4", "4D3", "8IU", "KA6", "7Y1"]);
    const byCode = Object.fromEntries(build.options.filter((o) => o.code).map((o) => [o.code, o]));
    assert.equal(byCode.PU5.name, "Premium Package Plus");
    assert.equal(byCode.PU5.price, 3790);
    assert.equal(byCode.KA6.name, "Surround View");
    assert.equal(byCode.KA6.price, 1240);
    assert.equal(byCode["3FU"].name, "Panoramic Roof System");
    assert.equal(byCode["3FU"].price, null, "known name, unknown price stays null — never 0");
    assert.equal(build.dealer.name, "Paul Miller Porsche");
    assert.equal(build.vdpUrl, SEARCH_ROW.vdp_url);
    assert.match(build.note || "", /Prices are shown only where/);
  });

  it("adds typed-Optional high-value features without duplicating a coded option, and keeps Standard ones separate", () => {
    const build = porscheBuildFromMarketCheck(VIN, SEARCH_ROW, DETAIL);
    const names = build.options.map((o) => o.name);
    assert.ok(names.includes("Panoramic Sun/Moonroof"));
    assert.ok(names.includes("Heated/Cooled Seats"));
    assert.equal(names.filter((n) => n === "Surround View").length, 1);
    assert.deepEqual(build.standardFeatures, ["Premium Speakers", "Leather Seats"]);
    assert.ok(!names.includes("Leather Seats"), "standard equipment is not an option");
  });

  it("names an unknown code honestly instead of inventing one, and never fabricates a price", () => {
    const build = porscheBuildFromMarketCheck(VIN, SEARCH_ROW, {
      ...DETAIL,
      extra: { options_packages: ["ZZ9", "PU5", "pu5", " ka6 "] },
    });
    assert.deepEqual(build.optionCodes, ["ZZ9", "PU5", "KA6"], "normalized + de-duplicated");
    const zz9 = build.options.find((o) => o.code === "ZZ9")!;
    assert.equal(zz9.name, unknownCodeName("ZZ9"));
    assert.equal(zz9.price, null);
    assert.ok(!(("ZZ9" as string) in PORSCHE_OPTION_CODES));
  });

  it("no build data → not_found, no options, no guessed model", () => {
    const build = porscheBuildFromMarketCheck(VIN, { id: "x", vin: VIN }, { extra: {} });
    assert.equal(build.status, "not_found");
    assert.equal(build.model, "");
    assert.deepEqual(build.options, []);
  });
});

describe("porscheBuildToVehicle + wizard lines", () => {
  it("builds a Vehicle whose $0 option price means unknown, with the dealer confirmed from the listing", () => {
    const build = porscheBuildFromMarketCheck(VIN, SEARCH_ROW, DETAIL);
    const v = porscheBuildToVehicle(build, null);
    assert.equal(v.vin, VIN);
    assert.equal(v.make, "Porsche");
    assert.equal(v.model, "Macan");
    assert.equal(v.msrp, 73260);
    assert.equal(v.dealerPrice, 74255);
    assert.equal(v.location.dealerName, "Paul Miller Porsche");
    assert.equal(v.location.dealerConfirmed, true);
    assert.equal(v.dealerUrl, SEARCH_ROW.vdp_url);
    const pano = v.options.find((o) => o.code === "3FU")!;
    assert.equal(pano.price, 0);
    const premium = v.options.find((o) => o.code === "PU5")!;
    assert.equal(premium.price, 3790);
    assert.equal(premium.category, "package");
    assert.ok(v.packages.includes("Surround View"));
  });

  it("filterable options carry the code in the description and null prices where unknown; nice-to-haves are the coded options", () => {
    const build = porscheBuildFromMarketCheck(VIN, SEARCH_ROW, DETAIL);
    const filterable = filterableFactoryOptions(build);
    const ka6 = filterable.find((o) => o.code === "KA6")!;
    assert.equal(ka6.description, "KA6  Surround View");
    assert.equal(ka6.price, 1240);
    const nice = defaultNiceToHaveLines(build, ["Surround View"]);
    assert.ok(nice.includes("Premium Package Plus"));
    assert.ok(!nice.includes("Surround View"), "already a must-have");
    assert.ok(nice.includes("Panoramic Sun/Moonroof"), "typed-Optional features are nice-to-haves too");
    assert.ok(!nice.includes("Navigation System"), "plain dealer equipment lines are not default nice-to-haves");
  });
});

describe("getPorscheBuild", () => {
  it("makes exactly two calls — search by VIN, then listing detail — and never a sticker fetch", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes("/v2/search/car/active") ? { num_found: 1, listings: [SEARCH_ROW] } : DETAIL;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const build = await getPorscheBuild(VIN, { fetchImpl, apiKey: "test-key" });
    assert.equal(build.status, "found");
    assert.equal(urls.length, 2);
    assert.match(urls[0], /\/v2\/search\/car\/active\?.*vin=WP1AA2A53TLB07942/);
    assert.match(urls[1], /\/v2\/listing\/car\/abc123-mc-listing/);
    assert.ok(urls.every((u) => !/window|sticker|finder\.porsche/i.test(u)));
    assert.equal(build.optionCodes.length, 9);
  });

  it("no active listing → not_found with an honest note; no key → error, zero calls", async () => {
    let calls = 0;
    const empty = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ num_found: 0, listings: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const build = await getPorscheBuild(VIN, { fetchImpl: empty, apiKey: "test-key" });
    assert.equal(build.status, "not_found");
    assert.match(build.note || "", /No active dealer listing/);
    assert.equal(calls, 1);

    let keylessCalls = 0;
    const never = (async () => {
      keylessCalls += 1;
      return new Response("{}");
    }) as typeof fetch;
    const noKey = await getPorscheBuild(VIN, { fetchImpl: never, apiKey: null });
    assert.equal(noKey.status, "error");
    assert.equal(keylessCalls, 0);
  });

  it("rejects a non-Porsche VIN without calling anything", async () => {
    let calls = 0;
    const never = (async () => {
      calls += 1;
      return new Response("{}");
    }) as typeof fetch;
    const build = await getPorscheBuild("1FMWK8JCXTGB47204", { fetchImpl: never, apiKey: "test-key" });
    assert.equal(build.status, "error");
    assert.equal(calls, 0);
  });
});

describe("importPastedFactoryVehicle for a Porsche VIN", () => {
  it("accepts the route's response shape and surfaces the coded options as filterable", async () => {
    const build = porscheBuildFromMarketCheck(VIN, SEARCH_ROW, DETAIL);
    const routeJson = {
      handled: true,
      vin: VIN,
      sticker: { status: "released", pdfUrl: null, msrp: build.msrp },
      vehicle: porscheBuildToVehicle(build, null),
      listingPrice: build.listingPrice,
      mustHaveLines: [],
      niceToHaveLines: defaultNiceToHaveLines(build, []),
      filterableOptions: filterableFactoryOptions(build),
      pdfUrl: null,
    };
    const hits: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      hits.push(String(input));
      return new Response(JSON.stringify(routeJson), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const result = await importPastedFactoryVehicle(VIN, fetchImpl);
    assert.deepEqual(hits, ["/api/porsche-sticker"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.oem, "porsche");
    assert.equal(result.vehicle.vin, VIN);
    assert.equal(result.msrp, 73260);
    assert.equal(result.pdfUrl, null);
    assert.ok(result.filterableOptions.some((o) => o.code === "PU5" && o.price === 3790));
    assert.ok(result.niceToHaveLines.includes("Premium Package Plus"));
  });

  it("a non-Porsche VIN sent to the Porsche route falls through to the right OEM, never a catalog stand-in", async () => {
    const fordVin = "1FMWK8JCXTGB47204";
    const hits: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      hits.push(url);
      if (url === "/api/porsche-sticker") {
        return new Response(JSON.stringify({ handled: false, notPorsche: true, vin: fordVin }), { status: 200 });
      }
      return new Response(JSON.stringify({ handled: true, vin: fordVin, sticker: { status: "released" }, vehicle: { vin: fordVin } }), { status: 200 });
    }) as typeof fetch;
    const result = await importPastedFactoryVehicle(fordVin, fetchImpl);
    assert.equal(hits[0], "/api/ford-sticker", "Ford VIN never goes to Porsche in the first place");
    assert.equal(result.ok, true);
  });
});
