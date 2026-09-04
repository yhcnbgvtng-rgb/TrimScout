/**
 * Shared /api/{make}-sticker handlers for makes whose factory build comes
 * from the dealer listing feed (lib/listingFeedBuild.ts). Same
 * request/response contract as the sticker-PDF routes, so
 * lib/pasteImport.ts dispatches to every make the same way.
 */

import { NextResponse } from "next/server";
import { isExplicitNonFordDemoPaste, resolvePasteVin } from "./fordSticker";
import {
  buildToVehicle,
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getListingFeedBuild,
  type ListingFeedMake,
} from "./listingFeedBuild";
import { factoryBuildFailedError, factoryBuildUnavailableError } from "./pasteImport";

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

  async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null }) {
    const paste = opts.paste || "";
    const makeish = looksLikePaste(paste) || looksLikePaste(opts.vin || "");
    const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
    const resolved = forcedVin
      ? { vin: forcedVin, dealerBlocked: false, source: "paste" as const, listingPrice: null as number | null }
      : await resolvePasteVin(paste);

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
    return lookup({ vin, paste: vin, pasteUrl: null });
  }

  async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    const paste = typeof body?.paste === "string" ? body.paste : "";
    const vinArg = typeof body?.vin === "string" ? body.vin : "";
    return lookup({ vin: vinArg, paste, pasteUrl: paste });
  }

  return { GET, POST };
}
