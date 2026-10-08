/**
 * Validation for the buyer's trade-in, shared by the step UI and the server. The server is the
 * authority: a request with the trade toggle on and fewer than six required photos is refused there
 * whatever the browser did. Errors are keyed by field so the UI can point at the first problem.
 */
import { findContactInfo } from "../piiFilter";
import {
  DRIVETRAINS, HISTORY_FLAGS, INTENT_LABELS, KEYS, OWNERSHIPS, REQUIRED_PHOTO_SLOTS, SERVICE_HISTORIES, TIRE_BRAKES, TITLE_STATUSES, TRADE_CONDITIONS, TRADE_INTENTS, TRADE_OPTIONS,
  isRequiredSlot, type PhotoSlot, type TradeInFields, type TradePhoto,
} from "./types";

export const MILEAGE_MAX = 500_000;
export const PAYOFF_MAX = 300_000;

const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;
const TRANSLIT: Record<string, number> = {};
"ABCDEFGH".split("").forEach((c, i) => (TRANSLIT[c] = i + 1));
"JKLMN".split("").forEach((c, i) => (TRANSLIT[c] = i + 1));
TRANSLIT.P = 7; TRANSLIT.R = 9;
"STUVWXYZ".split("").forEach((c, i) => (TRANSLIT[c] = i + 2));
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** 17 valid characters AND the ISO 3779 check digit (position 9). */
export function isValidVin(raw: string): boolean {
  const vin = (raw || "").trim().toUpperCase();
  if (!VIN_CHARS.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /\d/.test(c) ? Number(c) : TRANSLIT[c];
    sum += v * WEIGHTS[i];
  }
  const check = sum % 11 === 10 ? "X" : String(sum % 11);
  return vin[8] === check;
}

export type TradeErrors = Partial<Record<string, string>>;
export type TradeParse = { ok: true; fields: TradeInFields } | { ok: false; errors: TradeErrors };

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (list as readonly string[]).includes(v as string) ? (v as T) : null;
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const wholeNumber = (v: unknown): number => {
  const t = typeof v === "string" ? v.replace(/[$,\s]/g, "") : v;
  return t === "" || t == null ? NaN : Number(t);
};

