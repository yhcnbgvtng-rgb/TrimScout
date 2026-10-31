/**
 * How a buyer's paste became a vehicle — logged for QA metrics and stamped
 * on the Step 1 card as data attributes — plus the honest one-liner for a
 * car whose factory build isn't there. Pure; client-safe.
 *
 *   url_only              — a listing link carried the VIN and the buyer confirmed it as read
 *   url_plus_vin_confirm  — a listing link, but the buyer typed or corrected the VIN
 *   vin_only              — a bare VIN, no link
 *   factory_pending       — resolved (any of the above) but no factory build behind it
 *   fail                  — nothing resolved
 */
import type { Vehicle } from "./types";

export type ResolvePath = NonNullable<Vehicle["resolvePath"]>;

export function classifyResolvePath(input: {
  /** What the buyer pasted into the slot. */
  paste: "url" | "vin";
  /** The VIN read from the link, when there was one. */
  vinFromUrl: string | null;
  /** The VIN the vehicle was finally built from. */
  vinUsed: string | null;
  ok: boolean;
  factoryBuildUnavailable: boolean;
}): ResolvePath {
  if (!input.ok || !input.vinUsed) return "fail";
  if (input.factoryBuildUnavailable) return "factory_pending";
  if (input.paste === "vin") return "vin_only";
  return input.vinFromUrl && input.vinFromUrl.toUpperCase() === input.vinUsed.toUpperCase() ? "url_only" : "url_plus_vin_confirm";
}

/** The rooftop came from the pasted listing (its hostname, or the page itself), not from the VIN or a search. */
export function dealerFromVdp(vehicle: Pick<Vehicle, "location"> | null | undefined): boolean {
  const src = vehicle?.location?.dealerSource;
  return src === "listing_domain" || src === "listing_page";
}

export interface ResolveLogEntry {
  resolvePath: ResolvePath;
  vin: string | null;
  dealerShown: string;
  dealerFromVdp: boolean;
  dealerSource: string | null;
}

export function resolveLogEntry(vehicle: Vehicle | null, resolvePath: ResolvePath): ResolveLogEntry {
  return {
    resolvePath,
    vin: vehicle?.vin || null,
    dealerShown: vehicle?.location?.dealerName?.trim() || "",
    dealerFromVdp: dealerFromVdp(vehicle),
    dealerSource: vehicle?.location?.dealerSource || null,
  };
}

/** One console line per resolve, in a fixed shape QA can grep for. */
export function logResolve(entry: ResolveLogEntry): void {
  if (typeof console === "undefined") return;
  console.info(`[trimscout:resolve] ${JSON.stringify(entry)}`);
}

/**
 * The honest line under a car with no factory build: what we have instead.
 * Null when a real
 * sticker was read (nothing to explain) or the car is pre-owned (no
 * factory build is expected).
 */
export function factoryBuildStateLine(vehicle: Pick<Vehicle, "buildConfidence" | "condition" | "daysOnLot" | "stickerPendingNote" | "stickerUnavailableReason"> | null | undefined): string | null {
  if (!vehicle) return null;
  if (vehicle.condition === "used" || vehicle.condition === "cpo") return null;
  if (vehicle.buildConfidence !== "dealer_listing_only") return null;
  // Buyers never see how long a car has sat (days on lot / first seen stay admin-only).
  if (vehicle.stickerUnavailableReason) return vehicle.stickerUnavailableReason;
  return vehicle.stickerPendingNote || "Factory build not published yet — details come from the VIN decode; the dealer confirms the build when they quote.";
}
