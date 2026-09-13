export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// POST /api/used-vin { paste, vin?, condition: "used" | "cpo" } — a used or
// certified pre-owned car on the same quote-request pipe. Year / make /
// model / trim come from the VIN (NHTSA); the dealership from the VIN's
// inventory sighting or the pasted link's hostname; nothing from a factory
// sticker and never from the dealer's page. The car is flagged used/cpo
// and dealer_listing_only — the dealer confirms the rest.
import { NextResponse } from "next/server";
import { buildFreeImport } from "@/lib/freeVinImportServer";
import { blockedDealerPayload, resolveRoutePaste, resolveVehicleDealer } from "@/lib/pasteResolutionServer";
import { decodeVinFromNhtsa } from "@/lib/vinDecoder";
import { looksLikeUrl } from "@/lib/fordSticker";
import { detectUsedCondition, USED_VEHICLES_ENABLED, type UsedCondition } from "@/lib/usedVehicle";

export async function POST(request: Request) {
  if (!USED_VEHICLES_ENABLED) return NextResponse.json({ error: "Used vehicles are not enabled." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const paste = typeof body?.paste === "string" ? body.paste : "";
  const vinArg = typeof body?.vin === "string" ? body.vin.trim().toUpperCase() : "";
  const condition: UsedCondition = body?.condition === "cpo" ? "cpo" : body?.condition === "used" ? "used" : detectUsedCondition(paste) || "used";
  const forcedVin = vinArg.length === 17 ? vinArg : "";
  const resolved = await resolveRoutePaste(paste, forcedVin);
  const vin = resolved.vin;
  if (!vin) {
    return NextResponse.json(
      {
        error: resolved.dealerBlocked ? "That dealer site blocked the VIN lookup. Paste the 17-character VIN from the listing." : "Could not find a 17-character VIN in that paste.",
        handled: true,
        needsVin: true,
        dealerBlocked: !!resolved.dealerBlocked,
        dealer: blockedDealerPayload(resolved.dealer),
        listingUrl: looksLikeUrl(paste) ? paste.trim() : undefined,
      },
      { status: 422 }
    );
  }
  const decoded = await decodeVinFromNhtsa(vin).catch(() => null);
  const free = await buildFreeImport({ vin, pasteUrl: paste && looksLikeUrl(paste) ? paste : null, source: resolved, makeLabel: decoded?.make || "vehicle" });
  if (!free.ok) return NextResponse.json({ error: free.error, handled: true, needsVin: false, vin }, { status: 422 });
  // Dealer: inventory sighting → listing hostname. No window sticker on a used car.
  const vehicle = await resolveVehicleDealer({ ...free.vehicle, condition }, resolved, null);
  return NextResponse.json({ ...free.payload, vehicle, condition, usedVehicle: true });
}
