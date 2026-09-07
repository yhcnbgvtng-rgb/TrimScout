import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, RfqApiError, walkAwayFromRfq } from "@/lib/rfqApi";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;

  try {
    const existing = await getRfq(id);
    if (!existing) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (existing.buyerUserId !== session.user.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    const rfq = await walkAwayFromRfq(id);
    return NextResponse.json({ rfq });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not record that you walked away.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
