// DELETE /api/admin/rfqs/:id/invites/:inviteId — an admin dropping a dealer
// before release. The box refuses once released or sent. Admin session only.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { deleteRfqInvite, RfqApiError } from "@/lib/rfqApi";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id, inviteId } = await params;
  try {
    const rfq = await deleteRfqInvite(id, inviteId);
    return NextResponse.json({ rfq });
  } catch (err) {
    const message = err instanceof RfqApiError ? (err.status === 409 ? "That dealer already has the request — it can't be removed now." : err.message) : "Could not remove the dealer.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
