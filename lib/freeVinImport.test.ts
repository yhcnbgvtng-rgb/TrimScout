import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freeVinImportVehicle, isUsableFreeImport, hasVinIntegrityError } from "./freeVinImport";
import type { DecodedVehicle } from "./vinDecoder";

const VIN = "WBA33AY09RF611293";

function decoded(over: Partial<DecodedVehicle> = {}): DecodedVehicle {
  return {
    vin: VIN,
    year: 2024,
    make: "BMW",
    model: "3 Series",
    trim: "330i xDrive",
    bodyClass: "Sedan/Saloon",
    driveType: "AWD/All-Wheel Drive",
    engineCylinders: "4",
    displacementL: "2.0",
    transmission: "Automatic",
    ...over,
  };
}

describe("freeVinImportVehicle", () => {
  it("builds a usable vehicle from a decode, a dealer and a listing price", () => {
    const vehicle = freeVinImportVehicle({
      vin: VIN,
      decoded: decoded(),
      dealer: { name: "BMW of Manhattan", city: "New York", state: "NY", zip: "10019", source: "json_ld" },
      listingPrice: 52400,
      listingUrl: "https://bmwofmanhattan.example/vdp/123",
      fallbackMake: "BMW",
    });

    assert.equal(vehicle.year, 2024);
    assert.equal(vehicle.make, "BMW");
    assert.equal(vehicle.model, "3 Series");
    assert.equal(vehicle.trim, "330i xDrive");
    assert.equal(vehicle.engine, "2.0L 4-cyl");
    assert.equal(vehicle.dealerPrice, 52400);
    assert.equal(vehicle.location.dealerName, "BMW of Manhattan");
    assert.equal(vehicle.location.state, "NY");
    assert.equal(vehicle.dealerUrl, "https://bmwofmanhattan.example/vdp/123");
    assert.equal(isUsableFreeImport(vehicle), true);
  });

  it("parses displacement whether NHTSA sends \"3.0\" or \"3.0L\"", () => {
    const base = {
      vin: VIN,
      dealer: null,
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "BMW",
    };
    assert.equal(
      freeVinImportVehicle({ ...base, decoded: decoded({ displacementL: "3.0L", engineCylinders: "6" }) }).engine,
      "3.0L 6-cyl"
    );
    assert.equal(
      freeVinImportVehicle({ ...base, decoded: decoded({ displacementL: "3.0", engineCylinders: "6" }) }).engine,
      "3.0L 6-cyl"
    );
    // Nothing parseable must not produce "NaNL".
    assert.equal(
      freeVinImportVehicle({ ...base, decoded: decoded({ displacementL: "", engineCylinders: "6" }) }).engine,
      "6-cyl"
    );
  });

  it("claims no MSRP and no factory options, because it has neither", () => {
    const vehicle = freeVinImportVehicle({
      vin: VIN,
      decoded: decoded(),
      dealer: null,
      listingPrice: 52400,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    // A listing price is the dealer's own number; MSRP would be a fabrication.
    assert.equal(vehicle.msrp, 0);
    assert.deepEqual(vehicle.options, []);
    assert.deepEqual(vehicle.packages, []);
  });

  it("marks the dealer confirmed only when the page actually named one", () => {
    const named = freeVinImportVehicle({
      vin: VIN,
      decoded: decoded(),
      dealer: { name: "Prestige BMW", city: null, state: null, zip: null, source: "og_site_name" },
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    assert.equal(named.location.dealerConfirmed, true);

    const unnamed = freeVinImportVehicle({
      vin: VIN,
      decoded: decoded(),
      dealer: null,
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    assert.equal(unnamed.location.dealerConfirmed, false);
    assert.equal(unnamed.location.dealerName, "");
  });

  it("leaves the model blank rather than repeating the make", () => {
    // NHTSA withholds the model for some VINs; "2024 BMW BMW" is worse than
    // "2024 BMW", and every display drops the blank.
    const vehicle = freeVinImportVehicle({
      vin: VIN,
      decoded: decoded({ model: undefined, trim: undefined }),
      dealer: null,
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    assert.equal(vehicle.model, "");
    assert.equal(
      [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" "),
      "2024 BMW"
    );
    assert.equal(isUsableFreeImport(vehicle), true);
  });

  it("title-cases a shouted multi-word make but leaves acronyms alone", () => {
    const mercedes = freeVinImportVehicle({
      vin: VIN,
      decoded: decoded({ make: "MERCEDES-BENZ" }),
      dealer: null,
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "Mercedes-Benz",
    });
    assert.equal(mercedes.make, "Mercedes-Benz");

    const bmw = freeVinImportVehicle({
      vin: VIN,
      decoded: decoded({ make: "BMW" }),
      dealer: null,
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    assert.equal(bmw.make, "BMW");
  });

  it("falls back to the route's make label when NHTSA returns nothing at all", () => {
    const vehicle = freeVinImportVehicle({
      vin: VIN,
      decoded: null,
      dealer: null,
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    assert.equal(vehicle.make, "BMW");
    assert.equal(vehicle.year, 0);
    // No year means we can't show a real car — the route turns this into a
    // "check the VIN" prompt rather than adding a blank vehicle.
    assert.equal(isUsableFreeImport(vehicle), false);
  });

  it("refuses a VIN that fails its own check digit, however confident the decode looks", () => {
    // vPIC decodes structurally even for a VIN nobody ever built, so a mistyped
    // or invented VIN comes back with a plausible year/make/model. Sending a
    // quote request for a car that doesn't exist is worse than refusing.
    const decodedBad = decoded({
      errorText: "1 - Check Digit (9th position) does not calculate properly",
    });
    const vehicle = freeVinImportVehicle({
      vin: VIN,
      decoded: decodedBad,
      dealer: null,
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    assert.equal(hasVinIntegrityError(decodedBad), true);
    assert.equal(isUsableFreeImport(vehicle, decodedBad), false);
  });

  it("refuses an auto-corrected VIN too", () => {
    for (const text of [
      "3 - VIN corrected, error in one position (assuming Check Digit is correct)",
      "4 - VIN corrected, error in two positions",
      "11 - Incorrect Model Year",
      "1 - Check Digit (9th position) does not calculate properly; 14 - Unable to provide information",
    ]) {
      assert.equal(hasVinIntegrityError(decoded({ errorText: text })), true, text);
    }
  });

  it("still accepts a valid VIN that NHTSA only has partial data for", () => {
    // Code 14 is "we don't know everything about this VIN", not "this VIN is
    // wrong" — the car is real and belongs in the package.
    const partial = decoded({
      errorText: "14 - Unable to provide information for some of the characters in the VIN",
    });
    assert.equal(hasVinIntegrityError(partial), false);
    const vehicle = freeVinImportVehicle({
      vin: VIN,
      decoded: partial,
      dealer: null,
      listingPrice: null,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    assert.equal(isUsableFreeImport(vehicle, partial), true);
  });

  it("treats no error text at all as a clean decode", () => {
    assert.equal(hasVinIntegrityError(decoded({ errorText: undefined })), false);
    assert.equal(hasVinIntegrityError(decoded({ errorText: "0 - VIN decoded clean" })), false);
    assert.equal(hasVinIntegrityError(null), false);
  });

  it("treats a zero or missing listing price as no price shown", () => {
    const vehicle = freeVinImportVehicle({
      vin: VIN,
      decoded: decoded(),
      dealer: null,
      listingPrice: 0,
      listingUrl: null,
      fallbackMake: "BMW",
    });
    assert.equal(vehicle.dealerPrice, 0);
  });
});
