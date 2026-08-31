export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getGmSticker,
  isGmVin,
  looksLikeGmPaste,
  resolvePasteVin,
} from "@/lib/gmSticker";
import { isExplicitNonFordDemoPaste } from "@/lib/fordSticker";
import { gmStickerToVehicle } from "@/lib/vinSearch";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vin = searchParams.get("vin")?.trim().toUpperCase();
  if (!vin) {
    return NextResponse.json({ error: "vin is required" }, { status: 400 });
  }
  return lookup({ vin, paste: vin, pasteUrl: null });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const paste = typeof body?.paste === "string" ? body.paste : "";
  const vinArg = typeof body?.vin === "string" ? body.vin : "";
  return lookup({ vin: vinArg, paste, pasteUrl: paste });
}

function vinPasteError(message: string, extra?: { dealerBlocked?: boolean }) {
  return NextResponse.json(
    {
      error: message,
      handled: true,
      needsVin: true,
      dealerBlocked: !!extra?.dealerBlocked,
    },
    { status: 422 }
  );
}

async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null }) {
  const paste = opts.paste || "";
  const gmish = looksLikeGmPaste(paste) || looksLikeGmPaste(opts.vin || "");
  const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
  const resolved = forcedVin
    ? { vin: forcedVin, dealerBlocked: false, source: "paste" as const, listingPrice: null as number | null }
    : await resolvePasteVin(paste);

  let vin = resolved.vin;
  if (vin && gmish && !isGmVin(vin)) {
    vin = null;
  }

  if (!vin) {
    if (!gmish && isExplicitNonFordDemoPaste(paste)) {
      return NextResponse.json({ handled: false, notGm: true });
    }
    if (resolved.dealerBlocked || gmish) {
      return vinPasteError(
        resolved.dealerBlocked
          ? "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing."
          : "Could not read a VIN from that page. Paste the 17-character VIN.",
        { dealerBlocked: resolved.dealerBlocked }
      );
    }
    return vinPasteError("Could not find a 17-character VIN in that paste.");
  }

  if (!isGmVin(vin)) {
    if (gmish) {
      return vinPasteError("Could not read a Chevrolet/GM VIN from that page. Paste the 17-character VIN.");
    }
    return NextResponse.json({
      handled: false,
      notGm: true,
      vin,
    });
  }

  try {
    const sticker = await getGmSticker(vin);
    const listingUrl =
      opts.pasteUrl && /^https?:\/\//i.test(opts.pasteUrl) ? opts.pasteUrl.trim() : null;
    const mustHaveLines = defaultMustHaveLines(sticker);
    const niceToHaveLines = defaultNiceToHaveLines(sticker, mustHaveLines);
    const listingPrice = resolved.listingPrice && resolved.listingPrice > 0 ? resolved.listingPrice : null;
    return NextResponse.json({
      handled: true,
      vin,
      sticker,
      vehicle:
        sticker.status === "released" ? gmStickerToVehicle(sticker, listingUrl, listingPrice) : null,
      listingPrice,
      mustHaveLines,
      niceToHaveLines,
      filterableOptions: filterableFactoryOptions(sticker).map((o) => ({
        name: o.name,
        price: o.price,
        isPackageChild: o.isPackageChild,
        source: "sticker" as const,
      })),
      pdfUrl: sticker.pdfUrl,
      fetchSource: sticker.fetchSource,
      fetchKind: sticker.fetchKind,
      akamaiBlocked: sticker.fetchSource === "fixture" || sticker.fetchKind === "akamai_empty",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch GM window sticker";
    return NextResponse.json(
      {
        error: `${message} Paste the 17-character VIN if you have it.`,
        handled: true,
        needsVin: true,
        vin,
      },
      { status: 502 }
    );
  }
}
