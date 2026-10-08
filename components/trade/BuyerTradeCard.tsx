"use client";

import React, { useCallback, useEffect, useState } from "react";
import { TradeSummary, type SignedView } from "./TradeSummary";
import { TradePhotoSlots } from "./TradePhotoSlots";
import { processPhoto } from "../../lib/trade/photoPipeline";
import { PHOTO_SLOT_INFO, type OptionalSlot, type PhotoSlot, type TradeInRecord, TRADE_PRIVACY_COPY } from "../../lib/trade/types";

interface Loaded { tradeIn: TradeInRecord | null; signed: SignedView[]; photoRequests: Array<{ inviteId: string; dealerName: string; slots: OptionalSlot[]; note: string | null }>; locked?: boolean }

/**
 * "Your trade-in" on a sent request: the buyer's own details and photos, dealers' in-app asks for more photos,
 * and replace / add of photos until a quote is picked. Invited dealers get one notice per batch of changes.
 */
export function BuyerTradeCard({ rfqId, headers, version }: { rfqId: string; headers?: Record<string, string>; version?: unknown }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busySlot, setBusySlot] = useState<PhotoSlot | null>(null);
  const [slotError, setSlotError] = useState<{ slot: PhotoSlot; message: string } | null>(null);
  const [show, setShow] = useState(false);
  const hdr = { "Content-Type": "application/json", ...(headers || {}) };
  const load = useCallback(() => fetch(`/api/rfqs/${rfqId}/trade`, { headers: hdr }).then((r) => r.json()).then((j: Loaded) => { setData(j); setUrls(Object.fromEntries((j.signed || []).map((s) => [s.slot, s.url]))); }).catch(() => undefined), [rfqId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, version]);
  if (!data?.tradeIn) return null;
  const trade = data.tradeIn;
  const requested = Array.from(new Set(data.photoRequests.flatMap((r) => r.slots)));
  const locked = Boolean(data.locked);

  const post = async (body: object) => {
    const res = await fetch(`/api/rfqs/${rfqId}/trade/photos`, { method: "POST", headers: hdr, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
    return json;
  };
  const onPick = async (slot: PhotoSlot, file: File) => {
    setSlotError(null); setBusySlot(slot);
    try {
      const out = await processPhoto(file);
      if (!out.ok) { setSlotError({ slot, message: out.message }); return; }
      const { uploadUrl } = await post({ op: "sign", slot });
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: out.blob });
      if (!put.ok) throw new Error("The upload didn't go through. Check your connection and retry.");
      await post({ op: "confirm", slot, width: out.width, height: out.height, capturedAt: out.capturedAt });
      setUrls((u) => ({ ...u, [slot]: URL.createObjectURL(out.blob) }));
      await load();
    } catch (e) { setSlotError({ slot, message: e instanceof Error ? e.message : "Couldn't upload that photo." }); } finally { setBusySlot(null); }
  };
  const onRemove = async (slot: PhotoSlot) => { try { await post({ op: "remove", slot }); await load(); } catch (e) { setSlotError({ slot, message: e instanceof Error ? e.message : "Couldn't remove that photo." }); } };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4" data-testid="buyer-trade-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">Your trade-in</h3>
        <button type="button" onClick={() => setShow((v) => !v)} className="text-[11px] font-bold text-brand-300 hover:text-brand-200">{show ? "Hide details" : "Details and photos"}</button>
      </div>
      {data.photoRequests.length ? (
        <div className="rounded-xl border border-sky-500/40 bg-sky-950/20 p-3 text-xs text-sky-100" data-testid="photo-requests">
          {data.photoRequests.map((r) => (
            <p key={r.inviteId}><strong>{r.dealerName}</strong> asked for {r.slots.map((s) => PHOTO_SLOT_INFO[s].label).join(", ") || "more detail"}{r.note ? `: “${r.note}”` : ""}. Add {r.slots.length > 1 ? "them" : "it"} below{r.slots.length ? "" : " (any photo works)"}.</p>
          ))}
        </div>
      ) : null}
      {show || data.photoRequests.length ? (
        <>
          {show ? <TradeSummary trade={trade} signed={data.signed} /> : null}
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-bold text-white">{locked ? "Photos are locked (the request is closed)" : "Replace a photo or add more until you pick a quote"}</p>
            {locked ? null : <p className="text-[11px] text-ink-muted">Dealers are told once when photos change. {TRADE_PRIVACY_COPY}</p>}
            {!locked ? <TradePhotoSlots photos={trade.photos} urls={urls} busySlot={busySlot} slotError={slotError} onPick={onPick} onRemove={onRemove} requested={requested} sent /> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
