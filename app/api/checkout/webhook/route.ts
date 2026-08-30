import { NextResponse } from "next/server";
import Stripe from "stripe";
import { markDealPaid } from "@/lib/dealsApi";

// Stripe requires the exact raw request body for signature verification —
// Next.js's App Router gives us that via req.text() as long as we don't
// run any body-parsing middleware in front of this route.
export async function POST(req: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature || "", process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    const dealId = checkoutSession.metadata?.dealId;
    if (dealId) {
      await markDealPaid(dealId, {
        stripeCheckoutSessionId: checkoutSession.id,
        stripePaymentIntentId:
          typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : null,
      });
    }
  }

  return NextResponse.json({ received: true });
}
