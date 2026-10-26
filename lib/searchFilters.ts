// The filters of the /search panel that go beyond make/model/trim/price: their allowed values, labels and cleaning rules.
// Pure and client-safe. The box (scrapers/lightsail-crawler/src/inventoryDerived.js) keeps the same value sets: a value sent here that the box
// does not know is dropped there, so both sides list the same keys.

export interface FilterChoice { value: string; label: string }

/** Fuel type is INFERRED from the engine / model / trim text (there is no fuel column): "gas" means an engine is stated and nothing says otherwise. */
export const FUEL_CHOICES: FilterChoice[] = [
  { value: "gas", label: "Gas" }, { value: "hybrid", label: "Hybrid" }, { value: "phev", label: "Plug-in hybrid" },
  { value: "electric", label: "Electric" }, { value: "diesel", label: "Diesel" },
];
/** Drivetrain is INFERRED from the trim / engine / body text (AWD, 4WD, 4x4, xDrive, quattro, RWD, FWD ...); a car that does not say is in no bucket. */
export const DRIVETRAIN_CHOICES: FilterChoice[] = [{ value: "awd", label: "AWD / 4WD" }, { value: "rwd", label: "RWD" }, { value: "fwd", label: "FWD" }];
/** Transmission is grouped from the dealer's free text ("8-Speed Automatic", "CVT", "Dual-Clutch" ...). */
export const TRANSMISSION_CHOICES: FilterChoice[] = [
  { value: "automatic", label: "Automatic" }, { value: "manual", label: "Manual" }, { value: "cvt", label: "CVT" },
  { value: "dct", label: "Dual-clutch" }, { value: "single", label: "Single-speed" },
];
/** Days on market: how long the car has been listed. Each band is an inclusive [min, max] in days; the last is open-ended. */
export const DAYS_BANDS: Array<FilterChoice & { min?: number; max?: number }> = [
  { value: "0-7", label: "Under a week", max: 7 },
  { value: "8-30", label: "1–4 weeks", min: 8, max: 30 },
  { value: "31-60", label: "1–2 months", min: 31, max: 60 },
  { value: "61-90", label: "2–3 months", min: 61, max: 90 },
  { value: "91+", label: "Over 3 months", min: 91 },
];

const keysOf = (choices: FilterChoice[]) => new Set(choices.map((c) => c.value));
const FUEL = keysOf(FUEL_CHOICES), DRIVE = keysOf(DRIVETRAIN_CHOICES), TRANS = keysOf(TRANSMISSION_CHOICES);

export const labelOf = (choices: FilterChoice[], value: string) => choices.find((c) => c.value === value)?.label ?? value;

/** The picked values of a fixed-choice filter, in the order the choices are listed, unknown ones dropped. */
export function pickKnown(raw: string[], choices: FilterChoice[]): string[] {
  const set = new Set(raw);
  return choices.filter((c) => set.has(c.value)).map((c) => c.value);
}
export const cleanFuel = (raw: string[]) => pickKnown(raw, FUEL_CHOICES);
export const cleanDrivetrain = (raw: string[]) => pickKnown(raw, DRIVETRAIN_CHOICES);
export const cleanTransmission = (raw: string[]) => pickKnown(raw, TRANSMISSION_CHOICES);
export const isFuel = (v: string) => FUEL.has(v);
export const isDrivetrain = (v: string) => DRIVE.has(v);
export const isTransmission = (v: string) => TRANS.has(v);

export const MAX_BODY_STYLES = 6;
export const MAX_DEALERS = 10;

/** Body styles are the dealer's own words ("SUV", "Crew Cab Pickup"): letters, digits, space, hyphen, slash and ampersand only, at most 40 characters. */
export function cleanBodyStyle(raw: string): string {
  return String(raw).replace(/[^A-Za-z0-9 \-/&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

/** A dealer id as the box stores it: positive whole digits. */
export const cleanDealerId = (raw: string): string => (/^\d{1,9}$/.test(String(raw).trim()) && Number(raw) > 0 ? String(Number(raw)) : "");

export function daysBandRange(value: string): { min?: number; max?: number } | null {
  const b = DAYS_BANDS.find((x) => x.value === value);
  return b ? { min: b.min, max: b.max } : null;
}

/**
 * A VIN pattern: 17-character VIN letters/digits (no I, O, Q), `?` for exactly one unknown character and `*` for any run of characters.
 * Upper-cased, anything else dropped, at most 17 characters of pattern. "1HGCM*" = starts with 1HGCM; "*123456" = ends with 123456;
 * "????????5*" = the ninth character is 5.
 */
export function cleanVinPattern(raw: string): string {
  return String(raw).toUpperCase().replace(/[^A-HJ-NPR-Z0-9*?]/g, "").replace(/\*{2,}/g, "*").slice(0, 17);
}

/**
 * A pattern the box will run. A bare VIN prefix/suffix uses an index; with a make, any pattern is only a check on that make's rows. Without a
 * make the box refuses a pattern whose first and last three characters are not all literal (it would be a scan of every car).
 */
export function vinPatternUsable(pattern: string, hasMake: boolean): boolean {
  const p = cleanVinPattern(pattern);
  if (p.replace(/[*?]/g, "").length < 3) return false;
  if (hasMake) return true;
  return /^[A-HJ-NPR-Z0-9]{3}/.test(p) || /[A-HJ-NPR-Z0-9]{3}$/.test(p);
}

/** True when `vin` fits `pattern` (used by tests, and to explain a pattern on the page). */
export function vinMatchesPattern(vin: string, pattern: string): boolean {
  const p = cleanVinPattern(pattern);
  if (!p) return true;
  const re = new RegExp("^" + p.replace(/[*]/g, ".*").replace(/[?]/g, ".") + "$", "i");
  return re.test(vin);
}
