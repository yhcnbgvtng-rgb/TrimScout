import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listActiveDealRequests, getRequestMarket, DealsApiError } from "@/lib/dealsApi";
import { isDealAcceptingResponses } from "@/lib/dealEngagementStore";
import { fetchVehiclesFromBox, fetchFacetsFromBox, fetchVehicleByVinFromBox, fetchBoxHealth } from "@/lib/lightsailClient";
import { calculateDistanceMiles } from "@/lib/otdCalculator";
import type { DealerInboundRequest } from "@/lib/types";

// Every brand this pipeline currently tracks, used to discover which
// brand(s) a dealer's real inventory actually carries.
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

  // Cheap, dedicated reachability check before anything else. Every
  // per-brand vehicle lookup below collapses "genuinely zero inventory" and
  // "the box is unreachable" to the same `null` — without this, a real
  // outage looked identical to "no requests match your inventory" (a
  // confident, wrong answer with no error). This is a real check, not a
  // decorative one: skip straight to a 502 if it fails.
  const health = await fetchBoxHealth();
  if (!health) {
    return NextResponse.json(
      { error: "Could not reach the inventory service — try again shortly." },
      { status: 502 }
    );
  }

  // Which brands does this dealer actually carry, and where are they.
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

  let activeRequests;
  try {
    activeRequests = await listActiveDealRequests();
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not load buyer requests.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const matched: DealerInboundRequest[] = [];
  for (const req of activeRequests) {
    if (!(await isDealAcceptingResponses(req.id))) continue;
    const brandInfo = carriedBrands.find((b) => b.brand === req.referenceBrandCode);
    if (!brandInfo) continue;
    // Direct offer (firm_offer): only the rooftop that actually has this VIN.
    // Reverse-auction requests still match by model + radius as before.
    if (req.strategy === "firm_offer") {
      const vinRecord = await fetchVehicleByVinFromBox(req.referenceVin);
      if (!vinRecord || vinRecord.dealer_name !== user.dealerName) continue;
    } else if (!brandInfo.models.has(req.referenceModel)) {
      continue;
    }

    let distanceMiles = 0;
    if (brandInfo.dealerLat && brandInfo.dealerLng) {
      distanceMiles = calculateDistanceMiles(req.buyerZip, {
        city: brandInfo.dealerCity || "",
        state: brandInfo.dealerState || "",
        lat: brandInfo.dealerLat,
        lng: brandInfo.dealerLng,
      });
      if (req.strategy !== "firm_offer" && distanceMiles > req.searchRadiusMiles) continue;
    }
    if (req.strategy !== "firm_offer" && req.sameStateOnly && brandInfo.dealerState && brandInfo.dealerState !== req.buyerState) continue;

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
      tradeIn: req.tradeIn as unknown as DealerInboundRequest["tradeIn"],
      buyerComment: req.buyerComment,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt,
    });
  }

  // One aggregate call per matched request, in parallel — never a
  // competing dealer's identity/VIN/price, just the current best discount%
  // and how many dealers have bid, so this dealer knows the market before
  // (or instead of) submitting a bid blind. A failed lookup for one request
  // must not blank out the others.
  await Promise.all(
    matched.map(async (m) => {
      try {
        const market = await getRequestMarket(m.requestId);
        m.leadingDiscountPercent = market.leadingDiscountPercent;
        m.bidCount = market.bidCount;
      } catch {
        m.leadingDiscountPercent = null;
        m.bidCount = undefined;
      }
    })
  );

  return NextResponse.json({ requests: matched });
}
