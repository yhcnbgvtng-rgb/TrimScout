/**
 * Lease quotes — the only kind of quote in this flow. The buyer states
 * term, miles/year and ZIP; each dealer replies through a structured
 * calculator, never a free-text "monthly only" number. Everything a buyer
 * compares is derived from these fields, and nothing here is a bid.
 *
 * Pure: types, validation, derived numbers. No I/O.
 */
import { parseCreditBand, type CreditBand } from "./creditBand";
import { calcNetCap, totalLeaseCost as totalLeaseCostOf, residualAmountFrom, sumItems } from "./leaseMath";

export const LEASE_TERMS = [18, 24, 36, 39, 48] as const;
export type LeaseTerm = (typeof LEASE_TERMS)[number];
export const LEASE_MILES = [7500, 10000, 12000, 15000] as const;
export type LeaseMiles = (typeof LEASE_MILES)[number];
export const DEFAULT_LEASE_TERM: LeaseTerm = 36;
export type LeaseTimeline = "asap" | "this_week" | "this_month";

/** What the buyer intends to pay up front — a stated intent, not a number (a "quote under $X" would be a reverse-bid). */
export type LeaseDueAtSigningIntent = "first_month_only" | "cash_down";
export const LEASE_DAS_INTENTS: readonly LeaseDueAtSigningIntent[] = ["first_month_only", "cash_down"];
export const LEASE_DAS_INTENT_LABELS: Record<LeaseDueAtSigningIntent, string> = {
  first_month_only: "First month + fees only — no cap reduction",
  cash_down: "I plan to put money down (cap reduction)",
};

/** What the buyer asked for. */
export interface LeaseRequestPrefs {
  termMonths: LeaseTerm;
  milesPerYear: LeaseMiles;
  /** Tax context only — never shared with the dealer beyond the state it implies. */
  zip: string;
  timeline?: LeaseTimeline | null;
  /** Buyer locks (required on new requests; older requests may lack them). */
  creditBand?: CreditBand | null;
  dueAtSigningIntent?: LeaseDueAtSigningIntent | null;
}

/**
 * Only the terms and mileage bands the product offers; anything else is
 * dropped, not guessed. Shared by the create and the edit routes so the
 * sheet can't be saved with a value the calculator can't quote to.
 */
export function parseLeasePrefs(raw: unknown): LeaseRequestPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const term = Number(o.termMonths);
  const miles = Number(o.milesPerYear);
  if (!(LEASE_TERMS as readonly number[]).includes(term) || !(LEASE_MILES as readonly number[]).includes(miles)) return null;
  const zip = typeof o.zip === "string" && /^\d{5}$/.test(o.zip) ? o.zip : "";
  const timeline = o.timeline === "asap" || o.timeline === "this_week" || o.timeline === "this_month" ? o.timeline : null;
  // Buyer prefs are term + miles + ZIP + credit band + due-at-signing
  // intent (+ timeline). No payment cap: a "quote under $X" is a
  // reverse-bid, and v1 is a quote request.
  const creditBand = parseCreditBand(o.creditBand);
  const dueAtSigningIntent = (LEASE_DAS_INTENTS as readonly unknown[]).includes(o.dueAtSigningIntent) ? (o.dueAtSigningIntent as LeaseDueAtSigningIntent) : null;
  return { termMonths: term as LeaseTerm, milesPerYear: miles as LeaseMiles, zip, timeline, creditBand, dueAtSigningIntent };
}

// ---------------------------------------------------------------------------
// Lease quote v2 vocabulary. Every new field is OPTIONAL on the type (quotes
// stored before v2 lack them) and REQUIRED by validateLeaseQuote on a new
// dealer submission.
// ---------------------------------------------------------------------------

/** How the state collects sales tax on a lease. The calculator applies it (lib/leaseMath.ts computeLeaseTax). */
export const LEASE_TAX_METHODS = ["monthly", "upfront_payments", "upfront_cap_cost", "other"] as const;
export type LeaseTaxMethod = (typeof LEASE_TAX_METHODS)[number];
export const LEASE_TAX_METHOD_LABELS: Record<LeaseTaxMethod, string> = {
  monthly: "Monthly on payment",
  upfront_payments: "Upfront on total payments",
  upfront_cap_cost: "Upfront on cap cost",
  other: "Other (describe)",
};

