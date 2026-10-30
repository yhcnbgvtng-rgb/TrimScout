// /api/quote-invite/trade — the dealer's side of the request's trade-in, behind the invite's own tracked-link token.
//   GET ?t=…                                   the trade summary + signed photo URLs (5-minute expiry) + this desk's
//                                              appraisal and photo request. Opening it marks the trade "seen".
//   POST { t, kind: "appraisal", … }           the trade appraisal (allowance single | range, basis, good-until, payoff)
//   POST { t, kind: "photo_request", slots, note }   ONE in-app ask for more photos; no email thread.
// Only a desk invited on this request resolves; anyone else gets a 404. Never a public photo URL.
import { NextResponse, after } from "next/server";
import { getRfq, getRfqInviteByViewToken, markTradeSeen, reconfirmTradeAppraisal, RfqApiError, submitTradeAppraisal, submitTradePhotoRequest } from "@/lib/rfqApi";
import { dealerMayViewTrade, signTradePhotos } from "@/lib/trade/access";
import { payoffShared, redactDealerTradePayload } from "@/lib/trade/dealerView";
import { s3Storage } from "@/lib/trade/storage";
import { tradeErrorResponse } from "@/lib/trade/routeKit";
import { parseAppraisalInput, parsePhotoRequestInput, parseTradeDecline } from "@/lib/trade/dealer";
import { effectiveStatus, publicConfirmation, tradeConfirmConfig } from "@/lib/trade/confirm";
import { settleAndCloseOut, sweepIfDue } from "@/lib/trade/confirmFlow";
import { guideValue, isOutlier } from "@/lib/trade/guide";
import { dealerMayAppraise } from "@/lib/acceptTrade";

const TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;

async function resolve(token: string) {
  if (!TOKEN_RE.test(token)) return { res: NextResponse.json({ error: "Invalid link." }, { status: 400 }) };
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return { res: NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 }) };
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq || !dealerMayViewTrade(found, rfq.id)) return { res: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  const invite = rfq.invites.find((i) => i.id === found.invite.id);
  if (!invite) return { res: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  return { rfq, invite };
}

export async function GET(req: Request) {
  const r = await resolve((new URL(req.url).searchParams.get("t") || "").trim());
  if (r.res) return r.res;
  const { rfq: loaded, invite: loadedInvite } = r;
  if (!loaded.tradeIn) return NextResponse.json({ tradeIn: null });
  try {
    // A confirm-step deadline that passed is written now (the original number stands) before this desk is shown anything.
    const swept = await sweepIfDue(loaded);
    if (swept.settledInviteIds.length) { const ids = swept.settledInviteIds; after(async () => { for (const w of ids) await settleAndCloseOut(loaded.id, w); }); }
    const rfq = swept.rfq;
    const invite = rfq.invites.find((i) => i.id === loadedInvite.id) ?? loadedInvite;
    const signed = await signTradePhotos(s3Storage, rfq.tradeIn!.photos);
    await markTradeSeen(rfq.id, invite.id).catch(() => undefined);
    // Payoff amount + lender are the buyer's to share; without their say-so the dealer sees only that a payoff exists.
    return NextResponse.json(redactDealerTradePayload({
      tradeIn: rfq.tradeIn!, signed, appraisal: invite.tradeAppraisal ?? null, photoRequest: invite.tradePhotoRequest ?? null,
      inviteStatus: invite.status, rfqStatus: rfq.status, appraisalOpen: dealerMayAppraise(rfq, invite),
      // The confirm-or-revise step: present only for the desk the buyer selected.
      confirmation: publicConfirmation(invite.tradeConfirmation),
      confirmationStatus: effectiveStatus(invite.tradeConfirmation, new Date()),
      quoteExpiresAt: invite.quote?.expiresAt ?? null,
      thresholdPct: tradeConfirmConfig().thresholdPct,
    }, rfq.tradeIn!));
  } catch (err) {
    return tradeErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const r = await resolve(typeof body?.t === "string" ? body.t.trim() : "");
  if (r.res) return r.res;
  const { rfq, invite } = r;
  if (!rfq.tradeIn) return NextResponse.json({ error: "The buyer didn't include a trade-in." }, { status: 409 });
  if (invite.notSelectedAt) return NextResponse.json({ error: "The buyer chose another dealer, so this quote is closed." }, { status: 409 });
  if (!dealerMayAppraise(rfq, invite)) return NextResponse.json({ error: "The buyer has closed this request." }, { status: 409 });
  if (invite.status === "declined") return NextResponse.json({ error: "This invite was declined." }, { status: 409 });
  try {
    if (body?.kind === "appraisal") {
      const parsed = parseAppraisalInput(body, { payoffEstimate: rfq.tradeIn.payoffEstimate, ownership: rfq.tradeIn.ownership, quoteExpiresAt: invite.quote?.expiresAt ?? null });
      if (!parsed.ok) return NextResponse.json({ error: parsed.errors.join(" "), errors: parsed.errors }, { status: 422 });
      // Optional value-guide sanity check: only when a guide is configured; never a silent paid call.
      const guide = await guideValue({ vin: rfq.tradeIn.vin, mileage: rfq.tradeIn.mileage, zip: rfq.tradeIn.zip });
      const mid = parsed.value.allowanceSingle ?? ((parsed.value.allowanceLow as number) + (parsed.value.allowanceHigh as number)) / 2;
      const outlier = isOutlier(mid, guide);
      if (outlier && body.confirmOutlier !== true) {
        return NextResponse.json({ error: `That's more than 50% away from the value guide ($${Math.round(guide as number).toLocaleString()}). Confirm it's right to continue.`, needsConfirmation: true, guideValue: guide }, { status: 409 });
      }
      await submitTradeAppraisal(rfq.id, invite.id, { ...parsed.value, outlierConfirmed: outlier ? true : undefined });
      return NextResponse.json({ ok: true, ...(payoffShared(rfq.tradeIn) ? { equityComputed: parsed.value.equityComputed } : {}) });
    }
    if (body?.kind === "decline") {
      const parsed = parseTradeDecline(body, { quoteExpiresAt: invite.quote?.expiresAt ?? null });
      if (!parsed.ok) return NextResponse.json({ error: parsed.errors.join(" "), errors: parsed.errors }, { status: 422 });
      await submitTradeAppraisal(rfq.id, invite.id, parsed.value);
      return NextResponse.json({ ok: true });
    }
    if (body?.kind === "reconfirm") {
      await reconfirmTradeAppraisal(rfq.id, invite.id);
      return NextResponse.json({ ok: true });
    }
    if (body?.kind === "photo_request") {
      if (invite.tradePhotoRequest?.status === "open") return NextResponse.json({ error: "You already have an open photo request. The buyer will see it in TrimScout." }, { status: 409 });
      const parsed = parsePhotoRequestInput(body);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
      await submitTradePhotoRequest(rfq.id, invite.id, parsed.value);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  } catch (err) {
    if (err instanceof RfqApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return tradeErrorResponse(err);
  }
}
