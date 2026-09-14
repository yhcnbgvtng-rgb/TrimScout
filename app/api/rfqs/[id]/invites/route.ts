import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRfqInvite, getRfq, listRfqsForBuyer, markRfqInviteDelivery, RfqApiError } from "@/lib/rfqApi";
import type { RfqInvite } from "@/lib/rfq";
import { guardPerDeskCap } from "@/lib/apiSpendGuard";
import { buyerRfqStrikeCount, canInviteMore, reputationInviteCap } from "@/lib/rfqLogic";
import { listDealerships } from "@/lib/dealershipsApi";
import { matchDirectoryDealership } from "@/lib/dealerContactLookup";
import {
  deskFromDealership,
  deskFromBuyerEmail,
  maskEmail,
  sisterStoreConflicts,
  INVITE_BLOCK_MESSAGES,
  type DealerDesk,
} from "@/lib/quotePackage";
import { quoteInviteSubject, quoteInviteHtml, type QuoteEmailType } from "@/lib/quoteInviteEmail";
import { sendQuoteInviteEmail } from "@/lib/dealerEmail";
import { unsubscribeUrlFor, DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";
import { formatBuyerAlias } from "@/lib/buyerAlias";
import { dealerReference } from "@/lib/dealerReference";

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

    // --- Resolve the desk. Directory first; a buyer-typed adviser address
    //     only when the directory has nothing, and only if it's a person's
    //     mailbox. Never a shared inbox from either source.
    let desk: DealerDesk | null = null;
    if (rfq.packageKind === "links") {
      const directory = await listDealerships().catch(() => []);
      const row = matchDirectoryDealership(directory, { dealerName, state: dealerState });
      desk = row ? deskFromDealership(row) : null;
      if (!desk?.knownNamed && typeof body?.buyerProvidedEmail === "string") {
        desk = deskFromBuyerEmail(dealerName, dealerState, body.buyerProvidedEmail);
      }
      if (!desk || !desk.knownNamed) {
        return NextResponse.json({ error: INVITE_BLOCK_MESSAGES.no_named_contact, code: "no_named_contact" }, { status: 422 });
      }
      if (desk.emailOptOut) {
        return NextResponse.json({ error: INVITE_BLOCK_MESSAGES.dealer_opted_out, code: "dealer_opted_out" }, { status: 422 });
      }
      // Sister store: the package already has a desk on this dealer group's domain.
      const existingDesks = rfq.invites
        .filter((i) => i.status !== "declined" && i.status !== "expired")
        .map((i) => (i.dealerContactEmail ? ({ emailDomain: i.dealerContactEmail.split("@")[1] || "" } as DealerDesk) : null));
      if (sisterStoreConflicts([...existingDesks, desk]).has(existingDesks.length)) {
        return NextResponse.json({ error: INVITE_BLOCK_MESSAGES.sister_store, code: "sister_store" }, { status: 422 });
      }
    }

    // --- The vehicle this desk quotes, from the package's own pastes.
    const paste = (rfq.linkPastes || []).find(
      (p) => typeof p.dealerName === "string" && p.dealerName.trim().toLowerCase() === dealerName.toLowerCase()
    ) as Record<string, unknown> | undefined;
    const vehicle = paste
      ? {
          vin: String(paste.vin || rfq.vin),
          year: Number(paste.year || rfq.vehicleYear),
          make: String(paste.make || rfq.vehicleMake),
          model: String(paste.model || rfq.vehicleModel),
          trim: String(paste.trim || rfq.vehicleTrim || ""),
          vdpUrl: typeof paste.vdpUrl === "string" ? paste.vdpUrl : null,
        }
      : { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim, vdpUrl: null };

    // --- Queue it. The box enforces the one-open-invite-per-desk cap
    //     across all buyers and returns 409 if this desk is already waiting.
    let invite: RfqInvite;
    try {
      invite = await createRfqInvite(id, {
        dealerName,
        dealerContactEmail: desk ? desk.email : body?.dealerContactEmail || null,
        desk: desk
          ? { contactName: desk.contactName, role: desk.role, emailMasked: maskEmail(desk.email), source: desk.source }
          : undefined,
        vehicle,
      });
    } catch (err) {
      if (err instanceof RfqApiError && err.status === 409) {
        return NextResponse.json({ error: INVITE_BLOCK_MESSAGES.desk_already_invited, code: "desk_already_invited" }, { status: 409 });
      }
      throw err;
    }

    // --- Send, then mark sent. A send failure leaves the invite queued,
    //     which is the truth, and the buyer sees "Queued" rather than a
    //     "Sent" that never happened.
    if (desk) {
      const viewToken = invite.viewToken;
      const viewUrl = `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(viewToken || "")}`;
      const directoryRow = desk.source === "directory"
        ? matchDirectoryDealership(await listDealerships().catch(() => []), { dealerName, state: dealerState })
        : null;
      // One template for Cash / Lease / Finance. The type comes from what the
      // package stores (lease prefs, used quote prefs) before what the client
      // says it asked for.
      const requested = Array.isArray(body?.requestedStructures) ? String(body.requestedStructures[0] || "") : "";
      const quoteType: QuoteEmailType = rfq.leasePrefs
        ? "lease"
        : rfq.quotePrefs?.quoteType === "finance" || requested === "finance"
          ? "finance"
          : "cash";
      const bodyFinance = body?.financePrefs && typeof body.financePrefs === "object" ? body.financePrefs : null;
      const financePrefs =
        rfq.quotePrefs?.quoteType === "finance"
          ? { termMonths: rfq.quotePrefs.finance.termMonths, downPayment: rfq.quotePrefs.finance.downPayment, creditBand: rfq.quotePrefs.finance.creditBand }
          : bodyFinance && Number.isFinite(Number(bodyFinance.termMonths))
            ? { termMonths: Number(bodyFinance.termMonths), downPayment: Math.max(0, Number(bodyFinance.downPayment) || 0), creditBand: typeof bodyFinance.creditBand === "string" ? bodyFinance.creditBand : null }
            : null;
      const storedZip = rfq.leasePrefs?.zip || (rfq.quotePrefs?.quoteType === "finance" ? rfq.quotePrefs.finance.zip : rfq.quotePrefs?.quoteType === "cash" ? rfq.quotePrefs.cash.zip : "");
      const buyerZip = storedZip || (typeof body?.buyerZip === "string" ? body.buyerZip.replace(/\D/g, "").slice(0, 5) : "") || null;
      const emailInput = {
        quoteType,
        dealerName,
        contactName: desk.contactName,
        role: desk.role,
        rooftop: directoryRow
          ? { city: directoryRow.city, state: directoryRow.state, address: directoryRow.address }
          : { city: null, state: dealerState || null, address: null },
        vehicle,
        buyerAlias: formatBuyerAlias(rfq.buyerUserId),
        // The dealer's own number for this request — never the buyer's TS- deal number.
        dealReference: dealerReference(id, invite.id),
        viewUrl,
        unsubscribeUrl: directoryRow ? unsubscribeUrlFor(directoryRow.id) : null,
        purchaseTimelineLabel: typeof body?.purchaseTimelineLabel === "string" ? body.purchaseTimelineLabel : null,
        buyerNote: rfq.buyerNote || null,
        buyerZip,
        leasePrefs: rfq.leasePrefs || null,
        financePrefs,
        vehicleFacts: body?.vehicleFacts && typeof body.vehicleFacts === "object" ? body.vehicleFacts : null,
      };
      const html = quoteInviteHtml(emailInput);
      const accepted = await sendQuoteInviteEmail(quoteInviteSubject(emailInput), html);
      if (accepted) {
        invite = await markRfqInviteDelivery(id, invite.id, "sent").catch(() => invite);
      }
    }

    // Neither the desk's real address nor the tracked-link token leaves the server.
    const { dealerContactEmail: _hiddenEmail, viewToken: _hiddenToken, ...publicInvite } = invite;
    return NextResponse.json({ invite: publicInvite });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not add this dealer.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
