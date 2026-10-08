/**
 * Trade-in on a quote request: what the buyer says about the car, the photos that back it up,
 * the dealer's appraisal, and a dealer's ask for more photos.
 *
 * Storage convention: the box keeps these as JSON on existing rows (rfq_requests.trade_in_json,
 * rfq_invites.trade_appraisal_json / trade_photo_request_json) like every other RFQ extension.
 * "dealer_quote_id" in the product spec maps to the invite id: a desk's appraisal survives a
 * re-quote after a counter, a quote id would not. Photo bytes live in S3 only.
 */

export const TRADE_CONDITIONS = ["excellent", "good", "fair", "rough"] as const;
export type TradeCondition = (typeof TRADE_CONDITIONS)[number];
export const TRADE_CONDITION_COPY: Record<TradeCondition, { label: string; line: string }> = {
  excellent: { label: "Excellent", line: "Like new: no dents or scratches, spotless interior, no mechanical issues." },
  good: { label: "Good", line: "Normal wear for its age: minor scratches or small dings, clean interior, runs well." },
  fair: { label: "Fair", line: "Visible wear: several dents or scratches, interior stains, or something needs attention." },
  rough: { label: "Rough", line: "Heavy wear or damage, major cosmetic or mechanical problems, or doesn't run reliably." },
};

export const TITLE_STATUSES = ["clean", "salvage", "rebuilt", "lemon_buyback", "not_sure"] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];
export const TITLE_LABELS: Record<TitleStatus, string> = { clean: "Clean", salvage: "Salvage", rebuilt: "Rebuilt", lemon_buyback: "Lemon-buyback", not_sure: "Not sure" };

export const OWNERSHIPS = ["owned", "financed", "leased"] as const;
export type Ownership = (typeof OWNERSHIPS)[number];
export const OWNERSHIP_LABELS: Record<Ownership, string> = { owned: "Owned outright", financed: "Financed", leased: "Leased" };

export const KEYS = ["1", "2+"] as const;
export type KeyCount = (typeof KEYS)[number];

export const HISTORY_FLAGS = ["no", "yes", "not_sure"] as const;
export type HistoryFlag = (typeof HISTORY_FLAGS)[number];

export const TRADE_OPTIONS = ["awd", "4x4", "sunroof", "tow_package", "premium_audio", "premium_package", "third_row", "other"] as const;
export type TradeOption = (typeof TRADE_OPTIONS)[number];
export const TRADE_OPTION_LABELS: Record<TradeOption, string> = {
  awd: "AWD", "4x4": "4x4", sunroof: "Sunroof", tow_package: "Tow package", premium_audio: "Premium audio", premium_package: "Premium or tech package", third_row: "Third row", other: "Other",
};
export const DRIVETRAINS = ["2wd", "awd", "4x4"] as const;
export type Drivetrain = (typeof DRIVETRAINS)[number];
export const DRIVETRAIN_LABELS: Record<Drivetrain, string> = { "2wd": "2WD", awd: "AWD", "4x4": "4x4" };

export const SERVICE_HISTORIES = ["dealer", "independent", "mixed", "unknown"] as const;
export type ServiceHistory = (typeof SERVICE_HISTORIES)[number];
export const SERVICE_LABELS: Record<ServiceHistory, string> = { dealer: "Dealer", independent: "Independent", mixed: "Mixed", unknown: "Unknown" };

export const TIRE_BRAKES = ["good", "fair", "needs_replacing"] as const;
export type TireBrake = (typeof TIRE_BRAKES)[number];
export const TIRE_BRAKE_LABELS: Record<TireBrake, string> = { good: "Good", fair: "Fair", needs_replacing: "Needs replacing" };

export const TRADE_INTENTS = ["apply_to_deal", "sell_outright"] as const;
export type TradeIntent = (typeof TRADE_INTENTS)[number];
export const INTENT_LABELS: Record<TradeIntent, string> = { apply_to_deal: "Apply to this deal", sell_outright: "Open to selling outright" };

// ---- photos ---------------------------------------------------------------
export const REQUIRED_PHOTO_SLOTS = ["front", "rear", "driver_side", "passenger_side", "odometer", "interior"] as const;
export const OPTIONAL_PHOTO_SLOTS = ["rear_cargo", "tire_tread", "damage_1", "damage_2", "damage_3", "damage_4"] as const;
export type RequiredSlot = (typeof REQUIRED_PHOTO_SLOTS)[number];
export type OptionalSlot = (typeof OPTIONAL_PHOTO_SLOTS)[number];
export type PhotoSlot = RequiredSlot | OptionalSlot;
export const ALL_PHOTO_SLOTS: readonly PhotoSlot[] = [...REQUIRED_PHOTO_SLOTS, ...OPTIONAL_PHOTO_SLOTS];
export const isPhotoSlot = (s: unknown): s is PhotoSlot => typeof s === "string" && (ALL_PHOTO_SLOTS as readonly string[]).includes(s);
export const isRequiredSlot = (s: PhotoSlot): s is RequiredSlot => (REQUIRED_PHOTO_SLOTS as readonly string[]).includes(s);

