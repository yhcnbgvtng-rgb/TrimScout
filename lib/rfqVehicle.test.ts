import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { modelFromVin, repairLinkPastes, repairVehicleIdentity, resolveRfqVehicle, rfqVehicleLabel } from "./rfqVehicle";
import { vehicleTitle } from "./vehicleTitle";

const VIN = "WBX33HR09VDA44039";

describe("resolveRfqVehicle", () => {
  it("accepts a complete car unchanged", () => {
    const r = resolveRfqVehicle({ vin: VIN, year: 2027, make: "BMW", model: "iX3", trim: "50 xDrive" });
    assert.deepEqual(r, { ok: true, vehicle: { vin: VIN, year: 2027, make: "BMW", model: "iX3", trim: "50 xDrive" } });
  });

  it("accepts a VIN-matched car with a blank model and trim, naming the iX3 from the VIN", () => {
    const r = resolveRfqVehicle({ vin: VIN, year: 2027, make: "BMW", model: "", trim: "" });
    assert.equal(r.ok && r.vehicle.model, "iX3");
    assert.equal(r.ok && r.vehicle.trim, "");
  });

  it('moves a lone "50 xDrive" model into the trim and restores iX3', () => {
    const r = resolveRfqVehicle({ vin: VIN, year: 2027, make: "BMW", model: "50 xDrive", trim: "" });
    assert.ok(r.ok);
    assert.equal(r.vehicle.model, "iX3");
    assert.equal(r.vehicle.trim, "50 xDrive");
  });

  it('keeps the trim when model "50 xDrive" and trim "50 xDrive" repeat', () => {
    const r = resolveRfqVehicle({ vin: VIN, year: 2027, make: "BMW", model: "50 xDrive", trim: "50 xDrive" });
    assert.ok(r.ok);
    assert.deepEqual([r.vehicle.model, r.vehicle.trim], ["iX3", "50 xDrive"]);
  });

  it("accepts a car whose model the VIN cannot name by standing in the make (the box needs a non-empty model)", () => {
    const r = resolveRfqVehicle({ vin: "1HGCV1F30PA000001", year: 2023, make: "Honda", model: "", trim: null });
    assert.ok(r.ok);
    assert.equal(r.vehicle.model, "Honda");
    assert.equal(vehicleTitle({ year: 2023, make: "Honda", model: r.vehicle.model, trim: r.vehicle.trim }), "2023 Honda");
  });

  it("does not overwrite a real, different model", () => {
    const r = resolveRfqVehicle({ vin: VIN, year: 2027, make: "BMW", model: "X3", trim: "30 xDrive" });
    assert.ok(r.ok);
    assert.equal(r.vehicle.model, "X3");
  });

  it("does not apply a BMW hint to another make", () => {
    assert.equal(modelFromVin(VIN, "Audi"), null);
    assert.equal(modelFromVin(VIN, "bmw"), "iX3");
  });

  it("still refuses a car with no VIN, make or year", () => {
    for (const bad of [{ vin: "", year: 2027, make: "BMW" }, { vin: VIN, year: 2027, make: "" }, { vin: VIN, year: 0, make: "BMW" }, { vin: VIN, year: undefined, make: "BMW" }]) {
      const r = resolveRfqVehicle({ ...bad, model: "iX3", trim: "50 xDrive" });
      assert.deepEqual(r, { ok: false, error: "A specific matched vehicle is required." });
    }
  });
});

describe("labels", () => {
  it('reads "2027 BMW iX3 50 xDrive" for every partial shape of the iX3', () => {
    for (const [model, trim] of [["iX3", "50 xDrive"], ["50 xDrive", ""], ["50 xDrive", "50 xDrive"], ["", "50 xDrive"]]) {
      assert.equal(rfqVehicleLabel({ vin: VIN, year: 2027, make: "BMW", model, trim }), "2027 BMW iX3 50 xDrive", `${model}|${trim}`);
    }
  });

  it("vehicleTitle drops a model that only repeats the make", () => {
    assert.equal(vehicleTitle({ year: 2027, make: "BMW", model: "BMW", trim: "" }), "2027 BMW");
    assert.equal(vehicleTitle({ year: 2024, make: "Ford", model: "F-150", trim: "Raptor" }), "2024 Ford F-150 Raptor");
  });

  it("repairs each pasted car for the dealer invites, leaving other fields and non-VIN pastes alone", () => {
    const out = repairLinkPastes([{ vin: VIN, make: "BMW", model: "50 xDrive", trim: "", dealerName: "BMW of Westlake" }, { vin: "", model: "x" }]);
    assert.deepEqual(out?.[0], { vin: VIN, make: "BMW", model: "iX3", trim: "50 xDrive", dealerName: "BMW of Westlake" });
    assert.deepEqual(out?.[1], { vin: "", model: "x" });
    assert.equal(repairLinkPastes(undefined), undefined);
  });

  it("repairVehicleIdentity never throws on null parts", () => {
    assert.deepEqual(repairVehicleIdentity({ vin: null, model: null, trim: null }).model, "");
  });
});

describe("rfq create route wiring", () => {
  const route = fs.readFileSync(new URL("../app/api/rfqs/route.ts", import.meta.url), "utf8");
  it("gates on the VIN/make/year check, not on model or trim", () => {
    assert.match(route, /resolveRfqVehicle\(/);
    assert.doesNotMatch(route, /!body\?\.vehicleModel/);
    assert.doesNotMatch(route, /!body\?\.vehicleTrim/);
  });
  it("sends the repaired vehicle and pastes to the box", () => {
    assert.match(route, /vehicleModel: vehicle\.model/);
    assert.match(route, /repairLinkPastes\(body\.linkPastes\)/);
  });
});
