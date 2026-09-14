import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { declineRfqInvite, RfqApiError } from "@/lib/rfqApi";
import type { RfqDeclineReason } from "@/lib/rfq";

const VALID_REASONS: RfqDeclineReason[] = ["soft_lead", "wrong_car", "options_mismatch", "other"];

/**
 * POST /api/admin/rfqs/:id/invites/:inviteId/reject — the admin's other
 * checkpoint action: instead of sending this queued invite, decline it.
 * Reuses the same box endpoint the buyer's own "mark declined" goes
 * through (lib/rfqApi.ts declineRfqInvite) — no new rejection state.
 * Admin session only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const { id, inviteId } = await params;
  const body = await req.json().catch(() => null);
  const declineReason: RfqDeclineReason = VALID_REASONS.includes(body?.declineReason) ? body.declineReason : "other";

  try {
    const invite = await declineRfqInvite(id, inviteId, declineReason);
    const { viewToken, ...rest } = invite;
    return NextResponse.json({ invite: rest });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not reject this invite.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
