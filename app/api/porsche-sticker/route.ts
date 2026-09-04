export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isExplicitNonFordDemoPaste, resolvePasteVin } from "@/lib/fordSticker";
import {
  defaultMustHaveLines,
  defaultNiceToHaveLines,
  filterableFactoryOptions,
  getPorscheBuild,
  isPorscheVin,
  looksLikePorschePaste,
  porscheBuildToVehicle,
} from "@/lib/porscheSticker";
import { factoryBuildFailedError, factoryBuildUnavailableError } from "@/lib/pasteImport";

// Porsche factory options, sourced from the dealer's live listing feed via
// the listings provider we already contract with — see lib/porscheSticker.ts
// for why that's the only reachable source (no public sticker endpoint,
// Finder bot-blocked, dealer VDPs 403 server fetches). Same request/response
// contract as the other /api/{oem}-sticker routes so lib/pasteImport.ts can
// dispatch to it unchanged.

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

async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null }) {
  const paste = opts.paste || "";
  const porscheish = looksLikePorschePaste(paste) || looksLikePorschePaste(opts.vin || "");
  const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
  const resolved = forcedVin
    ? { vin: forcedVin, dealerBlocked: false, source: "paste" as const, listingPrice: null as number | null }
    : await resolvePasteVin(paste);

  let vin = resolved.vin;
  if (vin && porscheish && !isPorscheVin(vin)) {
    vin = null;
  }

  if (!vin) {
    if (!porscheish && isExplicitNonFordDemoPaste(paste)) {
      return NextResponse.json({
        handled: false,
        notPorsche: true,
        error: factoryBuildUnavailableError(null),
      });
    }
    if (resolved.dealerBlocked || porscheish) {
      return vinPasteError(
        resolved.dealerBlocked
          ? "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing."
          : "Could not read a VIN from that page. Paste the 17-character VIN.",
        { dealerBlocked: resolved.dealerBlocked }
      );
    }
    return vinPasteError("Could not find a 17-character VIN in that paste.");
  }

  if (!isPorscheVin(vin)) {
    if (porscheish) {
      return vinPasteError("Could not read a Porsche VIN from that page. Paste the 17-character VIN.", { vin });
    }
    return NextResponse.json({
      handled: false,
      notPorsche: true,
      vin,
      error: factoryBuildUnavailableError(vin),
    });
  }

  try {
    const build = await getPorscheBuild(vin);
    const listingUrl =
      opts.pasteUrl && /^https?:\/\//i.test(opts.pasteUrl) ? opts.pasteUrl.trim() : null;
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
      // for Porsche — status "released" means the live build was found.
      sticker: { status: "released", pdfUrl: null, msrp: build.msrp, source: "dealer_listing_feed" },
      build,
      vehicle: porscheBuildToVehicle(build, listingUrl),
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
