/**
 * The vehicle on a quote request, made sendable.
 *
 * The send used to refuse any car whose model was blank (or, on the factory-match package, whose trim was) with
 * "A specific matched vehicle is required." A VIN-matched car with a known make and year is specific enough: the
 * VIN is the identity, model/trim are labels. This repairs the labels where the VIN says what they are, and only
 * rejects a car that has no VIN, make or year.
 */
import { modelFromVin, repairVehicleIdentity, vehicleTitle } from "./vehicleTitle";

export { modelFromVin, repairVehicleIdentity };

const norm = (s: string | null | undefined) => (s || "").trim().replace(/\s+/g, " ");

export interface RfqVehicleParts {
  vin?: string | null;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
}

export interface RfqVehicle {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
}

export type RfqVehicleResult = { ok: true; vehicle: RfqVehicle } | { ok: false; error: string };

/**
 * Validate and normalise the vehicle on a same-spec request. Needs a VIN, a make and a year; model and trim are
 * optional. The deals box still requires a non-empty model, so when neither the buyer's value nor the VIN names
 * one the make stands in (the same fallback the factory-build vehicle uses), and the label drops the repeat.
 */
export function resolveRfqVehicle(input: RfqVehicleParts): RfqVehicleResult {
  const vin = norm(input.vin);
  const make = norm(input.make);
  const year = Number(input.year);
  if (!vin || !make || !Number.isFinite(year) || year <= 0) {
    return { ok: false, error: "A specific matched vehicle is required." };
  }
  const fixed = repairVehicleIdentity({ vin, year, make, model: input.model, trim: input.trim });
  return { ok: true, vehicle: { vin, year, make, model: fixed.model || make, trim: fixed.trim } };
}

/** "2027 BMW iX3 50 xDrive" — the label for a car, repaired from its VIN when the stored model is partial. */
export function rfqVehicleLabel(v: RfqVehicleParts): string {
  const r = repairVehicleIdentity(v);
  return vehicleTitle({ year: r.year || null, make: r.make, model: r.model, trim: r.trim });
}

/** Repair model/trim on every pasted car, so each dealer invite and the tracker label name the same car. Other fields pass through. */
export function repairLinkPastes(pastes: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(pastes)) return undefined;
  return pastes.map((p) => {
    if (!p || typeof p !== "object") return p as Record<string, unknown>;
    const r = p as Record<string, unknown>;
    if (typeof r.vin !== "string" || !r.vin) return r;
    const fixed = repairVehicleIdentity({ vin: r.vin, make: typeof r.make === "string" ? r.make : "", model: typeof r.model === "string" ? r.model : "", trim: typeof r.trim === "string" ? r.trim : "" });
    return { ...r, model: fixed.model, trim: fixed.trim };
  });
}
