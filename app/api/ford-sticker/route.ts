export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { DealerPageIdentity } from "@/lib/dealerPageIdentity";
import {
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptionBreakout,
  getFordSticker,
  isExplicitNonFordDemoPaste,
  isFordOrLincolnVin,
  looksLikeFordOrLincolnPaste,
  looksLikeUrl,
} from "@/lib/fordSticker";
import { stickerToVehicle } from "@/lib/vinSearch";
import { factoryBuildFailedError } from "@/lib/pasteImport";
import { buildFreeImport, buildStickerUnavailableImport, fillMissingYear } from "@/lib/freeVinImportServer";
import { blockedDealerPayload, resolveRoutePaste, resolveVehicleDealer } from "@/lib/pasteResolutionServer";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vin = searchParams.get("vin")?.trim().toUpperCase();
  if (!vin) {
    return NextResponse.json({ error: "vin is required" }, { status: 400 });
  }
  return lookup({ vin, paste: vin, pasteUrl: null, request });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const paste = typeof body?.paste === "string" ? body.paste : "";
  const vinArg = typeof body?.vin === "string" ? body.vin : "";
  return lookup({ vin: vinArg, paste, pasteUrl: paste, request });
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
      dealer: blockedDealerPayload(extra?.dealer),
      listingUrl: extra?.listingUrl || undefined,
    },
    { status: 422 }
  );
}

async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null; request: Request }) {
  const paste = opts.paste || "";
  const fordish = looksLikeFordOrLincolnPaste(paste) || looksLikeFordOrLincolnPaste(opts.vin || "");
  const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
  const resolved = await resolveRoutePaste(paste, forcedVin);

  let vin = resolved.vin;
  if (vin && fordish && !isFordOrLincolnVin(vin)) {
    vin = null;
  }

  if (!vin) {
    if (!fordish && isExplicitNonFordDemoPaste(paste)) {
      return NextResponse.json({ handled: false, notFord: true });
    }
    if (resolved.dealerBlocked || fordish) {
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

  if (!isFordOrLincolnVin(vin)) {
    if (fordish) {
      return vinPasteError("Could not read a Ford VIN from that page. Paste the 17-character VIN.");
    }
    return NextResponse.json({
      handled: false,
      notFord: true,
      vin,
    });
  }

  try {
    // The window sticker is the official OEM document and free to read.
    // No paid current-dealer lookup: the dealership is settled from the
    // listing (page or hostname) or the sticker's own sold-to block —
    // see resolveVehicleDealer.
    const sticker = await getFordSticker(vin);
    const listingUrl =
      opts.pasteUrl && /^https?:\/\//i.test(opts.pasteUrl) ? opts.pasteUrl.trim() : null;
    const mustHaveLines = defaultMustHaveLines(sticker);
    const niceToHaveLines = defaultNiceToHaveLines(sticker, mustHaveLines);
    const listingPrice = resolved.listingPrice && resolved.listingPrice > 0 ? resolved.listingPrice : null;

    // No released sticker — the car is still real. Import it on the free
    // path (NHTSA + the listing page) flagged dealer-listing-only, instead
    // of returning vehicle: null and dead-ending the buyer.
    if (sticker.status !== "released") {
      const free = await buildFreeImport({
        vin,
        pasteUrl: opts.pasteUrl,
        source: resolved,
        makeLabel: "Ford",
        sticker: sticker as unknown as Record<string, unknown>,
      });
      if (!free.ok) return vinPasteError(free.error);
      return NextResponse.json(free.payload);
    }

    // A released sticker the parser only half-read (no year) must not ship
    // as "0 Ford F-150" — fill the year from the VIN.
    const vehicle = await resolveVehicleDealer(
      await fillMissingYear(stickerToVehicle(sticker, listingUrl, listingPrice, null)),
      resolved,
      sticker.dealerSoldTo
    );
    vehicle.buildConfidence = "verified_factory";
    return NextResponse.json({
      handled: true,
      vin,
      sticker,
      vehicle,
      buildConfidence: "verified_factory",
      listingPrice,
      pageUnread: Boolean(resolved.pageBlocked),
      mustHaveLines,
      niceToHaveLines,
      filterableOptions: filterableFactoryOptionBreakout(sticker).map((o) => ({
        name: o.description,
        code: o.code,
        description: o.description,
        price: o.price,
        isPackageChild: o.isPackageChild,
        source: "sticker" as const,
      })),
      pdfUrl: sticker.pdfUrl,
    });
  } catch (err: unknown) {
    // The factory sticker didn't come back (edge hiccup, bot shield,
    // network). The VIN is valid and the desk may already be matched, so
    // fall back to the free decode and say the sticker is temporarily
    // unavailable — the buyer can still confirm and continue.
    const reason = err instanceof Error ? err.message : factoryBuildFailedError(vin);
    console.log(`[ford-sticker] ${vin} sticker unavailable → free import: ${reason}`);
    const free = await buildStickerUnavailableImport({ vin, pasteUrl: opts.pasteUrl, source: resolved, makeLabel: "Ford", reason }).catch(() => null);
    if (free && free.ok) return NextResponse.json(free.payload);
    return NextResponse.json({ error: reason, handled: true, needsVin: false, vin, stickerUnavailable: { reason } }, { status: 502 });
  }
}
