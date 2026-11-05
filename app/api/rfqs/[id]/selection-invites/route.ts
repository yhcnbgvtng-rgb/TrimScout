import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, listRfqsForBuyer, recordSelectionOutcomes, RfqApiError } from "@/lib/rfqApi";
import { guardPerDeskCap } from "@/lib/apiSpendGuard";
import { buyerRfqStrikeCount, reputationInviteCap } from "@/lib/rfqLogic";
import { queueInvite, resolveInviteDesk } from "@/lib/inviteDesk";
import { featureEnabled, DEGRADE_COPY } from "@/lib/featureFlags";
import { firstTrippedLimit, isRateLimitExempt, tooManyRequests } from "@/lib/rateLimit";
import { clientIpFromHeaders } from "@/lib/clientIp";
import { bump } from "@/lib/opsMetrics";
import { isBuyerTestMode } from "@/lib/buyerTestMode";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { publicRfqForBuyer } from "@/lib/rfq";
import { createSelectionInvites, withRequestLock, type SelectionChoice } from "@/lib/selectionInvites";
import { deliveryLine, isPartial, summarizeRows, summaryHeadline, vehicleRows } from "@/lib/selectionOutcomes";
import { dealerIdFrom } from "@/lib/dealerContactLookup";

/**
 * POST /api/rfqs/:id/selection-invites — { choices: [{ vin, checked, dealerId?, buyerProvidedEmail? }] }
 *
 * The one submit step for a saved selection. It walks EVERY vehicle on the request, creates the invitations that are
 * allowed (queued only — nothing is emailed here; the admin release gate and the outbox still decide that), and stores
 * one outcome per vehicle: invited, or excluded with a reason code. Safe to repeat: vehicles that already have an
 * invitation are linked, not invited again. The response carries counts and per-vehicle rows, never an address or token.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req)) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const { id } = await params;
  if (!featureEnabled("rfqSend")) {
    return NextResponse.json({ error: DEGRADE_COPY.rfqSendOff, paused: true }, { status: 503, headers: { "Retry-After": "120" } });
  }
  const tripped = session?.user && isRateLimitExempt(session.user as { id?: unknown; email?: string | null; role?: unknown }) ? null : firstTrippedLimit([
    { name: "invite_send_ip", subject: clientIpFromHeaders(req.headers) },
    { name: "invite_send_user", subject: session?.user?.id ? String(session.user.id) : `rfq:${id}` },
    { name: "invite_send_global", subject: "all" },
  ]);
  if (tripped) {
    bump("invite_429");
    return tooManyRequests(tripped);
  }
  const body = await req.json().catch(() => null);
  const rawChoices: unknown[] = Array.isArray(body?.choices) ? body.choices : [];
  const choices: SelectionChoice[] = rawChoices
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : null))
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c!.vin === "string")
    .map((c) => ({
      vin: String(c.vin).trim().toUpperCase(),
      checked: c.checked === true,
      dealerId: dealerIdFrom(c.dealerId),
      buyerProvidedEmail: typeof c.buyerProvidedEmail === "string" ? c.buyerProvidedEmail : null,
    }));
  if (choices.length === 0 || choices.length > 3) {
    return NextResponse.json({ error: "Send one choice per selected vehicle (1 to 3).", code: "validation_failed" }, { status: 400 });
  }

  try {
    return await withRequestLock(id, async () => {
      const rfq = await getRfq(id);
      if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
      const buyer = buyerForRfq(session, req, rfq);
      if (!buyer) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
      if (rfq.buyerUserId !== buyer.id) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
      if (rfq.status !== "collecting") return NextResponse.json({ error: "This request is closed, so no invitations can be added.", code: "request_closed" }, { status: 409 });

      const history = await listRfqsForBuyer(rfq.buyerUserId);
      const maxInvites = reputationInviteCap(buyerRfqStrikeCount(history, Date.now(), { testMode: isBuyerTestMode(session?.user) }));
      const run = await createSelectionInvites(rfq, choices, {
        resolveDesk: resolveInviteDesk,
        queue: (r, dealerName, desk, vin) => queueInvite(r, dealerName, desk, null, vin),
        // Only a dealership we are about to create a NEW invitation for counts against its daily cap.
        deskCapAllows: (name) => guardPerDeskCap(name),
        maxInvites,
      });
      for (const inv of run.created) {
        bump("invite_queued");
        if (!inv.dealerContactEmail) bump("invite_unassigned");
      }
      const recorded = await recordSelectionOutcomes(id, run.outcomes);
      if (!recorded) bump("selection_outcomes_not_stored");

      // Re-read so the counts and rows come from what the box actually holds, not from what we hoped to create.
      const fresh = (await getRfq(id)) ?? rfq;
      const view = publicRfqForBuyer({ ...fresh, selectionOutcomes: recorded ? run.outcomes : fresh.selectionOutcomes ?? run.outcomes });
      const rows = vehicleRows({ ...view, selectionOutcomes: run.outcomes });
      const summary = summarizeRows(rows);
      return NextResponse.json({
        rfq: view,
        outcomes: run.outcomes,
        rows,
        summary,
        headline: summaryHeadline(summary),
        delivery: deliveryLine(summary),
        partial: isPartial(summary),
        /** False when the box has no selection-outcomes storage yet: the reasons are shown now but not kept. */
        recorded,
        underReview: true,
      });
    });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not process your selection.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
