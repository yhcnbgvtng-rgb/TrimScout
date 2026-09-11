/**
 * Shared /api/{make}-sticker handlers for makes whose factory build comes
 * from the dealer listing feed (lib/listingFeedBuild.ts). Same
 * request/response contract as the sticker-PDF routes, so
 * lib/pasteImport.ts dispatches to every make the same way.
 */

import { NextResponse } from "next/server";
import { isExplicitNonFordDemoPaste, looksLikeUrl, resolvePasteVin } from "./fordSticker";
import {
  buildToVehicle,
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getListingFeedBuild,
  type ListingFeedMake,
} from "./listingFeedBuild";
import { factoryBuildFailedError, factoryBuildUnavailableError } from "./pasteImport";
import { guardPaidDecode, isPaidVinDecodeEnabled, MARKETCHECK_CALL_COST_USD } from "./apiSpendGuard";
import { decodeVinFromNhtsa } from "./vinDecoder";
import { freeVinImportVehicle, isUsableFreeImport, hasVinIntegrityError } from "./freeVinImport";
import type { DealerPageIdentity } from "./dealerPageIdentity";

export interface ListingFeedRouteConfig {
  make: ListingFeedMake;
  looksLikePaste: (paste: string) => boolean;
  /** e.g. "notPorsche" — the flag pasteImport uses to fall through to another OEM. */
  notFlag: string;
}

function vinPasteError(message: string, extra?: { dealerBlocked?: boolean; vin?: string | null }) {
  return NextResponse.json(
    {
      error: message,
      handled: true,
      needsVin: true,
      dealerBlocked: !!extra?.dealerBlocked,
      vin: extra?.vin || undefined,
    },
    { status: 422 }
  );
}

