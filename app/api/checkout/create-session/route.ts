import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@/auth";
import { createDeal, getSingleBid, DealsApiError } from "@/lib/dealsApi";
import { PLATFORM_FEE_CENTS } from "@/lib/pricing";
import type { DealerBid } from "@/lib/types";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in to lock in a deal." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  // Two paths: the real reverse-auction flow sends {dealRequestId, bidId}
  // and the authoritative, unmasked bid is fetched server-to-server here
  // (never trusting whatever the browser had, which was masked) — the
  // older client-fabricated-object path stays for the out-of-scope mock
  // demo flow (BidProgramIntro's "View Demo Deal Room"), which has no real
  // bid to look up.
  let winningBid: DealerBid | undefined;
  let dealRequestId: string | undefined;
  let bidId: string | undefined;

  if (body?.dealRequestId && body?.bidId) {
    dealRequestId = String(body.dealRequestId);
    bidId = String(body.bidId);
    const realBid = await getSingleBid(dealRequestId, bidId);
    if (!realBid) {
      return NextResponse.json({ error: "That bid no longer exists." }, { status: 404 });
    }
    winningBid = {
      id: realBid.id,
      dealRequestId: realBid.dealRequestId,
      dealerName: realBid.dealerName,
      dealerCity: realBid.dealerCity || "",
      dealerState: realBid.dealerState || "",
      distanceMiles: realBid.distanceMiles || 0,
      matchedVin: realBid.matchedVin,
      matchedVehicleTitle: realBid.matchedVehicleTitle,
      matchedVehicleSpec: realBid.matchedVehicleSpec || "",
      matchedVehicleImageUrl: realBid.matchedVehicleImageUrl || "",
      vehicleStatus: (realBid.vehicleStatus as any) || "on_lot",
      msrp: realBid.msrp,
      dealerDiscountDollars: realBid.dealerDiscountDollars,
      dealerDiscountPercent: realBid.dealerDiscountPercent,
      manufacturerRebates: realBid.manufacturerRebates,
      sellingPrice: realBid.sellingPrice,
      salesTax: realBid.salesTax,
      dmvFees: realBid.dmvFees,
      docFee: realBid.docFee,
      dealerAccessories: realBid.dealerAccessories,
      tradeInAllowance: realBid.tradeInAllowance ?? undefined,
      totalOtdPrice: realBid.totalOtdPrice,
      quotedOtdPrice: realBid.quotedOtdPrice,
      netOtdWithTradeIn: realBid.netOtdWithTradeIn ?? undefined,
      notes: realBid.notes,
      rank: realBid.rank || 1,
      createdAt: realBid.createdAt,
      isTopDeal: realBid.isTopDeal,
      salesRep: realBid.salesRep || undefined,
    };
  } else {
    winningBid = body?.winningBid as DealerBid | undefined;
  }

  if (
    !winningBid ||
    !winningBid.dealerName ||
    !winningBid.matchedVin ||
    typeof winningBid.totalOtdPrice !== "number" ||
    winningBid.totalOtdPrice <= 0
  ) {
    return NextResponse.json({ error: "Invalid or missing winningBid" }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 500 });
  }

  let deal;
  try {
    deal = await createDeal({
      buyerUserId: session.user.id as string,
      dealerName: winningBid.dealerName,
      matchedVin: winningBid.matchedVin,
      totalOtdPrice: winningBid.totalOtdPrice,
      platformFeeCents: PLATFORM_FEE_CENTS,
      winningBid: winningBid as unknown as Record<string, unknown>,
      dealRequestId,
      bidId,
    });
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not create deal record.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.get("origin") || new URL(req.url).origin;

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "TrimScout Deal Lock-In Fee",
            description: `${winningBid.matchedVehicleTitle} via ${winningBid.dealerName}`,
          },
          unit_amount: PLATFORM_FEE_CENTS,
        },
        quantity: 1,
      },
    ],
    customer_email: session.user.email || undefined,
    metadata: { dealId: deal.id },
    success_url: `${origin}/?checkout=success&dealId=${deal.id}`,
    cancel_url: `${origin}/?checkout=cancelled&dealId=${deal.id}`,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
