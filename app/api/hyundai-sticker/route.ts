export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { DealerPageIdentity } from "@/lib/dealerPageIdentity";
import { isExplicitNonFordDemoPaste, looksLikeUrl } from "@/lib/fordSticker";
import { filterableHyundaiOptions, getHyundaiSticker, hyundaiStickerToVehicle, isHyundaiVin, looksLikeHyundaiPaste, HYUNDAI_STICKER_PENDING_COPY } from "@/lib/hyundaiSticker";
import { factoryBuildFailedError, factoryBuildUnavailableError } from "@/lib/pasteImport";
import { buildFreeImport, buildStickerUnavailableImport, fillMissingYear } from "@/lib/freeVinImportServer";
import { blockedDealerPayload, resolveRoutePaste, resolveVehicleDealer } from "@/lib/pasteResolutionServer";

// Hyundai factory window sticker: DealerFire's public VIN-keyed PDF first,
// Hyundai's own endpoint second, Genesis's for the shared 5NM prefix — see
// lib/hyundaiSticker.ts. No dealer-page HTML is ever read. A VIN with no
// published label yet imports on the free decode as "sticker pending"; the
// quote flow is never gated on it.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vin = searchParams.get("vin")?.trim().toUpperCase();
  if (!vin) return NextResponse.json({ error: "vin is required" }, { status: 400 });
  return lookup({ vin, paste: vin, pasteUrl: null });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const paste = typeof body?.paste === "string" ? body.paste : "";
  const vinArg = typeof body?.vin === "string" ? body.vin : "";
  return lookup({ vin: vinArg, paste, pasteUrl: paste });
}

function vinPasteError(message: string, extra?: { dealerBlocked?: boolean; vin?: string | null; dealer?: DealerPageIdentity; listingUrl?: string | null }) {
  return NextResponse.json(
    { error: message, handled: true, needsVin: true, dealerBlocked: !!extra?.dealerBlocked, dealer: blockedDealerPayload(extra?.dealer), listingUrl: extra?.listingUrl || undefined, vin: extra?.vin || undefined },
    { status: 422 }
  );
}

async function lookup(opts: { vin?: string; paste?: string; pasteUrl: string | null }) {
  const paste = opts.paste || "";
  const hyundaiish = looksLikeHyundaiPaste(paste) || looksLikeHyundaiPaste(opts.vin || "");
  const forcedVin = opts.vin && opts.vin.trim().length === 17 ? opts.vin.trim().toUpperCase() : "";
  const resolved = await resolveRoutePaste(paste, forcedVin);

  let vin = resolved.vin;
  if (vin && hyundaiish && !isHyundaiVin(vin)) vin = null;
  if (!vin) {
    if (!hyundaiish && isExplicitNonFordDemoPaste(paste)) return NextResponse.json({ handled: false, notHyundai: true, error: factoryBuildUnavailableError(null) });
    if (resolved.dealerBlocked || hyundaiish) {
      return vinPasteError(
        resolved.dealerBlocked ? "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing." : "Could not read a VIN from that page. Paste the 17-character VIN.",
        { dealerBlocked: resolved.dealerBlocked, dealer: resolved.dealer, listingUrl: looksLikeUrl(paste) ? paste.trim() : null }
      );
    }
    return vinPasteError("Could not find a 17-character VIN in that paste.");
  }
  if (!isHyundaiVin(vin)) {
    if (hyundaiish) return vinPasteError("Could not read a Hyundai VIN from that page. Paste the 17-character VIN.", { vin });
    return NextResponse.json({ handled: false, notHyundai: true, vin, error: factoryBuildUnavailableError(vin) });
  }

  try {
    const sticker = await getHyundaiSticker(vin);
    const listingUrl = opts.pasteUrl && /^https?:\/\//i.test(opts.pasteUrl) ? opts.pasteUrl.trim() : null;
    const listingPrice = resolved.listingPrice && resolved.listingPrice > 0 ? resolved.listingPrice : null;
    const makeLabel = sticker.make || "Hyundai";
    if (!(sticker.status === "released" && sticker.vin === vin)) {
      // Sticker pending (new inventory lists before the digital Monroney
      // exists) — import on the free decode, no warning, nothing gated.
      const free = await buildFreeImport({ vin, pasteUrl: opts.pasteUrl, source: resolved, makeLabel, sticker: sticker as unknown as Record<string, unknown> });
      if (!free.ok) return vinPasteError(free.error, { vin });
      return NextResponse.json({ ...free.payload, stickerPending: true, stickerPendingNote: HYUNDAI_STICKER_PENDING_COPY });
    }
    const vehicle = await resolveVehicleDealer(await fillMissingYear(hyundaiStickerToVehicle(sticker, listingUrl, listingPrice, null)), resolved, sticker.dealerSoldTo);
    vehicle.buildConfidence = "verified_factory";
    if (vehicle.vin !== vin) return vinPasteError(factoryBuildFailedError(vin), { vin });
    return NextResponse.json({
      handled: true,
      vin,
      sticker,
      stickerSource: sticker.source || null,
      vehicle,
      buildConfidence: "verified_factory",
      listingPrice,
      pageUnread: Boolean(resolved.pageBlocked),
      mustHaveLines: [],
      niceToHaveLines: sticker.options.filter((o) => !o.isStandard && !o.isPackageChild).map((o) => o.name),
      filterableOptions: filterableHyundaiOptions(sticker).map((o) => ({ name: o.name, code: o.code || null, description: o.name, price: o.price, isPackageChild: o.isPackageChild, source: "sticker" as const })),
      pdfUrl: sticker.pdfUrl,
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : factoryBuildFailedError(vin);
    console.log(`[hyundai-sticker] ${vin} sticker unavailable → free import: ${reason}`);
    const free = await buildStickerUnavailableImport({ vin, pasteUrl: opts.pasteUrl, source: resolved, makeLabel: "Hyundai", reason }).catch(() => null);
    if (free && free.ok) return NextResponse.json(free.payload);
    return NextResponse.json({ error: reason, handled: true, needsVin: false, vin, stickerUnavailable: { reason } }, { status: 502 });
  }
}
