// POST /api/rfqs/:id/invites/:inviteId/counter { counter } — the buyer's
// structured counter to one desk's lease quote. The box supersedes that
// quote (kept for history) and reopens the invite; the dealer is told by
// email (SAFE MODE) with their calculator link, prefilled from their last
// quote. Scoped to this invite — the lease sheet stays as it is.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, RfqApiError, submitBuyerCounter } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { parseBuyerCounter, counterSummary } from "@/lib/buyerCounter";
import { sendQuoteInviteEmail } from "@/lib/dealerEmail";
import { buyerCounterHtml, buyerCounterSubject } from "@/lib/quoteInviteEmail";
import { dealerReference } from "@/lib/dealerReference";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || (session.user as { role?: string }).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }
  const { id, inviteId } = await params;
  const body = await req.json().catch(() => null);
  const counter = parseBuyerCounter(body?.counter);
  if (!counter) return NextResponse.json({ error: "Ask for something: a target monthly, a max due at signing, or a different term or miles." }, { status: 400 });

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfq.buyerUserId !== session.user.id) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    if (!rfq.leasePrefs) return NextResponse.json({ error: "Counters are for lease quotes." }, { status: 409 });
    if (rfq.status !== "collecting") return NextResponse.json({ error: "This request is closed." }, { status: 409 });
    const invite = rfq.invites.find((i) => i.id === inviteId);
    if (!invite?.quote?.lease) return NextResponse.json({ error: "This dealer has no current lease quote to counter." }, { status: 409 });
    if (invite.quote.id !== counter.againstQuoteId) return NextResponse.json({ error: "That quote has been replaced — reload and counter the current one." }, { status: 409 });

    const updated = await submitBuyerCounter(id, inviteId, counter);

    // Tell the desk. Best effort: a missed email leaves the counter in place
    // on their page; SAFE MODE routes this to the safe recipient.
    if (invite.viewToken && invite.desk) {
      const input = {
        dealerName: invite.dealerName,
        contactName: invite.desk.contactName,
        vehicle: invite.vehicle || { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim, vdpUrl: null },
        dealReference: dealerReference(id, inviteId),
        summary: counterSummary(counter),
        note: counter.note ?? null,
        priorMonthly: invite.quote.lease.monthlyPaymentPreTax,
        viewUrl: `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken)}`,
      };
      await sendQuoteInviteEmail(buyerCounterSubject(input), buyerCounterHtml(input)).catch(() => false);
    }
    return NextResponse.json({ rfq: publicRfqForBuyer(updated) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not send your counter.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
