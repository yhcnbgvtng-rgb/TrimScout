import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, RfqApiError } from "@/lib/rfqApi";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;
  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfq.buyerUserId !== session.user.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    return NextResponse.json({ rfq });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not load this request.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
