/**
 * Per-VIN cash / finance / lease inputs and simple estimated payments.
 * Estimates are not quotes — they exist so columns can be compared.
 */

import { advertisedOrStickerPrice } from "./fordCompetitionUi";
import { DEAL_STRUCTURE_METHODS, FINANCE_TERM_MONTHS, LEASE_TERM_MONTHS } from "./dealStructure";
import type {
  CashDealTerms,
  DealStructureMethod,
  DealStructurePreferences,
  FinanceDealTerms,
  LeaseDealTerms,
  Vehicle,
  VehicleDealTerms,
} from "./types";

export const DEFAULT_FINANCE_APR_PERCENT = 6.9;
export const DEFAULT_LEASE_MONEY_FACTOR = 0.0025;
export const DEFAULT_LEASE_RESIDUAL_PERCENT = 55;
export const DEFAULT_LEASE_ACQUISITION_FEE = 895;
export const DEFAULT_LEASE_DISPOSITION_FEE = 395;
export const DEFAULT_LEASE_SALES_TAX_PERCENT = 8;
export const LEASE_TAX_METHODS = ["monthly", "upfront"] as const;
export type LeaseTaxMethod = (typeof LEASE_TAX_METHODS)[number];

export function advertisedPriceForTerms(vehicle: Pick<Vehicle, "dealerPrice" | "msrp">): number | null {
  return advertisedOrStickerPrice(vehicle.dealerPrice, vehicle.msrp).amount;
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function clampTerm(value: number | null | undefined, allowed: readonly number[], fallback: number): number {
  if (value != null && allowed.includes(value)) return value;
  return fallback;
}

export function estimatedFinanceMonthly(
  sellingPrice: number,
  downPayment: number,
  termMonths: number,
  aprPercent: number
): number | null {
  const principal = sellingPrice - downPayment;
  if (!(principal > 0) || !(termMonths > 0) || !Number.isFinite(aprPercent) || aprPercent < 0) return null;
  const monthlyRate = aprPercent / 100 / 12;
  if (monthlyRate === 0) return principal / termMonths;
  const pow = (1 + monthlyRate) ** termMonths;
  return (principal * (monthlyRate * pow)) / (pow - 1);
}

export function estimatedLeaseMonthly(
  capCost: number,
  residualPercent: number,
  termMonths: number,
  moneyFactor: number
): number | null {
  if (!(capCost > 0) || !(termMonths > 0)) return null;
  if (!Number.isFinite(residualPercent) || residualPercent < 0) return null;
  if (!Number.isFinite(moneyFactor) || moneyFactor < 0) return null;
  const residual = capCost * (residualPercent / 100);
  const depreciation = (capCost - residual) / termMonths;
  const rentCharge = (capCost + residual) * moneyFactor;
  return depreciation + rentCharge;
}

export interface LeaseEstimate {
  /** Cap cost after rebates, acquisition fee, and cap cost reduction. */
  netCapCost: number;
  residualValue: number;
  depreciationFee: number;
  rentCharge: number;
  /** Depreciation + rent charge, before tax. */
  baseMonthly: number;
  monthlyTax: number;
  /** What the payment actually is, tax included when taxed monthly. */
  totalMonthly: number;
  /** Tax paid upfront instead of monthly, when taxMethod is "upfront". */
  upfrontTax: number;
  /** Cap cost reduction + first month's payment + any upfront tax. */
  estimatedDueAtSigning: number;
}

/**
 * Detailed lease breakdown: rolls the acquisition fee into cap cost, nets
 * out rebates and any cap cost reduction, then applies sales tax either to
 * each monthly payment (most states) or once upfront on the cap cost.
 */
export function calculateLeaseEstimate(lease: LeaseDealTerms): LeaseEstimate | null {
  const rebates = lease.rebates ?? 0;
  const acquisitionFee = lease.acquisitionFee ?? DEFAULT_LEASE_ACQUISITION_FEE;
  const capCostReduction = lease.dueAtSigning || 0;
  const taxRate = (lease.salesTaxPercent ?? DEFAULT_LEASE_SALES_TAX_PERCENT) / 100;
  const taxMethod: LeaseTaxMethod = lease.taxMethod === "upfront" ? "upfront" : "monthly";

  const netCapCost = lease.capCost - capCostReduction + acquisitionFee - rebates;
  const baseMonthly = estimatedLeaseMonthly(netCapCost, lease.residualPercent, lease.termMonths, lease.moneyFactor);
  if (baseMonthly == null) return null;

  const residualValue = netCapCost * (lease.residualPercent / 100);
  const depreciationFee = (netCapCost - residualValue) / lease.termMonths;
  const rentCharge = (netCapCost + residualValue) * lease.moneyFactor;

  const monthlyTax = taxMethod === "monthly" ? baseMonthly * taxRate : 0;
  const totalMonthly = baseMonthly + monthlyTax;
  const upfrontTax = taxMethod === "upfront" ? netCapCost * taxRate : 0;
  const estimatedDueAtSigning = capCostReduction + totalMonthly + upfrontTax;

  return {
    netCapCost,
    residualValue,
    depreciationFee,
    rentCharge,
    baseMonthly,
    monthlyTax,
    totalMonthly,
    upfrontTax,
    estimatedDueAtSigning,
  };
}

export function roundEstimateDollars(amount: number | null): number | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount);
}

