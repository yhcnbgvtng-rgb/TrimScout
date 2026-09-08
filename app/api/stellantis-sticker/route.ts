export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isExplicitNonFordDemoPaste, resolvePasteVin } from "@/lib/fordSticker";
import {
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getStellantisSticker,
  isStellantisVin,
  looksLikeStellantisPaste,
  stellantisStickerToVehicle,
} from "@/lib/stellantisSticker";
import { factoryBuildFailedError, factoryBuildUnavailableError } from "@/lib/pasteImport";
import { currentDealerForVin } from "@/lib/listingSheet";
import { guardPaidDecode, MARKETCHECK_CALL_COST_USD } from "@/lib/apiSpendGuard";

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

async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null; request: Request }) {
  const paste = opts.paste || "";
  const stellantisish = looksLikeStellantisPaste(paste) || looksLikeStellantisPaste(opts.vin || "");
  const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
  const resolved = forcedVin
    ? { vin: forcedVin, dealerBlocked: false, source: "paste" as const, listingPrice: null as number | null }
    : await resolvePasteVin(paste);

  let vin = resolved.vin;
  if (vin && stellantisish && !isStellantisVin(vin)) {
    vin = null;
  }

  if (!vin) {
    if (!stellantisish && isExplicitNonFordDemoPaste(paste)) {
      return NextResponse.json({
        handled: false,
        notStellantis: true,
        error: factoryBuildUnavailableError(null),
      });
    }
    if (resolved.dealerBlocked || stellantisish) {
      return vinPasteError(
        resolved.dealerBlocked
          ? "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing."
          : "Could not read a VIN from that page. Paste the 17-character VIN.",
        { dealerBlocked: resolved.dealerBlocked }
      );
    }
    return vinPasteError("Could not find a 17-character VIN in that paste.");
  }

  if (!isStellantisVin(vin)) {
    if (stellantisish) {
      return vinPasteError(
        `Could not read a Chrysler/Dodge/Jeep/Ram VIN from that page. Paste the 17-character VIN.`,
        { vin }
      );
    }
    return NextResponse.json({
      handled: false,
      notStellantis: true,
      vin,
      error: factoryBuildUnavailableError(vin),
    });
  }

  try {
    // The window-sticker fetch itself is free (official Stellantis PDF).
    // currentDealerForVin is the one real MarketCheck call in this route —
    // gated the same as every other paid call; when blocked, degrade to
    // "current dealer unknown" rather than failing the free sticker lookup.
    const dealerBlocked = guardPaidDecode({
      kind: "stellantis_current_dealer",
      request: opts.request,
      estCostUsd: MARKETCHECK_CALL_COST_USD.search,
    });
    const [sticker, currentDealer] = await Promise.all([
      getStellantisSticker(vin),
      dealerBlocked ? Promise.resolve(null) : currentDealerForVin(vin),
    ]);
    const listingUrl =
      opts.pasteUrl && /^https?:\/\//i.test(opts.pasteUrl) ? opts.pasteUrl.trim() : null;
    const mustHaveLines = defaultMustHaveLines(sticker);
    const niceToHaveLines = defaultNiceToHaveLines(sticker, mustHaveLines);
    const listingPrice = resolved.listingPrice && resolved.listingPrice > 0 ? resolved.listingPrice : null;
    const vehicle =
      sticker.status === "released" && sticker.vin === vin
        ? stellantisStickerToVehicle(sticker, listingUrl, listingPrice, currentDealer)
        : null;
    if (vehicle && vehicle.vin !== vin) {
      return vinPasteError(factoryBuildFailedError(vin), { vin });
    }
    return NextResponse.json({
      handled: true,
      vin,
      sticker,
      vehicle,
      listingPrice,
      mustHaveLines,
      niceToHaveLines,
      filterableOptions: filterableFactoryOptions(sticker).map((o) => ({
        name: o.name,
        code: o.code || null,
        description: o.name,
        price: o.price,
        isPackageChild: o.isPackageChild,
        source: "sticker" as const,
      })),
      pdfUrl: sticker.pdfUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : factoryBuildFailedError(vin);
    return NextResponse.json(
      {
        error: message,
        handled: true,
        needsVin: false,
        vin,
      },
      { status: 502 }
    );
  }
}
