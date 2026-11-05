// POST /api/admin/rfqs/:id/send-queued — the EXPLICIT retry for invitations still queued on a request.
//
// This used to happen as a side effect of the buyer opening the deal page (GET /api/rfqs/:id). Reading a deal no longer
// sends anything; an admin who sees queued invitations on a released request presses this instead. It runs the same gated
// outbox as the release: an unreleased request is held, the outbound-email switch is respected, opted-out rooftops are
// skipped, and SAFE MODE routing is unchanged. Admin session only. POST only, so a page load or link prefetch can't fire it.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getRfq, RfqApiError } from "@/lib/rfqApi";
import { drainQueuedInvites } from "@/lib/inviteOutbox";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await params;
  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const result = await drainQueuedInvites([rfq]);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not send the queued invitations.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
