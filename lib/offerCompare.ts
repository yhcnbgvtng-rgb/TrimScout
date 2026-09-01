/**
 * Client-side deal snapshot for the post-Step-5 compare page.
 * Favorite + up to two other lots. Never pads with demo inventory.
 */

import type { BiddingRequest, DealStructureMethod, Option, Vehicle, VehicleDealTerms } from "./types";
import { DEAL_STRUCTURE_METHODS } from "./dealStructure";
import { listingVdpHref } from "./fordCompetitionUi";
import { defaultTermsForVehicles, mergeVehicleTerms, parseVehicleTermsList } from "./dealTerms";

export const OFFER_COMPARE_STORAGE_KEY = "trimscout_offer_compare";
export const SHOPPER_REQUESTS_STORAGE_KEY = "trimscout_shopper_requests";
export const LANDING_VIEW_STORAGE_KEY = "trimscout_landing_view";

export type OfferVehicleRole = "favorite" | "other_lot_1" | "other_lot_2";

export interface OfferCompareVehicle {
  role: OfferVehicleRole;
  label: string;
  vehicle: Vehicle;
}

export interface OfferCompareSnapshot {
  version: 1;
  request: BiddingRequest;
  vehicles: OfferCompareVehicle[];
  buyerZip: string;
  requestedStructures: DealStructureMethod[];
}

const ROLE_LABELS: Record<OfferVehicleRole, string> = {
  favorite: "Imported favorite",
  other_lot_1: "Other lot 1",
  other_lot_2: "Other lot 2",
};

const ROLES: OfferVehicleRole[] = ["favorite", "other_lot_1", "other_lot_2"];

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

export function collectDealVehicles(
  favorite: Vehicle | null | undefined,
  otherLots: Array<Vehicle | null | undefined>
): Vehicle[] {
  const out: Vehicle[] = [];
  const seen = new Set<string>();
  const add = (vehicle: Vehicle | null | undefined) => {
    if (!vehicle) return;
    const vin = (vehicle.vin || "").trim().toUpperCase();
    if (!vin || seen.has(vin)) return;
    seen.add(vin);
    out.push({ ...vehicle, vin });
  };
  add(favorite);
  for (const lot of otherLots) add(lot);
  return out.slice(0, 3);
}

export function serializeDealVehicle(vehicle: Vehicle): Record<string, unknown> {
  const loc = vehicle.location || { dealerName: "", city: "", state: "", distanceMiles: 0 };
  const dealerName = asString(loc.dealerName);
  const dealerCity = asString(loc.city);
  const dealerState = asString(loc.state);
  const dealerZip = asString(loc.zip);
  const dealerUrl = listingVdpHref(vehicle.dealerUrl) || undefined;
  return {
    vin: vehicle.vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    engine: vehicle.engine,
    exteriorColor: vehicle.exteriorColor,
    interiorColor: vehicle.interiorColor,
    msrp: vehicle.msrp,
    dealerPrice: vehicle.dealerPrice,
    mileage: vehicle.mileage,
    imageUrl: vehicle.imageUrl || "",
    packages: vehicle.packages || [],
    options: vehicle.options || [],
    status: vehicle.status,
    ...(dealerUrl ? { dealerUrl } : {}),
    location: {
      ...(dealerName ? { dealerName } : { dealerName: "" }),
      ...(dealerCity ? { city: dealerCity } : { city: "" }),
      ...(dealerState ? { state: dealerState } : { state: "" }),
      ...(dealerZip ? { zip: dealerZip } : {}),
      distanceMiles: loc.distanceMiles || 0,
    },
  };
}

