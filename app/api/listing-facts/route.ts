export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { FORD_LISTINGS_LOAD_FAILED } from "@/lib/fordCompetitionUi";
import {
  fetchShopperListingSheets,
  normalizeListingVins,
  publicListingSheets,
} from "@/lib/listingSheet";

/**
 * Live per-VIN listing facts for the compare page.
 * Maps MarketCheck payloads into typed shopper sheets. Never returns raw
 * provider JSON. Does not cache listings or re-run the coarse YMM hunt.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const vins = normalizeListingVins(body?.vins);
  if (vins.length === 0) {
    return NextResponse.json({ sheets: [] });
  }

  try {
    const sheets = publicListingSheets(await fetchShopperListingSheets(vins));
    return NextResponse.json({ sheets });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "listing facts failed";
    console.error("listing-facts failed:", message);
    return NextResponse.json(
      {
        error: FORD_LISTINGS_LOAD_FAILED,
        sheets: vins.map((vin) => ({
          vin,
          available: false,
          attribution: null,
          advertisedPrice: null,
          msrp: null,
          priceChange: null,
          priceHistory: [],
          daysOnMarket: null,
          daysOnMarketActive: null,
          firstSeen: null,
          lastSeen: null,
          stockNumber: null,
          inventoryType: null,
          exteriorColor: null,
          interiorColor: null,
          mileage: null,
          dealerName: null,
          dealerStreet: null,
          dealerCity: null,
          dealerState: null,
          dealerZip: null,
          dealerPhone: null,
          vdpUrl: null,
          inTransit: null,
          photoUrl: null,
          note: FORD_LISTINGS_LOAD_FAILED,
        })),
      },
      { status: 502 }
    );
  }
}
