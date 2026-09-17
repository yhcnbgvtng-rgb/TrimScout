// POST /api/admin/rfqs/:id/approval — { decision: "approved" | "rejected", reason? }
// The admin gate. "approved" releases the request: the box records who and
// when, then every queued invite is sent through the normal outbox (which
// only ever sends approved requests). "rejected" needs a reason; the buyer
// sees it in their tracker and may fix and resubmit. Admin session only.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getRfq, setRfqApproval, RfqApiError } from "@/lib/rfqApi";
import { drainQueuedInvites } from "@/lib/inviteOutbox";
import { bump } from "@/lib/opsMetrics";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { decision?: unknown; reason?: unknown } | null;
  const decision = body?.decision === "approved" || body?.decision === "rejected" ? body.decision : null;
  if (!decision) return NextResponse.json({ error: "decision must be approved or rejected." }, { status: 400 });
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (decision === "rejected" && !reason) return NextResponse.json({ error: "A rejection needs a reason the buyer will read." }, { status: 400 });
  const by = session.user?.email || session.user?.id || "admin";
  try {
    const rfq = await setRfqApproval(id, { decision, by, reason: decision === "rejected" ? reason : null });
    bump(decision === "approved" ? "rfq_approved" : "rfq_rejected");
    if (decision === "rejected") return NextResponse.json({ rfq, released: null });
    // Release: send everything queued on this request now, synchronously,
    // so the admin sees the outcome per dealer. The outbox re-checks the
    // approval itself and marks each invite sent only once Resend accepts.
    const fresh = (await getRfq(id)) || rfq;
    const released = await drainQueuedInvites([fresh]);
    const after = (await getRfq(id)) || fresh;
    return NextResponse.json({ rfq: after, released });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not record the decision.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
