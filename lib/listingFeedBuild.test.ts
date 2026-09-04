import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importPastedFactoryVehicle, preferredFactoryBuildEndpoint } from "./pasteImport";
import { isHondaVin, isToyotaVin, looksLikeHondaPaste, looksLikeToyotaPaste } from "./oemWmi";
import {
  buildToVehicle,
  defaultNiceToHaveLines,
  equipmentLineName,
  filterableFactoryOptions,
  isBaselineEquipment,
  splitEquipmentLine,
} from "./listingFeedBuild";
import { TOYOTA_MAKE, getToyotaBuild, toyotaBuildFromMarketCheck } from "./toyotaSticker";
import { HONDA_MAKE, getHondaBuild, hondaBuildFromMarketCheck } from "./hondaSticker";

// Shapes captured live from MarketCheck on 2026-09-04 (Crestmont Toyota and
// Route 23 Honda, NJ), trimmed to the fields the engine reads.
const CAMRY_VIN = "4T1DBADK0TU39C844";
const CAMRY_ROW = {
  id: "camry-listing-id",
  vin: CAMRY_VIN,
  price: 37474,
  msrp: 38104,
  vdp_url: "https://www.crestmonttoyota.com/new/Toyota/2026-Toyota-Camry-x.htm",
  dealer: { name: "Crestmont Toyota", city: "Pompton Plains", state: "NJ", zip: "07444" },
  build: { year: 2026, make: "Toyota", model: "Camry", trim: "SE", body_type: "Sedan", transmission: "CVT", drivetrain: "AWD", engine: "2.5L I4 Hybrid" },
};
const CAMRY_DETAIL = {
  ...CAMRY_ROW,
  extra: {
    options_packages: ["SR"],
    high_value_features: [
      { category: "Interior", description: "Sun/Moonroof", type: "Optional" },
      { category: "Infotainment", description: "Bluetooth", type: "Standard" },
    ],
    options: [
      "Wireless Apple CarPlay compatibility",
      "Backup camera with dynamic gridlines",
      "Cold Weather Package Cold Weather PackageHeated leather steering wheel Paddle shiftersHeated front seats",
      "Convenience Package Convenience PackageAuto-dimming rearview mirror with HomeLink universal garage door openerSmart Key System on front doors",
      "Power tilt/slide moonroof (removal of overhead sunglasses storage)",
      "Qi-compatible wireless charging with charge indicator light",
      "50 State Emissions 50 State Emissions",
      "Eight airbags includes driver and front passenger airbag",
      "Push Button Start",
    ],
    features: [],
  },
};

const CRV_VIN = "7FARS6H54TE171297";
const CRV_ROW = {
  id: "crv-listing-id",
  vin: CRV_VIN,
  price: 38580,
  msrp: 38580,
  dealer: { name: "Route 23 Honda", city: "Pompton Plains", state: "NJ", zip: "07444" },
  build: { year: 2026, make: "Honda", model: "CR-V", trim: "Sport", body_type: "SUV" },
};
const CRV_DETAIL = {
  ...CRV_ROW,
  extra: {
    options_packages: ["TSP", "18BR"],
    high_value_features: [],
    options: [
      "Radio: 240-Watt AM/FM Audio System",
      "Heated Front Bucket Seats",
      "Cloth Seat Trim",
      'Wheels: 18" Berlina Black',
      "4-Wheel Disc Brakes",
      "Blind Spot Information (BSI) System warning",
      "Adaptive Cruise Control: Adaptive Cruise Control (ACC) with Low-Speed Follow",
      "Apple CarPlay/Android Auto",
      "Power moonroof",
      "Power windows",
      "Dual front impact airbags",
      "Trip computer",
    ],
  },
};