export function deserializeDealVehicle(raw: unknown): Vehicle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const vin = asString(row.vin).toUpperCase();
  const make = asString(row.make);
  const model = asString(row.model);
  if (!vin && !make && !model) return null;
  const loc = (row.location && typeof row.location === "object" ? row.location : {}) as Record<string, unknown>;
  const options = Array.isArray(row.options) ? (row.options as Option[]) : [];
  const packages = Array.isArray(row.packages)
    ? row.packages.filter((line): line is string => typeof line === "string")
    : [];
  return {
    id: asString(row.id) || (vin ? `deal-${vin}` : `deal-${make}-${model}`),
    vin,
    year: asNumber(row.year) || 0,
    make,
    model,
    trim: asString(row.trim),
    bodyType: asString(row.bodyType),
    engine: asString(row.engine),
    drivetrain: asString(row.drivetrain),
    transmission: asString(row.transmission),
    exteriorColor: asString(row.exteriorColor),
    interiorColor: asString(row.interiorColor),
    msrp: asNumber(row.msrp) || 0,
    dealerPrice: asNumber(row.dealerPrice) || 0,
    daysOnLot: asNumber(row.daysOnLot) || 0,
    status: (asString(row.status) as Vehicle["status"]) || "on_lot",
    location: {
      dealerName: asString(loc.dealerName),
      city: asString(loc.city),
      state: asString(loc.state),
      zip: asString(loc.zip) || undefined,
      distanceMiles: asNumber(loc.distanceMiles) || 0,
    },
    packages,
    options,
    imageUrl: asString(row.imageUrl),
    mileage: asNumber(row.mileage) || 0,
    dealerUrl: listingVdpHref(asString(row.dealerUrl)) || undefined,
  };
}

export function otherLotsFromVehicles(
  favoriteVin: string | undefined,
  vehicles: Vehicle[]
): Vehicle[] {
  const fav = (favoriteVin || "").toUpperCase();
  return vehicles.filter((v) => v.vin.toUpperCase() !== fav).slice(0, 2);
}

export function snapshotVehiclesFromDeal(
  favorite: Vehicle | null | undefined,
  otherLots: Array<Vehicle | null | undefined>
): OfferCompareVehicle[] {
  const vehicles = collectDealVehicles(favorite, otherLots);
  return vehicles.map((vehicle, index) => {
    const role = ROLES[index] || "other_lot_2";
    return { role, label: ROLE_LABELS[role], vehicle };
  });
}

export function buildOfferCompareSnapshot(opts: {
  request: BiddingRequest;
  favorite: Vehicle | null | undefined;
  otherLots: Array<Vehicle | null | undefined>;
  buyerZip: string;
  requestedStructures: DealStructureMethod[];
}): OfferCompareSnapshot | null {
  const columns = snapshotVehiclesFromDeal(opts.favorite, opts.otherLots);
  if (columns.length === 0) return null;
  const requestedStructures = DEAL_STRUCTURE_METHODS.filter((method) =>
    opts.requestedStructures.includes(method)
  );
  const prefs = opts.request.dealStructurePreferences || { requestedStructures };
  const vehicleTerms = mergeVehicleTerms(
    columns.map((col) => col.vehicle),
    prefs.vehicleTerms,
    {
      requestedStructures,
      financeTermMonths: prefs.financeTermMonths,
      downPayment: prefs.downPayment,
      leaseMileagePerYear: prefs.leaseMileagePerYear,
      leaseTermMonths: prefs.leaseTermMonths,
    }
  );
  const request: BiddingRequest = {
    ...opts.request,
    otherLots: otherLotsFromVehicles(opts.favorite?.vin, columns.map((col) => col.vehicle)),
    dealStructurePreferences: {
      ...prefs,
      requestedStructures,
      vehicleTerms,
    },
  };
  return {
    version: 1,
    request,
    vehicles: columns,
    buyerZip: (opts.buyerZip || request.buyerZip || "").trim(),
    requestedStructures,
  };
}

