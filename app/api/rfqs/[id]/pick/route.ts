import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, pickRfqQuote, RfqApiError } from "@/lib/rfqApi";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
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
    if (existing.buyerUserId !== session.user.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    const rfq = await pickRfqQuote(id, body.quoteId);
    return NextResponse.json({ rfq });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not record your pick.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