const ACCORD_VIN = "1HGCY2F78TA060873";
const ACCORD_DETAIL = {
  id: "accord-listing-id",
  vin: ACCORD_VIN,
  price: 36690,
  msrp: 36690,
  dealer: { name: "Route 23 Honda", city: "Pompton Plains", state: "NJ" },
  build: { year: 2026, make: "Honda", model: "Accord", trim: "Hybrid Sport-L" },
  extra: {
    high_value_features: [],
    options: ["Heated Front Bucket Seats", "Leather-Trimmed Seat Trim", 'Wheels: 19" x 8.5J Matte Berlina Black', "Memory seat", "Power moonroof", "Overhead airbag", "Power steering"],
  },
};

describe("Toyota / Honda WMI + paste routing", () => {
  it("recognizes the WMIs confirmed live, and Lexus/Acura ride along", () => {
    assert.equal(isToyotaVin(CAMRY_VIN), true, "4T1 Kentucky Camry");
    assert.equal(isToyotaVin("2T36CRAV1TW39J188"), true, "2T3 Canada RAV4");
    assert.equal(isToyotaVin("JTHC81H62N0000000"), true, "JTH Lexus");
    assert.equal(isHondaVin(CRV_VIN), true, "7FA Indiana CR-V");
    assert.equal(isHondaVin(ACCORD_VIN), true, "1HG Ohio Accord");
    assert.equal(isHondaVin("2HGFE2F51TH627012"), true, "2HG Canada Civic");
    assert.equal(isHondaVin("19UDE2F32NA000000"), true, "19U Acura");
    assert.equal(isToyotaVin(CRV_VIN), false);
    assert.equal(isHondaVin(CAMRY_VIN), false);
    assert.equal(isHondaVin("1FMWK8JCXTGB47204"), false);
  });

  it("routes a Toyota or Honda VIN / dealer URL to its own route, and leaves the others alone", () => {
    assert.equal(preferredFactoryBuildEndpoint(CAMRY_VIN), "/api/toyota-sticker");
    assert.equal(preferredFactoryBuildEndpoint(CRV_VIN), "/api/honda-sticker");
    assert.equal(preferredFactoryBuildEndpoint("https://www.crestmonttoyota.com/new/2026-Toyota-Camry.htm"), "/api/toyota-sticker");
    assert.equal(preferredFactoryBuildEndpoint("https://www.route23honda.com/new/2026-Honda-CR-V.htm"), "/api/honda-sticker");
    assert.equal(looksLikeToyotaPaste("2026 Lexus RX 350"), true);
    assert.equal(looksLikeHondaPaste("2026 Acura MDX"), true);
    assert.equal(preferredFactoryBuildEndpoint("1FMWK8JCXTGB47204"), "/api/ford-sticker");
    assert.equal(preferredFactoryBuildEndpoint("WP1AA2A53TLB07942"), "/api/porsche-sticker");
  });
});

