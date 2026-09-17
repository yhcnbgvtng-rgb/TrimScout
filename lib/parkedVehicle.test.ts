import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PARKED_VEHICLE_KEY, PARKED_VEHICLE_TTL_MS, clearParkedVehicle, parkVehicle, parkedVehicleLabel, readParkedVehicle } from "./parkedVehicle";

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), map: m };
}
const ADX = { vin: "3HDSA2H70TM713712", url: "https://www.keyacuraofatlanticcity.com/new/Acura/2026-Acura-ADX-3hdsa2h70tm713712.htm", year: 2026, make: "Acura", model: "ADX", trim: "A-Spec Advance", dealerName: "Key Acura of Atlantic City", notify: false };

describe("parkedVehicle — a car kept for a later retry", () => {
  it("round-trips, labels, and clears", () => {
    const s = memStore();
    assert.equal(parkVehicle(ADX, s), true);
    const p = readParkedVehicle(s)!;
    assert.equal(p.vin, ADX.vin);
    assert.equal(p.url, ADX.url);
    assert.equal(parkedVehicleLabel(p), "2026 Acura ADX A-Spec Advance · Key Acura of Atlantic City");
    assert.equal(parkedVehicleLabel({ ...p, dealerName: null, trim: null }), "2026 Acura ADX");
    clearParkedVehicle(s);
    assert.equal(readParkedVehicle(s), null);
  });
  it("expires after the TTL and drops junk", () => {
    const s = memStore();
    parkVehicle(ADX, s);
    assert.equal(readParkedVehicle(s, Date.now() + PARKED_VEHICLE_TTL_MS + 1), null);
    assert.equal(s.map.has(PARKED_VEHICLE_KEY), false, "stale record removed");
    s.setItem(PARKED_VEHICLE_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), vin: "NOT A VIN" }));
    assert.equal(readParkedVehicle(s), null);
    s.setItem(PARKED_VEHICLE_KEY, "{not json");
    assert.equal(readParkedVehicle(s), null);
  });
  it("no storage → no-ops", () => {
    assert.equal(parkVehicle(ADX, null), false);
    assert.equal(readParkedVehicle(null), null);
  });
});