export function parseOfferCompareSnapshot(raw: unknown): OfferCompareSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.version !== 1) return null;
  const request = row.request as BiddingRequest | undefined;
  if (!request || typeof request !== "object") return null;
  const buyerZip = asString(row.buyerZip) || request.buyerZip || "";
  const requestedStructures = DEAL_STRUCTURE_METHODS.filter((method) => {
    const rawMethods = Array.isArray(row.requestedStructures)
      ? row.requestedStructures
      : request.dealStructurePreferences?.requestedStructures || [];
    return rawMethods.includes(method);
  });
  const columns: OfferCompareVehicle[] = [];
  if (Array.isArray(row.vehicles)) {
    for (const item of row.vehicles) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const vehicle = deserializeDealVehicle(rec.vehicle);
      if (!vehicle) continue;
      const role = ROLES.includes(rec.role as OfferVehicleRole)
        ? (rec.role as OfferVehicleRole)
        : ROLES[columns.length];
      columns.push({
        role,
        label: asString(rec.label) || ROLE_LABELS[role],
        vehicle,
      });
      if (columns.length === 3) break;
    }
  }
  if (columns.length === 0) {
    const rebuilt = snapshotVehiclesFromDeal(request.targetVehicle, request.otherLots || []);
    columns.push(...rebuilt);
  }
  if (columns.length === 0) return null;
  const looksInvented = columns.some((col) => {
    const title = `${col.vehicle.year} ${col.vehicle.make} ${col.vehicle.model}`.toLowerCase();
    return /porsche|bmw 3 series|demo explorer/i.test(title) && !request.targetVehicle;
  });
  if (looksInvented && !request.targetVin) return null;

  const prefs = request.dealStructurePreferences || { requestedStructures };
  const vehicleTerms =
    parseVehicleTermsList(prefs.vehicleTerms).length > 0
      ? parseVehicleTermsList(prefs.vehicleTerms)
      : defaultTermsForVehicles(
          columns.map((col) => col.vehicle),
          { ...prefs, requestedStructures }
        );

  return {
    version: 1,
    request: {
      ...request,
      otherLots: otherLotsFromVehicles(
        request.targetVehicle?.vin || request.targetVin,
        columns.map((col) => col.vehicle)
      ),
      dealStructurePreferences: { ...prefs, requestedStructures, vehicleTerms },
    },
    vehicles: columns,
    buyerZip,
    requestedStructures,
  };
}

export function saveOfferCompareSnapshot(snapshot: OfferCompareSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(OFFER_COMPARE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota / private mode — compare page will show the empty state.
  }
}

export function loadOfferCompareSnapshot(): OfferCompareSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(OFFER_COMPARE_STORAGE_KEY);
    if (!raw) return null;
    return parseOfferCompareSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function upsertShopperRequest(request: BiddingRequest): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadShopperRequests();
    const next = [request, ...existing.filter((row) => row.id !== request.id)];
    sessionStorage.setItem(SHOPPER_REQUESTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function loadShopperRequests(): BiddingRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SHOPPER_REQUESTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => row && typeof row === "object" && typeof (row as BiddingRequest).id === "string");
  } catch {
    return [];
  }
}

export function setLandingView(view: "track_deals" | "deal_room"): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(LANDING_VIEW_STORAGE_KEY, view);
  } catch {
    // ignore
  }
}

export function consumeLandingView(): "track_deals" | "deal_room" | null {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(LANDING_VIEW_STORAGE_KEY);
    sessionStorage.removeItem(LANDING_VIEW_STORAGE_KEY);
    if (value === "track_deals" || value === "deal_room") return value;
    return null;
  } catch {
    return null;
  }
}

export function applyVehicleTermsToSnapshot(
  snapshot: OfferCompareSnapshot,
  vehicleTerms: VehicleDealTerms[]
): OfferCompareSnapshot {
  const next: OfferCompareSnapshot = {
    ...snapshot,
    request: {
      ...snapshot.request,
      dealStructurePreferences: {
        requestedStructures: snapshot.requestedStructures,
        ...snapshot.request.dealStructurePreferences,
        vehicleTerms,
      },
    },
  };
  return next;
}
