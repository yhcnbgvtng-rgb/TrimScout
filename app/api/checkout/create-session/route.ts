import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@/auth";
import { createDeal, DealsApiError } from "@/lib/dealsApi";
import { PLATFORM_FEE_CENTS } from "@/lib/pricing";
import type { DealerBid } from "@/lib/types";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in to lock in a deal." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const winningBid = body?.winningBid as DealerBid | undefined;
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