describe("engine: baseline filter and equipment-line naming", () => {
  it("drops universal baseline kit, keeps shoppable equipment", () => {
    assert.equal(isBaselineEquipment("Dual front impact airbags"), true);
    assert.equal(isBaselineEquipment("Power windows"), true);
    assert.equal(isBaselineEquipment("50 State Emissions 50 State Emissions"), true);
    assert.equal(isBaselineEquipment("Heated Front Bucket Seats"), false);
    assert.equal(isBaselineEquipment("Blind Spot Information (BSI) System warning"), false);
    assert.equal(isBaselineEquipment("Power moonroof"), false);
  });

  it("shortens a doubled or glued feed line to its name, and never splits a brand camel-word", () => {
    assert.equal(
      equipmentLineName("Cold Weather Package Cold Weather PackageHeated leather steering wheel Paddle shiftersHeated front seats"),
      "Cold Weather Package"
    );
    assert.equal(
      equipmentLineName("Convenience Package Convenience PackageAuto-dimming rearview mirror with HomeLink"),
      "Convenience Package"
    );
    assert.equal(
      equipmentLineName("All-Weather Floor Liner Package All-Weather Floor Liner package provides weather -resistant floor liners"),
      "All-Weather Floor Liner Package",
      "doubled name, case-insensitive"
    );
    assert.equal(equipmentLineName("Mudguards Mudguards help protect your paint finish"), "Mudguards");
    assert.equal(equipmentLineName("Multimedia Upgrade Package Multimedia Upgrade Package12.3-in. Toyota Audio Multimedia"), "Multimedia Upgrade Package");
    assert.equal(equipmentLineName("Wireless Apple CarPlay compatibility"), "Wireless Apple CarPlay compatibility");
    assert.equal(equipmentLineName("Emergency communication system: HondaLink"), "Emergency communication system: HondaLink");
    assert.equal(equipmentLineName("Heated Front Bucket Seats"), "Heated Front Bucket Seats");
    const cold = splitEquipmentLine("Cold Weather Package Cold Weather PackageHeated leather steering wheel");
    assert.equal(cold.description, "Heated leather steering wheel");
  });

  it("a plain line and its parenthetical variant are one option, and the picker label stays short", () => {
    const build = toyotaBuildFromMarketCheck(CAMRY_VIN, CAMRY_ROW, {
      ...CAMRY_DETAIL,
      extra: {
        options: [
          "Power tilt/slide moonroof Power tilt/slide moonroof (removal of overhead sunglasses storage)",
          "Power tilt/slide moonroof (removal of overhead sunglasses storage)",
          "Cold Weather Package Cold Weather PackageHeated leather steering wheel",
        ],
      },
    });
    const names = build.options.map((o) => o.name);
    assert.deepEqual(names, ["Power tilt/slide moonroof", "Cold Weather Package"]);
    const cold = filterableFactoryOptions(build).find((o) => o.name === "Cold Weather Package")!;
    assert.equal(cold.description, "Cold Weather Package", "no glued long text in the checkbox label");
  });
});

describe("Toyota build", () => {
  it("codes first (honestly named until the catalog knows them), then typed-Optional features, then Toyota's own equipment lines", () => {
    const build = toyotaBuildFromMarketCheck(CAMRY_VIN, CAMRY_ROW, CAMRY_DETAIL);
    assert.equal(build.status, "found");
    assert.equal(build.make, "Toyota");
    assert.equal(build.model, "Camry");
    assert.equal(build.trim, "SE");
    assert.equal(build.msrp, 38104);
    assert.equal(build.listingPrice, 37474);
    assert.deepEqual(build.optionCodes, ["SR"]);
    const [sr] = build.options;
    assert.equal(sr.code, "SR");
    assert.equal(sr.name, "Toyota factory option SR");
    assert.equal(sr.price, null);
    const names = build.options.map((o) => o.name);
    assert.ok(names.includes("Sun/Moonroof"), "typed-Optional feature");
    assert.ok(names.includes("Cold Weather Package"), "feed line, shortened");
    assert.ok(names.includes("Convenience Package"));
    assert.ok(names.includes("Push Button Start"));
    assert.ok(!names.some((n) => /emissions|airbag/i.test(n)), "baseline kit filtered out");
    const cold = build.options.find((o) => o.name === "Cold Weather Package")!;
    assert.equal(cold.source, "listing");
    assert.equal(cold.category, "package");
    assert.match(cold.description || "", /Heated leather steering wheel/);
    assert.deepEqual(build.standardFeatures, ["Bluetooth"]);
    assert.equal(build.dealer.name, "Crestmont Toyota");
  });

  it("filterable options put feed lines a step below coded ones; nice-to-haves exclude feed lines", () => {
    const build = toyotaBuildFromMarketCheck(CAMRY_VIN, CAMRY_ROW, CAMRY_DETAIL);
    const filterable = filterableFactoryOptions(build);
    assert.equal(filterable.find((o) => o.code === "SR")!.isPackageChild, false);
    assert.equal(filterable.find((o) => o.name === "Cold Weather Package")!.isPackageChild, true);
    const nice = defaultNiceToHaveLines(build, []);
    assert.deepEqual(nice, ["Toyota factory option SR", "Sun/Moonroof"]);
  });

  it("getToyotaBuild makes exactly two calls and nothing else", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes("/v2/search/car/active") ? { num_found: 1, listings: [CAMRY_ROW] } : CAMRY_DETAIL;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const build = await getToyotaBuild(CAMRY_VIN, { fetchImpl, apiKey: "test-key" });
    assert.equal(build.status, "found");
    assert.equal(urls.length, 2);
    assert.match(urls[1], /\/v2\/listing\/car\/camry-listing-id/);
    assert.equal(TOYOTA_MAKE.key, "toyota");
  });
});

