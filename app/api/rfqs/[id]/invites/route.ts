import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRfqInvite, getRfq, RfqApiError } from "@/lib/rfqApi";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const dealerName = typeof body?.dealerName === "string" ? body.dealerName.trim() : "";
  if (!dealerName) {
    return NextResponse.json({ error: "A dealer name is required." }, { status: 400 });
  }

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfq.buyerUserId !== session.user.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    const invite = await createRfqInvite(id, {
      dealerName,
      dealerContactEmail: body?.dealerContactEmail || null,
    });
    return NextResponse.json({ invite });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not add this dealer.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