export function createListingFeedStickerHandlers(config: ListingFeedRouteConfig) {
  const { make, looksLikePaste, notFlag } = config;

  /**
   * A vehicle built from only free sources: the VIN read off the pasted page,
   * NHTSA's public decoder, the dealership the page names about itself, and its
   * advertised price. No factory option list, so must-haves aren't offered —
   * but the car and its dealership still reach the offer package, which is the
   * part the buyer actually needs.
   */
  async function freeImportResponse(
    vin: string,
    pasteUrl: string | null,
    resolved: { listingPrice?: number | null; dealer?: DealerPageIdentity }
  ) {
    const listingUrl = pasteUrl && /^https?:\/\//i.test(pasteUrl) ? pasteUrl.trim() : null;
    const decoded = await decodeVinFromNhtsa(vin).catch(() => null);
    const vehicle = freeVinImportVehicle({
      vin,
      decoded,
      dealer: resolved.dealer,
      listingPrice: resolved.listingPrice ?? null,
      listingUrl,
      fallbackMake: make.label,
    });

    if (!isUsableFreeImport(vehicle, decoded)) {
      return vinPasteError(
        hasVinIntegrityError(decoded)
          ? `That VIN doesn't check out — ${vin} fails its own check digit, so it isn't a valid ${make.label} VIN. Copy it again from the listing.`
          : `We couldn't read enough about that ${make.label} to add it. Check the VIN and try again.`,
        { vin }
      );
    }

    return NextResponse.json({
      handled: true,
      vin,
      // "unreleased" is the shared contract's way of saying there is no factory
      // build to show, and the wizard already hides the must-have picker on it.
      // Deliberately carries no `error`: the import succeeded.
      sticker: { status: "unreleased", pdfUrl: null, msrp: null, source: "free_decode" },
      vehicle,
      listingPrice: vehicle.dealerPrice > 0 ? vehicle.dealerPrice : null,
      mustHaveLines: [],
      niceToHaveLines: [],
      filterableOptions: [],
      pdfUrl: null,
    });
  }

  async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null; request: Request }) {
    const paste = opts.paste || "";
    const makeish = looksLikePaste(paste) || looksLikePaste(opts.vin || "");
    const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
    // A forced VIN arrives on the cross-OEM retry: another make's route read
    // the page, found a VIN that wasn't its own, and handed it here. The VIN
    // is settled, but the page is still where the dealership and the
    // advertised price live — so a pasted URL is still fetched. Skipping it
    // meant every retried import landed with no dealer, which on step 2 read
    // as a package with one dealership when the buyer had added two.
    const pageResolution =
      forcedVin && looksLikeUrl(paste)
        ? await resolvePasteVin(paste)
        : forcedVin
          ? null
          : await resolvePasteVin(paste);
    const resolved = forcedVin
      ? {
          vin: forcedVin,
          dealerBlocked: false,
          source: "paste" as const,
          listingPrice: pageResolution?.listingPrice ?? null,
          dealer: pageResolution?.dealer,
        }
      : pageResolution!;

    let vin = resolved.vin;
    if (vin && makeish && !make.isVin(vin)) {
      vin = null;
    }

    if (!vin) {
      if (!makeish && isExplicitNonFordDemoPaste(paste)) {
        return NextResponse.json({ handled: false, [notFlag]: true, error: factoryBuildUnavailableError(null) });
      }
      if (resolved.dealerBlocked || makeish) {
        return vinPasteError(
          resolved.dealerBlocked
            ? "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing."
            : "Could not read a VIN from that page. Paste the 17-character VIN.",
          { dealerBlocked: resolved.dealerBlocked }
        );
      }
      return vinPasteError("Could not find a 17-character VIN in that paste.");
    }

    if (!make.isVin(vin)) {
      if (makeish) {
        return vinPasteError(`Could not read a ${make.label} VIN from that page. Paste the 17-character VIN.`, { vin });
      }
      return NextResponse.json({ handled: false, [notFlag]: true, vin, error: factoryBuildUnavailableError(vin) });
    }

    // Paid VIN/options decode — off by default (see lib/apiSpendGuard.ts).
    // This is a deliberate kill switch, not a bug: flip
    // PAID_VIN_DECODE_ENABLED=true only once the seed shortlist's honesty
    // checks are green.
    if (!isPaidVinDecodeEnabled()) {
      return freeImportResponse(vin, opts.pasteUrl, resolved);
    }
    // getListingFeedBuild fires 1-2 real MarketCheck calls per VIN (search,
    // plus a conditional listing-detail call) — charge the worst case.
    const blocked = guardPaidDecode({
      kind: `listing_feed_sticker_${make.key}`,
      request: opts.request,
      estCostUsd: MARKETCHECK_CALL_COST_USD.search + MARKETCHECK_CALL_COST_USD.listingDetail,
    });
    if (blocked) {
      // Over the daily budget, but the free signals cost nothing — same
      // degraded-but-usable import rather than a dead end for the buyer.
      return freeImportResponse(vin, opts.pasteUrl, resolved);
    }

    try {
      const build = await getListingFeedBuild(make, vin);
      const listingUrl = opts.pasteUrl && /^https?:\/\//i.test(opts.pasteUrl) ? opts.pasteUrl.trim() : null;
      if (build.status !== "found") {
        return NextResponse.json(
          {
            handled: true,
            vin,
            sticker: { status: build.status === "not_found" ? "unreleased" : "error", pdfUrl: null, msrp: null },
            vehicle: null,
            error: build.note || factoryBuildFailedError(vin),
          },
          { status: build.status === "not_found" ? 200 : 502 }
        );
      }
      const mustHaveLines = defaultMustHaveLines(build);
      const niceToHaveLines = defaultNiceToHaveLines(build, mustHaveLines);
      const listingPrice =
        build.listingPrice || (resolved.listingPrice && resolved.listingPrice > 0 ? resolved.listingPrice : null);
      return NextResponse.json({
        handled: true,
        vin,
        // "sticker" keeps the shared paste-import contract; there is no PDF
        // for these makes — status "released" means the live build was found.
        sticker: { status: "released", pdfUrl: null, msrp: build.msrp, source: "dealer_listing_feed" },
        build,
        vehicle: buildToVehicle(make.key, build, listingUrl),
        listingPrice,
        mustHaveLines,
        niceToHaveLines,
        filterableOptions: filterableFactoryOptions(build).map((o) => ({ ...o, source: "listing" as const })),
        pdfUrl: null,
        note: build.note,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : factoryBuildFailedError(vin);
      return NextResponse.json({ error: message, handled: true, needsVin: false, vin }, { status: 502 });
    }
  }

  async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const vin = searchParams.get("vin")?.trim().toUpperCase();
    if (!vin) {
      return NextResponse.json({ error: "vin is required" }, { status: 400 });
    }
    return lookup({ vin, paste: vin, pasteUrl: null, request });
  }

  async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    const paste = typeof body?.paste === "string" ? body.paste : "";
    const vinArg = typeof body?.vin === "string" ? body.vin : "";
    return lookup({ vin: vinArg, paste, pasteUrl: paste, request });
  }

  return { GET, POST };
}
