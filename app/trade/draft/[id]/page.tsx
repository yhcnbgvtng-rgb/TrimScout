"use client";

export const dynamic = "force-dynamic";

import React, { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { TradePhotoSlots } from "../../../../components/trade/TradePhotoSlots";
import { useTradeDraft } from "../../../../components/trade/useTradeDraft";
import { TRADE_PHOTO_COPY, TRADE_PRIVACY_COPY } from "../../../../lib/trade/types";
import { requiredPhotoProgress, tradeReadiness } from "../../../../lib/trade/validate";

// The phone side of "Continue on my phone": the same draft, photos only, camera-first, one slot at a time.
// The link carries the draft's own token, so no login is needed on the phone.
function PhonePhotos() {
  const { id } = useParams<{ id: string }>();
  const k = useSearchParams().get("k") || "";
  const draft = useTradeDraft(true, { draftId: id, token: k, poll: true });
  const progress = requiredPhotoProgress(draft.photos);
  const readiness = tradeReadiness(draft.fields, draft.photos, { uploading: Boolean(draft.busySlot) });
  const detailsLeft = readiness.missing.filter((m) => !/photo/i.test(m));
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <h1 className="text-lg font-extrabold text-white">Trade-in photos</h1>
      <p className="text-xs text-ink-muted">{TRADE_PHOTO_COPY}</p>
      <p className="text-[11px] text-ink-faint">{TRADE_PRIVACY_COPY}</p>
      {draft.error ? <p className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200" role="alert">{draft.error.includes("valid") || draft.error.includes("not found") ? "This link isn't valid anymore. Start again from your computer." : draft.error}</p> : null}
      {draft.sent ? <p className="rounded-xl border border-border bg-surface p-3 text-sm text-ink-light">This trade-in was already sent with a request. You can change photos from the request page.</p> : (
        <TradePhotoSlots guided photos={draft.photos} urls={draft.urls} busySlot={draft.busySlot} slotError={draft.slotError} onPick={draft.uploadPhoto} onRemove={draft.removePhoto} />
      )}
      {progress.complete ? <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-sm text-emerald-200" data-testid="phone-done">All 6 required photos are in. They&apos;re already saved to your draft.</p> : null}
      {progress.complete && detailsLeft.length ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-100" role="status" data-testid="phone-details-left">
          <p className="font-bold">Photos done. To continue, the trade-in details still need:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{detailsLeft.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="mt-2 text-amber-200/80">Fill these in on the quote request, where this draft opens with your photos already attached. This page only collects photos.</p>
        </div>
      ) : null}
      {progress.complete && !detailsLeft.length ? <p className="text-xs text-emerald-200" data-testid="phone-ready">Details and photos are complete. Go back to the quote request and continue.</p> : null}
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading…</p>}><PhonePhotos /></Suspense>;
}
