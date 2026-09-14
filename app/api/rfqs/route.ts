import { NextResponse } from "next/server";
import { parseLeasePrefs } from "@/lib/leaseQuote";
import { parseQuotePrefs } from "@/lib/usedQuote";
import { auth } from "@/auth";
import { createRfq, listRfqsForBuyer, RfqApiError } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { hasActiveRfq, isFullyLockedSpec } from "@/lib/rfqLogic";
import { MAX_PACKAGE_LINKS } from "@/lib/quotePackage";
import { recordQuoteRequest } from "@/lib/apiSpendGuard";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }
  try {
    const rfqs = await listRfqsForBuyer(session.user.id as string);
    return NextResponse.json({ rfqs: rfqs.map(publicRfqForBuyer) });
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
  const packageKind: "match" | "links" = body?.packageKind === "links" ? "links" : "match";
  if (!body?.vin || !body?.vehicleMake || !body?.vehicleModel || (packageKind === "match" && !body?.vehicleTrim)) {
    return NextResponse.json({ error: "A specific matched vehicle is required." }, { status: 400 });
  }
  // Two kinds of package. "match" is the factory-option flow, and keeps its
  // hard gate: every must-have a confirmed hit. "links" is the v1 core loop
  // — the buyer pasted dealer listings; there is no option match to gate
  // on, and no target price anywhere in it.
  if (packageKind === "match") {
    if (!Array.isArray(body.mustHaves) || !isFullyLockedSpec(body.mustHaves)) {
      return NextResponse.json(
        { error: "This vehicle doesn't hit every must-have — an RFQ can only be sent from a full match." },
        { status: 400 }
      );
    }
  } else {
    const pastes = Array.isArray(body.linkPastes) ? body.linkPastes : [];
    if (pastes.length === 0 || pastes.length > MAX_PACKAGE_LINKS) {
      return NextResponse.json({ error: `A quote request holds 1 to ${MAX_PACKAGE_LINKS} vehicles.` }, { status: 400 });
    }
    const used = pastes.some((p: { condition?: string }) => p?.condition === "used" || p?.condition === "cpo");
    if (used && body.leasePrefs) {
      return NextResponse.json({ error: "Used cars quote as Finance or Cash — a used lease isn't offered yet." }, { status: 400 });
    }
    if (used && !parseQuotePrefs(body.quotePrefs)) {
      return NextResponse.json({ error: "Pick Finance or Cash, with a ZIP, for a used car." }, { status: 400 });
    }
    // A finance ask sent without its locks (term, down, credit band, ZIP) can't be quoted apples to apples.
    if (body.quotePrefs && typeof body.quotePrefs === "object" && !parseQuotePrefs(body.quotePrefs)) {
      return NextResponse.json({ error: "Finance requests need a term, down payment, credit band and ZIP before they can be sent." }, { status: 400 });
    }
  }

  try {
    // Rate limit: one active RFQ at a time — no spray. The buyer must
    // finish (pick) or walk away from the current one before starting
    // another.
    const existing = await listRfqsForBuyer(session.user.id as string);
    if (hasActiveRfq(existing)) {
      return NextResponse.json(
        { error: "You already have an active request — finish or walk away from it before starting another." },
        { status: 400 }
      );
    }

    const rfq = await createRfq({
      buyerUserId: session.user.id as string,
      vin: body.vin,
      stockNumber: body.stockNumber ?? null,
      vehicleYear: body.vehicleYear,
      vehicleMake: body.vehicleMake,
      vehicleModel: body.vehicleModel,
      vehicleTrim: body.vehicleTrim || "",
      mustHaves: packageKind === "match" ? body.mustHaves : [],
      packageKind,
      linkPastes: packageKind === "links" ? body.linkPastes : undefined,
      dealReference: typeof body.dealReference === "string" ? body.dealReference : null,
      leasePrefs: parseLeasePrefs(body.leasePrefs),
      // Used cars: Finance / Cash only. A lease ask on a used car is refused
      // rather than silently dropped.
      quotePrefs: parseQuotePrefs(body.quotePrefs),
    });
    recordQuoteRequest();
    return NextResponse.json({ rfq: publicRfqForBuyer(rfq) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not create your request.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
