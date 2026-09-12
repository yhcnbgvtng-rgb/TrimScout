/**
 * Shared /api/{make}-sticker handlers for makes whose factory build comes
 * from the dealer listing feed (lib/listingFeedBuild.ts). Same
 * request/response contract as the sticker-PDF routes, so
 * lib/pasteImport.ts dispatches to every make the same way.
 */

import { NextResponse } from "next/server";
import { isExplicitNonFordDemoPaste, looksLikeUrl } from "./fordSticker";
import { type ListingFeedMake } from "./listingFeedBuild";
import { factoryBuildUnavailableError } from "./pasteImport";
import { buildFreeImport } from "./freeVinImportServer";
import type { DealerPageIdentity } from "./dealerPageIdentity";
import { blockedDealerPayload, resolveRoutePaste } from "./pasteResolutionServer";

export interface ListingFeedRouteConfig {
  make: ListingFeedMake;
  looksLikePaste: (paste: string) => boolean;
  /** e.g. "notPorsche" — the flag pasteImport uses to fall through to another OEM. */
  notFlag: string;
}

function vinPasteError(
  message: string,
  extra?: { dealerBlocked?: boolean; vin?: string | null; dealer?: DealerPageIdentity; listingUrl?: string | null }
) {
  return NextResponse.json(
    {
      error: message,
      handled: true,
      needsVin: true,
      dealerBlocked: !!extra?.dealerBlocked,
      vin: extra?.vin || undefined,
      // When the page refused us but the hostname named the store, say so:
      // the wizard can open the listing for the buyer with the rooftop
      // already identified, and only ask them for the VIN.
      dealer: blockedDealerPayload(extra?.dealer),
      listingUrl: extra?.listingUrl || undefined,
    },
    { status: 422 }
  );
}



export function createListingFeedStickerHandlers(config: ListingFeedRouteConfig) {
  const { make, looksLikePaste, notFlag } = config;

  /** See lib/freeVinImportServer.ts — shared with the window-sticker routes. */
  async function freeImportResponse(
    vin: string,
    pasteUrl: string | null,
    resolved: { listingPrice?: number | null; dealer?: DealerPageIdentity }
  ) {
    const free = await buildFreeImport({ vin, pasteUrl, source: resolved, makeLabel: make.label });
    if (!free.ok) return vinPasteError(free.error, { vin });
    return NextResponse.json(free.payload);
  }

  async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null; request: Request }) {
    const paste = opts.paste || "";
    const makeish = looksLikePaste(paste) || looksLikePaste(opts.vin || "");
    const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
    const resolved = await resolveRoutePaste(paste, forcedVin);

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
          {
            dealerBlocked: resolved.dealerBlocked,
            dealer: resolved.dealer,
            listingUrl: looksLikeUrl(paste) ? paste.trim() : null,
          }
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

    // v1: no MarketCheck. The free import (NHTSA facts + the link's
    // dealership) is the whole answer for these makes; the listing-feed
    // build in lib/listingFeedBuild.ts stays for a later metered release.
    return freeImportResponse(vin, opts.pasteUrl, resolved);
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