export function parseVehicleDealTerms(raw: unknown): VehicleDealTerms | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const vin = typeof row.vin === "string" ? row.vin.trim().toUpperCase() : "";
  if (vin.length !== 17) return null;

  const cashRaw = row.cash && typeof row.cash === "object" ? (row.cash as Record<string, unknown>) : null;
  const financeRaw =
    row.finance && typeof row.finance === "object" ? (row.finance as Record<string, unknown>) : null;
  const leaseRaw = row.lease && typeof row.lease === "object" ? (row.lease as Record<string, unknown>) : null;

  const cash: CashDealTerms | undefined = (() => {
    const offerPrice = asPositiveNumber(cashRaw?.offerPrice);
    if (offerPrice == null) return undefined;
    return { offerPrice };
  })();

  const finance: FinanceDealTerms | undefined = (() => {
    if (!financeRaw) return undefined;
    const sellingPrice = asPositiveNumber(financeRaw.sellingPrice);
    if (sellingPrice == null) return undefined;
    return {
      sellingPrice,
      downPayment: asPositiveNumber(financeRaw.downPayment) ?? 0,
      termMonths: clampTerm(asPositiveNumber(financeRaw.termMonths), FINANCE_TERM_MONTHS, 60),
      aprPercent: asPositiveNumber(financeRaw.aprPercent) ?? DEFAULT_FINANCE_APR_PERCENT,
    };
  })();

  const lease: LeaseDealTerms | undefined = (() => {
    if (!leaseRaw) return undefined;
    const capCost = asPositiveNumber(leaseRaw.capCost);
    if (capCost == null) return undefined;
    return {
      capCost,
      dueAtSigning: asPositiveNumber(leaseRaw.dueAtSigning) ?? 0,
      termMonths: clampTerm(asPositiveNumber(leaseRaw.termMonths), LEASE_TERM_MONTHS, 36),
      milesPerYear: asPositiveNumber(leaseRaw.milesPerYear) ?? 12000,
      moneyFactor: asPositiveNumber(leaseRaw.moneyFactor) ?? DEFAULT_LEASE_MONEY_FACTOR,
      residualPercent: asPositiveNumber(leaseRaw.residualPercent) ?? DEFAULT_LEASE_RESIDUAL_PERCENT,
      rebates: asPositiveNumber(leaseRaw.rebates) ?? 0,
      acquisitionFee: asPositiveNumber(leaseRaw.acquisitionFee) ?? DEFAULT_LEASE_ACQUISITION_FEE,
      dispositionFee: asPositiveNumber(leaseRaw.dispositionFee) ?? DEFAULT_LEASE_DISPOSITION_FEE,
      salesTaxPercent: asPositiveNumber(leaseRaw.salesTaxPercent) ?? DEFAULT_LEASE_SALES_TAX_PERCENT,
      taxMethod: leaseRaw.taxMethod === "upfront" ? "upfront" : "monthly",
    };
  })();

  return { vin, cash, finance, lease };
}

export function parseVehicleTermsList(raw: unknown): VehicleDealTerms[] {
  if (!Array.isArray(raw)) return [];
  const out: VehicleDealTerms[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const parsed = parseVehicleDealTerms(row);
    if (!parsed || seen.has(parsed.vin)) continue;
    seen.add(parsed.vin);
    out.push(parsed);
  }
  return out;
}

