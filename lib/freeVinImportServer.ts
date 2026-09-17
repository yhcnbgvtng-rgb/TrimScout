/**
 * Server-side half of the free import: the NHTSA call plus the response
 * shape every sticker route returns when it has no factory build to show.
 *
 * Shared by the 15 listing-feed makes (whose paid decode is off) and by the
 * four window-sticker makes when the sticker isn't released yet. Before this
 * was shared, an unreleased Ford/GM/Stellantis/Genesis sticker returned
 * `vehicle: null`, the client turned that into a failure, and the buyer was
 * stuck with Continue disabled and no way forward. The car is real either
 * way — the sticker just isn't published — so it imports on the same terms
 * as a BMW does: NHTSA facts, the listing page's dealer and price, no option
 * list, and flagged as dealer-listing-only.
 */

import { decodeVinFromNhtsa, type DecodedVehicle } from "./vinDecoder";
import { freeVinImportVehicle, isUsableFreeImport, hasVinIntegrityError, vpicCorrectedButValid, vpicCorrectedDecode } from "./freeVinImport";
import type { DealerPageIdentity } from "./dealerPageIdentity";
import type { Vehicle } from "./types";
import { resolveVehicleDealer } from "./pasteResolutionServer";
import { inventoryDealerForVin, type InventoryVinLookup } from "./inventoryVinLookup";

export interface FreeImportSource {
  listingPrice?: number | null;
  dealer?: DealerPageIdentity;
  /** The listing page was never read — the buyer has to confirm the car by eye. */
  pageBlocked?: boolean;
}

export type FreeImportOutcome =
  | { ok: true; payload: Record<string, unknown>; vehicle: Vehicle; decoded: DecodedVehicle | null }
  | { ok: false; error: string; vinIntegrity: boolean };

/**
 * The sticker fetch failed (GM/Ford/… edge hiccup, bot shield, network):
 * the car is still real and the desk is still matched, so the buyer must
 * not be dead-ended. Import on the free path (NHTSA facts) flagged
 * dealer-listing-only, and say plainly that the factory sticker is
 * temporarily unavailable — not that the VIN has no build.
 */
export async function buildStickerUnavailableImport(input: {
  vin: string;
  pasteUrl: string | null;
  source: FreeImportSource;
  makeLabel: string;
  /** Buyer-facing reason from the OEM client (e.g. gmUnavailableMessage). */
  reason: string;
}): Promise<FreeImportOutcome> {
  const free = await buildFreeImport({ ...input, sticker: { status: "unavailable", pdfUrl: null, msrp: null, source: "sticker_unavailable" } });
  if (!free.ok) return free;
  return { ...free, payload: { ...free.payload, stickerUnavailable: { reason: input.reason }, note: input.reason } };
}

export async function buildFreeImport(input: {
  vin: string;
  pasteUrl: string | null;
  source: FreeImportSource;
  makeLabel: string;
  /** The make when NHTSA names none; defaults to makeLabel. The catch-all route passes "" so an unknown make never ships as a car. */
  fallbackMake?: string;
  /** Passed through so the client keeps the real sticker status (e.g. "unreleased"). */
  sticker?: Record<string, unknown>;
  /** Test seam: where our own crawl last saw the VIN (defaults to the live dealer_inventory lookup). */
  lookupSighting?: InventoryVinLookup;
}): Promise<FreeImportOutcome> {
  const { vin, pasteUrl, source, makeLabel } = input;
  const listingUrl = pasteUrl && /^https?:\/\//i.test(pasteUrl) ? pasteUrl.trim() : null;
  const raw = await decodeVinFromNhtsa(vin).catch(() => null);
  const decoded = raw && vpicCorrectedButValid(raw) ? vpicCorrectedDecode(raw) : raw;
  const built = freeVinImportVehicle({
    vin,
    decoded,
    dealer: source.dealer,
    listingPrice: source.listingPrice ?? null,
    listingUrl,
    fallbackMake: input.fallbackMake ?? makeLabel,
  });
  built.buildConfidence = "dealer_listing_only";

  if (!isUsableFreeImport(built, decoded)) {
    const vinIntegrity = hasVinIntegrityError(decoded);
    return {
      ok: false,
      vinIntegrity,
      error: vinIntegrity
        ? `This VIN doesn't look right: ${vin}. One character is probably off — copy the VIN straight from the listing and try again.`
        : `We couldn't find a ${makeLabel} with this VIN: ${vin}. Copy it straight from the listing and try again.`,
    };
  }

  // The dealership, the same way every sticker route settles it: the link's
  // store first, else the rooftop our own crawl last saw the VIN at (with
  // its lot age), never invented. Live QA 2026-09-16: every free import —
  // Toyota, Lexus, Acura, the catch-all — shipped "Dealer not found" while
  // dealer_inventory had the car, because only the sticker routes ran this.
  const vehicle = await resolveVehicleDealer(built, { dealer: source.dealer }, null, input.lookupSighting ?? inventoryDealerForVin);
  vehicle.buildConfidence = "dealer_listing_only";

  return {
    ok: true,
    vehicle,
    decoded,
    payload: {
      handled: true,
      vin,
      // "unreleased" is the shared contract's way of saying there is no
      // factory build to show; the wizard hides the must-have picker on it.
      // Deliberately carries no `error`: the import succeeded.
      sticker: input.sticker ?? { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" },
      vehicle,
      buildConfidence: "dealer_listing_only",
      listingPrice: vehicle.dealerPrice > 0 ? vehicle.dealerPrice : null,
      mustHaveLines: [],
      niceToHaveLines: [],
      filterableOptions: [],
      pdfUrl: null,
      pageUnread: Boolean(source.pageBlocked),
    },
  };
}

/**
 * A released sticker whose parser missed the model year. The sticker is
 * real and the options are real; only the headline didn't match a pattern.
 * NHTSA knows the year from the VIN, so fill it rather than ship "0 Ford
 * F-150" — which is exactly what went out before this existed.
 */
export async function fillMissingYear<T extends { vin: string; year: number }>(vehicle: T): Promise<T> {
  if (vehicle.year >= 1980) return vehicle;
  const decoded = await decodeVinFromNhtsa(vehicle.vin).catch(() => null);
  if (decoded?.year && decoded.year >= 1980 && !hasVinIntegrityError(decoded)) {
    return { ...vehicle, year: decoded.year };
  }
  return vehicle;
}
