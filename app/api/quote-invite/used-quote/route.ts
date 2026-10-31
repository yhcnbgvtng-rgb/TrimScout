// POST /api/quote-invite/used-quote { t, vin?, stockNumber?, quote } — a
// dealer's Finance / Cash sheet (new or used car), submitted from their
// quote page behind the invite token. Validated here (lib/usedQuote.ts)
// against the buyer's locks before anything reaches the box.
import { NextResponse, after } from "next/server";
import { getRfq, getRfqInviteByViewToken, postRfqMessage, submitRfqQuote } from "@/lib/rfqApi";
import { normalizeFeeOverrides, type FeeOverride } from "@/lib/feeOverride";
import { buildFeeOverrideNotice } from "@/lib/feeOverrideNotice";
import { sendFeeOverrideNotice } from "@/lib/dealerEmail";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";
import { guestTrackerPath, isGuestBuyerId } from "@/lib/buyerAccess";
import { validateUsedQuote, cashOutTheDoor, type UsedQuote } from "@/lib/usedQuote";
import { rfqVehicles } from "@/lib/rfqTracker";
import { recordTradeWithQuote } from "@/lib/trade/quoteTrade";
import { notifyDealerQuoted } from "@/lib/noticeOutbox";
import { vehicleTitle } from "@/lib/vehicleTitle";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq) return NextResponse.json({ error: "Quote request not found." }, { status: 404 });
  if (rfq.status !== "collecting") return NextResponse.json({ error: "The buyer has closed this request." }, { status: 409 });
  if (found.invite.notSelectedAt) return NextResponse.json({ error: "The buyer chose another dealer, so this quote is closed." }, { status: 409 });
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
    msrp: num(raw.msrp),
    dueAtSigning: toLines(raw.dueAtSigning),
    addOns: toLines(raw.addOns) ?? [],
    noAddOns: Boolean(raw.noAddOns),
    // Each surcharge also carries the dealer's short reason (shown to the buyer as "Dealer-imposed").
    surcharges: Array.isArray(raw.surcharges) ? (raw.surcharges as Array<Record<string, unknown>>).map((l) => ({ name: String(l?.name || ""), amount: num(l?.amount) ?? NaN, reason: typeof l?.reason === "string" ? l.reason.trim().replace(/\s+/g, " ").slice(0, 140) : "" })) : [],
    noSurcharges: Boolean(raw.noSurcharges),
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
  const v = validateUsedQuote(quote, rfq.quotePrefs, { vin, stockNumber, condition, requireMsrp: true, requireSurcharges: true });
  if (v.errors.length) return NextResponse.json({ error: "Quote is incomplete.", errors: v.errors, warnings: v.warnings }, { status: 422 });

  // TrimScout calculates sales tax and title & registration. A different amount is the dealer's override: it needs a
  // reason, and the calculated figure is recomputed here, never taken from the browser. The doc fee can't be overridden.
  const zip = (rfq.quotePrefs?.quoteType === "finance" ? rfq.quotePrefs.finance?.zip : rfq.quotePrefs?.cash?.zip) || "";
  const fees = normalizeFeeOverrides({ dueAtSigning: quote.dueAtSigning, sellingPrice: quote.sellingPrice, addOns: quote.addOns, isNew: condition === "new", zip, submitted: raw.feeOverrides });
  if (fees.errors.length) return NextResponse.json({ error: "Quote is incomplete.", errors: fees.errors, warnings: v.warnings }, { status: 422 });

  const used = { ...(quote as UsedQuote), feeOverrides: fees.overrides.length ? fees.overrides : null } as UsedQuote;
  // A request with a trade-in takes no quote without the desk's trade allowance (or "can't quote this trade").
  const traded = await recordTradeWithQuote({ rfq, invite: found.invite, body, quoteExpiresAt: used.expiresAt });
  if (!traded.ok) return NextResponse.json(traded.body, { status: traded.status });
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
  // Tell the buyer a quote is in (after the response; SAFE MODE routes it, and a failure never fails the dealer's submit).
  after(() => notifyDealerQuoted(rfq, found.invite));
  if (fees.overrides.length) await announceOverrides({ rfq, invite: found.invite, rfqId: found.rfqId, vin, overrides: fees.overrides });
  return NextResponse.json({ ok: true, warnings: v.warnings, outTheDoor: used.kind === "cash" ? cashOutTheDoor(used) : null });
}

/** Best effort — the quote is already saved: log the override as a deal event, and tell the buyer through the SAFE MODE sender. */
async function announceOverrides(i: { rfq: NonNullable<Awaited<ReturnType<typeof getRfq>>>; invite: { id: string; dealerName: string }; rfqId: string; vin: string; overrides: FeeOverride[] }) {
  await postRfqMessage(i.rfqId, i.invite.id, { kind: "event", type: "fee_override", overrides: i.overrides as unknown as Array<Record<string, unknown>> }).catch((err) => {
    console.warn("used-quote: could not log the fee_override event —", err instanceof Error ? err.message : err);
  });
  const notice = buildFeeOverrideNotice({
    dealerName: i.invite.dealerName,
    vehicle: vehicleTitle({ vin: i.rfq.vin, year: i.rfq.vehicleYear, make: i.rfq.vehicleMake, model: i.rfq.vehicleModel, trim: i.rfq.vehicleTrim }) || "vehicle",
    overrides: i.overrides,
    url: `${DEALER_EMAIL_BASE_URL}${isGuestBuyerId(i.rfq.buyerUserId) ? guestTrackerPath(i.rfqId) : `/rfq/${encodeURIComponent(i.rfqId)}`}`,
  });
  await sendFeeOverrideNotice(notice);
}
