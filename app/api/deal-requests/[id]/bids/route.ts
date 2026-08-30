import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDealRequest, listBidsForRequest, submitDealerBid, DealsApiError, type DealBidRecord } from "@/lib/dealsApi";
import { fetchVehiclesFromBox, fetchVehicleByVinFromBox } from "@/lib/lightsailClient";
import { calculateDistanceMiles } from "@/lib/otdCalculator";

// A letter label per rank ("Certified Dealer A/B/C…") — stable within one
// response, not persisted, since it's purely a display convenience over
// whatever order the bids come back ranked in.
function maskBid(bid: DealBidRecord, index: number) {
  const letter = String.fromCharCode(65 + Math.min(index, 25));
  return {
    ...bid,
    dealerName: `Certified Dealer ${letter}`,
    dealerCity: null,
    matchedVin: "",
    salesRep: null,
  };
}

// GET — buyer-facing, polled by LiveDealRoom. Real dealer identity/
// VIN/contact are withheld unless a bid has actually been paid for
// (status === 'accepted', which only happens via the Stripe webhook's
// mark-paid cascade).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const dealRequest = await getDealRequest(id);
  if (!dealRequest) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (dealRequest.buyerUserId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized to view this request" }, { status: 403 });
  }

  const bids = await listBidsForRequest(id);
  const masked = bids.map((bid, i) => (bid.status === "accepted" ? bid : maskBid(bid, i)));
  return NextResponse.json({ bids: masked, requestStatus: dealRequest.status, expiresAt: dealRequest.expiresAt });
}

// POST — dealer submits/updates a bid. Real buyer contact never appears
// anywhere in this handler; only buyerZip/buyerState (fetched
// server-to-server) are used, purely to compute distance, and never
// returned to the client.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user as any;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer to submit a bid." }, { status: 401 });
  }
  if (!user.dealerName) {
    return NextResponse.json({ error: "Your account has no dealership name on file." }, { status: 400 });
  }

  const { id } = await params;
  const dealRequest = await getDealRequest(id);
  if (!dealRequest) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (dealRequest.status !== "active") {
    return NextResponse.json({ error: "This request is no longer accepting bids." }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.matchedVin) {
    return NextResponse.json({ error: "matchedVin is required" }, { status: 400 });
  }

  // Confirm the VIN is actually in this dealer's own real inventory —
  // cheap, and prevents a dealer bidding a vehicle they don't have (which
  // would break the post-payment reveal promise to the buyer).
  const vinRecord = await fetchVehicleByVinFromBox(body.matchedVin);
  if (!vinRecord || vinRecord.dealer_name !== user.dealerName) {
    return NextResponse.json({ error: "That VIN isn't in your dealership's current inventory." }, { status: 403 });
  }

  // Dealer's own location, for the distance figure shown to the buyer
  // (region-level only — the buyer's exact zip never leaves this handler).
  const dealerVehicles = await fetchVehiclesFromBox({
    brand: dealRequest.referenceBrandCode,
    dealer: user.dealerName,
    pageSize: 1,
  });
  const dealerVehicle = dealerVehicles?.vehicles[0];
  const dealerCity = dealerVehicle?.dealer_city || null;
  const dealerState = dealerVehicle?.state || null;
  const dealerLat = dealerVehicle?.dealer_latitude ? Number(dealerVehicle.dealer_latitude) : undefined;
  const dealerLng = dealerVehicle?.dealer_longitude ? Number(dealerVehicle.dealer_longitude) : undefined;
  const distanceMiles =
    dealerLat && dealerLng
      ? calculateDistanceMiles(dealRequest.buyerZip, { city: dealerCity || "", state: dealerState || "", lat: dealerLat, lng: dealerLng })
      : null;

  try {
    const bid = await submitDealerBid(id, {
      dealerUserId: user.id,
      dealerName: user.dealerName,
      dealerCity,
      dealerState,
      distanceMiles,
      matchedVin: body.matchedVin,
      matchedVehicleTitle: body.matchedVehicleTitle,
      matchedVehicleSpec: body.matchedVehicleSpec,
      matchedVehicleImageUrl: body.matchedVehicleImageUrl,
      vehicleStatus: body.vehicleStatus,
      msrp: body.msrp,
      dealerDiscountDollars: body.dealerDiscountDollars,
      dealerDiscountPercent: body.dealerDiscountPercent,
      manufacturerRebates: body.manufacturerRebates,
      sellingPrice: body.sellingPrice,
      salesTax: body.salesTax,
      dmvFees: body.dmvFees,
      docFee: body.docFee,
      dealerAccessories: body.dealerAccessories,
      tradeInAllowance: body.tradeInAllowance,
      totalOtdPrice: body.totalOtdPrice,
      netOtdWithTradeIn: body.netOtdWithTradeIn,
      financeMonthlyEstimate: body.financeMonthlyEstimate,
      leaseMonthlyEstimate: body.leaseMonthlyEstimate,
      notes: body.notes,
      salesRepName: body.salesRepName,
      salesRepTitle: body.salesRepTitle,
      salesRepPhone: body.salesRepPhone,
    });
    return NextResponse.json({ bid });
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not submit bid.";
    const status = err instanceof DealsApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
