/**
 * One place that turns year / make / model / trim into a title. A model that already ends with the trim
 * ("F-150 Raptor" + "Raptor") must not repeat it, so the trim is dropped in that case.
 */
export interface VehicleTitleParts {
  /** When present, a partial model is repaired from what the VIN shows ("50 xDrive" -> "iX3" + "50 xDrive"). */
  vin?: string | null;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** True when `model` already ends with `trim` as whole words (or equals it). */
export function modelEndsWithTrim(model: string | null | undefined, trim: string | null | undefined): boolean {
  const m = norm(model || "");
  const t = norm(trim || "");
  if (!m || !t) return false;
  return m === t || m.endsWith(` ${t}`);
}

/**
 * VIN-prefix (WMI + VDS positions 4-5) → model, for series whose feed label is unreliable.
 * Add only prefixes confirmed against stored inventory rows.
 * WBX33: every checked 2027 BMW row (WBX33HR09VDA44039, WBX33HR07VDA46209 and the BMW of Westlake units) is "iX3 / 50 xDrive".
 */
const VIN_MODEL_HINTS: Array<{ prefix: string; make: string; model: string }> = [{ prefix: "WBX33", make: "BMW", model: "iX3" }];

const tidy = (s: string | null | undefined) => (s || "").trim().replace(/\s+/g, " ");
const lower = (s: string) => s.toLowerCase();

/** The model the VIN itself shows, or null when we do not know the series. */
export function modelFromVin(vin: string | null | undefined, make?: string | null): string | null {
  const v = tidy(vin).toUpperCase();
  const m = lower(tidy(make));
  const hit = VIN_MODEL_HINTS.find((h) => v.startsWith(h.prefix) && (!m || m === lower(h.make)));
  return hit ? hit.model : null;
}

/** A "model" that is really a trim token ("50 xDrive", "xDrive50", "sDrive40i"), so a feed put the trim in the model field. */
const looksLikeTrimToken = (s: string) => /xdrive|sdrive|edrive|^\d{2,3}\b/i.test(s);

const hasWord = (haystack: string, needle: string) => ` ${lower(haystack)} `.includes(` ${lower(needle)} `);

/** Fill / repair model and trim from the VIN. Never throws, never drops a value the buyer or feed gave. */
export function repairVehicleIdentity<T extends VehicleTitleParts>(v: T): T & { model: string; trim: string } {
  let model = tidy(v.model);
  let trim = tidy(v.trim);
  // The factory-build vehicle stands the make in when the feed has no model ("BMW" under make "BMW"): that is blank, not a model.
  if (model && lower(model) === lower(tidy(v.make))) model = "";
  const hint = modelFromVin(v.vin, v.make);
  if (hint && !hasWord(model, hint) && (!model || looksLikeTrimToken(model))) {
    // "50 xDrive" with no "iX3": the model slot holds the trim. Move it down and name the model.
    if (model) trim = !trim ? model : lower(trim).includes(lower(model)) ? trim : `${model} ${trim}`;
    model = hint;
  }
  return { ...v, model, trim };
}

export function vehicleTitle(input: VehicleTitleParts): string {
  const v = input.vin ? repairVehicleIdentity(input) : input;
  const trim = modelEndsWithTrim(v.model, v.trim) ? null : v.trim;
  // A model that only repeats the make ("BMW" under make "BMW") is the box's stand-in for an unknown model: say nothing.
  const model = norm(v.model || "") === norm(v.make || "") ? null : v.model;
  return [v.year, v.make, model, trim].filter(Boolean).join(" ");
}
