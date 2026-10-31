// POST /api/quote-invite/accept-counter { t, quote } — the dealer accepting
// the buyer's counter on a cash quote. `quote` is the sheet the dealer
// confirmed; it is verified against the counter on file (every line but
// sales tax must equal it), and the stored revised quote is rebuilt from the
// counter with only the tax amounts taken from the dealer. The buyer is told
// by email through the SAFE MODE sender. Token-scoped; no login.
import { NextResponse, after as afterResponse } from "next/server";
import { getRfq, getRfqInviteByViewToken, postDealStage, RfqApiError, submitRfqQuote } from "@/lib/rfqApi";
import { isStagedRfq } from "@/lib/dealStages";
import { acceptableCashCounter, acceptedOutTheDoor, buildAcceptedQuote, verifyAcceptedQuote } from "@/lib/acceptCounter";
import { isTaxLine } from "@/lib/counterSheet";
import { activeOverrides } from "@/lib/feeOverride";
import { surchargeSummary, validateUsedQuote, type UsedCashQuote, type UsedQuote } from "@/lib/usedQuote";
import { rfqVehicles } from "@/lib/rfqTracker";
import { sendCounterAcceptedNotice } from "@/lib/dealerEmail";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";
import { closeOutLosers } from "@/lib/inviteOutbox";
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
  const invite = rfq.invites.find((i) => i.id === found.invite.id) || found.invite;
  if (invite.notSelectedAt) return NextResponse.json({ error: "The buyer chose another dealer, so this quote is closed." }, { status: 409 });
  if (invite.status !== "invited") return NextResponse.json({ error: `This invite already has a response (${invite.status}).` }, { status: 409 });
  const counter = acceptableCashCounter(rfq.quotePrefs, invite.buyerCounter);
  if (!counter) return NextResponse.json({ error: "There is no buyer counter on this cash quote to accept." }, { status: 409 });

  const raw = (body?.quote && typeof body.quote === "object" ? body.quote : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const toLines = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>).map((l) => ({ name: String(l?.name || ""), amount: num(l?.amount) ?? NaN })) : undefined);
  const submitted: Partial<UsedQuote> = {
    kind: raw.kind === "cash" ? "cash" : undefined,
    sellingPrice: num(raw.sellingPrice),
    dueAtSigning: toLines(raw.dueAtSigning),
    addOns: toLines(raw.addOns) ?? [],
    noAddOns: Boolean(raw.noAddOns),
    surcharges: toLines(raw.surcharges) ?? [],
    noSurcharges: Boolean(raw.noSurcharges),
    rebates: toLines(raw.rebates) ?? [],
    miles: num(raw.miles) ?? null,
    cpo: Boolean(raw.cpo),
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
  };
  const mismatches = verifyAcceptedQuote(submitted, counter);
  if (mismatches.length) return NextResponse.json({ error: "That isn't the buyer's counter.", errors: mismatches }, { status: 422 });

  // Only the tax amounts come from the dealer; everything else is the counter's own sheet.
  const after = counter.sheet.after as UsedCashQuote;
  const submittedTax = (submitted.dueAtSigning || []).find((l) => isTaxLine(l.name))?.amount ?? 0;
  const built = buildAcceptedQuote(after, submittedTax, counter.sentAt);
  // Overrides carried over from the quote this counter answered survive only while the line still equals the dealer's amount.
  const used = { ...built, feeOverrides: activeOverrides(built).length ? activeOverrides(built) : null };
  const vin = (invite.vehicle?.vin || rfq.vin).toUpperCase();
  const stockNumber = used.stockNumber || rfq.stockNumber;
  const car = rfqVehicles(rfq).find((c) => c.vin === vin) || rfqVehicles(rfq)[0] || null;
  const v = validateUsedQuote(used, rfq.quotePrefs!, { vin, stockNumber, condition: car?.condition || "new" });
  if (v.errors.length) return NextResponse.json({ error: "Quote is incomplete.", errors: v.errors, warnings: v.warnings }, { status: 422 });

  try {
    await submitRfqQuote(found.rfqId, invite.id, {
      price: used.sellingPrice,
      fees: used.dueAtSigning.map((f) => ({ label: f.name, amount: f.amount })),
      vin,
      stockNumber,
      expiresAt: used.expiresAt,
      mustHaveAcknowledgement: true,
      notes: used.notes || null,
      used,
    });
  } catch (err) {
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof RfqApiError ? err.message : "Could not record the accepted counter." }, { status });
  }

  // Staged Cash / Finance deal: the dealer accepting the buyer's counter is what locks the out-the-door price (stage 1).
  let stageLocked = false;
  if (isStagedRfq(rfq)) {
    try {
      await postDealStage(found.rfqId, invite.id, { action: { type: "accept_otd" }, actor: "dealer" });
      stageLocked = true;
    } catch (err) {
      // The revised quote is saved; the buyer can still accept it from their compare to lock the stage.
      console.error("accept-counter: could not lock the OTD stage —", err instanceof Error ? err.message : err);
    }
  }
  // The buyer's counter was accepted and the price is locked: that is the choice of dealer, so close and thank everyone else, once.
  if (stageLocked) afterResponse(async () => { await closeOutLosers(rfq, invite.id); });
  const outTheDoor = acceptedOutTheDoor(used);
  // Best effort — the accepted quote is already on the buyer's compare.
  await sendCounterAcceptedNotice({
    dealerName: invite.dealerName,
    vehicle: vehicleTitle({ vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim }) || "vehicle",
    outTheDoor,
    surcharges: surchargeSummary(used),
    rfqUrl: `${DEALER_EMAIL_BASE_URL}/rfq/${encodeURIComponent(found.rfqId)}`,
  });
  return NextResponse.json({ ok: true, outTheDoor, warnings: v.warnings, stageLocked });
}
