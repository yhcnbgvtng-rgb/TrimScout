export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getFordSticker,
  isFordOrLincolnVin,
  resolveVinFromPaste,
} from "@/lib/fordSticker";
import { stickerToVehicle } from "@/lib/vinSearch";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vin = searchParams.get("vin")?.trim().toUpperCase();
  if (!vin) {
    return NextResponse.json({ error: "vin is required" }, { status: 400 });
  }
  return lookup({ vin, pasteUrl: null });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const paste = typeof body?.paste === "string" ? body.paste : "";
  const vinArg = typeof body?.vin === "string" ? body.vin : "";
  return lookup({ vin: vinArg, paste, pasteUrl: paste });
}

async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null }) {
  const vin = (opts.vin && opts.vin.trim().toUpperCase()) || (await resolveVinFromPaste(opts.paste || ""));
  if (!vin) {
    return NextResponse.json(
      { error: "Could not find a 17-character VIN in that paste.", handled: false },
      { status: 400 }
    );
  }

  if (!isFordOrLincolnVin(vin)) {
    return NextResponse.json({
      handled: false,
      notFord: true,
      vin,
    });
  }

  try {
    const sticker = await getFordSticker(vin);
    const listingUrl =
      opts.pasteUrl && /^https?:\/\//i.test(opts.pasteUrl) ? opts.pasteUrl.trim() : null;
    const mustHaveLines = defaultMustHaveLines(sticker);
    const niceToHaveLines = defaultNiceToHaveLines(sticker, mustHaveLines);
    return NextResponse.json({
      handled: true,
      vin,
      sticker,
      vehicle: sticker.status === "released" ? stickerToVehicle(sticker, listingUrl) : null,
      mustHaveLines,
      niceToHaveLines,
      filterableOptions: filterableFactoryOptions(sticker).map((o) => ({
        name: o.name,
        price: o.price,
        isPackageChild: o.isPackageChild,
        source: "sticker" as const,
      })),
      pdfUrl: sticker.pdfUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch Ford window sticker";
    return NextResponse.json({ error: message, handled: true, vin }, { status: 502 });
  }
}
