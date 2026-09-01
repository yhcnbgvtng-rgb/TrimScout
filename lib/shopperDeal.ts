/**
 * Shopper deal-request snapshot: wizard submit → /api/deal-requests →
 * Live Deal Room / tracker. No listings I/O. Never invent a catalog car
 * or dealer when the imported vehicle did not carry one.
 */

import type {
  BiddingRequest,
  DealStructureMethod,
  PaymentMethod,
  TradeInVehicle,
  Vehicle,
  VehicleDealTerms,
} from "./types";
import { DEAL_STRUCTURE_METHODS } from "./dealStructure";
import { parseVehicleTermsList } from "./dealTerms";
import { listingVdpHref } from "./fordCompetitionUi";
import { deserializeDealVehicle, serializeDealVehicle } from "./offerCompare";

export function offerPathLabel(directOffer: boolean | undefined): string {
  return directOffer ? "Offer this dealer directly" : "Get prices from other dealers";
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseDealStructure(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function requestedStructuresFrom(
  ds: Record<string, unknown>,
  paymentMethod: string
): DealStructureMethod[] {
  const raw = ds.requestedStructures;
  if (Array.isArray(raw)) {
    const picked = DEAL_STRUCTURE_METHODS.filter((method) => raw.includes(method));
    if (picked.length) return [...picked];
  }
  if (paymentMethod === "cash" || paymentMethod === "finance" || paymentMethod === "lease") {
    return [paymentMethod];
  }
  return [];
}

/** Opaque JSON stored in deal_structure_json — extra keys the box already persists. */
export function shopperDealStructurePayload(opts: {
  requestedStructures: DealStructureMethod[];
  financeTermMonths: number;
  downPayment: number;
  leaseMileagePerYear: number;
  leaseTermMonths: number;
  directOffer: boolean;
  vehicle: Pick<Vehicle, "dealerUrl"> & { location?: Vehicle["location"] };
  mustHavePackages: string[];
  otherLots?: Vehicle[];
  vehicleTerms?: VehicleDealTerms[];
}): Record<string, unknown> {
  const loc = opts.vehicle.location;
  const dealerName = (loc?.dealerName || "").trim();
  const dealerCity = (loc?.city || "").trim();
  const dealerState = (loc?.state || "").trim();
  const dealerZip = (loc?.zip || "").trim();
  const dealerUrl = listingVdpHref(opts.vehicle.dealerUrl) || undefined;
  const otherLots = (opts.otherLots || [])
    .map(serializeDealVehicle)
    .filter((lot) => typeof lot.vin === "string" && String(lot.vin).length === 17)
    .slice(0, 2);
  const vehicleTerms = parseVehicleTermsList(opts.vehicleTerms);
  return {
    requestedStructures: opts.requestedStructures,
    financeTermMonths: opts.financeTermMonths,
    downPayment: opts.downPayment,
    leaseMileagePerYear: opts.leaseMileagePerYear,
    leaseTermMonths: opts.leaseTermMonths,
    directOffer: opts.directOffer,
    mustHavePackages: opts.mustHavePackages,
    ...(dealerName ? { dealerName } : {}),
    ...(dealerCity ? { dealerCity } : {}),
    ...(dealerState ? { dealerState } : {}),
    ...(dealerZip ? { dealerZip } : {}),
    ...(dealerUrl ? { dealerUrl } : {}),
    ...(otherLots.length ? { otherLots } : {}),
    ...(vehicleTerms.length ? { vehicleTerms } : {}),
  };
}

function mapTradeIn(raw: unknown, existing?: TradeInVehicle): TradeInVehicle | undefined {
  if (raw && typeof raw === "object") {
    const t = raw as Record<string, unknown>;
    if (t.hasTradeIn === false) return undefined;
    const year = asNumber(t.year);
    const make = asString(t.make);
    const model = asString(t.model);
    if (t.hasTradeIn === true || year || make || model) {
      return {
        hasTradeIn: true,
        year: year || 0,
        make,
        model,
        trim: asString(t.trim),
        mileage: asNumber(t.mileage) || 0,
        vin: asString(t.vin) || undefined,
        condition: (asString(t.condition) as TradeInVehicle["condition"]) || "good",
        estimatedValueMin: asNumber(t.estimatedValueMin) || 0,
        estimatedValueMax: asNumber(t.estimatedValueMax) || 0,
        photos: Array.isArray(t.photos) ? (t.photos as TradeInVehicle["photos"]) : [],
      };
    }
  }
  return existing?.hasTradeIn ? existing : undefined;
}

export function mapDealRequestJson(
  dr: Record<string, unknown>,
  existing?: BiddingRequest
): BiddingRequest {
  const ds = parseDealStructure(dr.dealStructure);
  const vin = asString(dr.referenceVin || existing?.targetVin || existing?.targetVehicle?.vin);
  const year = asNumber(dr.referenceYear) ?? existing?.targetVehicle?.year ?? 0;
  const make = asString(dr.referenceMake || existing?.targetVehicle?.make);
  const model = asString(dr.referenceModel || existing?.targetVehicle?.model);
  const trim = asString(dr.referenceTrim || existing?.targetVehicle?.trim);
  const dealerName = asString(ds.dealerName || existing?.targetVehicle?.location?.dealerName);
  const dealerCity = asString(ds.dealerCity || existing?.targetVehicle?.location?.city);
  const dealerState = asString(ds.dealerState || existing?.targetVehicle?.location?.state);
  const dealerZip = asString(ds.dealerZip || existing?.targetVehicle?.location?.zip);
  const dealerUrl =
    listingVdpHref(asString(ds.dealerUrl) || existing?.targetVehicle?.dealerUrl) || undefined;

  const paymentMethodRaw = asString(dr.paymentMethod) || existing?.paymentMethod || "";
  const requestedStructures = requestedStructuresFrom(ds, paymentMethodRaw);
  const paymentMethod = (requestedStructures[0] ||
    (paymentMethodRaw === "finance" || paymentMethodRaw === "lease" || paymentMethodRaw === "cash"
      ? paymentMethodRaw
      : "cash")) as PaymentMethod;
  const directOffer =
    typeof ds.directOffer === "boolean"
      ? ds.directOffer
      : existing?.directOffer ?? dr.strategy === "firm_offer";

  const mustHavePackages = Array.isArray(ds.mustHavePackages)
    ? ds.mustHavePackages.filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    : existing?.flexibleCriteria?.mustHavePackages || [];

  const hasVehicle = Boolean(vin || make || model);
  const targetVehicle: Vehicle | undefined = hasVehicle
    ? {
        id: existing?.targetVehicle?.id || vin || `deal-${String(dr.id || "")}`,
        vin,
        year: year || 0,
        make,
        model,
        trim,
        bodyType: existing?.targetVehicle?.bodyType || "",
        engine: existing?.targetVehicle?.engine || "",
        drivetrain: existing?.targetVehicle?.drivetrain || "",
        transmission: existing?.targetVehicle?.transmission || "",
        exteriorColor: existing?.targetVehicle?.exteriorColor || "",
        interiorColor: existing?.targetVehicle?.interiorColor || "",
        msrp: asNumber(dr.referenceMsrp) ?? existing?.targetVehicle?.msrp ?? 0,
        dealerPrice: asNumber(dr.referencePrice) ?? existing?.targetVehicle?.dealerPrice ?? 0,
        daysOnLot: existing?.targetVehicle?.daysOnLot || 0,
        status: "on_lot",
        location: {
          dealerName,
          city: dealerCity,
          state: dealerState,
          zip: dealerZip || undefined,
          distanceMiles: existing?.targetVehicle?.location?.distanceMiles || 0,
        },
        packages: existing?.targetVehicle?.packages || mustHavePackages,
        options: existing?.targetVehicle?.options || [],
        imageUrl: asString(dr.referenceImageUrl) || existing?.targetVehicle?.imageUrl || "",
        mileage: existing?.targetVehicle?.mileage || 0,
        dealerUrl,
      }
    : existing?.targetVehicle;

  return {
    id: String(dr.id ?? existing?.id ?? ""),
    strategy:
      (asString(dr.strategy) as BiddingRequest["strategy"]) || existing?.strategy || "exact_auction",
    targetVin: vin || undefined,
    targetVehicle,
    flexibleCriteria: {
      make,
      model,
      trims: trim ? [trim] : existing?.flexibleCriteria?.trims || [],
      minMsrp: existing?.flexibleCriteria?.minMsrp,
      maxMsrp: existing?.flexibleCriteria?.maxMsrp,
      mustHavePackages,
      preferredColors: existing?.flexibleCriteria?.preferredColors || [],
      dealbreakers: existing?.flexibleCriteria?.dealbreakers || [],
      allowedStatuses: existing?.flexibleCriteria?.allowedStatuses || ["on_lot", "in_transit"],
    },
    targetOtdPrice: asNumber(dr.targetOtdPrice) ?? existing?.targetOtdPrice,
    targetDiscountPercent: asNumber(dr.targetDiscountPercent) ?? existing?.targetDiscountPercent,
    paymentMethod,
    dealStructurePreferences: {
      requestedStructures,
      financeTermMonths:
        asNumber(ds.financeTermMonths) ?? existing?.dealStructurePreferences?.financeTermMonths,
      downPayment: asNumber(ds.downPayment) ?? existing?.dealStructurePreferences?.downPayment,
      leaseMileagePerYear:
        asNumber(ds.leaseMileagePerYear) ?? existing?.dealStructurePreferences?.leaseMileagePerYear,
      leaseTermMonths:
        asNumber(ds.leaseTermMonths) ?? existing?.dealStructurePreferences?.leaseTermMonths,
      vehicleTerms: (() => {
        const mapped = parseVehicleTermsList(ds.vehicleTerms);
        return mapped.length ? mapped : existing?.dealStructurePreferences?.vehicleTerms;
      })(),
    },
    otherLots: (() => {
      if (Array.isArray(ds.otherLots)) {
        return ds.otherLots
          .map(deserializeDealVehicle)
          .filter((v): v is Vehicle => Boolean(v))
          .slice(0, 2);
      }
      return existing?.otherLots;
    })(),
    buyerZip: asString(dr.buyerZip) || existing?.buyerZip || "",
    buyerState: asString(dr.buyerState) || existing?.buyerState || "",
    searchRadiusMiles: asNumber(dr.searchRadiusMiles) || existing?.searchRadiusMiles || 100,
    sameStateOnly: dr.sameStateOnly !== false,
    tradeIn: mapTradeIn(dr.tradeIn, existing?.tradeIn),
    buyerComment: asString(dr.buyerComment) || existing?.buyerComment || undefined,
    createdAt: asString(dr.createdAt) || existing?.createdAt || "",
    expiresAt: asString(dr.expiresAt) || existing?.expiresAt || "",
    status: dr.status === "locked" || dr.status === "expired" ? dr.status : "active",
    directOffer: Boolean(directOffer),
    dealerEngagement: Array.isArray(dr.dealerEngagement)
      ? (dr.dealerEngagement as BiddingRequest["dealerEngagement"])
      : existing?.dealerEngagement,
    offerClock:
      dr.offerClock && typeof dr.offerClock === "object" && !Array.isArray(dr.offerClock)
        ? (dr.offerClock as BiddingRequest["offerClock"])
        : existing?.offerClock,
  };
}
