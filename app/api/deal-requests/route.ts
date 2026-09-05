import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { createDealRequest, listDealRequestsForBuyer, DealsApiError } from "@/lib/dealsApi";
import { getZipCoordinates } from "@/lib/otdCalculator";
import { findContactInfo } from "@/lib/piiFilter";
import { invitedDealersFromVehicles, primaryDealTimeZone } from "@/lib/dealEngagement";
import { decorateDealRequestJson, seedDealInvites } from "@/lib/dealEngagementStore";
import { mapDealRequestJson } from "@/lib/shopperDeal";
import { notifyDealersOfNewOffer } from "@/lib/dealerEmail";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }

  try {
    const dealRequests = await listDealRequestsForBuyer(session.user.id as string);
    const decorated = await Promise.all(
      dealRequests.map((row) => decorateDealRequestJson({ ...row } as unknown as Record<string, unknown>))
    );
    return NextResponse.json({ dealRequests: decorated });
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not load your deals.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer to submit a request." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.referenceVin || !body?.referenceMake || !body?.referenceModel || !body?.referenceBrandCode) {
    return NextResponse.json({ error: "A reference vehicle is required." }, { status: 400 });
  }
  if (!body?.buyerZip) {
    return NextResponse.json({ error: "buyerZip is required." }, { status: 400 });
  }

  const buyerComment = typeof body.buyerComment === "string" ? body.buyerComment.trim().slice(0, 1000) : "";
  const contactInfoFound = findContactInfo(buyerComment);
  if (contactInfoFound) {
    return NextResponse.json(
      { error: `Your comment appears to contain ${contactInfoFound} — remove it and try again. Dealers only see your masked buyer ID.` },
      { status: 400 }
    );
  }

  const buyerState = getZipCoordinates(body.buyerZip).state;

  try {
    const dealRequest = await createDealRequest({
      buyerUserId: session.user.id as string,
      strategy: body.strategy || "flexible_discount",
      referenceBrandCode: body.referenceBrandCode,
      referenceVin: body.referenceVin,
      referenceYear: body.referenceYear ?? null,
      referenceMake: body.referenceMake,
      referenceModel: body.referenceModel,
      referenceTrim: body.referenceTrim ?? null,
      referencePrice: body.referencePrice ?? null,
      referenceMsrp: body.referenceMsrp ?? null,
      referenceImageUrl: body.referenceImageUrl ?? null,
      targetOtdPrice: body.targetOtdPrice ?? null,
      targetDiscountPercent: body.targetDiscountPercent ?? null,
      paymentMethod: body.paymentMethod || "cash",
      dealStructure: body.dealStructure ?? null,
      tradeIn: body.tradeIn ?? null,
      buyerZip: body.buyerZip,
      buyerState,
      searchRadiusMiles: body.searchRadiusMiles ?? 100,
      sameStateOnly: body.sameStateOnly !== false,
      buyerComment: buyerComment || undefined,
    });
    const mapped = mapDealRequestJson(dealRequest as unknown as Record<string, unknown>);
    const seeds = invitedDealersFromVehicles(mapped.targetVehicle, mapped.otherLots);
    await seedDealInvites(
      dealRequest.id,
      seeds,
      primaryDealTimeZone(mapped.targetVehicle, dealRequest.buyerState)
    );
    // Runs after the response is sent, but Vercel keeps the function alive
    // until it settles — unlike a bare un-awaited promise, which can be
    // frozen mid-flight once the response goes out. Never let a
    // notification failure fail the buyer's own submission.
    after(() =>
      notifyDealersOfNewOffer(mapped).catch((err) =>
        console.error("notifyDealersOfNewOffer failed:", err instanceof Error ? err.message : err)
      )
    );
    const decorated = await decorateDealRequestJson({ ...dealRequest } as unknown as Record<string, unknown>);
    return NextResponse.json({ dealRequest: decorated });
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not create your request.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
