/**
 * Client-side deal snapshot for the post-Step-5 compare page.
 * Favorite + up to two other lots. Never pads with demo inventory.
 */

import type { BiddingRequest, DealStructureMethod, Option, Vehicle, VehicleDealTerms } from "./types";
import { DEAL_STRUCTURE_METHODS } from "./dealStructure";
import { listingVdpHref } from "./fordCompetitionUi";
import { defaultTermsForVehicles, mergeVehicleTerms, parseVehicleTermsList } from "./dealTerms";
import { isFordOrLincolnVin, isGmVin } from "./oemWmi";

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
  mustHaveLines: string[];
  niceToHaveLines: string[];
  searchRadiusMiles: number;
}

export const ROLE_LABELS: Record<OfferVehicleRole, string> = {
  favorite: "Imported favorite",
  other_lot_1: "Competitor 1",
  other_lot_2: "Competitor 2",
};

export const DUPLICATE_COMPARE_VIN = "That VIN is already in this deal.";

export const COMPARE_COLUMN_ROLES: OfferVehicleRole[] = ["favorite", "other_lot_1", "other_lot_2"];

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
  const out: OfferCompareVehicle[] = [];
  const seen = new Set<string>();
  const add = (vehicle: Vehicle | null | undefined, role: OfferVehicleRole) => {
    if (!vehicle) return;
    const vin = (vehicle.vin || "").trim().toUpperCase();
    if (!vin || seen.has(vin)) return;
    seen.add(vin);
    out.push({ role, label: ROLE_LABELS[role], vehicle: { ...vehicle, vin } });
  };
  add(favorite, "favorite");
  add(otherLots[0], "other_lot_1");
  add(otherLots[1], "other_lot_2");
  return out;
}

export type CompareSortMode = "default" | "days_on_market" | "price_cuts";

/** Just what the sort needs from a listing sheet, so this stays testable. */
export interface CompareSortMetrics {
  daysOnMarket?: number | null;
  daysOnMarketActive?: number | null;
  priceCuts?: number | null;
}

/**
 * Order the compare columns. The favorite is always pinned first — it's the
 * car the buyer actually chose, and the other lots exist to be measured
 * against it. Only the competing lots reorder.
 *
 * Both metrics come from listing sheets already fetched for these VINs, so
 * sorting never costs an additional upstream call.
 *
 * Lots with no listing data sort last rather than as zero: a missing value
 * is "unknown", and treating it as 0 would rank it as the freshest listing
 * / the one never discounted, floating unknowns above real data.
 */
export function sortCompareColumns<T extends { role: OfferVehicleRole; vin: string | null }>(
  entries: T[],
  mode: CompareSortMode,
  metricsByVin: Record<string, CompareSortMetrics | undefined>
): T[] {
  if (mode === "default") return entries;
  const favorites = entries.filter((e) => e.role === "favorite");
  const others = entries.filter((e) => e.role !== "favorite");

  const valueOf = (entry: T): number | null => {
    const vin = entry.vin ? entry.vin.toUpperCase() : null;
    const m = vin ? metricsByVin[vin] : undefined;
    if (!m) return null;
    if (mode === "days_on_market") return m.daysOnMarket ?? m.daysOnMarketActive ?? null;
    return m.priceCuts ?? null;
  };

  const sorted = [...others].sort((a, b) => {
    const aVal = valueOf(a);
    const bVal = valueOf(b);
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return bVal - aVal; // most days on market / most price cuts first
  });
  return [...favorites, ...sorted];
}

export function vehicleForCompareRole(
  snapshot: OfferCompareSnapshot,
  role: OfferVehicleRole
): OfferCompareVehicle | null {
  if (role === "favorite") {
    return snapshot.vehicles.find((col) => col.role === "favorite") || snapshot.vehicles[0] || null;
  }
  return snapshot.vehicles.find((col) => col.role === role) || null;
}

export function assignCompetitorLot(
  snapshot: OfferCompareSnapshot,
  slot: 1 | 2,
  vehicle: Vehicle
): { ok: true; snapshot: OfferCompareSnapshot } | { ok: false; error: string } {
  const vin = (vehicle.vin || "").trim().toUpperCase();
  if (vin.length !== 17) {
    return { ok: false, error: "Paste a 17-character VIN or dealer listing URL." };
  }
  const favorite = vehicleForCompareRole(snapshot, "favorite")?.vehicle;
  const lot1 = vehicleForCompareRole(snapshot, "other_lot_1")?.vehicle ?? null;
  const lot2 = vehicleForCompareRole(snapshot, "other_lot_2")?.vehicle ?? null;
  const used = [favorite?.vin, slot === 1 ? lot2?.vin : lot1?.vin]
    .filter(Boolean)
    .map((value) => String(value).toUpperCase());
  if (used.includes(vin)) {
    return { ok: false, error: DUPLICATE_COMPARE_VIN };
  }
  const nextLots: [Vehicle | null, Vehicle | null] = [
    slot === 1 ? { ...vehicle, vin } : lot1,
    slot === 2 ? { ...vehicle, vin } : lot2,
  ];
  const next = buildOfferCompareSnapshot({
    request: snapshot.request,
    favorite,
    otherLots: nextLots,
    buyerZip: snapshot.buyerZip,
    requestedStructures: snapshot.requestedStructures,
    mustHaveLines: snapshot.mustHaveLines,
    niceToHaveLines: snapshot.niceToHaveLines,
    searchRadiusMiles: snapshot.searchRadiusMiles,
  });
  if (!next) return { ok: false, error: "Could not add that vehicle." };
  return { ok: true, snapshot: next };
}

