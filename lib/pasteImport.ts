/**
 * Client-safe paste routing and shopper-facing factory-build errors.
 * Never substitute a catalog / demo VIN for the pasted one.
 */

import {
  isFordOrLincolnVin,
  isGmVin,
  looksLikeFordPaste,
  looksLikeGmPaste,
  pastedVinCandidate,
} from "./oemWmi";

export type FactoryBuildOem = "ford" | "gm";
export type FactoryBuildEndpoint = "/api/ford-sticker" | "/api/gm-sticker";

export const PAUL_CHEVY_VIN = "2GC4KREY7T1167690";
export const MOCK_CATALOG_PORSCHE_VIN = "WP0AB2A98SS160032";

export function factoryBuildUnavailableError(vin: string | null | undefined): string {
  const named = (vin || "").trim().toUpperCase();
  if (named.length === 17) {
    return `We don't have a factory build for VIN ${named} yet.`;
  }
  return "We don't have a factory build for this VIN yet.";
}

export function factoryBuildFailedError(vin: string | null | undefined, detail?: string): string {
  const named = (vin || "").trim().toUpperCase();
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (named.length === 17) {
    return `Could not load a factory build for VIN ${named}.`;
  }
  return "Could not load a factory build for that VIN.";
}

export function factoryBuildUnreleasedError(vin: string | null | undefined): string {
  const named = (vin || "").trim().toUpperCase();
  if (named.length === 17) {
    return `The factory build for VIN ${named} has not yet been released. Dealer ad copy is not proof — status is unconfirmed.`;
  }
  return "The factory build has not yet been released. Dealer ad copy is not proof — status is unconfirmed.";
}

export function preferredFactoryBuildEndpoint(paste: string): FactoryBuildEndpoint | null {
  const vin = pastedVinCandidate(paste);
  if (vin && isGmVin(vin) && !looksLikeFordPaste(paste)) return "/api/gm-sticker";
  if (vin && isFordOrLincolnVin(vin) && !looksLikeGmPaste(paste)) return "/api/ford-sticker";
  if (looksLikeGmPaste(paste) && !looksLikeFordPaste(paste)) return "/api/gm-sticker";
  if (looksLikeFordPaste(paste) && !looksLikeGmPaste(paste)) return "/api/ford-sticker";
  return null;
}

export function vehicleVinMatchesPaste(
  vehicleVin: string | null | undefined,
  pastedVin: string | null | undefined
): boolean {
  const got = (vehicleVin || "").trim().toUpperCase();
  const want = (pastedVin || "").trim().toUpperCase();
  if (!got || got.length !== 17) return false;
  if (!want) return true;
  return got === want;
}

/** Drop a vehicle whose VIN is not the one the shopper pasted. Never a catalog stand-in. */
export function acceptImportedVehicle<T extends { vin?: string }>(
  vehicle: T | null | undefined,
  pastedVin: string | null | undefined
): T | null {
  if (!vehicle?.vin) return null;
  if (!vehicleVinMatchesPaste(vehicle.vin, pastedVin)) return null;
  return vehicle;
}
