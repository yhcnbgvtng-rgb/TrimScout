/**
 * Client-safe paste routing and shopper-facing factory-build errors.
 * Never substitute a catalog / demo VIN for the pasted one.
 */

import {
  isFordOrLincolnVin,
  isGmVin,
  isStellantisVin,
  looksLikeFordPaste,
  looksLikeGmPaste,
  looksLikeStellantisPaste,
  pastedVinCandidate,
} from "./oemWmi";
import type { Vehicle } from "./types";

export type FactoryBuildOem = "ford" | "gm" | "stellantis";
export type FactoryBuildEndpoint = "/api/ford-sticker" | "/api/gm-sticker" | "/api/stellantis-sticker";

export const PAUL_CHEVY_VIN = "2GC4KREY7T1167690";
export const MOCK_CATALOG_PORSCHE_VIN = "WP0AB2A98SS160032";

/**
 * Per-OEM "does this VIN belong to it" / "does this paste text mention it"
 * checks, keyed the same way across both — used to generalize dispatch and
 * the cross-fallback retry to any number of OEMs without hardcoding pairwise
 * branches. Order matters only as a tie-break when a VIN or paste text could
 * plausibly match more than one (should not happen in practice — the WMI
 * ranges and paste keywords don't overlap across Ford/GM/Stellantis).
 */
const OEM_ORDER: FactoryBuildOem[] = ["gm", "ford", "stellantis"];
const OEM_ENDPOINT: Record<FactoryBuildOem, FactoryBuildEndpoint> = {
  gm: "/api/gm-sticker",
  ford: "/api/ford-sticker",
  stellantis: "/api/stellantis-sticker",
};
const OEM_BY_ENDPOINT: Record<FactoryBuildEndpoint, FactoryBuildOem> = {
  "/api/gm-sticker": "gm",
  "/api/ford-sticker": "ford",
  "/api/stellantis-sticker": "stellantis",
};
const VIN_IS_OEM: Record<FactoryBuildOem, (vin: string) => boolean> = {
  gm: isGmVin,
  ford: isFordOrLincolnVin,
  stellantis: isStellantisVin,
};
const PASTE_LOOKS_LIKE_OEM: Record<FactoryBuildOem, (paste: string) => boolean> = {
  gm: looksLikeGmPaste,
  ford: looksLikeFordPaste,
  stellantis: looksLikeStellantisPaste,
};

/** True when some *other* OEM's paste heuristic also matches — a conflicting
 * signal, so the caller should not trust `self` for this paste. */
function otherOemLooksLikeToo(paste: string, self: FactoryBuildOem): boolean {
  return OEM_ORDER.some((oem) => oem !== self && PASTE_LOOKS_LIKE_OEM[oem](paste));
}

/** Pure VIN → endpoint, no paste-text heuristics — used for the
 * cross-fallback retry, where the VIN itself (not the original paste) is
 * already known. */
function endpointForVin(vin: string): FactoryBuildEndpoint | null {
  for (const oem of OEM_ORDER) {
    if (VIN_IS_OEM[oem](vin)) return OEM_ENDPOINT[oem];
  }
  return null;
}

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
  if (vin) {
    for (const oem of OEM_ORDER) {
      if (VIN_IS_OEM[oem](vin) && !otherOemLooksLikeToo(paste, oem)) return OEM_ENDPOINT[oem];
    }
  }
  for (const oem of OEM_ORDER) {
    if (PASTE_LOOKS_LIKE_OEM[oem](paste) && !otherOemLooksLikeToo(paste, oem)) return OEM_ENDPOINT[oem];
  }
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

    const triedOem = OEM_BY_ENDPOINT[endpoint];
    const notThisOem =
      (triedOem === "ford" && json.notFord) ||
      (triedOem === "gm" && json.notGm) ||
      (triedOem === "stellantis" && json.notStellantis);
    if (notThisOem && json.handled === false) {
      const retryEndpoint = jsonVin ? endpointForVin(jsonVin) : null;
      if (retryEndpoint && retryEndpoint !== endpoint) {
        const retryRes = await fetchImpl(retryEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paste: raw, vin: jsonVin }),
        });
        const retryJson = (await retryRes.json().catch(() => ({}))) as Record<string, unknown>;
        return interpretFactoryBuildJson(retryJson, retryRes.ok, OEM_BY_ENDPOINT[retryEndpoint], jsonVin);
      }
      return { ok: false, error: factoryBuildUnavailableError(jsonVin || pastedVin) };
    }

    return interpretFactoryBuildJson(json, res.ok, triedOem, jsonVin || pastedVin);
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Lookup failed" };
  }
}
