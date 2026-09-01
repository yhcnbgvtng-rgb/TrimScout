import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOfferCompareSnapshot,
  collectDealVehicles,
  parseOfferCompareSnapshot,
  snapshotVehiclesFromDeal,
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
