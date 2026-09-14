import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { createRfqInvite, getRfq, RfqApiError } from "@/lib/rfqApi";
import { guardPerDeskCap } from "@/lib/apiSpendGuard";
import { canInviteMore } from "@/lib/rfqLogic";
import { RFQ_MAX_INVITES } from "@/lib/rfq";
import { listDealerships } from "@/lib/dealershipsApi";
import { matchDirectoryDealership } from "@/lib/dealerContactLookup";
import { deskFromDealership, deskFromBuyerEmail, maskEmail, sisterStoreConflicts, INVITE_BLOCK_MESSAGES, type DealerDesk } from "@/lib/quotePackage";

/**
 * POST /api/admin/rfqs/:id/invites — the "edit which dealers it goes to"
 * add-a-desk half of the admin edit story. Same desk-resolution rule the
 * buyer route uses (named directory contact first, a typed adviser
 * address only when the directory has nothing and it isn't a shared
 * inbox) and the same createRfqInvite() call — the new invite lands
 * "queued" like any other and needs its own approval. Admin session only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const dealerName = typeof body?.dealerName === "string" ? body.dealerName.trim() : "";
  const dealerState = typeof body?.dealerState === "string" ? body.dealerState.trim() : "";
  if (!dealerName) return NextResponse.json({ error: "A dealer name is required." }, { status: 400 });
  if (!guardPerDeskCap(dealerName)) {
    return NextResponse.json({ error: `${dealerName} has already received the maximum number of requests for today. Try again tomorrow.` }, { status: 429 });
  }

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (!canInviteMore(rfq.invites, RFQ_MAX_INVITES)) {
      return NextResponse.json({ error: "This request already has the maximum number of invites." }, { status: 400 });
    }

    const directory = await listDealerships().catch(() => []);
    const row = matchDirectoryDealership(directory, { dealerName, state: dealerState });
    let desk: DealerDesk | null = row ? deskFromDealership(row) : null;
    if (!desk?.knownNamed && typeof body?.dealerContactEmail === "string") {
      desk = deskFromBuyerEmail(dealerName, dealerState, body.dealerContactEmail);
    }
    if (!desk || !desk.knownNamed) {
      return NextResponse.json({ error: INVITE_BLOCK_MESSAGES.no_named_contact, code: "no_named_contact" }, { status: 422 });
    }
    if (desk.emailOptOut) {
      return NextResponse.json({ error: INVITE_BLOCK_MESSAGES.dealer_opted_out, code: "dealer_opted_out" }, { status: 422 });
    }
    const existingDesks = rfq.invites
      .filter((i) => i.status !== "declined" && i.status !== "expired")
      .map((i) => (i.dealerContactEmail ? ({ emailDomain: i.dealerContactEmail.split("@")[1] || "" } as DealerDesk) : null));
    if (sisterStoreConflicts([...existingDesks, desk]).has(existingDesks.length)) {
      return NextResponse.json({ error: INVITE_BLOCK_MESSAGES.sister_store, code: "sister_store" }, { status: 422 });
    }

    const vehicle = { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim, vdpUrl: null };
    let invite;
    try {
      invite = await createRfqInvite(id, {
        dealerName,
        dealerContactEmail: desk.email,
        desk: { contactName: desk.contactName, role: desk.role, emailMasked: maskEmail(desk.email), source: desk.source },
        vehicle,
      });
    } catch (err) {
      if (err instanceof RfqApiError && err.status === 409) {
        return NextResponse.json({ error: INVITE_BLOCK_MESSAGES.desk_already_invited, code: "desk_already_invited" }, { status: 409 });
      }
      throw err;
    }
    const { viewToken, ...publicInvite } = invite;
    return NextResponse.json({ invite: publicInvite });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not add this dealer.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
