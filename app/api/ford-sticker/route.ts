export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptionBreakout,
  getFordSticker,
  isExplicitNonFordDemoPaste,
  isFordOrLincolnVin,
  looksLikeFordOrLincolnPaste,
  resolvePasteVin,
} from "@/lib/fordSticker";
import { stickerToVehicle } from "@/lib/vinSearch";
import { currentDealerForVin } from "@/lib/listingSheet";

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
  const fordish = looksLikeFordOrLincolnPaste(paste) || looksLikeFordOrLincolnPaste(opts.vin || "");
  const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
  const resolved = forcedVin
    ? { vin: forcedVin, dealerBlocked: false, source: "paste" as const }
    : await resolvePasteVin(paste);

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
        { dealerBlocked: resolved.dealerBlocked }
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
    const [sticker, currentDealer] = await Promise.all([
      getFordSticker(vin),
      currentDealerForVin(vin),
    ]);
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
        sticker.status === "released"
          ? stickerToVehicle(sticker, listingUrl, listingPrice, currentDealer)
          : null,
      listingPrice,
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
    const message = err instanceof Error ? err.message : "Failed to fetch Ford window sticker";
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