export const PHOTO_SLOT_INFO: Record<PhotoSlot, { label: string; hint: string; required: boolean }> = {
  front: { label: "Front", hint: "Straight on, whole vehicle in frame", required: true },
  rear: { label: "Rear", hint: "Straight on, whole vehicle in frame", required: true },
  driver_side: { label: "Driver side", hint: "Full profile", required: true },
  passenger_side: { label: "Passenger side", hint: "Full profile", required: true },
  odometer: { label: "Odometer", hint: "Car ON, mileage readable, warning lights visible", required: true },
  interior: { label: "Interior", hint: "Front seats and dash from the open driver door", required: true },
  rear_cargo: { label: "Rear seats / cargo", hint: "Back seats and cargo area", required: false },
  tire_tread: { label: "Tire tread", hint: "One tire, tread close up", required: false },
  damage_1: { label: "Damage or wear 1", hint: "Anything worth noting, close up", required: false },
  damage_2: { label: "Damage or wear 2", hint: "Anything worth noting, close up", required: false },
  damage_3: { label: "Damage or wear 3", hint: "Anything worth noting, close up", required: false },
  damage_4: { label: "Damage or wear 4", hint: "Anything worth noting, close up", required: false },
};

export interface TradePhoto {
  slot: PhotoSlot;
  required: boolean;
  /** trade/{quoteRequestId}/{slot}.jpg — the bytes are only ever served through short-lived signed URLs. */
  storageKey: string;
  width: number;
  height: number;
  /** EXIF capture time when the phone recorded one; location data is stripped before upload. */
  capturedAt: string | null;
  uploadedAt: string;
}

// ---- the buyer's record ---------------------------------------------------
export interface TradeInFields {
  vin: string;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  /** True when year/make/model/trim came from the VIN decode rather than manual entry. */
  decodedFromVin: boolean;
  mileage: number;
  zip: string;
  conditionBand: TradeCondition;
  titleStatus: TitleStatus;
  ownership: Ownership;
  lenderName: string | null;
  /** Approximate; the dealer verifies the exact payoff. 0 when owned outright. */
  payoffEstimate: number;
  keys: KeyCount;
  historyFlag: HistoryFlag;
  historyNotes: string | null;
  drivetrain: Drivetrain | null;
  options: TradeOption[];
  optionsOther: string | null;
  // optional
  extColor: string | null;
  intColor: string | null;
  serviceHistory: ServiceHistory | null;
  serviceNotes: string | null;
  tireBrake: TireBrake | null;
  mods: string | null;
  warningLights: { on: boolean; which: string | null } | null;
  intent: TradeIntent;
  /** "Mileage in photo matches what I entered". */
  odometerConfirmed: boolean;
}

export interface TradeInRecord extends TradeInFields {
  photos: TradePhoto[];
  createdAt: string;
  updatedAt: string;
  /** Set when photos changed after the request went out; dealers get one notice per change batch. */
  photosChangedAt?: string | null;
}

// ---- the dealer's side ----------------------------------------------------
export const APPRAISAL_BASES = ["preliminary", "firm"] as const;
export type AppraisalBasis = (typeof APPRAISAL_BASES)[number];
export const BASIS_LABELS: Record<AppraisalBasis, string> = {
  preliminary: "Preliminary",
  firm: "Firm",
};
export const BASIS_COPY: Record<AppraisalBasis, string> = {
  preliminary: "Preliminary, subject to inspection",
  firm: "Firm if the vehicle matches the description and photos",
};

export interface DealerTradeAppraisal {
  /** Exactly one of single, or low + high. */
  allowanceSingle: number | null;
  allowanceLow: number | null;
  allowanceHigh: number | null;
  basis: AppraisalBasis;
  goodUntil: string;
  /** The buyer's payoff estimate the dealer used (0 when owned outright). */
  payoffUsed: number;
  /** Midpoint (or single) allowance minus payoffUsed. */
  equityComputed: number;
  conditions: string | null;
  /** Set when the dealer confirmed a value far from the guide. */
  outlierConfirmed?: boolean;
  createdAt: string;
}

export interface TradePhotoRequest {
  slots: OptionalSlot[];
  note: string | null;
  status: "open" | "fulfilled";
  createdAt: string;
  fulfilledAt: string | null;
}

export const TRADE_PHOTO_COPY = "Dealers need these 6 photos to give you a real trade number instead of a guess.";
export const TRADE_PRIVACY_COPY = "Photos and details go only to the dealers you send this request to. We remove location data from your photos.";
export const TRADE_ESTIMATE_COPY = "Trade values are dealer estimates and may change after inspection.";
