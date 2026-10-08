// POST /api/rfqs/:id/trade/photos — { op: "sign" | "confirm" | "remove", slot, width?, height?, capturedAt? }
// The buyer replaces a photo, adds an optional one or removes an optional one until they pick a quote.
// Each confirmed change updates the request's photo list; invited dealers get ONE notice per change batch
// (the box decides who is owed one: not already told since they last looked). SAFE MODE routes the email.
import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { fulfilTradePhotoRequests, getRfq, putRfqTradePhotos, RfqApiError } from "@/lib/rfqApi";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { buyerMayManageTrade, signTradePhotos } from "@/lib/trade/access";
import { s3Storage } from "@/lib/trade/storage";
import { confirmPhoto, presignPhotoUpload, TradeError, withPhoto, withoutOptionalPhoto } from "@/lib/trade/service";
import { tradeErrorResponse, uploadRateLimited } from "@/lib/trade/routeKit";
import { sendQuoteInviteEmail } from "@/lib/dealerEmail";
import { tradePhotosUpdatedHtml, tradePhotosUpdatedSubject } from "@/lib/quoteInviteEmail";
import { dealerReference } from "@/lib/dealerReference";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req)) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  const { id } = await params;
  const limited = uploadRateLimited(req, `rfq:${id}`, session?.user as { id?: string; email?: string | null; role?: string } | undefined);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, rfq);
    if (!buyer) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
    if (!buyerMayManageTrade(buyer.id, rfq)) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    if (!rfq.tradeIn) throw new TradeError("This request has no trade-in.", 409);
    if (rfq.status !== "collecting") throw new TradeError("Photos are locked once you've picked a quote or walked away.", 409);
    const scope = { kind: "rfq" as const, id };

    if (body?.op === "sign") return NextResponse.json(await presignPhotoUpload(s3Storage, scope, body.slot));

    let photos = rfq.tradeIn.photos;
    let changedSlot: string;
    if (body?.op === "confirm") {
      const photo = await confirmPhoto(s3Storage, scope, body.slot, body);
      photos = withPhoto(photos, photo);
      changedSlot = photo.slot;
    } else if (body?.op === "remove") {
      const slot = body.slot as typeof photos[number]["slot"];
      photos = withoutOptionalPhoto(photos, slot);
      await s3Storage.remove(`trade/${id}/${slot}.jpg`).catch(() => undefined);
      changedSlot = slot;
    } else {
      return NextResponse.json({ error: "Unknown photo operation." }, { status: 400 });
    }

    const { rfq: updated, notifyInviteIds } = await putRfqTradePhotos(id, photos);
    await fulfilTradePhotoRequests(id, [changedSlot]).catch(() => undefined);
    const tradeTitle = [rfq.tradeIn.year, rfq.tradeIn.make, rfq.tradeIn.model, rfq.tradeIn.trim].filter(Boolean).join(" ");
    after(async () => {
      for (const inviteId of notifyInviteIds) {
        const invite = rfq.invites.find((i) => i.id === inviteId);
        if (!invite?.viewToken || !invite.desk || invite.status === "declined" || invite.dealerUnsubscribedAt) continue;
        const input = {
          dealerName: invite.dealerName, contactName: invite.desk.contactName,
          vehicle: invite.vehicle || { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim },
          dealReference: dealerReference(id, inviteId), tradeTitle,
          viewUrl: `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken)}`,
        };
        await sendQuoteInviteEmail(tradePhotosUpdatedSubject(input), tradePhotosUpdatedHtml(input)).catch(() => false);
      }
    });
    const tradeIn = updated.tradeIn ?? { ...rfq.tradeIn, photos };
    return NextResponse.json({ tradeIn, signed: await signTradePhotos(s3Storage, tradeIn.photos) });
  } catch (err) {
    if (err instanceof RfqApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return tradeErrorResponse(err);
  }
}
