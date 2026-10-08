"use client";

export const dynamic = "force-dynamic";

import React, { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { TradePhotoSlots } from "../../../../components/trade/TradePhotoSlots";
import { useTradeDraft } from "../../../../components/trade/useTradeDraft";
import { TRADE_PHOTO_COPY, TRADE_PRIVACY_COPY } from "../../../../lib/trade/types";
import { requiredPhotoProgress } from "../../../../lib/trade/validate";

// The phone side of "Continue on my phone": the same draft, photos only, camera-first, one slot at a time.
// The link carries the draft's own token, so no login is needed on the phone.
function PhonePhotos() {
  const { id } = useParams<{ id: string }>();
  const k = useSearchParams().get("k") || "";
  const draft = useTradeDraft(true, { draftId: id, token: k, poll: true });
  const progress = requiredPhotoProgress(draft.photos);
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <h1 className="text-lg font-extrabold text-white">Trade-in photos</h1>
      <p className="text-xs text-ink-muted">{TRADE_PHOTO_COPY}</p>
      <p className="text-[11px] text-ink-faint">{TRADE_PRIVACY_COPY}</p>
      {draft.error ? <p className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200" role="alert">{draft.error.includes("valid") || draft.error.includes("not found") ? "This link isn't valid anymore. Start again from your computer." : draft.error}</p> : null}
      {draft.sent ? <p className="rounded-xl border border-border bg-surface p-3 text-sm text-ink-light">This trade-in was already sent with a request. You can change photos from the request page.</p> : (
        <TradePhotoSlots guided photos={draft.photos} urls={draft.urls} busySlot={draft.busySlot} slotError={draft.slotError} onPick={draft.uploadPhoto} onRemove={draft.removePhoto} />
      )}
      {progress.complete ? <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-sm text-emerald-200" data-testid="phone-done">All 6 required photos are in. Go back to your computer and continue; they&apos;re already there.</p> : null}
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={<p className="p-6 text-sm text-ink-muted">Loading…</p>}><PhonePhotos /></Suspense>;
}
