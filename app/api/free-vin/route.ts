export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { looksLikeUrl } from "@/lib/fordSticker";
import { buildFreeImport } from "@/lib/freeVinImportServer";
import { vinPasteError } from "@/lib/listingFeedStickerRoute";
import { resolveRoutePaste } from "@/lib/pasteResolutionServer";

/**
 * The catch-all behind every /api/{make}-sticker route: a VIN no OEM route
 * claims (a WMI we haven't listed, a make we don't read stickers for) still
 * imports on the free path — NHTSA facts plus the link's dealership — flagged
 * dealer-listing-only, instead of dead-ending on "no factory build". The
 * make must come from NHTSA; nothing is invented.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const paste = typeof body?.paste === "string" ? body.paste : "";
  const vinArg = typeof body?.vin === "string" ? body.vin.trim().toUpperCase() : "";
  const forcedVin = vinArg.length === 17 ? vinArg : "";
  const resolved = await resolveRoutePaste(paste, forcedVin);
  const vin = resolved.vin;
  if (!vin) {
    return vinPasteError(
      resolved.dealerBlocked ? "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing." : "Could not read a VIN from that page. Paste the 17-character VIN.",
      { dealerBlocked: resolved.dealerBlocked, dealer: resolved.dealer, listingUrl: looksLikeUrl(paste) ? paste.trim() : null }
    );
  }
  const free = await buildFreeImport({ vin, pasteUrl: looksLikeUrl(paste) ? paste : null, source: resolved, makeLabel: "vehicle", fallbackMake: "" });
  if (!free.ok) return vinPasteError(free.error, { vin });
  return NextResponse.json(free.payload);
}
