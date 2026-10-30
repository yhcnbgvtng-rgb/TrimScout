// Tolerant reader for a stored trade-in record. The deals box keeps the record as JSON; a record written by an older
// build, a script, or a partially filled draft can lack fields the views index into (options, conditionBand, ...), and
// one missing field used to take the whole page down ("Application error: a client-side exception").
// This never throws and never invents contact data: unknown or missing values become the same neutral defaults
// parseTradeFields uses, and photos without a usable slot are dropped. Use it wherever a stored record is rendered.
import {
  DRIVETRAINS, HISTORY_FLAGS, KEYS, OWNERSHIPS, SERVICE_HISTORIES, TIRE_BRAKES, TITLE_STATUSES, TRADE_CONDITIONS, TRADE_INTENTS, TRADE_OPTIONS,
  DEALER_NOTES_MAX, OPTIONAL_PHOTO_SLOTS, REQUIRED_PHOTO_SLOTS,
  type TradeInRecord, type TradePhoto,
} from "./types";

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const strOrNull = (v: unknown, max = 500): string | null => str(v, max) || null;
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const SLOTS: readonly string[] = [...REQUIRED_PHOTO_SLOTS, ...OPTIONAL_PHOTO_SLOTS];

function coercePhotos(raw: unknown): TradePhoto[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TradePhoto[] = [];
  for (const p of raw) {
    const o = p && typeof p === "object" ? (p as Record<string, unknown>) : null;
    const slot = o && typeof o.slot === "string" && SLOTS.includes(o.slot) ? (o.slot as TradePhoto["slot"]) : null;
    if (!o || !slot || seen.has(slot) || typeof o.storageKey !== "string" || !o.storageKey) continue;
    seen.add(slot);
    out.push({
      slot, required: (REQUIRED_PHOTO_SLOTS as readonly string[]).includes(slot), storageKey: o.storageKey,
      width: num(o.width), height: num(o.height),
      capturedAt: str(o.capturedAt, 40), uploadedAt: str(o.uploadedAt, 40),
    } as TradePhoto);
  }
  return out;
}

/** A complete TradeInRecord from whatever was stored, or null when there is nothing record-shaped to read. */
export function coerceTradeIn(raw: unknown): TradeInRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const options = Array.from(new Set((Array.isArray(o.options) ? o.options : []).map((x) => oneOf(TRADE_OPTIONS, x)).filter((x): x is NonNullable<typeof x> => Boolean(x))));
  const wl = o.warningLights && typeof o.warningLights === "object" ? (o.warningLights as Record<string, unknown>) : null;
  const year = Number(o.year);
  const now = new Date().toISOString();
  return {
    vin: str(o.vin, 40).toUpperCase(),
    year: Number.isInteger(year) && year > 0 ? year : null,
    make: str(o.make, 40), model: str(o.model, 60), trim: str(o.trim, 60),
    decodedFromVin: o.decodedFromVin === true,
    mileage: Math.max(0, Math.round(num(o.mileage))),
    zip: str(o.zip, 10),
    conditionBand: oneOf(TRADE_CONDITIONS, o.conditionBand) ?? "good",
    titleStatus: oneOf(TITLE_STATUSES, o.titleStatus) ?? "not_sure",
    ownership: oneOf(OWNERSHIPS, o.ownership) ?? "owned",
    lenderName: strOrNull(o.lenderName, 80),
    payoffEstimate: Math.max(0, Math.round(num(o.payoffEstimate))),
    sharePayoff: o.sharePayoff === true,
    keys: oneOf(KEYS, o.keys) ?? "1",
    historyFlag: oneOf(HISTORY_FLAGS, o.historyFlag) ?? "no",
    historyNotes: strOrNull(o.historyNotes),
    drivetrain: oneOf(DRIVETRAINS, o.drivetrain),
    options,
    optionsOther: strOrNull(o.optionsOther, 200),
    extColor: strOrNull(o.extColor, 40), intColor: strOrNull(o.intColor, 40),
    serviceHistory: oneOf(SERVICE_HISTORIES, o.serviceHistory), serviceNotes: strOrNull(o.serviceNotes),
    tireBrake: oneOf(TIRE_BRAKES, o.tireBrake), mods: strOrNull(o.mods, 300),
    warningLights: wl ? { on: wl.on === true, which: wl.on === true ? strOrNull(wl.which, 200) : null } : null,
    intent: oneOf(TRADE_INTENTS, o.intent) ?? "apply_to_deal",
    dealerNotes: strOrNull(o.dealerNotes, DEALER_NOTES_MAX),
    odometerConfirmed: o.odometerConfirmed === true,
    photos: coercePhotos(o.photos),
    createdAt: str(o.createdAt, 40) || now, updatedAt: str(o.updatedAt, 40) || str(o.createdAt, 40) || now,
    photosChangedAt: strOrNull(o.photosChangedAt, 40),
  };
}
