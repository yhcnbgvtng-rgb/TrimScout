import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DUPLICATE_COMPARE_VIN,
  assignCompetitorLot,
  buildOfferCompareSnapshot,
  collectDealVehicles,
  comparablesEndpointForVin,
  isSharedFactoryOption,
  parseOfferCompareSnapshot,
  replaceCompetitorLots,
  sharedFactoryOptionKeys,
  snapshotVehiclesFromDeal,
  sortCompareColumns,
  vehicleForCompareRole,
  vehicleFromComparableSuggestion,
  type ComparableSuggestion,
} from "./offerCompare";
import type { BiddingRequest, Vehicle } from "./types";

function vehicle(partial: Partial<Vehicle> & Pick<Vehicle, "vin">): Vehicle {
  return {
    id: partial.id || partial.vin,
    vin: partial.vin,
    year: partial.year || 2026,
    make: partial.make || "Ford",
    model: partial.model || "Explorer",
    trim: partial.trim || "ST",
    bodyType: "",
    engine: "",
    drivetrain: "",
    transmission: "",
    exteriorColor: "",
    interiorColor: "",
    msrp: partial.msrp || 64000,
    dealerPrice: partial.dealerPrice || 58000,
    daysOnLot: 0,
    status: "on_lot",
    location: partial.location || {
      dealerName: "Battlefield Ford",
      city: "Killeen",
      state: "TX",
      zip: "76541",
      distanceMiles: 12,
    },
    packages: partial.packages || ["Ultimate Package"],
    options: partial.options || [
      { code: "60B", name: "Ultimate Package", price: 0, category: "package" },
    ],
    imageUrl: "",
    mileage: 0,
    dealerUrl: partial.dealerUrl,
  };
}

const favorite = vehicle({ vin: "1FMWK8JCXTGB47204", dealerUrl: "https://dealer.example/vdp-a" });
const lot1 = vehicle({
  vin: "1FMWK8JC7TGB81309",
  dealerPrice: 50000,
  location: {
    dealerName: "Jim Shorkey Ford",
    city: "White Oak",
    state: "PA",
    zip: "15131",
    distanceMiles: 80,
  },
});

const request: BiddingRequest = {
  id: "req-1",
  strategy: "exact_auction",
  targetVin: favorite.vin,
  targetVehicle: favorite,
  paymentMethod: "cash",
  dealStructurePreferences: {
    requestedStructures: ["cash", "finance"],
    financeTermMonths: 60,
    downPayment: 5000,
  },
  buyerZip: "76541",
  searchRadiusMiles: 100,
  createdAt: "now",
  expiresAt: "48 Hours",
  status: "active",
};

