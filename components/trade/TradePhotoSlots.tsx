"use client";

import React, { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, RefreshCw, Trash2 } from "lucide-react";
import { OPTIONAL_PHOTO_SLOTS, PHOTO_SLOT_INFO, REQUIRED_PHOTO_SLOTS, type PhotoSlot, type TradePhoto } from "../../lib/trade/types";
import { photoProgressLabel, requiredPhotoProgress } from "../../lib/trade/validate";

/** Simple line drawings so each slot shows what the shot should look like. */
function SlotExample({ slot }: { slot: PhotoSlot }) {
  const c = "currentColor";
  const body = (d: React.ReactNode) => <svg viewBox="0 0 120 80" className="h-full w-full text-ink-faint" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
  switch (slot) {
    case "front": return body(<><path d="M22 58V38l8-14h60l8 14v20" /><rect x="22" y="38" width="76" height="20" rx="4" /><circle cx="36" cy="48" r="4" /><circle cx="84" cy="48" r="4" /><path d="M46 52h28" /></>);
    case "rear": return body(<><path d="M22 58V38l8-14h60l8 14v20" /><rect x="22" y="38" width="76" height="20" rx="4" /><rect x="28" y="44" width="12" height="6" /><rect x="80" y="44" width="12" height="6" /><path d="M50 52h20" /></>);
    case "driver_side": case "passenger_side": return body(<><path d="M10 54V44l12-6 16-14h40l16 14 10 4v12" /><path d="M10 54h100" /><circle cx="34" cy="56" r="8" /><circle cx="88" cy="56" r="8" /><path d={slot === "driver_side" ? "M48 24v14M70 24v14" : "M50 24v14M72 24v14"} /></>);
    case "odometer": return body(<><circle cx="60" cy="42" r="28" /><path d="M60 42l14-12" /><rect x="40" y="56" width="40" height="10" rx="2" /><path d="M46 61h28" /></>);
    case "interior": return body(<><path d="M14 66V30l20-10h52l20 10v36" /><rect x="40" y="36" width="40" height="12" rx="3" /><circle cx="30" cy="52" r="10" /><path d="M24 70h24" /></>);
    case "rear_cargo": return body(<><rect x="16" y="30" width="88" height="34" rx="4" /><path d="M16 46h88M44 30v34" /></>);
    case "tire_tread": return body(<><circle cx="60" cy="42" r="28" /><circle cx="60" cy="42" r="14" /><path d="M60 14v8M60 62v8M32 42h8M80 42h8" /></>);
    default: return body(<><path d="M20 60l30-30 12 10 28-24" /><path d="M20 60h80" /><circle cx="86" cy="30" r="3" fill={c} /></>);
  }
}

export interface SlotsProps {
  photos: TradePhoto[];
  urls: Record<string, string>;
  busySlot: PhotoSlot | null;
  slotError: { slot: PhotoSlot; message: string } | null;
  onPick: (slot: PhotoSlot, file: File) => void | Promise<unknown>;
  onRemove: (slot: PhotoSlot) => void;
  /** Phones: open the camera, one required slot at a time. */
  guided?: boolean;
  /** Only the slots a dealer asked for are highlighted as requested. */
  requested?: PhotoSlot[];
  /** Lock required slots from removal (sent request). */
  sent?: boolean;
  /** Highlight the first missing required slot (after a submit attempt). */
  pointAtMissing?: boolean;
}

