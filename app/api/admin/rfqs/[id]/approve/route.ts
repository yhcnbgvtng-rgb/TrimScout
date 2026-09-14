import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { approveRfqInvites } from "@/lib/rfqAdminApproval";
import { RfqApiError } from "@/lib/rfqApi";

/**
 * POST /api/admin/rfqs/:id/approve — the send checkpoint. Sends every
 * still-queued invite on this request (the "review the transaction, send
 * it" default gesture), or only the ones named in `inviteIds` when the
 * admin skipped some first. Admin session only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const inviteIds = Array.isArray(body?.inviteIds) ? body.inviteIds.filter((x: unknown): x is string => typeof x === "string") : undefined;

  try {
    const { rfq, results } = await approveRfqInvites(id, inviteIds);
    // Same admin-only shape as GET /api/admin/rfqs: the raw view token
    // never leaves the server, even to an admin.
    const invites = rfq.invites.map(({ viewToken, ...rest }) => ({
      ...rest,
      calculatorUrl: viewToken ? `/quote-request/received?t=${encodeURIComponent(viewToken)}` : null,
    }));
    return NextResponse.json({ rfq: { ...rfq, invites }, results });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not approve this request.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
