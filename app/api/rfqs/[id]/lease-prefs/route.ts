import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, RfqApiError, updateRfqLeasePrefs } from "@/lib/rfqApi";
import { parseLeasePrefs } from "@/lib/leaseQuote";

// PATCH /api/rfqs/:id/lease-prefs { leasePrefs } — the buyer adjusting the
// lease quote sheet. Allowed only while no invited dealer has opened their
// quote link; the box enforces the lock too (409), this just says it in
// buyer words first.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const prefs = parseLeasePrefs(body?.leasePrefs);
  if (!prefs) return NextResponse.json({ error: "Pick a term and a mileage band the calculator can quote to." }, { status: 400 });

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfq.buyerUserId !== session.user.id) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    if (!rfq.leasePrefs) return NextResponse.json({ error: "This request has no lease quote sheet." }, { status: 409 });
    if (rfq.leaseSheetLockedAt) {
      return NextResponse.json({ error: "Locked — a dealer has viewed this request. New terms need a new quote request.", lockedAt: rfq.leaseSheetLockedAt }, { status: 409 });
    }
    if (rfq.status !== "collecting") return NextResponse.json({ error: "This request is closed." }, { status: 409 });
    const updated = await updateRfqLeasePrefs(id, prefs);
    return NextResponse.json({ rfq: updated });
  } catch (err) {
    if (err instanceof RfqApiError && err.status === 409) {
      return NextResponse.json({ error: "Locked — a dealer has viewed this request. New terms need a new quote request." }, { status: 409 });
    }
    const message = err instanceof RfqApiError ? err.message : "Could not save your changes.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
