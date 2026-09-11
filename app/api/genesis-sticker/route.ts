export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isExplicitNonFordDemoPaste, resolvePasteVin } from "@/lib/fordSticker";
import {
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getGenesisSticker,
  isGenesisVin,
  looksLikeGenesisPaste,
  genesisStickerToVehicle,
} from "@/lib/genesisSticker";
import { factoryBuildFailedError, factoryBuildUnavailableError } from "@/lib/pasteImport";
import { currentDealerForVin } from "@/lib/listingSheet";
import { guardPaidDecode, MARKETCHECK_CALL_COST_USD } from "@/lib/apiSpendGuard";
import { buildFreeImport, fillMissingYear } from "@/lib/freeVinImportServer";

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
  const genesisish = looksLikeGenesisPaste(paste) || looksLikeGenesisPaste(opts.vin || "");
  const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
  const resolved = forcedVin
    ? { vin: forcedVin, dealerBlocked: false, source: "paste" as const, listingPrice: null as number | null }
    : await resolvePasteVin(paste);

  let vin = resolved.vin;
  if (vin && genesisish && !isGenesisVin(vin)) {
    vin = null;
  }

  if (!vin) {
    if (!genesisish && isExplicitNonFordDemoPaste(paste)) {
      return NextResponse.json({
        handled: false,
        notGenesis: true,
        error: factoryBuildUnavailableError(null),
      });
    }
    if (resolved.dealerBlocked || genesisish) {
      return vinPasteError(
        resolved.dealerBlocked
          ? "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing."
          : "Could not read a VIN from that page. Paste the 17-character VIN.",
        { dealerBlocked: resolved.dealerBlocked }
      );
    }
    return vinPasteError("Could not find a 17-character VIN in that paste.");
  }

  if (!isGenesisVin(vin)) {
    if (genesisish) {
      return vinPasteError(`Could not read a Genesis VIN from that page. Paste the 17-character VIN.`, { vin });
    }
    return NextResponse.json({
      handled: false,
      notGenesis: true,
      vin,
      error: factoryBuildUnavailableError(vin),
    });
  }

  try {
    // The window-sticker fetch itself is free (official Genesis PDF).
    // currentDealerForVin is the one real MarketCheck call in this route —
    // gated the same as every other paid call; when blocked, degrade to
    // "current dealer unknown" rather than failing the free sticker lookup.
    const dealerBlocked = guardPaidDecode({
      kind: "genesis_current_dealer",
      request: opts.request,
      estCostUsd: MARKETCHECK_CALL_COST_USD.search,
    });
    const [sticker, currentDealer] = await Promise.all([
      getGenesisSticker(vin),
      dealerBlocked ? Promise.resolve(null) : currentDealerForVin(vin),
    ]);
    const listingUrl =
      opts.pasteUrl && /^https?:\/\//i.test(opts.pasteUrl) ? opts.pasteUrl.trim() : null;
    const mustHaveLines = defaultMustHaveLines(sticker);
    const niceToHaveLines = defaultNiceToHaveLines(sticker, mustHaveLines);
    const listingPrice = resolved.listingPrice && resolved.listingPrice > 0 ? resolved.listingPrice : null;
    // No released sticker — the car is still real. Import it on the free
    // path (NHTSA + the listing page) flagged dealer-listing-only, instead
    // of returning vehicle: null and dead-ending the buyer.
    if (!(sticker.status === "released" && sticker.vin === vin)) {
      const free = await buildFreeImport({
        vin,
        pasteUrl: opts.pasteUrl,
        source: resolved,
        makeLabel: "Genesis",
        sticker: sticker as unknown as Record<string, unknown>,
      });
      if (!free.ok) return vinPasteError(free.error, { vin });
      return NextResponse.json(free.payload);
    }
    // A released sticker the parser only half-read (no year) must not ship
    // as "0 Genesis …" — fill the year from the VIN.
    const vehicle = await fillMissingYear(genesisStickerToVehicle(sticker, listingUrl, listingPrice, currentDealer));
    vehicle.buildConfidence = "verified_factory";
    if (vehicle.vin !== vin) {
      return vinPasteError(factoryBuildFailedError(vin), { vin });
    }
    return NextResponse.json({
      handled: true,
      vin,
      sticker,
      vehicle,
      buildConfidence: "verified_factory",
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