export function defaultVehicleDealTerms(
  vehicle: Pick<Vehicle, "vin" | "dealerPrice" | "msrp">,
  prefs: Pick<
    DealStructurePreferences,
    "requestedStructures" | "financeTermMonths" | "downPayment" | "leaseMileagePerYear" | "leaseTermMonths"
  >
): VehicleDealTerms {
  const vin = vehicle.vin.trim().toUpperCase();
  const price = advertisedPriceForTerms(vehicle) ?? 0;
  const requested = DEAL_STRUCTURE_METHODS.filter((method) => prefs.requestedStructures.includes(method));
  const down = prefs.downPayment ?? 0;
  const terms: VehicleDealTerms = { vin };
  if (requested.includes("cash")) {
    terms.cash = { offerPrice: price };
  }
  if (requested.includes("finance")) {
    terms.finance = {
      sellingPrice: price,
      downPayment: down,
      termMonths: clampTerm(prefs.financeTermMonths, FINANCE_TERM_MONTHS, 60),
      aprPercent: DEFAULT_FINANCE_APR_PERCENT,
    };
  }
  if (requested.includes("lease")) {
    terms.lease = {
      capCost: price,
      dueAtSigning: down,
      termMonths: clampTerm(prefs.leaseTermMonths, LEASE_TERM_MONTHS, 36),
      milesPerYear: prefs.leaseMileagePerYear ?? 12000,
      moneyFactor: DEFAULT_LEASE_MONEY_FACTOR,
      residualPercent: DEFAULT_LEASE_RESIDUAL_PERCENT,
      rebates: 0,
      acquisitionFee: DEFAULT_LEASE_ACQUISITION_FEE,
      dispositionFee: DEFAULT_LEASE_DISPOSITION_FEE,
      salesTaxPercent: DEFAULT_LEASE_SALES_TAX_PERCENT,
      taxMethod: "monthly",
    };
  }
  return terms;
}

export function defaultTermsForVehicles(
  vehicles: Array<Pick<Vehicle, "vin" | "dealerPrice" | "msrp">>,
  prefs: Pick<
    DealStructurePreferences,
    "requestedStructures" | "financeTermMonths" | "downPayment" | "leaseMileagePerYear" | "leaseTermMonths"
  >
): VehicleDealTerms[] {
  const out: VehicleDealTerms[] = [];
  const seen = new Set<string>();
  for (const vehicle of vehicles) {
    const vin = (vehicle.vin || "").trim().toUpperCase();
    if (vin.length !== 17 || seen.has(vin)) continue;
    seen.add(vin);
    out.push(defaultVehicleDealTerms({ ...vehicle, vin }, prefs));
  }
  return out;
}

/** Keep existing per-VIN edits; seed missing VINs from that vehicle's own advertised price. */
export function mergeVehicleTerms(
  vehicles: Array<Pick<Vehicle, "vin" | "dealerPrice" | "msrp">>,
  existing: VehicleDealTerms[] | undefined,
  prefs: Pick<
    DealStructurePreferences,
    "requestedStructures" | "financeTermMonths" | "downPayment" | "leaseMileagePerYear" | "leaseTermMonths"
  >
): VehicleDealTerms[] {
  const byVin = new Map((existing || []).map((row) => [row.vin.toUpperCase(), row]));
  return vehicles
    .map((vehicle) => {
      const vin = (vehicle.vin || "").trim().toUpperCase();
      if (vin.length !== 17) return null;
      return byVin.get(vin) || defaultVehicleDealTerms({ ...vehicle, vin }, prefs);
    })
    .filter((row): row is VehicleDealTerms => Boolean(row));
}

export function replaceVehicleTerms(
  list: VehicleDealTerms[],
  next: VehicleDealTerms
): VehicleDealTerms[] {
  const vin = next.vin.toUpperCase();
  let found = false;
  const out = list.map((row) => {
    if (row.vin.toUpperCase() !== vin) return row;
    found = true;
    return { ...next, vin };
  });
  if (!found) out.push({ ...next, vin });
  return out;
}

export function termsForVin(list: VehicleDealTerms[] | undefined, vin: string): VehicleDealTerms | undefined {
  const want = vin.trim().toUpperCase();
  return (list || []).find((row) => row.vin.toUpperCase() === want);
}

export function summarizeVehicleTerms(
  terms: VehicleDealTerms | undefined,
  requested: readonly DealStructureMethod[]
): string[] {
  if (!terms) return [];
  const lines: string[] = [];
  if (requested.includes("cash") && terms.cash) {
    lines.push(`Cash offer ${formatUsd(terms.cash.offerPrice)}`);
  }
  if (requested.includes("finance") && terms.finance) {
    const monthly = roundEstimateDollars(
      estimatedFinanceMonthly(
        terms.finance.sellingPrice,
        terms.finance.downPayment,
        terms.finance.termMonths,
        terms.finance.aprPercent
      )
    );
    lines.push(
      `Finance ${terms.finance.termMonths} mo` + (monthly != null ? ` · est. ${formatUsd(monthly)}/mo` : "")
    );
  }
  if (requested.includes("lease") && terms.lease) {
    const monthly = roundEstimateDollars(calculateLeaseEstimate(terms.lease)?.totalMonthly ?? null);
    lines.push(
      `Lease ${terms.lease.termMonths} mo` + (monthly != null ? ` · est. ${formatUsd(monthly)}/mo` : "")
    );
  }
  return lines;
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
