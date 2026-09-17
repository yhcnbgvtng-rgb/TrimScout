import { NextResponse, after } from "next/server";
import { parseLeasePrefs } from "@/lib/leaseQuote";
import { parseQuotePrefs } from "@/lib/usedQuote";
import { auth } from "@/auth";
import { createRfq, listRfqsForBuyer, RfqApiError } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { hasActiveRfq, isFullyLockedSpec } from "@/lib/rfqLogic";
import { MAX_PACKAGE_LINKS } from "@/lib/quotePackage";
import { recordQuoteRequest } from "@/lib/apiSpendGuard";
import { findContactInfo } from "@/lib/piiFilter";
import { featureEnabled, DEGRADE_COPY } from "@/lib/featureFlags";
import { firstTrippedLimit, isRateLimitExempt, tooManyRequests } from "@/lib/rateLimit";
import { clientIpFromHeaders } from "@/lib/clientIp";
import { bump } from "@/lib/opsMetrics";
import { approvalAlertHtml, approvalAlertSubject } from "@/lib/approvalAlertEmail";
import { sendAdminApprovalAlert } from "@/lib/dealerEmail";

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
  // Kill switch: an honest pause, never a 500 or a silent drop.
  if (!featureEnabled("rfqSend")) {
    bump("rfq_create_off");
    return NextResponse.json({ error: DEGRADE_COPY.rfqSendOff, paused: true }, { status: 503, headers: { "Retry-After": "120" } });
  }
  // Hard caps per IP, per account and per instance-global — 429 + Retry-After.
  // Test / admin accounts are never capped — see isRateLimitExempt.
  const tripped = isRateLimitExempt(session.user as { id?: unknown; email?: string | null; role?: unknown }) ? null : firstTrippedLimit([
    { name: "rfq_create_ip", subject: clientIpFromHeaders(req.headers) },
    { name: "rfq_create_user", subject: String(session.user.id) },
    { name: "rfq_create_global", subject: "all" },
  ]);
  if (tripped) {
    bump("rfq_create_429");
    return tooManyRequests(tripped);
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

  // The note goes to dealers word for word — never with the buyer's contact info in it.
  const buyerNote = typeof body.buyerNote === "string" ? body.buyerNote.trim().slice(0, 1000) : "";
  if (buyerNote) {
    const found = findContactInfo(buyerNote);
    if (found) return NextResponse.json({ error: `Your note appears to contain ${found} — remove it before sending.` }, { status: 400 });
  }

  try {
    // Rate limit: one active RFQ at a time — no spray. The buyer must
    // finish (pick) or walk away from the current one before starting
    // another.
    const existing = await listRfqsForBuyer(session.user.id as string);
    if (hasActiveRfq(existing)) {
      // Idempotent double-submit: the same buyer re-sending the same car
      // (a retry, a double click, a refresh) gets the request that already
      // exists — one row, not an error and not a second row.
      const same = existing.find((r) => r.status === "collecting" && r.vin === String(body.vin || "").trim().toUpperCase());
      if (same) {
        bump("rfq_create_idempotent");
        return NextResponse.json({ rfq: publicRfqForBuyer(same), idempotent: true });
      }
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
      buyerNote: buyerNote || null,
      tradeInExpected: typeof body.tradeInExpected === "boolean" ? body.tradeInExpected : null,
    });
    recordQuoteRequest();
    bump("rfq_create");
    // The admin gate: every new request waits for approval. Tell the admin
    // now (after the response), with the summary and a link to the desk.
    after(async () => {
      await sendAdminApprovalAlert(approvalAlertSubject(rfq), approvalAlertHtml(rfq)).catch(() => false);
    });
    return NextResponse.json({ rfq: publicRfqForBuyer(rfq) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not create your request.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