export function parseTradeFields(raw: unknown, now: Date = new Date()): TradeParse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const e: TradeErrors = {};
  const free = (key: string, v: unknown, max: number, label: string): string => {
    const t = text(v, max);
    if (t && findContactInfo(t)) e[key] = `Leave contact info out of ${label} — TrimScout passes messages along.`;
    return t;
  };

  const vin = text(o.vin, 40).toUpperCase().replace(/\s+/g, "");
  if (!isValidVin(vin)) e.vin = "Enter the 17-character VIN (the letters I, O and Q aren't used).";
  const year = Number(o.year);
  const make = text(o.make, 40), model = text(o.model, 60), trim = text(o.trim, 60);
  if (!(Number.isInteger(year) && year >= 1981 && year <= now.getFullYear() + 1)) e.year = "Pick the model year.";
  if (!make) e.make = "Enter the make.";
  if (!model) e.model = "Enter the model.";
  if (!trim) e.trim = "Enter the trim.";

  const mileage = wholeNumber(o.mileage);
  if (!(Number.isInteger(mileage) && mileage >= 0 && mileage <= MILEAGE_MAX)) e.mileage = `Enter the mileage as a whole number, 0–${MILEAGE_MAX.toLocaleString()}.`;
  const zip = text(o.zip, 10);
  if (!/^\d{5}$/.test(zip)) e.zip = "Enter the 5-digit ZIP where the vehicle is.";

  const conditionBand = oneOf(TRADE_CONDITIONS, o.conditionBand);
  if (!conditionBand) e.conditionBand = "Pick the condition.";
  const titleStatus = oneOf(TITLE_STATUSES, o.titleStatus);
  if (!titleStatus) e.titleStatus = "Pick the title status.";
  const ownership = oneOf(OWNERSHIPS, o.ownership);
  if (!ownership) e.ownership = "Say whether it's owned, financed or leased.";

  let lenderName: string | null = null;
  let payoffEstimate = 0;
  if (ownership === "financed" || ownership === "leased") {
    lenderName = free("lenderName", o.lenderName, 80, "the lender name") || null;
    if (!lenderName && !e.lenderName) e.lenderName = "Enter the lender name.";
    payoffEstimate = wholeNumber(o.payoffEstimate);
    if (!(Number.isFinite(payoffEstimate) && payoffEstimate > 0 && payoffEstimate <= PAYOFF_MAX)) { e.payoffEstimate = "Enter an approximate payoff. An estimate is fine."; payoffEstimate = 0; }
    payoffEstimate = Math.round(payoffEstimate);
  }

  const keys = oneOf(KEYS, o.keys);
  if (!keys) e.keys = "How many keys do you have?";
  const historyFlag = oneOf(HISTORY_FLAGS, o.historyFlag);
  if (!historyFlag) e.historyFlag = "Answer the accident, airbag or flood question.";
  let historyNotes: string | null = null;
  if (historyFlag === "yes") {
    historyNotes = free("historyNotes", o.historyNotes, 500, "the history notes") || null;
    if (!historyNotes && !e.historyNotes) e.historyNotes = "Tell the dealer briefly what happened.";
  }

  const drivetrain = oneOf(DRIVETRAINS, o.drivetrain);
  if (!drivetrain) e.drivetrain = "Pick the drivetrain.";
  const options = Array.from(new Set((Array.isArray(o.options) ? o.options : []).map((x) => oneOf(TRADE_OPTIONS, x)).filter((x): x is NonNullable<typeof x> => Boolean(x))));
  let optionsOther: string | null = null;
  if (options.includes("other")) {
    optionsOther = free("optionsOther", o.optionsOther, 200, "the options") || null;
    if (!optionsOther && !e.optionsOther) e.optionsOther = "Say what the other option is.";
  }

  if (o.odometerConfirmed !== true) e.odometerConfirmed = "Confirm the mileage in the odometer photo matches what you entered.";

  const serviceHistory = oneOf(SERVICE_HISTORIES, o.serviceHistory);
  const tireBrake = oneOf(TIRE_BRAKES, o.tireBrake);
  const intent = oneOf(TRADE_INTENTS, o.intent) ?? "apply_to_deal";
  const wl = o.warningLights && typeof o.warningLights === "object" ? (o.warningLights as Record<string, unknown>) : null;
  const warningLights = wl ? { on: wl.on === true, which: wl.on === true ? free("warningLights", wl.which, 200, "the warning lights") || null : null } : null;

  const fields: TradeInFields = {
    vin, year: Number.isInteger(year) ? year : null, make, model, trim, decodedFromVin: o.decodedFromVin === true,
    mileage: Number.isInteger(mileage) ? mileage : 0, zip,
    conditionBand: conditionBand ?? "good", titleStatus: titleStatus ?? "not_sure", ownership: ownership ?? "owned",
    lenderName, payoffEstimate, keys: keys ?? "1", historyFlag: historyFlag ?? "no", historyNotes,
    drivetrain: drivetrain ?? null, options, optionsOther,
    extColor: free("extColor", o.extColor, 40, "the color") || null,
    intColor: free("intColor", o.intColor, 40, "the color") || null,
    serviceHistory, serviceNotes: free("serviceNotes", o.serviceNotes, 500, "the service notes") || null,
    tireBrake, mods: free("mods", o.mods, 300, "the mods") || null, warningLights, intent,
    odometerConfirmed: o.odometerConfirmed === true,
  };
  return Object.keys(e).length ? { ok: false, errors: e } : { ok: true, fields };
}

// ---- photos ---------------------------------------------------------------
export function missingRequiredSlots(photos: ReadonlyArray<Pick<TradePhoto, "slot">>): PhotoSlot[] {
  const have = new Set(photos.map((p) => p.slot));
  return REQUIRED_PHOTO_SLOTS.filter((s) => !have.has(s));
}

/** "4 of 6 required photos", and the first slot still missing (the one the UI scrolls to). */
export function requiredPhotoProgress(photos: ReadonlyArray<Pick<TradePhoto, "slot">>): { have: number; total: number; missing: PhotoSlot[]; firstMissing: PhotoSlot | null; complete: boolean } {
  const missing = missingRequiredSlots(photos);
  return { have: REQUIRED_PHOTO_SLOTS.length - missing.length, total: REQUIRED_PHOTO_SLOTS.length, missing, firstMissing: missing[0] ?? null, complete: missing.length === 0 };
}

export const photoProgressLabel = (photos: ReadonlyArray<Pick<TradePhoto, "slot">>): string => {
  const p = requiredPhotoProgress(photos);
  return `${p.have} of ${p.total} required photos`;
};

/** A photo list is acceptable only if every required slot is present exactly once and every entry is a known slot. */
export function validatePhotoSet(photos: ReadonlyArray<TradePhoto>): { ok: boolean; error: string | null } {
  const seen = new Set<string>();
  for (const p of photos) {
    if (seen.has(p.slot)) return { ok: false, error: `Duplicate photo for ${p.slot}.` };
    seen.add(p.slot);
    if (p.required !== isRequiredSlot(p.slot)) return { ok: false, error: `Photo ${p.slot} has the wrong required flag.` };
  }
  const missing = missingRequiredSlots(photos);
  if (missing.length) return { ok: false, error: `Add all 6 required photos — missing: ${missing.join(", ")}.` };
  return { ok: true, error: null };
}

export { INTENT_LABELS };
