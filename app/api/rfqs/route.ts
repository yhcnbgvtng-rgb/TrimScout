import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRfq, listRfqsForBuyer, RfqApiError } from "@/lib/rfqApi";
import { isFullyLockedSpec } from "@/lib/rfqLogic";
import { recordQuoteRequest } from "@/lib/apiSpendGuard";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }
  try {
    const rfqs = await listRfqsForBuyer(session.user.id as string);
    return NextResponse.json({ rfqs });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not load your requests.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer to send an RFQ." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.vin || !body?.vehicleMake || !body?.vehicleModel || !body?.vehicleTrim) {
    return NextResponse.json({ error: "A specific matched vehicle is required." }, { status: 400 });
  }
  // The hard gate, enforced server-side too: an RFQ can only ever be
  // created from a full match — every must-have confirmed hit. A soft
  // shortlist or an unverified option never reaches here.
  if (!Array.isArray(body.mustHaves) || !isFullyLockedSpec(body.mustHaves)) {
    return NextResponse.json(
      { error: "This vehicle doesn't hit every must-have — an RFQ can only be sent from a full match." },
      { status: 400 }
    );
  }

  try {
    const rfq = await createRfq({
      buyerUserId: session.user.id as string,
      vin: body.vin,
      stockNumber: body.stockNumber ?? null,
      vehicleYear: body.vehicleYear,
      vehicleMake: body.vehicleMake,
      vehicleModel: body.vehicleModel,
      vehicleTrim: body.vehicleTrim,
      mustHaves: body.mustHaves,
    });
    recordQuoteRequest();
    return NextResponse.json({ rfq });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not create your request.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
