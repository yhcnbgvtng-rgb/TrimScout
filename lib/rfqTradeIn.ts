/**
 * A trade-in attached to ONE dealer's invite on a quote request.
 *
 * The buyer describes the car (VIN, or year/make/model/trim), mileage, any
 * payoff, condition, photos and a note; the dealer answers with a trade-in
 * allowance. Nothing here is binding — the allowance is a dealer estimate
 * that can change after inspection.
 *
 * The post-purchase trade-in on a paid deal (lib/tradeInMath.ts) is a
 * different flow with its own state-tax-credit table; this one deliberately
 * does NOT use it. Per the current rules, sales tax stays on the full price.
 */
import { findContactInfo } from "./piiFilter";

export const TRADE_CONDITIONS = ["excellent", "good", "fair", "rough"] as const;
export type TradeCondition = (typeof TRADE_CONDITIONS)[number];
export const TRADE_CONDITION_LABELS: Record<TradeCondition, string> = { excellent: "Excellent", good: "Good", fair: "Fair", rough: "Rough" };
export const MAX_TRADE_PHOTOS = 6;
/** Per photo, as a base64 data URL (the client compresses to JPEG well under this). */
export const MAX_TRADE_PHOTO_CHARS = 450_000;
export const TRADE_VALUES_COPY = "Trade values are dealer estimates and may change after inspection.";

export interface RfqTradeIn {
  vin: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  mileage: number;
  /** Amount still owed on the trade; null when it's paid off or unknown. */
  payoff: number | null;
  lender: string | null;
  condition: TradeCondition;
  note: string | null;
  /** Data URLs. Present on write and on the dealer's own fetch; the buyer's invite list carries only photoCount. */
  photos?: string[];
  photoCount: number;
  submittedAt: string;
  /** The dealer's allowance; null/undefined until they quote one. */
  allowance?: number | null;
  allowanceAt?: string | null;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export type TradeInParse = { ok: true; tradeIn: RfqTradeIn } | { ok: false; errors: string[] };

/** Validates the buyer's form. VIN, or year + make + model + trim, is required; mileage and condition always are. */
export function parseTradeInRequest(raw: unknown, now: Date = new Date()): TradeInParse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const vin = text(o.vin, 40).toUpperCase().replace(/\s+/g, "");
  const make = text(o.make, 40);
  const model = text(o.model, 60);
  const trim = text(o.trim, 60);
  const year = Number(o.year);
  if (vin) {
    if (!VIN_RE.test(vin)) errors.push("That VIN isn't 17 valid characters.");
  } else {
    if (!(Number.isInteger(year) && year >= 1981 && year <= now.getFullYear() + 1)) errors.push("Enter the VIN, or the year, make, model and trim.");
    else if (!make || !model || !trim) errors.push("Enter the VIN, or the year, make, model and trim.");
  }
  const mileageRaw = typeof o.mileage === "string" ? o.mileage.replace(/[,\s]/g, "") : o.mileage;
  const mileage = mileageRaw === "" || mileageRaw == null ? NaN : Number(mileageRaw);
  if (!(Number.isFinite(mileage) && mileage >= 0 && mileage <= 999_999)) errors.push("Enter the mileage.");
  const payoff = money(o.payoff);
  if (payoff !== null && !(payoff >= 0 && payoff <= 500_000)) errors.push("Payoff must be 0 or more.");
  const lender = text(o.lender, 80);
  const condition = TRADE_CONDITIONS.find((c) => c === o.condition);
  if (!condition) errors.push("Pick the condition: Excellent, Good, Fair or Rough.");
  const photos = Array.isArray(o.photos) ? (o.photos as unknown[]) : [];
  if (photos.length > MAX_TRADE_PHOTOS) errors.push(`Up to ${MAX_TRADE_PHOTOS} photos.`);
  else if (!photos.every((p) => typeof p === "string" && p.length <= MAX_TRADE_PHOTO_CHARS && PHOTO_RE.test(p))) errors.push("Photos must be JPEG, PNG or WebP images, each under about 300 KB.");
  const note = text(o.note, 500);
  if (note && findContactInfo(note)) errors.push("Leave phone numbers, emails and links out of the note — TrimScout passes messages along.");
  if (errors.length || !condition) return { ok: false, errors };
  return {
    ok: true,
    tradeIn: {
      vin: vin || null,
      year: Number.isInteger(year) && year > 0 ? year : null,
      make, model, trim,
      mileage: Math.round(mileage),
      payoff: payoff && payoff > 0 ? payoff : null,
      lender: lender || null,
      condition,
      note: note || null,
      photos: photos as string[],
      photoCount: photos.length,
      submittedAt: now.toISOString(),
    },
  };
}

export const tradeTitle = (t: Pick<RfqTradeIn, "year" | "make" | "model" | "trim" | "vin">): string =>
  [t.year, t.make, t.model, t.trim].filter(Boolean).join(" ") || (t.vin ? `VIN ${t.vin}` : "Trade-in");

/** The dealer's allowance, validated. null = leave blank (still pending). */
export function parseAllowance(raw: unknown): { ok: true; allowance: number | null } | { ok: false; error: string } {
  const n = money(raw);
  if (n === null) return { ok: true, allowance: null };
  if (!(n >= 0 && n <= 1_000_000)) return { ok: false, error: "Trade-in allowance must be $0 or more." };
  return { ok: true, allowance: n };
}

export type TradeStatus = "none" | "pending" | "quoted";

export interface TradeOtd {
  status: TradeStatus;
  /** selling price + fees + tax + add-ons − rebates — the dealer's quote with no trade in it. */
  baseOtd: number;
  allowance: number | null;
  payoff: number | null;
  /** allowance − payoff; null until the dealer has quoted a value. */
  netEquity: number | null;
  negativeEquity: boolean;
  /** What the buyer pays: baseOtd − netEquity. Equals baseOtd while the trade is pending. */
  total: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Out the door with a trade: selling price + fees + tax + add-ons − rebates − net trade equity.
 * `baseOtd` is that sum without the trade (see cashOutTheDoor), so every dealer's tax is
 * whatever they quoted on the full price.
 *
 * TODO(tax): no trade-in sales-tax credit is applied anywhere. NJ taxes the full price
 * and the other states' rules are undecided — revisit per state before changing this.
 *
 * Negative equity (payoff > allowance) is ADDED to the total. Pending (no dealer value yet) leaves the total untouched.
 */
export function tradeOutTheDoor(baseOtd: number, trade: Pick<RfqTradeIn, "allowance" | "payoff"> | null | undefined): TradeOtd {
  const base = cents(baseOtd);
  if (!trade) return { status: "none", baseOtd: base, allowance: null, payoff: null, netEquity: null, negativeEquity: false, total: base };
  const payoff = trade.payoff && trade.payoff > 0 ? trade.payoff : 0;
  if (trade.allowance == null || !Number.isFinite(trade.allowance)) {
    return { status: "pending", baseOtd: base, allowance: null, payoff: payoff || null, netEquity: null, negativeEquity: false, total: base };
  }
  const netEquity = cents(trade.allowance - payoff);
  return { status: "quoted", baseOtd: base, allowance: trade.allowance, payoff: payoff || null, netEquity, negativeEquity: netEquity < 0, total: cents(base - netEquity) };
}
