"use client";

import React, { useState } from "react";
import { MAX_TRADE_PHOTOS, TRADE_CONDITIONS, TRADE_CONDITION_LABELS, TRADE_VALUES_COPY, parseTradeInRequest } from "../lib/rfqTradeIn";

/**
 * "Add a trade-in" for ONE dealer. VIN, or year/make/model/trim; mileage; optional payoff + lender;
 * condition; up to 6 photos and a short note. Validated with the same parser the server runs.
 * A request for an estimate — nothing is binding.
 */
const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none tabular-nums";
const label = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";

/** Downscale to ≤1280px JPEG so six photos stay a few hundred KB each at most. */
export async function compressPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function TradeInForm({ dealerName, onSubmit, onCancel }: { dealerName: string; onSubmit: (tradeIn: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({ vin: "", year: "", make: "", model: "", trim: "", mileage: "", payoff: "", lender: "", condition: "good", note: "" });
  const [photos, setPhotos] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const hasVin = f.vin.trim().length > 0;

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_TRADE_PHOTOS - photos.length;
    try {
      const next = await Promise.all(Array.from(files).slice(0, room).map(compressPhoto));
      setPhotos((p) => [...p, ...next]);
    } catch {
      setErrors(["One of those photos couldn't be read — try a JPEG or PNG."]);
    }
  };

  const submit = async () => {
    const payload = { ...f, photos };
    const parsed = parseTradeInRequest(payload);
    if (!parsed.ok) { setErrors(parsed.errors); return; }
    setBusy(true); setErrors([]);
    try { await onSubmit(payload); } catch (e) { setErrors([e instanceof Error ? e.message : "Could not add your trade-in."]); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface p-4" data-testid="trade-in-form">
      <div>
        <p className="text-sm font-bold text-white">Add a trade-in for {dealerName}</p>
        <p className="text-[11px] text-ink-muted">{dealerName} is asked to quote a trade value. {TRADE_VALUES_COPY} Nothing is binding.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2"><span className={label}>VIN <span className="font-normal normal-case">(or fill year / make / model / trim)</span></span>
          <input value={f.vin} onChange={set("vin")} maxLength={17} placeholder="17-character VIN" aria-label="Trade-in VIN" className={`${input} font-mono uppercase`} /></label>
        {!hasVin ? (
          <>
            <label className="space-y-1"><span className={label}>Year</span><input value={f.year} onChange={set("year")} inputMode="numeric" maxLength={4} aria-label="Trade-in year" className={input} /></label>
            <label className="space-y-1"><span className={label}>Make</span><input value={f.make} onChange={set("make")} aria-label="Trade-in make" className={input} /></label>
            <label className="space-y-1"><span className={label}>Model</span><input value={f.model} onChange={set("model")} aria-label="Trade-in model" className={input} /></label>
            <label className="space-y-1"><span className={label}>Trim</span><input value={f.trim} onChange={set("trim")} aria-label="Trade-in trim" className={input} /></label>
          </>
        ) : null}
        <label className="space-y-1"><span className={label}>Mileage</span><input value={f.mileage} onChange={set("mileage")} inputMode="numeric" aria-label="Trade-in mileage" className={input} /></label>
        <label className="space-y-1"><span className={label}>Condition</span>
          <select value={f.condition} onChange={set("condition")} aria-label="Trade-in condition" className={input}>
            {TRADE_CONDITIONS.map((c) => <option key={c} value={c}>{TRADE_CONDITION_LABELS[c]}</option>)}
          </select></label>
        <label className="space-y-1"><span className={label}>Payoff owed <span className="font-normal normal-case">(optional)</span></span><input value={f.payoff} onChange={set("payoff")} inputMode="decimal" placeholder="$0" aria-label="Trade-in payoff owed" className={input} /></label>
        <label className="space-y-1"><span className={label}>Lender <span className="font-normal normal-case">(optional)</span></span><input value={f.lender} onChange={set("lender")} maxLength={80} aria-label="Trade-in lender" className={input} /></label>
      </div>
      <div className="space-y-1.5">
        <span className={label}>Photos <span className="font-normal normal-case">(optional, up to {MAX_TRADE_PHOTOS})</span></span>
        {photos.length ? (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {photos.map((p, i) => (
              <button key={i} type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="group relative" aria-label={`Remove photo ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt="" className="aspect-[4/3] w-full rounded-md border border-border object-cover" />
                <span className="absolute inset-0 hidden items-center justify-center rounded-md bg-black/60 text-[10px] font-bold text-white group-hover:flex">Remove</span>
              </button>
            ))}
          </div>
        ) : null}
        {photos.length < MAX_TRADE_PHOTOS ? <input type="file" accept="image/*" multiple onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} className="block text-[11px] text-ink-light" aria-label="Add trade-in photos" /> : null}
      </div>
      <label className="block space-y-1"><span className={label}>Note <span className="font-normal normal-case">(optional)</span></span>
        <textarea value={f.note} onChange={set("note")} maxLength={500} rows={2} placeholder="Anything the dealer should know — no phone numbers or emails" aria-label="Trade-in note" className={input} /></label>
      {errors.length ? <ul className="space-y-0.5 text-[11px] text-rose-300" role="alert">{errors.map((e) => <li key={e}>• {e}</li>)}</ul> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="submit-trade-in">{busy ? "Sending…" : `Send trade-in to ${dealerName}`}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">Cancel</button>
      </div>
    </div>
  );
}