describe("offer compare snapshot", () => {
  it("collects favorite plus other lots and never pads a third car", () => {
    const two = collectDealVehicles(favorite, [lot1, null]);
    assert.equal(two.length, 2);
    assert.equal(two[0].vin, favorite.vin);
    assert.equal(two[1].vin, lot1.vin);
    const one = collectDealVehicles(favorite, [null, null]);
    assert.equal(one.length, 1);
    const columns = snapshotVehiclesFromDeal(favorite, [null, null]);
    assert.equal(columns.length, 1);
    assert.equal(columns[0].role, "favorite");
  });

  it("skips duplicate VINs and empty lots", () => {
    const dup = collectDealVehicles(favorite, [favorite, lot1]);
    assert.equal(dup.length, 2);
    assert.deepEqual(
      dup.map((v) => v.vin),
      [favorite.vin, lot1.vin]
    );
  });

  it("build + parse round-trips terms independently per VIN", () => {
    const snapshot = buildOfferCompareSnapshot({
      request,
      favorite,
      otherLots: [lot1, null],
      buyerZip: "76541",
      requestedStructures: ["cash", "finance"],
    });
    assert.ok(snapshot);
    assert.equal(snapshot!.vehicles.length, 2);
    assert.equal(snapshot!.request.otherLots?.length, 1);
    const terms = snapshot!.request.dealStructurePreferences?.vehicleTerms || [];
    assert.equal(terms[0].cash?.offerPrice, 58000);
    assert.equal(terms[1].cash?.offerPrice, 50000);
    const parsed = parseOfferCompareSnapshot(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(parsed?.vehicles.length, 2);
    assert.equal(parsed?.request.dealStructurePreferences?.vehicleTerms?.[1].cash?.offerPrice, 50000);
    assert.equal(parsed?.vehicles[0].vehicle.options[0].name, "Ultimate Package");
    assert.equal(parsed?.vehicles[1].role, "other_lot_1");
    assert.equal(parsed?.vehicles[1].label, "Competitor 1");
  });

  it("keeps competitor 2 empty until the shopper pastes a VIN — never invents a third car", () => {
    const snapshot = buildOfferCompareSnapshot({
      request,
      favorite,
      otherLots: [null, lot1],
      buyerZip: "76541",
      requestedStructures: ["cash", "finance"],
    });
    assert.ok(snapshot);
    assert.equal(snapshot!.vehicles.length, 2);
    assert.equal(snapshot!.vehicles[1].role, "other_lot_2");
    assert.equal(vehicleForCompareRole(snapshot!, "other_lot_1"), null);
    assert.equal(vehicleForCompareRole(snapshot!, "other_lot_2")?.vehicle.vin, lot1.vin);
    const assigned = assignCompetitorLot(snapshot!, 1, lot1);
    assert.equal(assigned.ok, false);
    if (!assigned.ok) assert.equal(assigned.error, DUPLICATE_COMPARE_VIN);
    const lot2 = vehicle({
      vin: "1FMWK8JC1TGB69561",
      dealerPrice: 50000,
      location: { dealerName: "Battlefield Ford", city: "Culpeper", state: "VA", zip: "22701", distanceMiles: 40 },
    });
    const filled = assignCompetitorLot(snapshot!, 1, lot2);
    assert.equal(filled.ok, true);
    if (filled.ok) {
      assert.equal(filled.snapshot.vehicles.length, 3);
      assert.equal(vehicleForCompareRole(filled.snapshot, "other_lot_1")?.vehicle.vin, lot2.vin);
      assert.equal(vehicleForCompareRole(filled.snapshot, "other_lot_2")?.vehicle.vin, lot1.vin);
      const terms = filled.snapshot.request.dealStructurePreferences?.vehicleTerms || [];
      assert.equal(terms.length, 3);
      assert.equal(terms[1].vin, lot2.vin.toUpperCase());
      assert.notEqual(terms[1].cash?.offerPrice, terms[0].cash?.offerPrice);
    }
  });

  it("parse refuses an empty snapshot instead of inventing demo Explorers", () => {
    assert.equal(parseOfferCompareSnapshot(null), null);
    assert.equal(parseOfferCompareSnapshot({ version: 1, request: { id: "x" }, vehicles: [] }), null);
    assert.equal(
      parseOfferCompareSnapshot({
        version: 1,
        request: { id: "x", paymentMethod: "cash", buyerZip: "", searchRadiusMiles: 0, strategy: "exact_auction", createdAt: "", expiresAt: "", status: "active" },
        vehicles: [{ role: "favorite", vehicle: { year: 2024, make: "BMW", model: "3 Series" } }],
      }),
      null
    );
  });
});

describe("compare column sorting", () => {
  const cols = [
    { role: "favorite" as const, vin: "AAAAAAAAAAAAAAAAA" },
    { role: "other_lot_1" as const, vin: "BBBBBBBBBBBBBBBBB" },
    { role: "other_lot_2" as const, vin: "CCCCCCCCCCCCCCCCC" },
  ];

  it("leaves order untouched in default mode", () => {
    const out = sortCompareColumns(cols, "default", {});
    assert.deepEqual(out.map((c) => c.role), ["favorite", "other_lot_1", "other_lot_2"]);
  });

  it("sorts other lots by days on market, most first, favorite pinned", () => {
    const out = sortCompareColumns(cols, "days_on_market", {
      AAAAAAAAAAAAAAAAA: { daysOnMarket: 999 },
      BBBBBBBBBBBBBBBBB: { daysOnMarket: 10 },
      CCCCCCCCCCCCCCCCC: { daysOnMarket: 80 },
    });
    // Favorite stays first even though its 999 is the highest value.
    assert.deepEqual(out.map((c) => c.role), ["favorite", "other_lot_2", "other_lot_1"]);
  });

  it("falls back to daysOnMarketActive when daysOnMarket is null", () => {
    const out = sortCompareColumns(cols, "days_on_market", {
      BBBBBBBBBBBBBBBBB: { daysOnMarket: null, daysOnMarketActive: 60 },
      CCCCCCCCCCCCCCCCC: { daysOnMarket: 5 },
    });
    assert.deepEqual(out.map((c) => c.role), ["favorite", "other_lot_1", "other_lot_2"]);
  });

  it("sorts by number of price cuts, most first", () => {
    const out = sortCompareColumns(cols, "price_cuts", {
      BBBBBBBBBBBBBBBBB: { priceCuts: 1 },
      CCCCCCCCCCCCCCCCC: { priceCuts: 4 },
    });
    assert.deepEqual(out.map((c) => c.role), ["favorite", "other_lot_2", "other_lot_1"]);
  });

  it("sinks lots with no listing data to the end instead of treating them as zero", () => {
    const out = sortCompareColumns(cols, "days_on_market", {
      // other_lot_1 has no sheet at all; other_lot_2 has a real 3.
      CCCCCCCCCCCCCCCCC: { daysOnMarket: 3 },
    });
    assert.deepEqual(out.map((c) => c.role), ["favorite", "other_lot_2", "other_lot_1"]);
  });

  it("treats an empty slot (null vin) as unknown, not zero", () => {
    const withEmpty = [
      { role: "favorite" as const, vin: "AAAAAAAAAAAAAAAAA" },
      { role: "other_lot_1" as const, vin: null },
      { role: "other_lot_2" as const, vin: "CCCCCCCCCCCCCCCCC" },
    ];
    const out = sortCompareColumns(withEmpty, "price_cuts", {
      CCCCCCCCCCCCCCCCC: { priceCuts: 0 },
    });
    // A real lot with zero cuts still outranks an empty slot.
    assert.deepEqual(out.map((c) => c.role), ["favorite", "other_lot_2", "other_lot_1"]);
  });

  it("matches VINs case-insensitively", () => {
    const out = sortCompareColumns(
      [
        { role: "favorite" as const, vin: "AAAAAAAAAAAAAAAAA" },
        { role: "other_lot_1" as const, vin: "bbbbbbbbbbbbbbbbb" },
        { role: "other_lot_2" as const, vin: "CCCCCCCCCCCCCCCCC" },
      ],
      "days_on_market",
      { BBBBBBBBBBBBBBBBB: { daysOnMarket: 90 }, CCCCCCCCCCCCCCCCC: { daysOnMarket: 2 } }
    );
    assert.deepEqual(out.map((c) => c.role), ["favorite", "other_lot_1", "other_lot_2"]);
  });
});

describe("shared factory options across compared cars", () => {
  it("flags a description that appears on two or more cars, not one that's unique to a single car", () => {
    const favorite = [{ description: "3.73 Electronic Lock RR Axle" }, { description: "STX Series" }];
    const lot1 = [{ description: "3.73 ELECTRONIC LOCK RR AXLE" }, { description: "Trailer Tow Package" }];
    const lot2 = [{ description: "Trailer Tow Package" }];
    const shared = sharedFactoryOptionKeys([favorite, lot1, lot2]);
    assert.equal(isSharedFactoryOption("3.73 Electronic Lock RR Axle", shared), true, "case/whitespace-insensitive match across two cars");
    assert.equal(isSharedFactoryOption("Trailer Tow Package", shared), true, "shared by lot1 and lot2");
    assert.equal(isSharedFactoryOption("STX Series", shared), false, "only on one car — not shared");
  });

  it("flags nothing when only one car is present, or when no descriptions overlap", () => {
    const oneCarOnly = sharedFactoryOptionKeys([[{ description: "STX Series" }]]);
    assert.equal(oneCarOnly.size, 0);

    const noOverlap = sharedFactoryOptionKeys([
      [{ description: "STX Series" }],
      [{ description: "Trailer Tow Package" }],
    ]);
    assert.equal(noOverlap.size, 0);
  });

  it("counts a description once per car, so it doesn't fake a match from duplicates within a single car's list", () => {
    const oneCarDuplicated = sharedFactoryOptionKeys([
      [{ description: "STX Series" }, { description: "STX Series" }],
    ]);
    assert.equal(isSharedFactoryOption("STX Series", oneCarDuplicated), false);
  });

  it("ignores blank descriptions", () => {
    const shared = sharedFactoryOptionKeys([[{ description: "" }], [{ description: "  " }]]);
    assert.equal(shared.size, 0);
  });
});

describe("comparable-vehicle suggestion to Vehicle", () => {
  function suggestion(partial: Partial<ComparableSuggestion> & Pick<ComparableSuggestion, "vin">): ComparableSuggestion {
    return {
      dealerName: "Battlefield Ford",
      city: "Culpeper",
      state: "VA",
      distanceMiles: 40,
      listingPrice: 55990,
      msrp: 62000,
      dealerUrl: null,
      pdfUrl: "https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=" + partial.vin,
      factoryOptions: [],
      daysOnMarket: null,
      priceChangeHint: null,
      ...partial,
    };
  }

  it("assigns straight into an empty competitor slot, same as a manual paste", () => {
    const request: BiddingRequest = {
      id: "deal-1",
      paymentMethod: "cash",
      buyerZip: "07405",
      searchRadiusMiles: 500,
      strategy: "exact_auction",
      createdAt: "",
      expiresAt: "",
      status: "active",
    };
    const favorite = vehicle({ vin: "1FMWK8JCXTGB47204" });
    const snapshot = buildOfferCompareSnapshot({
      request,
      favorite,
      otherLots: [null, null],
      buyerZip: "07405",
      requestedStructures: ["cash"],
    });
    assert.ok(snapshot);
    const match = suggestion({
      vin: "1FMWK8JC1TGB69561",
      dealerName: "Battlefield Ford",
      distanceMiles: 40,
      daysOnMarket: 12,
      priceChangeHint: -900,
    });
    const assigned = assignCompetitorLot(snapshot!, 1, vehicleFromComparableSuggestion(match));
    assert.equal(assigned.ok, true);
    if (assigned.ok) {
      const lot = vehicleForCompareRole(assigned.snapshot, "other_lot_1")?.vehicle;
      assert.equal(lot?.vin, match.vin);
      assert.equal(lot?.location.dealerName, "Battlefield Ford");
      assert.equal(lot?.location.distanceMiles, 40);
      assert.equal(lot?.msrp, 62000);
      assert.equal(lot?.dealerPrice, 55990);
    }
  });

  it("carries factory options into packages/options, and falls back to Ford/0/on_lot for missing fields", () => {
    const match = suggestion({
      vin: "1FTEW2LP6TKE14711",
      factoryOptions: [
        { code: "STX", description: "STX Appearance Package", price: 1995, isPackageChild: false },
        { code: null, description: "Tailgate Step", price: null, isPackageChild: true },
      ],
      listingPrice: null,
      msrp: null,
    });
    const veh = vehicleFromComparableSuggestion(match);
    assert.equal(veh.make, "Ford");
    assert.equal(veh.msrp, 0);
    assert.equal(veh.dealerPrice, 0);
    assert.equal(veh.status, "on_lot");
    assert.deepEqual(veh.packages, ["STX Appearance Package"]);
    assert.equal(veh.options.length, 2);
    assert.equal(veh.options[0].category, "package");
    assert.equal(veh.options[1].category, "standalone");
  });

  it("a GM VIN gets a Truck bodyType and a Chevrolet fallback make, never Ford's SUV/Ford defaults", () => {
    const match = suggestion({
      vin: "1GCUKDED8TZ200011",
      make: undefined,
      dealerName: "Ditschman Flemington Chevrolet",
    });
    const veh = vehicleFromComparableSuggestion(match);
    assert.equal(veh.bodyType, "Truck");
    assert.equal(veh.make, "Chevrolet");
    assert.equal(veh.id, "vehicle-1GCUKDED8TZ200011");
  });

  it("a Ford VIN still gets the SUV bodyType and never a GM default", () => {
    const match = suggestion({ vin: "1FMWK8JC1TGB69561", make: undefined });
    const veh = vehicleFromComparableSuggestion(match);
    assert.equal(veh.bodyType, "SUV");
    assert.equal(veh.make, "Ford");
  });
});

describe("comparablesEndpointForVin", () => {
  it("routes a Ford/Lincoln VIN to /api/ford-comparables", () => {
    assert.equal(comparablesEndpointForVin("1FMWK8JCXTGB47204"), "/api/ford-comparables");
    assert.equal(comparablesEndpointForVin("5LMWK8JCXTGB47204"), "/api/ford-comparables");
  });

  it("routes a GM VIN to /api/gm-comparables", () => {
    assert.equal(comparablesEndpointForVin("1GCUKDED8TZ200011"), "/api/gm-comparables");
    assert.equal(comparablesEndpointForVin("1G6UKDED8TZ200011"), "/api/gm-comparables");
  });

  it("returns null for an unsupported OEM instead of guessing", () => {
    assert.equal(comparablesEndpointForVin("WP0AB2A98SS160032"), null);
  });
});

describe("replaceCompetitorLots", () => {
  const favorite = { vin: "1FMWK8JCXTGB47204", year: 2026, make: "Ford", model: "Explorer", trim: "ST", msrp: 60000, dealerPrice: 0 } as unknown as import("./types").Vehicle;
  const lotA = { ...favorite, vin: "1FMWK8JC7TGB81309", trim: "Tremor" } as import("./types").Vehicle;
  const lotB = { ...favorite, vin: "1FMWK8JC1TGB69561", trim: "Platinum" } as import("./types").Vehicle;
  const base = buildOfferCompareSnapshot({
    request: { id: "req-1", strategy: "exact_auction", paymentMethod: "cash", buyerZip: "07405", searchRadiusMiles: 100, createdAt: "", expiresAt: "", status: "active" } as unknown as import("./types").BiddingRequest,
    favorite,
    otherLots: [],
    buyerZip: "07405",
    requestedStructures: ["cash"],
    searchRadiusMiles: 100,
  })!;

  it("mirrors the buyer's picks into other_lot_1/2 and request.otherLots, in order", () => {
    const next = replaceCompetitorLots(base, [lotA, lotB])!;
    assert.equal(vehicleForCompareRole(next, "other_lot_1")?.vehicle.vin, lotA.vin);
    assert.equal(vehicleForCompareRole(next, "other_lot_2")?.vehicle.vin, lotB.vin);
    assert.deepEqual((next.request.otherLots || []).map((v) => v.vin), [lotA.vin, lotB.vin]);
    const fewer = replaceCompetitorLots(next, [lotB])!;
    assert.equal(vehicleForCompareRole(fewer, "other_lot_1")?.vehicle.vin, lotB.vin);
    assert.equal(vehicleForCompareRole(fewer, "other_lot_2"), null);
    const none = replaceCompetitorLots(fewer, [])!;
    assert.equal(none.vehicles.length, 1, "favorite only");
  });

  it("never lets the favorite, a duplicate, or a third vehicle in", () => {
    const next = replaceCompetitorLots(base, [favorite, lotA, lotA, lotB, { ...lotB, vin: "1FMWK8JC7TGA20216" } as import("./types").Vehicle])!;
    assert.deepEqual(next.vehicles.map((c) => c.role), ["favorite", "other_lot_1", "other_lot_2"]);
    assert.deepEqual(next.vehicles.map((c) => c.vehicle.vin), [favorite.vin, lotA.vin, lotB.vin]);
  });
});