describe("Honda build", () => {
  it("a CR-V with codes: codes named honestly, equipment lines carry the real kit", () => {
    const build = hondaBuildFromMarketCheck(CRV_VIN, CRV_ROW, CRV_DETAIL);
    assert.equal(build.status, "found");
    assert.deepEqual(build.optionCodes, ["TSP", "18BR"]);
    assert.equal(build.options[0].name, "Honda factory option TSP");
    const names = build.options.map((o) => o.name);
    assert.ok(names.includes("Heated Front Bucket Seats"));
    assert.ok(names.includes('Wheels: 18" Berlina Black') === false, "wheel spec line is baseline-filtered");
    assert.ok(names.includes("Blind Spot Information (BSI) System warning"));
    assert.ok(names.includes("Power moonroof"));
    assert.ok(!names.includes("Power windows"));
    assert.ok(!names.includes("Trip computer"));
  });

  it("an Accord with no codes still gets its equipment — the tier that makes Honda work", () => {
    const build = hondaBuildFromMarketCheck(ACCORD_VIN, { id: "accord-listing-id", vin: ACCORD_VIN }, ACCORD_DETAIL);
    assert.equal(build.status, "found");
    assert.equal(build.trim, "Hybrid Sport-L");
    assert.deepEqual(build.optionCodes, []);
    const names = build.options.map((o) => o.name);
    assert.deepEqual(names, ["Heated Front Bucket Seats", "Memory seat", "Power moonroof"]);
    assert.ok(build.options.every((o) => o.source === "listing" && o.price === null));
    const v = buildToVehicle(HONDA_MAKE.key, build, null);
    assert.equal(v.id, `honda-${ACCORD_VIN}`);
    assert.equal(v.make, "Honda");
    assert.equal(v.msrp, 36690);
    assert.deepEqual(v.packages, [], "feed lines aren't headline packages");
    assert.equal(v.options.length, 3);
    assert.equal(v.options[0].price, 0, "$0 = unknown in the Vehicle shape; the build keeps null");
  });

  it("getHondaBuild: no active listing → not_found, one call", async () => {
    let calls = 0;
    const empty = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ num_found: 0, listings: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const build = await getHondaBuild(CRV_VIN, { fetchImpl: empty, apiKey: "test-key" });
    assert.equal(build.status, "not_found");
    assert.equal(build.make, "Honda");
    assert.equal(calls, 1);
  });
});

describe("importPastedFactoryVehicle for Toyota and Honda", () => {
  it("accepts each route's response shape end to end", async () => {
    for (const [vin, row, detail, endpoint, from] of [
      [CAMRY_VIN, CAMRY_ROW, CAMRY_DETAIL, "/api/toyota-sticker", toyotaBuildFromMarketCheck],
      [CRV_VIN, CRV_ROW, CRV_DETAIL, "/api/honda-sticker", hondaBuildFromMarketCheck],
    ] as const) {
      const build = from(vin, row, detail);
      const routeJson = {
        handled: true,
        vin,
        sticker: { status: "released", pdfUrl: null, msrp: build.msrp },
        vehicle: buildToVehicle(endpoint.includes("toyota") ? "toyota" : "honda", build, null),
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
      const result = await importPastedFactoryVehicle(vin, fetchImpl);
      assert.deepEqual(hits, [endpoint]);
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      assert.equal(result.vehicle.vin, vin);
      assert.equal(result.msrp, build.msrp);
      assert.ok(result.filterableOptions.length > 0);
    }
  });
});
