import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, listRfqsForBuyer, RfqApiError } from "@/lib/rfqApi";
import { guardPerDeskCap } from "@/lib/apiSpendGuard";
import { buyerRfqStrikeCount, canInviteMore, reputationInviteCap } from "@/lib/rfqLogic";
import { inviteRouting } from "@/lib/quotePackage";
import { queueInvite, resolveInviteDesk } from "@/lib/inviteDesk";
import { featureEnabled, DEGRADE_COPY } from "@/lib/featureFlags";
import { firstTrippedLimit, isRateLimitExempt, tooManyRequests } from "@/lib/rateLimit";
import { clientIpFromHeaders } from "@/lib/clientIp";
import { bump } from "@/lib/opsMetrics";

// The one send path. The buyer's confirm step names a dealership; this
// route re-derives the desk from the contact directory itself — the
// client never gets to supply the address we send to — applies every
// cap, creates the invite (queued), sends the email, and marks it sent
// only once Resend has accepted it. Each step is on the audit trail.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;
  if (!featureEnabled("rfqSend")) {
    return NextResponse.json({ error: DEGRADE_COPY.rfqSendOff, paused: true }, { status: 503, headers: { "Retry-After": "120" } });
  }
  // Test / admin accounts are never capped — see isRateLimitExempt.
  const tripped = isRateLimitExempt(session.user as { id?: unknown; email?: string | null; role?: unknown }) ? null : firstTrippedLimit([
    { name: "invite_send_ip", subject: clientIpFromHeaders(req.headers) },
    { name: "invite_send_user", subject: String(session.user.id) },
    { name: "invite_send_global", subject: "all" },
  ]);
  if (tripped) {
    bump("invite_429");
    return tooManyRequests(tripped);
  }
  const body = await req.json().catch(() => null);
  const dealerName = typeof body?.dealerName === "string" ? body.dealerName.trim() : "";
  const dealerState = typeof body?.dealerState === "string" ? body.dealerState.trim() : "";
  if (!dealerName) {
    return NextResponse.json({ error: "A dealer name is required." }, { status: 400 });
  }
  if (!guardPerDeskCap(dealerName)) {
    return NextResponse.json(
      { error: `${dealerName} has already received the maximum number of requests for today. Try again tomorrow.` },
      { status: 429 }
    );
  }

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfq.buyerUserId !== session.user.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    const history = await listRfqsForBuyer(rfq.buyerUserId);
    const maxInvites = reputationInviteCap(buyerRfqStrikeCount(history, Date.now()));
    if (!canInviteMore(rfq.invites, maxInvites)) {
      return NextResponse.json({ error: "You've reached the invite limit for this request." }, { status: 400 });
    }

    // --- Desk and vehicle, by the shared rule (lib/inviteDesk.ts); then
    //     queue it. The box enforces the one-open-invite-per-desk cap across
    //     all buyers. Nothing is sent here.
    const resolved = await resolveInviteDesk(rfq, { dealerName, dealerState, providedEmail: typeof body?.buyerProvidedEmail === "string" ? body.buyerProvidedEmail : null });
    if (!resolved.ok) return NextResponse.json({ error: resolved.error, code: resolved.code }, { status: resolved.status });
    const desk = resolved.desk;
    const queued = await queueInvite(rfq, dealerName, desk, typeof body?.dealerContactEmail === "string" ? body.dealerContactEmail : null);
    if (!queued.ok) return NextResponse.json({ error: queued.error, code: queued.code }, { status: queued.status });
    const invite = queued.invite;

    // --- The invite row is the queue entry, and it stays there: nothing is
    //     sent until an admin releases the request (POST /api/admin/rfqs/:id/
    //     approval), which drains it. The outbox itself refuses unreleased
    //     requests, so neither the buyer opening the deal page nor an ops
    //     "drain all" can send early — see lib/inviteOutbox.ts.
    bump("invite_queued");
    if (desk && !desk.email) bump("invite_unassigned");

    // Neither the desk's real address nor the tracked-link token leaves the server.
    const { dealerContactEmail: _hiddenEmail, viewToken: _hiddenToken, ...publicInvite } = invite;
    const routing = inviteRouting(desk);
    return NextResponse.json({ invite: publicInvite, queued: true, routing, underReview: true, notice: DEGRADE_COPY.underReview });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not add this dealer.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
