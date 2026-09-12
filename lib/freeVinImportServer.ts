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
import { freeVinImportVehicle, isUsableFreeImport, hasVinIntegrityError } from "./freeVinImport";
import type { DealerPageIdentity } from "./dealerPageIdentity";
import type { Vehicle } from "./types";

export interface FreeImportSource {
  listingPrice?: number | null;
  dealer?: DealerPageIdentity;
  /** The listing page was never read — the buyer has to confirm the car by eye. */
  pageBlocked?: boolean;
}

export type FreeImportOutcome =
  | { ok: true; payload: Record<string, unknown>; vehicle: Vehicle; decoded: DecodedVehicle | null }
  | { ok: false; error: string; vinIntegrity: boolean };

export async function buildFreeImport(input: {
  vin: string;
  pasteUrl: string | null;
  source: FreeImportSource;
  makeLabel: string;
  /** Passed through so the client keeps the real sticker status (e.g. "unreleased"). */
  sticker?: Record<string, unknown>;
}): Promise<FreeImportOutcome> {
  const { vin, pasteUrl, source, makeLabel } = input;
  const listingUrl = pasteUrl && /^https?:\/\//i.test(pasteUrl) ? pasteUrl.trim() : null;
  const decoded = await decodeVinFromNhtsa(vin).catch(() => null);
  const vehicle = freeVinImportVehicle({
    vin,
    decoded,
    dealer: source.dealer,
    listingPrice: source.listingPrice ?? null,
    listingUrl,
    fallbackMake: makeLabel,
  });
  vehicle.buildConfidence = "dealer_listing_only";

  if (!isUsableFreeImport(vehicle, decoded)) {
    const vinIntegrity = hasVinIntegrityError(decoded);
    return {
      ok: false,
      vinIntegrity,
      error: vinIntegrity
        ? `That VIN doesn't check out — ${vin} fails its own check digit, so it isn't a valid ${makeLabel} VIN. Copy it again from the listing.`
        : `We couldn't read enough about that ${makeLabel} to add it. Check the VIN and try again.`,
    };
  }

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
