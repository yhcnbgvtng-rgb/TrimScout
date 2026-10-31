/**
 * The vehicle on a quote request, made sendable.
 *
 * The send used to refuse any car whose model was blank (or, on the factory-match package, whose trim was) with
 * "A specific matched vehicle is required." A VIN-matched car with a known make and year is specific enough: the
 * VIN is the identity, model/trim are labels. This repairs the labels where the VIN says what they are, and only
 * rejects a car that has no VIN, make or year.
 */
import { vehicleTitle } from "./vehicleTitle";

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

/**
 * VIN-prefix (WMI + VDS positions 4-5) → model, for series whose feed label is unreliable.
 * Add only prefixes confirmed against stored inventory rows.
 * WBX33: every checked 2027 BMW row (WBX33HR09VDA44039, WBX33HR07VDA46209 and the BMW of Westlake units) is "iX3 / 50 xDrive".
 */
const VIN_MODEL_HINTS: Array<{ prefix: string; make: string; model: string }> = [{ prefix: "WBX33", make: "BMW", model: "iX3" }];

const norm = (s: string | null | undefined) => (s || "").trim().replace(/\s+/g, " ");
const lower = (s: string) => s.toLowerCase();

/** The model the VIN itself shows, or null when we do not know the series. */
export function modelFromVin(vin: string | null | undefined, make?: string | null): string | null {
  const v = norm(vin).toUpperCase();
  const m = lower(norm(make));
  const hit = VIN_MODEL_HINTS.find((h) => v.startsWith(h.prefix) && (!m || m === lower(h.make)));
  return hit ? hit.model : null;
}

/** A "model" that is really a trim token ("50 xDrive", "xDrive50", "sDrive40i"), so a feed put the trim in the model field. */
const looksLikeTrimToken = (s: string) => /xdrive|sdrive|edrive|^\d{2,3}\b/i.test(s);

const hasWord = (haystack: string, needle: string) => ` ${lower(haystack)} `.includes(` ${lower(needle)} `);

/** Fill / repair model and trim from the VIN. Never throws, never drops a value the buyer or feed gave. */
export function repairVehicleIdentity<T extends RfqVehicleParts>(v: T): T & { model: string; trim: string } {
  let model = norm(v.model);
  let trim = norm(v.trim);
  const hint = modelFromVin(v.vin, v.make);
  if (hint && !hasWord(model, hint) && (!model || looksLikeTrimToken(model))) {
    // "50 xDrive" with no "iX3": the model slot holds the trim. Move it down and name the model.
    if (model) trim = !trim ? model : lower(trim).includes(lower(model)) ? trim : `${model} ${trim}`;
    model = hint;
  }
  return { ...v, model, trim };
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
