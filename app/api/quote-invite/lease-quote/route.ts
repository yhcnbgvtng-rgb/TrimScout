// POST /api/quote-invite/lease-quote { t, quote } — a dealer's structured
// lease quote, submitted from the calculator behind their invite token.
// Validated here (lib/leaseQuote.ts) before anything reaches the box, so a
// monthly-only or lump-sum reply can never become a quote.
import { NextResponse } from "next/server";
import { getRfq, getRfqInviteByViewToken, submitRfqQuote } from "@/lib/rfqApi";
import { coerceLeaseQuote, dueAtSigningTotal, validateLeaseQuote, type LeaseQuote } from "@/lib/leaseQuote";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq) return NextResponse.json({ error: "Quote request not found." }, { status: 404 });
  if (rfq.status !== "collecting") return NextResponse.json({ error: "The buyer has already closed this request." }, { status: 409 });
  if (found.invite.status !== "invited") return NextResponse.json({ error: `This invite already has a response (${found.invite.status}).` }, { status: 409 });
  if (!rfq.leasePrefs) return NextResponse.json({ error: "This request has no lease preferences on file." }, { status: 409 });

  const quote = coerceLeaseQuote((body?.quote || {}) as Record<string, unknown>);
  const vin = typeof body?.vin === "string" && body.vin.trim() ? body.vin.trim().toUpperCase() : rfq.vin;
  const stockNumber = typeof body?.stockNumber === "string" && body.stockNumber.trim() ? body.stockNumber.trim() : rfq.stockNumber;
  const v = validateLeaseQuote(quote, rfq.leasePrefs, { vin, stockNumber });
  if (v.errors.length) return NextResponse.json({ error: "Quote is incomplete.", errors: v.errors, warnings: v.warnings }, { status: 422 });

  const lease = quote as LeaseQuote;
  const d = lease.dueAtSigning;
  await submitRfqQuote(found.rfqId, found.invite.id, {
    // Older readers see a number: the monthly and the itemized due-at-signing.
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
    // The dealer confirmed VIN/stock and quoted to the buyer's term/miles (or marked a counter).
    mustHaveAcknowledgement: true,
    notes: lease.notes || null,
    lease,
  });
  return NextResponse.json({ ok: true, warnings: v.warnings, dueAtSigningTotal: dueAtSigningTotal(d) });
}
