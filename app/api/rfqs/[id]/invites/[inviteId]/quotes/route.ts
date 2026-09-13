import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, RfqApiError, submitRfqQuote } from "@/lib/rfqApi";
import { coerceLeaseQuote, validateLeaseQuote, type LeaseQuote } from "@/lib/leaseQuote";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id, inviteId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "A quote body is required." }, { status: 400 });
  }

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfq.buyerUserId !== session.user.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    // A lease deal only takes the structured lease quote — validated with
    // the same rules as the dealer's calculator (no monthly-only, no lump
    // due-at-signing, counters need a note). Stored whole, plus the legacy
    // price/fees projection so older readers still see numbers.
    if (rfq.leasePrefs) {
      if (!body.lease || typeof body.lease !== "object") {
        return NextResponse.json({ error: "A lease deal needs the full lease calculator — monthly-only or price-only entries can't be recorded." }, { status: 422 });
      }
      const quote = coerceLeaseQuote(body.lease as Record<string, unknown>);
      const vin = typeof body.vin === "string" && body.vin.trim() ? body.vin.trim().toUpperCase() : rfq.vin;
      const stockNumber = typeof body.stockNumber === "string" && body.stockNumber.trim() ? body.stockNumber.trim() : rfq.stockNumber;
      const v = validateLeaseQuote(quote, rfq.leasePrefs, { vin, stockNumber });
      if (v.errors.length) return NextResponse.json({ error: v.errors.join(" "), errors: v.errors, warnings: v.warnings }, { status: 422 });
      const lease = quote as LeaseQuote;
      const d = lease.dueAtSigning;
      await submitRfqQuote(id, inviteId, {
        price: lease.monthlyPaymentPreTax,
        fees: [
          { label: "First month", amount: d.firstMonth },
          { label: "Acquisition fee", amount: d.acquisitionFee },
          { label: "Cap reduction", amount: d.capReduction },
          { label: "Taxes", amount: d.taxes },
          ...d.otherFees.map((f) => ({ label: f.name, amount: f.amount })),
        ],
        vin,
        stockNumber,
        expiresAt: lease.expiresAt,
        mustHaveAcknowledgement: Boolean(body.mustHaveAcknowledgement),
        notes: lease.notes || null,
        lease,
      });
      const refreshedLease = await getRfq(id);
      return NextResponse.json({ rfq: refreshedLease, warnings: v.warnings });
    }
    await submitRfqQuote(id, inviteId, {
      price: Number(body.price),
      fees: Array.isArray(body.fees) ? body.fees : [],
      vin: body.vin,
      stockNumber: body.stockNumber ?? null,
      expiresAt: body.expiresAt,
      mustHaveAcknowledgement: Boolean(body.mustHaveAcknowledgement),
      notes: body.notes ?? null,
    });
    const refreshed = await getRfq(id);
    return NextResponse.json({ rfq: refreshed });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not record this quote.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
