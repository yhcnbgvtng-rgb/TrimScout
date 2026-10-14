// POST /api/admin/rfqs/:id/invites — { dealerName, dealerState, providedEmail? }
// An admin adding a dealer before release, by the same desk rules as the
// buyer's own send (lib/inviteDesk.ts). Queued only; released with the
// request. Admin session only.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getRfq, RfqApiError } from "@/lib/rfqApi";
import { rfqIsReleased } from "@/lib/rfq";
import { queueInvite, resolveAdminInviteDesk } from "@/lib/inviteDesk";
import { isPlausibleDealerEmail } from "@/lib/emailShape";
import { inviteRouting } from "@/lib/quotePackage";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { dealerName?: unknown; dealerState?: unknown; providedEmail?: unknown } | null;
  const dealerName = typeof body?.dealerName === "string" ? body.dealerName.trim() : "";
  const dealerState = typeof body?.dealerState === "string" ? body.dealerState.trim() : "";
  if (!dealerName) return NextResponse.json({ error: "A dealer name is required." }, { status: 400 });
  if (!/^[A-Za-z]{2}$/.test(dealerState)) return NextResponse.json({ error: "A 2-letter dealer state is required." }, { status: 400 });
  const providedEmail = typeof body?.providedEmail === "string" ? body.providedEmail.trim() : "";
  if (providedEmail && !isPlausibleDealerEmail(providedEmail)) return NextResponse.json({ error: "That email address doesn't look valid." }, { status: 400 });
  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfqIsReleased(rfq)) return NextResponse.json({ error: "This request has already been released to dealers." }, { status: 409 });
    const resolved = await resolveAdminInviteDesk(rfq, { dealerName, dealerState, providedEmail: providedEmail || null });
    if (!resolved.ok) return NextResponse.json({ error: resolved.error, code: resolved.code }, { status: resolved.status });
    const queued = await queueInvite(rfq, dealerName, resolved.desk);
    if (!queued.ok) return NextResponse.json({ error: queued.error, code: queued.code }, { status: queued.status });
    const fresh = await getRfq(id);
    return NextResponse.json({ rfq: fresh, routing: inviteRouting(resolved.desk) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not add the dealer.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
