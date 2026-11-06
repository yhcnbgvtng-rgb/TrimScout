import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { getRfq, pickRfqQuote, RfqApiError } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { isReachableEmail } from "@/lib/rfqLogic";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { awardWinnerOnPick, closeOutLosers } from "@/lib/inviteOutbox";
import { isStagedRfq } from "@/lib/dealStages";
import { inviteOfQuote, isNotSelected } from "@/lib/rfqClose";
import { notifyConfirmRequested, openConfirmAfterPick } from "@/lib/trade/confirmFlow";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req)) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.quoteId) {
    return NextResponse.json({ error: "A quoteId is required." }, { status: 400 });
  }

  try {
    const existing = await getRfq(id);
    if (!existing) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, existing);
    if (!buyer) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    if (existing.buyerUserId !== buyer.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    if (!isReachableEmail(buyer.email)) {
      return NextResponse.json({ error: "Add a reachable email to your account before accepting a quote." }, { status: 400 });
    }
    const winner = inviteOfQuote(existing, String(body.quoteId));
    if (winner && isNotSelected(winner)) {
      return NextResponse.json({ error: "That dealer's quote is closed." }, { status: 409 });
    }
    // The pick is the acceptance on a non-staged request: the buyer's contact goes to the box, which releases it to this dealer only.
    const user = (session?.user ?? {}) as { name?: string | null; phone?: string | null };
    const contact = winner && !isStagedRfq(existing) ? { name: user.name ?? null, email: buyer.email ?? null, phone: user.phone ?? null, zip: existing.quotePrefs?.quoteType === "cash" ? existing.quotePrefs.cash?.zip ?? null : null } : undefined;
    let rfq = await pickRfqQuote(id, body.quoteId, contact);
    // With a trade-in, the selected dealer first confirms or revises their trade number (one in-app step, deadline 24h by default).
    // The other dealers stay open until that number is settled, so "go back" finds their original numbers untouched.
    const opened = winner ? await openConfirmAfterPick(rfq, winner) : null;
    if (opened?.opened && winner) {
      rfq = opened.rfq;
      after(async () => { await notifyConfirmRequested(existing, winner, opened.confirmation); });
    } else if (winner) {
      // The buyer chose: tell every other invited dealer once ("not selected this time") and close their quotes.
      // After the response; best effort and idempotent, so a failure here never undoes the pick.
      after(async () => { await closeOutLosers(existing, winner.id); });
      // ...and introduce the buyer to the winner ("Your offer was accepted" + reveal link), through the outbox: approval gate, email
      // switch and SAFE MODE all apply. Non-staged requests only; staged ones send it from Accept final deal.
      const pickedRfq = rfq;
      after(async () => { await awardWinnerOnPick(pickedRfq, winner.id); });
    }
    return NextResponse.json({ rfq: publicRfqForBuyer(rfq) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not record your pick.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
