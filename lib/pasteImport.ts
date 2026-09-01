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
import type { Vehicle } from "./types";

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

export type FactoryFilterableOption = {
  name: string;
  code?: string | null;
  description?: string;
  price: number | null;
  isPackageChild?: boolean;
};

export type PasteImportSuccess = {
  ok: true;
  vehicle: Vehicle;
  oem: FactoryBuildOem;
  pdfUrl: string | null;
  msrp: number | null;
  mustHaveLines: string[];
  niceToHaveLines: string[];
  filterableOptions: FactoryFilterableOption[];
};

export type PasteImportFailure = {
  ok: false;
  error: string;
  unreleased?: boolean;
  oem?: FactoryBuildOem;
  pdfUrl?: string | null;
};

export type PasteImportResult = PasteImportSuccess | PasteImportFailure;

function interpretFactoryBuildJson(
  json: Record<string, unknown>,
  ok: boolean,
  oem: FactoryBuildOem,
  pastedVin: string | null
): PasteImportResult {
  const sticker = json.sticker as { status?: string; pdfUrl?: string; msrp?: number } | undefined;
  const responseVin =
    (typeof json.vin === "string" && json.vin.trim().toUpperCase()) || pastedVin || null;
  const pdfUrl =
    (typeof json.pdfUrl === "string" && json.pdfUrl) || sticker?.pdfUrl || null;

  if (!ok) {
    return {
      ok: false,
      error: factoryBuildFailedError(
        responseVin,
        typeof json.error === "string" ? json.error : undefined
      ),
    };
  }

  if (sticker?.status === "unreleased") {
    return {
      ok: false,
      error: factoryBuildUnreleasedError(responseVin),
      unreleased: true,
      oem,
      pdfUrl,
    };
  }

  const matched = acceptImportedVehicle(json.vehicle as Vehicle | null, responseVin);
  if (!matched) {
    return {
      ok: false,
      error: factoryBuildFailedError(
        responseVin,
        typeof json.error === "string" ? json.error : undefined
      ),
    };
  }

  return {
    ok: true,
    vehicle: matched,
    oem,
    pdfUrl: pdfUrl || matched.oemBuildSheetUrl || null,
    msrp: typeof sticker?.msrp === "number" && sticker.msrp > 0 ? sticker.msrp : null,
    mustHaveLines: Array.isArray(json.mustHaveLines)
      ? json.mustHaveLines.map(String).filter(Boolean)
      : [],
    niceToHaveLines: Array.isArray(json.niceToHaveLines)
      ? json.niceToHaveLines.map(String).filter(Boolean)
      : [],
    filterableOptions: Array.isArray(json.filterableOptions)
      ? (json.filterableOptions as FactoryFilterableOption[])
      : [],
  };
}

/**
 * Same Ford Direct / GM CWS factory-build import the wizard uses.
 * Never swaps in a catalog VIN. Callers must mock fetch in tests.
 */
export async function importPastedFactoryVehicle(
  paste: string,
  fetchImpl: typeof fetch = fetch
): Promise<PasteImportResult> {
  const raw = paste.trim();
  if (!raw) {
    return { ok: false, error: "Paste a 17-character VIN or dealer listing URL." };
  }
  const pastedVin = pastedVinCandidate(raw);

  try {
    const endpoint = preferredFactoryBuildEndpoint(raw) || "/api/ford-sticker";
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paste: raw }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const jsonVin =
      typeof json.vin === "string" ? json.vin.trim().toUpperCase() : pastedVin;

    if (json.needsVin || json.dealerBlocked) {
      return {
        ok: false,
        error:
          (typeof json.error === "string" && json.error) ||
          "Could not read a VIN from that page. Paste the 17-character VIN.",
      };
    }

    if (endpoint === "/api/ford-sticker" && json.notFord && json.handled === false) {
      if (jsonVin && isGmVin(jsonVin)) {
        const gmRes = await fetchImpl("/api/gm-sticker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paste: raw, vin: jsonVin }),
        });
        const gmJson = (await gmRes.json().catch(() => ({}))) as Record<string, unknown>;
        return interpretFactoryBuildJson(gmJson, gmRes.ok, "gm", jsonVin);
      }
      return { ok: false, error: factoryBuildUnavailableError(jsonVin || pastedVin) };
    }

    if (endpoint === "/api/gm-sticker" && json.notGm && json.handled === false) {
      if (jsonVin && isFordOrLincolnVin(jsonVin)) {
        const fordRes = await fetchImpl("/api/ford-sticker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paste: raw, vin: jsonVin }),
        });
        const fordJson = (await fordRes.json().catch(() => ({}))) as Record<string, unknown>;
        return interpretFactoryBuildJson(fordJson, fordRes.ok, "ford", jsonVin);
      }
      return { ok: false, error: factoryBuildUnavailableError(jsonVin || pastedVin) };
    }

    return interpretFactoryBuildJson(
      json,
      res.ok,
      endpoint === "/api/gm-sticker" ? "gm" : "ford",
      jsonVin || pastedVin
    );
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Lookup failed" };
  }
}
