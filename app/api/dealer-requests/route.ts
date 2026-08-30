import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listActiveDealRequests } from "@/lib/dealsApi";
import { fetchVehiclesFromBox, fetchFacetsFromBox } from "@/lib/lightsailClient";
import { calculateDistanceMiles } from "@/lib/otdCalculator";
import type { DealerInboundRequest } from "@/lib/types";

// Every brand this pipeline currently tracks — same list DealerAnalytics
// already uses to discover which brand(s) a dealer's real inventory
// actually carries.
const BRAND_CODES = ["porsche", "ford", "chevrolet", "acura", "audi", "mclaren"];

export async function GET() {
  const session = await auth();
  const user = session?.user as any;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer." }, { status: 401 });
  }
  if (!user.dealerName) {
    return NextResponse.json({ requests: [] });
  }

  // Which brands does this dealer actually carry, and where are they —
  // exact pattern app/api/dealer-analytics/route.ts already uses.
  const perBrand = await Promise.all(
    BRAND_CODES.map(async (brand) => {
      const vehiclesRes = await fetchVehiclesFromBox({ brand, dealer: user.dealerName, pageSize: 1 });
      if (!vehiclesRes || vehiclesRes.stats.totalActive === 0) return null;
      const facetsRes = await fetchFacetsFromBox({ brand, dealer: user.dealerName });
      const models = new Set((facetsRes?.facets.model || []).map((f) => f.value));
      const v = vehiclesRes.vehicles[0];
      return {
        brand,
        models,
        dealerCity: v?.dealer_city || null,
        dealerState: v?.state || null,
        dealerLat: v?.dealer_latitude ? Number(v.dealer_latitude) : undefined,
        dealerLng: v?.dealer_longitude ? Number(v.dealer_longitude) : undefined,
      };
    })
  );
  const carriedBrands = perBrand.filter((b): b is NonNullable<typeof b> => b !== null);
  if (carriedBrands.length === 0) {
    return NextResponse.json({ requests: [] });
  }

  const activeRequests = await listActiveDealRequests();

  const matched: DealerInboundRequest[] = [];
  for (const req of activeRequests) {
    const brandInfo = carriedBrands.find((b) => b.brand === req.referenceBrandCode);
    if (!brandInfo) continue;
    if (!brandInfo.models.has(req.referenceModel)) continue;

    let distanceMiles = 0;
    if (brandInfo.dealerLat && brandInfo.dealerLng) {
      distanceMiles = calculateDistanceMiles(req.buyerZip, {
        city: brandInfo.dealerCity || "",
        state: brandInfo.dealerState || "",
        lat: brandInfo.dealerLat,
        lng: brandInfo.dealerLng,
      });
      if (distanceMiles > req.searchRadiusMiles) continue;
    }
    if (req.sameStateOnly && brandInfo.dealerState && brandInfo.dealerState !== req.buyerState) continue;

    matched.push({
      requestId: req.id,
      buyerAlias: `Buyer #${req.buyerUserId}`,
      buyerState: req.buyerState,
      distanceMiles: Math.round(distanceMiles),
      strategy: req.strategy,
      referenceBrandCode: req.referenceBrandCode,
      referenceVin: req.referenceVin,
      referenceYear: req.referenceYear,
      referenceMake: req.referenceMake,
      referenceModel: req.referenceModel,
      referenceTrim: req.referenceTrim,
      referencePrice: req.referencePrice,
      referenceMsrp: req.referenceMsrp,
      referenceImageUrl: req.referenceImageUrl,
      targetOtdPrice: req.targetOtdPrice,
      targetDiscountPercent: req.targetDiscountPercent,
      paymentMethod: req.paymentMethod,
      tradeIn: req.tradeIn as any,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt,
    });
  }

  return NextResponse.json({ requests: matched });
}