export const LENDER_TYPES = ["captive", "bank", "other"] as const;
export type LenderType = (typeof LENDER_TYPES)[number];
/** Manufacturer-captive lease lenders offered in the dropdown. "Bank / credit union" and "Other" take a typed name. */
export const CAPTIVE_LENDERS = [
  "Ford Credit", "GM Financial", "Toyota Financial Services", "Lexus Financial Services", "Honda Financial Services", "Acura Financial Services",
  "Hyundai Capital America", "Kia Finance America", "Genesis Finance", "Nissan Motor Acceptance (NMAC)", "Infiniti Financial Services", "Mazda Financial Services",
  "Subaru Motors Finance", "Mitsubishi Motors Credit of America", "Stellantis Financial Services", "BMW Financial Services", "MINI Financial Services",
  "Mercedes-Benz Financial Services", "Volkswagen Credit", "Audi Financial Services", "Porsche Financial Services", "Volvo Car Financial Services",
  "Jaguar Land Rover Financial Services", "Lincoln Automotive Financial Services",
] as const;

/** Credit tiers a dealer prices the money factor at, best first. */
export const CREDIT_TIERS = ["Tier 1+", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5+"] as const;

export const VEHICLE_STATUSES = ["in_stock", "in_transit", "on_order"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = { in_stock: "In stock", in_transit: "In transit", on_order: "On order" };

export const FEE_CATEGORIES = ["dealer", "government"] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];
export const LINE_TIMINGS = ["signing", "rolled"] as const;
export type LineTiming = (typeof LINE_TIMINGS)[number];
export const LINE_TIMING_LABELS: Record<LineTiming, string> = { signing: "Due at signing", rolled: "Rolled into cap cost" };

export const INCENTIVE_ELIGIBILITY_TYPES = ["open", "loyalty", "conquest", "military", "first_responder", "college_grad", "other"] as const;
export type IncentiveEligibility = (typeof INCENTIVE_ELIGIBILITY_TYPES)[number];
export const INCENTIVE_ELIGIBILITY_LABELS: Record<IncentiveEligibility, string> = {
  open: "Open to all", loyalty: "Loyalty", conquest: "Conquest", military: "Military", first_responder: "First responder", college_grad: "College grad", other: "Other",
};
export const INCENTIVE_ATTESTATION_COPY = "These incentives are current manufacturer or dealer programs this buyer appears to qualify for.";

export const RESIDUAL_ENTERED_DIRECTLY_NOTE = "Residual entered directly";
export const PRICED_AT_LOWER_TIER_LABEL = "Priced at a lower tier";
export const GOOD_THROUGH_MAX_DAYS = 45;

export interface LineItem {
  name: string;
  amount: number;
  /** Surcharge lines only: the dealer's short reason, shown to the buyer under a "Dealer-imposed" label. */
  reason?: string;
  /** Fee lines: dealer fee or government (pass-through) fee. Unset on older quotes (read as dealer). */
  category?: FeeCategory;
  /** Fee and add-on lines: whether sales tax applies to this line. */
  taxable?: boolean;
  /** Fee and add-on lines: due at signing, or rolled into the cap cost. */
  timing?: LineTiming;
  /** Incentive lines: who qualifies, and the proof the dealer will ask for. */
  eligibilityType?: IncentiveEligibility;
  eligibilityProof?: string;
  /** Add-on lines: the buyer can ask for it to come off. */
  removable?: boolean;
}

/** The last day of the month `now` is in, as YYYY-MM-DD — lease programs reset monthly, so it is the default "good through" date. */
export function endOfMonthDate(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 17 characters, A–Z/0–9, never I, O or Q. */
export function normalizeVin(v: string | null | undefined): string {
  return (v || "").trim().toUpperCase();
}
export function vinProblem(v: string | null | undefined): string | null {
  const vin = normalizeVin(v);
  if (!vin) return "VIN is required.";
  if (/[IOQ]/.test(vin)) return "A VIN never contains the letters I, O or Q.";
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return "VIN must be exactly 17 letters and numbers.";
  return null;
}

/** Best tier first: Tier 1+ = 0, Tier 1 = 1 … Tier 5+ = 5. Null when the text isn't a recognizable tier. */
export function creditTierRank(tier: string | null | undefined): number | null {
  const m = /^\s*tier\s*(\d)\s*(\+)?\s*$/i.exec(tier || "");
  if (!m) return null;
  const n = Number(m[1]);
  return n === 1 && m[2] ? 0 : n;
}
/** The worst tier that still honors each stated buyer band. */
const BAND_WORST_TIER_RANK: Record<CreditBand, number> = { excellent: 1, good: 2, fair: 3, rebuilding: 4 };
/** True when the dealer priced at a tier below what the buyer stated (an unrecognized tier or no band never flags). */
export function pricedAtLowerTier(tier: string | null | undefined, band: CreditBand | null | undefined): boolean {
  const r = creditTierRank(tier);
  return r != null && band != null && r > BAND_WORST_TIER_RANK[band];
}

/** Itemized, always — a single unlabeled lump is not a quote. */
export interface DueAtSigning {
  firstMonth: number;
  acquisitionFee: number;
  capReduction: number;
  taxes: number;
  /** Dealer and government fee lines due at signing (each carries its category). */
  otherFees: LineItem[];
  /** Refundable at lease end; counted in due at signing. Unset on pre-v2 quotes. */
  securityDeposit?: number;
  /** Add-ons due at signing (derived server-side from `addOns` with timing "signing"). */
  addOnsDue?: LineItem[];
}

export interface CounterOffer {
  counterOffer: boolean;
  /** Required when term or miles differ from the buyer's prefs. */
  note: string;
}

export interface LeaseQuote {
  capCost: number;
  residualPercent: number;
  residualAmount: number;
  moneyFactor: number;
  termMonths: number;
  milesPerYear: number;
  capReduction: number;
  monthlyPaymentPreTax: number;
  /** Null when the dealer can't estimate tax — shown as "tax estimated at signing". */
  monthlyPaymentWithEstTax: number | null;
  dueAtSigning: DueAtSigning;
  incentives: LineItem[];
  addOns: LineItem[];
  /** ISO timestamp; must be in the future when submitted. */
  expiresAt: string;
  notes?: string | null;
  counter: CounterOffer;
  // --- v2 (optional on the type so stored pre-v2 quotes still read; required by validateLeaseQuote) ---
  sellingPrice?: number;
  /** The MSRP the residual % is a share of (some lenders use an adjusted MSRP). */
  msrpForResidual?: number;
  /** Set server-side: the residual dollars don't match MSRP × residual % (beyond rounding). */
  residualEnteredDirectly?: boolean;
  lenderType?: LenderType;
  lenderName?: string;
  creditTierAssumed?: string;
  taxMethod?: LeaseTaxMethod;
  taxMethodOther?: string | null;
  vehicleStatus?: VehicleStatus;
  /** YYYY-MM-DD; required unless in stock. */
  etaDate?: string | null;
  securityDeposit?: number;
  /** End-of-lease cost. */
  dispositionFee?: number;
  /** End-of-lease cost, $ per mile over the allowance. */
  excessMileagePerMile?: number;
  /** Required when the net cap cost differs from the calculated one. */
  netCapOverrideReason?: string | null;
  incentiveAttested?: boolean;
  /** Fee lines rolled into the cap cost (not due at signing). */
  rolledFees?: LineItem[];
  /** The acquisition fee, when it is rolled into the cap cost (then dueAtSigning.acquisitionFee is 0). */
  acquisitionFeeRolled?: number;
  /** Set server-side: (monthly with tax × term) + due at signing − first month + disposition fee. */
  totalLeaseCost?: number | null;
}

/** A desk on the invite list, as the buyer sees it — masked, never a cleartext address or phone. */
export interface LeaseInvitee {
  inviteId: string | null;
  deskId: string | null;
  dealerName: string;
  city: string | null;
  state: string | null;
  contactName: string | null;
  role: string | null;
  emailMasked: string | null;
  contactReady: boolean;
  checked: boolean;
}

export function aprFromMoneyFactor(mf: number): number {
  return Math.round(mf * 2400 * 100) / 100;
}

export function dueAtSigningTotal(d: DueAtSigning): number {
  const other = (d.otherFees || []).reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const addOnsDue = (d.addOnsDue || []).reduce((t, f) => t + (Number(f.amount) || 0), 0);
  return (Number(d.firstMonth) || 0) + (Number(d.acquisitionFee) || 0) + (Number(d.capReduction) || 0) + (Number(d.taxes) || 0) + other + (Number(d.securityDeposit) || 0) + addOnsDue;
}

/** Dealer vs government fee subtotals over every fee line, due at signing and rolled (a line with no category is a dealer fee). */
export function feeSubtotals(q: Pick<LeaseQuote, "dueAtSigning" | "rolledFees">): { dealer: number; government: number; dealerLines: LineItem[]; governmentLines: LineItem[] } {
  const all = [...(q.dueAtSigning?.otherFees || []).map((f) => ({ ...f, timing: f.timing ?? ("signing" as const) })), ...(q.rolledFees || []).map((f) => ({ ...f, timing: "rolled" as const }))];
  const dealerLines = all.filter((f) => f.category !== "government");
  const governmentLines = all.filter((f) => f.category === "government");
  return { dealer: sumItems(dealerLines), government: sumItems(governmentLines), dealerLines, governmentLines };
}

/** Total lease cost for a stored quote — the server-set figure, else derived the same way (pre-v2 quotes: no disposition fee). */
export function leaseTotalCostOf(q: LeaseQuote): number | null {
  if (typeof q.totalLeaseCost === "number" && Number.isFinite(q.totalLeaseCost)) return q.totalLeaseCost;
  return totalLeaseCostOf(q.monthlyPaymentWithEstTax ?? q.monthlyPaymentPreTax, q.termMonths, q.dueAtSigning, q.dispositionFee ?? 0);
}

export interface LeaseValidation {
  /** Blocks submission. */
  errors: string[];
  /** Shown, never blocks. */
  warnings: string[];
}

const pos = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonneg = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const MS_DAY = 86_400_000;

/** Fee-line and add-on-line attributes a v2 quote must carry on every line. */
function lineAttributeErrors(label: string, list: LineItem[] | undefined, o: { category?: boolean; timing?: "signing" | "rolled" | "either" }): string[] {
  const out: string[] = [];
  for (const f of list || []) {
    if (!f) continue;
    const who = (f.name || "").trim() || `A ${label.toLowerCase()} line`;
    if (typeof f.taxable !== "boolean") out.push(`${who}: say whether it is taxable.`);
    if (o.category && !(FEE_CATEGORIES as readonly unknown[]).includes(f.category)) out.push(`${who}: mark it a dealer fee or a government fee.`);
    if (o.timing === "either" ? !(LINE_TIMINGS as readonly unknown[]).includes(f.timing) : o.timing && f.timing !== o.timing) out.push(`${who}: choose due at signing or rolled into the cap cost.`);
  }
  return out;
}

/**
 * The submit gate, mirrored on the dealer form and the server. Blocks on
 * anything a buyer couldn't compare on; warns on the merely unusual.
 *
 * Strict (the default) is the v2 dealer contract: MSRP, lender, credit tier,
 * tax method, vehicle status, security deposit, disposition fee, excess mileage
 * charge and a good-through date are all required, and the VIN must be a real
 * 17-character VIN. `legacy: true` is only for a BUYER logging a quote a dealer
 * gave by phone or email (they can't know the lender or tax method): it keeps
 * the pre-v2 rules.
 */
export function validateLeaseQuote(
  q: Partial<LeaseQuote>,
  prefs: Pick<LeaseRequestPrefs, "termMonths" | "milesPerYear">,
  vinOrStock: { vin?: string | null; stockNumber?: string | null },
  now: Date = new Date(),
  opts: { legacy?: boolean } = {}
): LeaseValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strict = !opts.legacy;

  if (strict) {
    const vp = vinProblem(vinOrStock.vin);
    if (vp) errors.push(vp);
  } else if (!(vinOrStock.vin || "").trim() && !(vinOrStock.stockNumber || "").trim()) errors.push("VIN or stock number is required.");
  if (!pos(q.capCost)) errors.push("Cap cost must be greater than 0.");
  if (strict && !pos(q.msrpForResidual)) errors.push("MSRP used for residual is required.");
  if (!(typeof q.residualPercent === "number" && q.residualPercent > 0 && q.residualPercent <= 100)) errors.push("Residual % must be greater than 0 and at most 100.");
  else if (q.residualPercent < 20 || q.residualPercent > 85) warnings.push(`Residual ${q.residualPercent}% is outside the usual 20–85% range — double-check it.`);
  if (!nonneg(q.residualAmount)) errors.push("Residual amount is required (0 or more).");
  if (q.residualEnteredDirectly) warnings.push(`Residual amount doesn't match MSRP × residual % — the buyer will see "${RESIDUAL_ENTERED_DIRECTLY_NOTE}".`);
  if (!pos(q.moneyFactor)) errors.push("Money factor is required and must be greater than 0.");
  else if (q.moneyFactor! < 0.00001 || q.moneyFactor! > 0.01) warnings.push(`Money factor ${q.moneyFactor} (${aprFromMoneyFactor(q.moneyFactor!)}% APR) is outside the usual 0.00001–0.01 range — confirm it's the factor, not a percent or an APR.`);
  if (!pos(q.termMonths)) errors.push("Term (months) is required.");
  if (!pos(q.milesPerYear)) errors.push("Miles per year is required.");
  if (!nonneg(q.capReduction)) errors.push("Cap reduction is required (0 or more).");
  if (!pos(q.monthlyPaymentPreTax)) errors.push("Monthly payment (pre-tax) must be greater than 0.");
  if (q.monthlyPaymentWithEstTax != null && !pos(q.monthlyPaymentWithEstTax)) errors.push("Monthly payment with estimated tax must be greater than 0 when given.");

  const d = q.dueAtSigning;
  if (!d) errors.push("Due at signing must be itemized: first month, acquisition fee, cap reduction, taxes, other fees.");
  else {
    const parts = [d.firstMonth, d.acquisitionFee, d.capReduction, d.taxes];
    if (!parts.every(nonneg)) errors.push("Each due-at-signing line must be a number (0 or more).");
    const other = Array.isArray(d.otherFees) ? d.otherFees : [];
    if (!other.every((f) => f && typeof f.name === "string" && nonneg(f.amount))) errors.push("Every other fee needs a name and an amount.");
    const labeledLines = parts.filter((n) => nonneg(n) && n > 0).length + other.filter((f) => f && f.amount > 0).length;
    // One positive "other" line with a vague name and nothing else itemized is the lump we refuse.
    if (labeledLines === 1 && other.length === 1 && other[0].amount > 0 && /^(due|total|dueatsigning|das|down|other|misc|fees?)$/i.test((other[0].name || "").replace(/[^a-z]/gi, ""))) {
      errors.push("Due at signing can't be a single unlabeled lump — itemize first month, acquisition fee, cap reduction, taxes and fees.");
    }
    if (pos(q.monthlyPaymentPreTax) && dueAtSigningTotal(d) > 2 * q.monthlyPaymentPreTax!) warnings.push("Due at signing is more than twice the monthly payment — make sure that's intended.");
    if (other.some((f) => f && f.amount > 0 && (f.name || "").trim().length < 4)) warnings.push("Some fees have unclear names — buyers compare these line by line.");
    if (strict) {
      errors.push(...lineAttributeErrors("Fee", other, { category: true, timing: "signing" }));
    }
  }
  for (const [label, list] of [["Incentive", q.incentives], ["Add-on", q.addOns], ["Rolled fee", q.rolledFees]] as const) {
    if (list && !list.every((f) => f && typeof f.name === "string" && Number.isFinite(f.amount))) errors.push(`${label}s need a name and an amount.`);
    if (label === "Add-on" && list?.some((f) => f && f.amount > 0 && (f.name || "").trim().length < 4)) warnings.push("Add-ons without clear names — the buyer will see them line by line.");
  }

  if (strict) {
    errors.push(...lineAttributeErrors("Rolled fee", q.rolledFees, { category: true, timing: "rolled" }));
    errors.push(...lineAttributeErrors("Add-on", q.addOns, { timing: "either" }));
    for (const a of q.addOns || []) if (a && typeof a.removable !== "boolean") errors.push(`${(a.name || "").trim() || "An add-on"}: say whether it is removable at the buyer's request.`);

    // Incentives: each priced line says who qualifies; the dealer attests once.
    const priced = (q.incentives || []).filter((i) => i && i.amount > 0);
    for (const i of priced) if (!(INCENTIVE_ELIGIBILITY_TYPES as readonly unknown[]).includes(i.eligibilityType)) errors.push(`${(i.name || "").trim() || "An incentive"}: choose who it is open to.`);
    if (priced.length && q.incentiveAttested !== true) errors.push("Confirm the incentive attestation: " + INCENTIVE_ATTESTATION_COPY);

    // Net cap cost: editable, but a figure that differs from the calculation needs a reason.
    if (!pos(q.sellingPrice)) errors.push("Selling price is required.");
    else if (pos(q.capCost) && nonneg(q.capReduction)) {
      const calc = calcNetCap({
        sellingPrice: q.sellingPrice!, incentivesTotal: sumItems(q.incentives || []), rolledFeesTotal: sumItems(q.rolledFees || []),
        rolledAddOnsTotal: sumItems((q.addOns || []).filter((a) => a.timing === "rolled")), acquisitionRolled: q.acquisitionFeeRolled ?? 0, capReduction: q.capReduction!,
      });
      const entered = q.capCost! - q.capReduction!;
      if (calc != null && Math.abs(entered - calc) > 0.5 && (q.netCapOverrideReason || "").trim().length < 3) errors.push("Net cap cost differs from the calculated figure — add a short reason.");
    }

    // Lender, tier, tax method.
    if (!(LENDER_TYPES as readonly unknown[]).includes(q.lenderType)) errors.push("Lender is required.");
    else if (!(q.lenderName || "").trim()) errors.push(q.lenderType === "bank" ? "Enter the bank or credit union name." : q.lenderType === "other" ? "Enter the lender name." : "Lender is required.");
    if (!(q.creditTierAssumed || "").trim()) errors.push("Credit tier assumed for the money factor is required.");
    if (!(LEASE_TAX_METHODS as readonly unknown[]).includes(q.taxMethod)) errors.push("Tax method is required.");
    else if (q.taxMethod === "other" && !(q.taxMethodOther || "").trim()) errors.push("Describe the tax method you used.");

    // Vehicle status.
    if (!(VEHICLE_STATUSES as readonly unknown[]).includes(q.vehicleStatus)) errors.push("Vehicle status is required.");
    else if (q.vehicleStatus !== "in_stock") {
      const eta = q.etaDate ? new Date(`${q.etaDate}T23:59:59Z`) : null;
      if (!eta || Number.isNaN(eta.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(q.etaDate || "")) errors.push("An ETA date is required unless the vehicle is in stock.");
      else if (eta.getTime() < now.getTime() - MS_DAY) errors.push("The ETA can't be in the past.");
    }

    // End-of-lease and deposit amounts: required, $0 allowed.
    if (!nonneg(q.securityDeposit ?? q.dueAtSigning?.securityDeposit)) errors.push("Security deposit is required ($0 is fine).");
    if (!nonneg(q.dispositionFee)) errors.push("Disposition fee is required ($0 is fine).");
    if (!nonneg(q.excessMileagePerMile)) errors.push("Excess mileage charge ($ per mile) is required ($0 is fine).");
  }

  // Good-through: required on a dealer quote, today or later, and no more than 45 days out. A legacy (buyer-logged) quote may omit it.
  if (q.expiresAt) {
    const t = new Date(q.expiresAt).getTime();
    if (Number.isNaN(t)) errors.push("The expiry date isn't a valid date.");
    else if (t <= now.getTime()) errors.push("The expiry date must be today or later.");
    else if (strict && t > now.getTime() + (GOOD_THROUGH_MAX_DAYS + 1) * MS_DAY) errors.push(`The quote can't be good for more than ${GOOD_THROUGH_MAX_DAYS} days.`);
  } else if (strict) errors.push("Quote good through is required.");

  const termDiffers = pos(q.termMonths) && q.termMonths !== prefs.termMonths;
  const milesDiffers = pos(q.milesPerYear) && q.milesPerYear !== prefs.milesPerYear;
  if (termDiffers || milesDiffers) {
    if (!q.counter?.counterOffer) errors.push(`Term/miles differ from the buyer's ${prefs.termMonths} mo / ${prefs.milesPerYear.toLocaleString()} mi — mark it as a counter-offer to submit.`);
    else if (!(q.counter.note || "").trim()) errors.push("A counter-offer needs a short note saying why.");
  }
  return { errors, warnings };
}

/** True when the quote's term or miles differ from what the buyer asked for. */
export function isCounter(q: Pick<LeaseQuote, "termMonths" | "milesPerYear">, prefs: Pick<LeaseRequestPrefs, "termMonths" | "milesPerYear">): boolean {
  return q.termMonths !== prefs.termMonths || q.milesPerYear !== prefs.milesPerYear;
}

export function isExpired(q: { expiresAt?: string | null }, now: Date = new Date()): boolean {
  // No offer date means the dealer gave no end date: never expired by the clock.
  if (!q.expiresAt) return false;
  const t = new Date(q.expiresAt).getTime();
  return Number.isNaN(t) || t <= now.getTime();
}

const ENUM = <T extends string>(list: readonly T[], v: unknown): T | undefined => ((list as readonly unknown[]).includes(v) ? (v as T) : undefined);

/** Coerce a form / JSON body into a LeaseQuote shape (numbers as numbers, lists as lists). Validation decides what's usable. */
export function coerceLeaseQuote(raw: Record<string, unknown>): Partial<LeaseQuote> {
  const num = (v: unknown): number | undefined => {
    if (v === "" || v == null) return undefined;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
  const items = (v: unknown): LineItem[] =>
    Array.isArray(v)
      ? v.filter((x) => x && typeof x === "object").map((x) => {
          const o = x as Record<string, unknown>;
          const item: LineItem = { name: String(o.name ?? "").trim(), amount: num(o.amount) ?? NaN };
          const category = ENUM(FEE_CATEGORIES, o.category);
          const timing = ENUM(LINE_TIMINGS, o.timing);
          const eligibilityType = ENUM(INCENTIVE_ELIGIBILITY_TYPES, o.eligibilityType);
          if (category) item.category = category;
          if (bool(o.taxable) !== undefined) item.taxable = o.taxable as boolean;
          if (timing) item.timing = timing;
          if (eligibilityType) item.eligibilityType = eligibilityType;
          if (str(o.eligibilityProof, 120)) item.eligibilityProof = str(o.eligibilityProof, 120);
          if (bool(o.removable) !== undefined) item.removable = o.removable as boolean;
          return item;
        })
      : [];
  const d = (raw.dueAtSigning || {}) as Record<string, unknown>;
  const c = (raw.counter || {}) as Record<string, unknown>;
  const lenderType = ENUM(LENDER_TYPES, raw.lenderType);
  const status = ENUM(VEHICLE_STATUSES, raw.vehicleStatus);
  const taxMethod = ENUM(LEASE_TAX_METHODS, raw.taxMethod);
  const quote: Partial<LeaseQuote> = {
    capCost: num(raw.capCost),
    sellingPrice: num(raw.sellingPrice),
    msrpForResidual: num(raw.msrpForResidual),
    residualPercent: num(raw.residualPercent),
    residualAmount: num(raw.residualAmount),
    moneyFactor: num(raw.moneyFactor),
    termMonths: num(raw.termMonths),
    milesPerYear: num(raw.milesPerYear),
    capReduction: num(raw.capReduction),
    monthlyPaymentPreTax: num(raw.monthlyPaymentPreTax),
    monthlyPaymentWithEstTax: raw.monthlyPaymentWithEstTax === "" || raw.monthlyPaymentWithEstTax == null ? null : num(raw.monthlyPaymentWithEstTax) ?? null,
    dueAtSigning: raw.dueAtSigning
      ? { firstMonth: num(d.firstMonth) ?? NaN, acquisitionFee: num(d.acquisitionFee) ?? NaN, capReduction: num(d.capReduction) ?? NaN, taxes: num(d.taxes) ?? NaN, otherFees: items(d.otherFees), ...(num(d.securityDeposit) !== undefined ? { securityDeposit: num(d.securityDeposit) } : {}) }
      : undefined,
    incentives: items(raw.incentives),
    addOns: items(raw.addOns),
    rolledFees: items(raw.rolledFees),
    acquisitionFeeRolled: num(raw.acquisitionFeeRolled),
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim().slice(0, 1000) : null,
    counter: { counterOffer: Boolean(c.counterOffer), note: typeof c.note === "string" ? c.note.trim().slice(0, 300) : "" },
    lenderType,
    lenderName: str(raw.lenderName, 80),
    creditTierAssumed: str(raw.creditTierAssumed, 40),
    taxMethod,
    taxMethodOther: str(raw.taxMethodOther, 200) || null,
    vehicleStatus: status,
    etaDate: status && status !== "in_stock" && typeof raw.etaDate === "string" ? raw.etaDate.trim().slice(0, 10) : null,
    securityDeposit: num(raw.securityDeposit) ?? num(d.securityDeposit),
    dispositionFee: num(raw.dispositionFee),
    excessMileagePerMile: num(raw.excessMileagePerMile),
    netCapOverrideReason: str(raw.netCapOverrideReason, 200) || null,
    incentiveAttested: raw.incentiveAttested === true,
  };
  return finalizeLeaseQuote(quote);
}

/**
 * Server-authoritative derived fields, so the buyer's compare never trusts the
 * browser for them: "Residual entered directly", the add-ons due at signing,
 * the security deposit mirrored into due at signing, and the total lease cost.
 */
export function finalizeLeaseQuote(q: Partial<LeaseQuote>): Partial<LeaseQuote> {
  const fromMsrp = residualAmountFrom(q.msrpForResidual ?? null, q.residualPercent ?? null);
  if (fromMsrp != null && typeof q.residualAmount === "number") q.residualEnteredDirectly = Math.abs(q.residualAmount - fromMsrp) > 1;
  else delete q.residualEnteredDirectly;
  if (q.dueAtSigning) {
    if (q.securityDeposit !== undefined) q.dueAtSigning.securityDeposit = q.securityDeposit;
    const due = (q.addOns || []).filter((a) => a.timing === "signing" && Number.isFinite(a.amount));
    q.dueAtSigning.addOnsDue = due;
  }
  const q2 = q as LeaseQuote;
  const total = q.dueAtSigning && pos(q.termMonths) && pos(q.monthlyPaymentPreTax) ? totalLeaseCostOf(q2.monthlyPaymentWithEstTax ?? q2.monthlyPaymentPreTax, q2.termMonths, q2.dueAtSigning, q.dispositionFee ?? 0) : null;
  q.totalLeaseCost = total;
  return q;
}

/** Human line for the compare table's term/miles cell. */
export function termMilesLabel(termMonths: number, milesPerYear: number): string {
  return `${termMonths} mo · ${milesPerYear.toLocaleString()} mi/yr`;
}

/** Copy the buyer sees for the calculator, never numbers we didn't get from the dealer. */
export const LEASE_NON_BINDING_COPY =
  "This is a non-binding lease quote request — not an auction, not a bid, and no response deadline. The dealer replies through TrimScout's lease calculator on their own time; you compare and pick one, or walk away.";