function SlotCard({ slot, photos, urls, busySlot, slotError, onPick, onRemove, guided, requested, sent, highlight }: SlotsProps & { slot: PhotoSlot; highlight?: boolean }) {
  const info = PHOTO_SLOT_INFO[slot];
  const have = photos.find((p) => p.slot === slot);
  const input = useRef<HTMLInputElement>(null);
  const busy = busySlot === slot;
  const err = slotError?.slot === slot ? slotError.message : null;
  const asked = requested?.includes(slot);
  return (
    <div id={`trade-slot-${slot}`} className={`rounded-xl border p-3 ${highlight ? "border-amber-400 ring-1 ring-amber-400/60" : asked ? "border-sky-400/60" : "border-border"} bg-background/40`} data-testid={`slot-${slot}`}>
      <div className="flex gap-3">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-surface">
          {have && urls[slot] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={urls[slot]} alt={`${info.label} photo`} className="h-full w-full object-cover" /> : <SlotExample slot={slot} />}
          {have ? <CheckCircle2 className="absolute right-1 top-1 h-4 w-4 text-emerald-400" aria-label="Added" /> : null}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-bold text-white">{info.label}{info.required ? <span className="ml-1 text-[10px] font-semibold text-amber-300">Required</span> : <span className="ml-1 text-[10px] font-semibold text-ink-faint">{asked ? "Requested by a dealer" : "Recommended"}</span>}</p>
          <p className="text-[11px] text-ink-muted">{info.hint}</p>
          {err ? <p className="text-[11px] text-rose-300" role="alert" data-testid="slot-error">{err}</p> : null}
          <div className="flex flex-wrap gap-2 pt-0.5">
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-ink-light hover:border-ink-muted hover:text-white disabled:opacity-50" data-testid={`slot-pick-${slot}`}>
              {have ? <RefreshCw className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}{busy ? "Uploading…" : have ? "Replace" : guided ? "Take photo" : "Upload"}
            </button>
            {have && !info.required ? <button type="button" onClick={() => onRemove(slot)} className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" />Remove</button> : null}
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" {...(guided ? { capture: "environment" as const } : {})} className="hidden" aria-label={`${info.label} photo`}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(slot, f); e.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

/** Six guided required slots + up to six optional ones, with "N of 6 required photos" progress. */
export function TradePhotoSlots(props: SlotsProps) {
  const progress = requiredPhotoProgress(props.photos);
  const first = progress.firstMissing;
  const [activeIdx, setActiveIdx] = useState(() => (first ? REQUIRED_PHOTO_SLOTS.indexOf(first as typeof REQUIRED_PHOTO_SLOTS[number]) : 0));
  // Phones go one required slot at a time: follow the first missing slot as photos land.
  useEffect(() => { if (props.guided && first) setActiveIdx(REQUIRED_PHOTO_SLOTS.indexOf(first as typeof REQUIRED_PHOTO_SLOTS[number])); }, [first, props.guided]);
  const missingNow = props.pointAtMissing ? first : null;
  useEffect(() => { if (missingNow) document.getElementById(`trade-slot-${missingNow}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [missingNow]);
  const requiredToShow = props.guided && first ? [REQUIRED_PHOTO_SLOTS[activeIdx]] : REQUIRED_PHOTO_SLOTS;
  return (
    <div className="space-y-3" data-testid="trade-photo-slots">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-bold ${progress.complete ? "text-emerald-300" : "text-white"}`} data-testid="photo-progress">{photoProgressLabel(props.photos)}</p>
        {!progress.complete && first ? <button type="button" onClick={() => document.getElementById(`trade-slot-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="text-[11px] font-bold text-brand-300 hover:text-brand-200">Next: {PHOTO_SLOT_INFO[first].label}</button> : null}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full bg-brand-500 transition-all" style={{ width: `${(progress.have / progress.total) * 100}%` }} /></div>
      <div className="space-y-2">
        {requiredToShow.map((s) => <SlotCard key={s} {...props} slot={s} highlight={missingNow === s} />)}
      </div>
      {props.guided && first ? (
        <div className="flex justify-between text-[11px] text-ink-muted">
          <button type="button" disabled={activeIdx === 0} onClick={() => setActiveIdx((i) => Math.max(0, i - 1))} className="disabled:opacity-40">← Previous</button>
          <span>{activeIdx + 1} of {REQUIRED_PHOTO_SLOTS.length}</span>
          <button type="button" disabled={activeIdx >= REQUIRED_PHOTO_SLOTS.length - 1} onClick={() => setActiveIdx((i) => Math.min(REQUIRED_PHOTO_SLOTS.length - 1, i + 1))} className="disabled:opacity-40">Skip →</button>
        </div>
      ) : null}
      {(!props.guided || progress.complete) ? (
        <div className="space-y-2 pt-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Recommended extras <span className="font-normal normal-case">(up to {OPTIONAL_PHOTO_SLOTS.length})</span></p>
          {OPTIONAL_PHOTO_SLOTS.map((s) => <SlotCard key={s} {...props} slot={s} />)}
        </div>
      ) : null}
    </div>
  );
}
