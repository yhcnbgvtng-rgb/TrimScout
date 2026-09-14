// POST /api/quote-invite/used-quote { t, vin?, stockNumber?, quote } — a
// dealer's Finance / Cash sheet (new or used car), submitted from their
// quote page behind the invite token. Validated here (lib/usedQuote.ts)
// against the buyer's locks before anything reaches the box.
import { NextResponse } from "next/server";
import { getRfq, getRfqInviteByViewToken, submitRfqQuote } from "@/lib/rfqApi";
import { validateUsedQuote, cashOutTheDoor, type UsedQuote } from "@/lib/usedQuote";
import { rfqVehicles } from "@/lib/rfqTracker";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq) return NextResponse.json({ error: "Quote request not found." }, { status: 404 });
  if (rfq.status !== "collecting") return NextResponse.json({ error: "The buyer has closed this request." }, { status: 409 });
  if (found.invite.status !== "invited") return NextResponse.json({ error: `This invite already has a response (${found.invite.status}).` }, { status: 409 });
  if (!rfq.quotePrefs) return NextResponse.json({ error: "This request has no Finance / Cash ask on file." }, { status: 409 });

  const raw = (body?.quote || {}) as Record<string, unknown>;
  const vin = typeof body?.vin === "string" && body.vin.trim() ? body.vin.trim().toUpperCase() : rfq.vin;
  const stockNumber = typeof body?.stockNumber === "string" && body.stockNumber.trim() ? body.stockNumber.trim() : rfq.stockNumber;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const toLines = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>).map((l) => ({ name: String(l?.name || ""), amount: num(l?.amount) ?? NaN })) : undefined);
  const car = rfqVehicles(rfq).find((c) => c.vin === vin) || rfqVehicles(rfq)[0] || null;
  const condition = car?.condition || "new";
  const base = {
    sellingPrice: num(raw.sellingPrice),
    dueAtSigning: toLines(raw.dueAtSigning),
    addOns: toLines(raw.addOns) ?? [],
    noAddOns: Boolean(raw.noAddOns),
    rebates: toLines(raw.rebates) ?? [],
    miles: condition === "new" ? null : num(raw.miles) ?? undefined,
    stockNumber,
    cpo: Boolean(raw.cpo),
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim().slice(0, 1000) : null,
  };
  const quote: Partial<UsedQuote> =
    raw.kind === "finance"
      ? {
          ...base,
          kind: "finance",
          downPayment: num(raw.downPayment),
          tradeEquity: num(raw.tradeEquity) ?? null,
          amountFinanced: num(raw.amountFinanced),
          apr: num(raw.apr),
          termMonths: num(raw.termMonths),
          monthlyPaymentPreTax: num(raw.monthlyPaymentPreTax),
          monthlyPaymentWithEstTax: num(raw.monthlyPaymentWithEstTax) ?? null,
          lenderName: typeof raw.lenderName === "string" && raw.lenderName.trim() ? raw.lenderName.trim().slice(0, 80) : null,
        }
      : { ...base, kind: "cash" };
  const v = validateUsedQuote(quote, rfq.quotePrefs, { vin, stockNumber, condition });
  if (v.errors.length) return NextResponse.json({ error: "Quote is incomplete.", errors: v.errors, warnings: v.warnings }, { status: 422 });

  const used = quote as UsedQuote;
  await submitRfqQuote(found.rfqId, found.invite.id, {
    // Older readers see a number: the selling price and the itemized lines.
    price: used.sellingPrice,
    fees: used.dueAtSigning.map((f) => ({ label: f.name, amount: f.amount })),
    vin,
    stockNumber,
    expiresAt: used.expiresAt,
    mustHaveAcknowledgement: true,
    notes: used.notes || null,
    used,
  });
  return NextResponse.json({ ok: true, warnings: v.warnings, outTheDoor: used.kind === "cash" ? cashOutTheDoor(used) : null });
}