/** Shape of one item in /api/ford-comparables's or /api/gm-comparables's `matches`. */
export interface ComparableSuggestion {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  exteriorColor?: string;
  dealerName: string;
  city: string;
  state: string;
  zip?: string;
  distanceMiles: number | null;
  listingPrice: number | null;
  msrp: number | null;
  dealerUrl: string | null;
  pdfUrl: string;
  factoryOptions: Array<{
    code: string | null;
    description: string;
    price: number | null;
    isPackageChild: boolean;
  }>;
  /** Days the listing has been active, free off the search row. */
  daysOnMarket: number | null;
  /** Free proxy for motivation; negative means a price cut. Not a true count. */
  priceChangeHint: number | null;
}

/** Mirrors vinSearch.ts's fordMatchToVehicle, kept client-safe here (vinSearch.ts is server-only). */
export function vehicleFromComparableSuggestion(match: ComparableSuggestion): Vehicle {
  const gm = isGmVin(match.vin);
  return {
    id: `vehicle-${match.vin}`,
    vin: match.vin,
    year: match.year || 0,
    make: match.make || (gm ? "Chevrolet" : "Ford"),
    model: match.model || "",
    trim: match.trim || "",
    bodyType: gm ? "Truck" : "SUV",
    engine: match.engine || "",
    drivetrain: "",
    transmission: "",
    exteriorColor: match.exteriorColor || "",
    interiorColor: "",
    msrp: match.msrp || 0,
    dealerPrice: match.listingPrice || 0,
    daysOnLot: 0,
    status: "on_lot",
    condition: "new",
    location: {
      dealerName: match.dealerName,
      city: match.city,
      state: match.state,
      zip: match.zip,
      distanceMiles: match.distanceMiles || 0,
    },
    packages: match.factoryOptions.filter((o) => !o.isPackageChild).map((o) => o.description),
    options: match.factoryOptions.map((o) => ({
      code: o.code || "",
      name: o.description,
      price: o.price || 0,
      category: o.isPackageChild ? ("standalone" as const) : ("package" as const),
    })),
    imageUrl: "",
    mileage: 0,
    dealerUrl: match.dealerUrl || undefined,
    oemBuildSheetUrl: match.pdfUrl,
  };
}

/** Which comparable-vehicle search endpoint a favorite's VIN supports, if any. */
export function comparablesEndpointForVin(
  vin: string
): "/api/ford-comparables" | "/api/gm-comparables" | null {
  if (isGmVin(vin)) return "/api/gm-comparables";
  if (isFordOrLincolnVin(vin)) return "/api/ford-comparables";
  return null;
}

export function buildOfferCompareSnapshot(opts: {
  request: BiddingRequest;
  favorite: Vehicle | null | undefined;
  otherLots: Array<Vehicle | null | undefined>;
  buyerZip: string;
  requestedStructures: DealStructureMethod[];
  mustHaveLines?: string[];
  niceToHaveLines?: string[];
  searchRadiusMiles?: number;
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
  const buyerZip = (opts.buyerZip || request.buyerZip || "").trim();
  const searchRadiusMiles =
    opts.searchRadiusMiles ??
    (typeof request.searchRadiusMiles === "number" ? request.searchRadiusMiles : 0);
  return {
    version: 1,
    request,
    vehicles: columns,
    buyerZip,
    requestedStructures,
    mustHaveLines: (opts.mustHaveLines || request.flexibleCriteria?.mustHavePackages || []).filter(Boolean),
    niceToHaveLines: (opts.niceToHaveLines || []).filter(Boolean),
    searchRadiusMiles,
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
      const role = COMPARE_COLUMN_ROLES.includes(rec.role as OfferVehicleRole)
        ? (rec.role as OfferVehicleRole)
        : COMPARE_COLUMN_ROLES[columns.length] || "other_lot_2";
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

  const mustHaveLines = Array.isArray(row.mustHaveLines)
    ? row.mustHaveLines.filter((line): line is string => typeof line === "string" && Boolean(line.trim()))
    : request.flexibleCriteria?.mustHavePackages || [];
  const niceToHaveLines = Array.isArray(row.niceToHaveLines)
    ? row.niceToHaveLines.filter((line): line is string => typeof line === "string" && Boolean(line.trim()))
    : [];
  const searchRadiusMiles =
    asNumber(row.searchRadiusMiles) ??
    (typeof request.searchRadiusMiles === "number" ? request.searchRadiusMiles : 0);

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
    mustHaveLines,
    niceToHaveLines,
    searchRadiusMiles,
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
