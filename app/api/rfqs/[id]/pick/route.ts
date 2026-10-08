import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, pickRfqQuote, RfqApiError } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { isReachableEmail } from "@/lib/rfqLogic";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req)) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.quoteId) {
    return NextResponse.json({ error: "A quoteId is required." }, { status: 400 });
  }

  try {
    const existing = await getRfq(id);
    if (!existing) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, existing);
    if (!buyer) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    if (existing.buyerUserId !== buyer.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    if (!isReachableEmail(buyer.email)) {
      return NextResponse.json({ error: "Add a reachable email to your account before accepting a quote." }, { status: 400 });
    }
    const rfq = await pickRfqQuote(id, body.quoteId);
    return NextResponse.json({ rfq: publicRfqForBuyer(rfq) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not record your pick.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
