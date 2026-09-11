"use client";

import React, { useState } from "react";
import { X, Camera, Loader2, CheckCircle2, Trash2 } from "lucide-react";
import { TRADE_IN_PHOTO_ANGLES, type TradeInPhoto, type TradeInSubmission, type TradeInVehicle } from "../lib/types";
import { compressPhotoForTradeIn } from "../lib/tradeInPhotos";

interface TradeInSubmissionModalProps {
  isOpen: boolean;
  dealId: string;
  dealerName: string;
  onClose: () => void;
  onSubmitted: (tradeIn: TradeInSubmission) => void;
}

const CONDITIONS: Array<{ value: TradeInVehicle["condition"]; label: string; hint: string }> = [
  { value: "excellent", label: "Excellent", hint: "Like new, no issues" },
  { value: "very_good", label: "Very good", hint: "Minor wear only" },
  { value: "good", label: "Good", hint: "Normal wear for its age" },
  { value: "fair", label: "Fair", hint: "Visible damage or mechanical issues" },
];

/**
 * The step after the buyer locks in an offer, if they said they have a
 * trade-in: a few facts and five photos, sent to the winning dealer only.
 * Photos are compressed in the browser before upload — see lib/tradeInPhotos.
 */
export const TradeInSubmissionModal: React.FC<TradeInSubmissionModalProps> = ({
  isOpen,
  dealId,
  dealerName,
  onClose,
  onSubmitted,
}) => {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [mileage, setMileage] = useState("");
  const [vin, setVin] = useState("");
  const [condition, setCondition] = useState<TradeInVehicle["condition"]>("good");
  const [loanPayoff, setLoanPayoff] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [busyAngle, setBusyAngle] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const photoCount = Object.keys(photos).length;
  const yearNum = Number(year);
  const canSubmit =
    Number.isInteger(yearNum) && yearNum >= 1980 && make.trim() && model.trim() && Number(mileage) >= 0 && mileage !== "" && photoCount > 0;

  const handlePhoto = async (angle: string, file: File | null) => {
    if (!file) return;
    setBusyAngle(angle);
    setPhotoError(null);
    try {
      const dataUrl = await compressPhotoForTradeIn(file);
      setPhotos((current) => ({ ...current, [angle]: dataUrl }));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Couldn't add that photo.");
    } finally {
      setBusyAngle(null);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const photoList: TradeInPhoto[] = TRADE_IN_PHOTO_ANGLES.filter((a) => photos[a.angle]).map((a, i) => ({
      id: `photo-${i + 1}`,
      angle: a.angle,
      label: a.label,
      imageUrl: photos[a.angle],
    }));
    const tradeIn: TradeInSubmission = {
      year: yearNum,
      make: make.trim(),
      model: model.trim(),
      trim: trim.trim(),
      mileage: Math.round(Number(mileage)),
      vin: vin.trim().toUpperCase().length === 17 ? vin.trim().toUpperCase() : undefined,
      condition,
      loanPayoff: Math.max(0, Math.round(Number(loanPayoff.replace(/[^\d]/g, "")) || 0)),
      notes: notes.trim() || undefined,
      photos: photoList,
      submittedAt: new Date().toISOString(),
    };
    try {
      const res = await fetch(`/api/deals/${dealId}/trade-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeIn }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't send your trade-in.");
      onSubmitted(json.deal?.tradeIn || tradeIn);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your trade-in.");
      setIsSubmitting(false);
    }
  };

  const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none";
  const label = "text-[10px] font-bold uppercase tracking-wide text-ink-faint";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-white">Price your trade-in</h2>
            <p className="text-xs text-ink-muted">
              Goes to {dealerName} only. They&apos;ll come back with an allowance, and we&apos;ll show your revised tax and registration.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-muted hover:bg-border hover:text-white transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">The car</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="space-y-1"><span className={label}>Year</span><input className={field} inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} placeholder="2019" /></label>
              <label className="space-y-1"><span className={label}>Make</span><input className={field} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Honda" /></label>
              <label className="space-y-1"><span className={label}>Model</span><input className={field} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Accord" /></label>
              <label className="space-y-1"><span className={label}>Trim</span><input className={field} value={trim} onChange={(e) => setTrim(e.target.value)} placeholder="EX-L" /></label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <label className="space-y-1"><span className={label}>Mileage</span><input className={field} inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="48,000" /></label>
              <label className="space-y-1"><span className={label}>VIN (optional)</span><input className={`${field} font-mono`} maxLength={17} value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="17 characters" /></label>
              <label className="space-y-1"><span className={label}>Loan payoff (if any)</span><input className={field} inputMode="numeric" value={loanPayoff} onChange={(e) => setLoanPayoff(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" /></label>
            </div>
            <div className="space-y-1">
              <span className={label}>Condition</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CONDITIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCondition(c.value)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      condition === c.value ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:border-border-strong"
                    }`}
                  >
                    <div className="text-[11px] font-bold text-ink-light">{c.label}</div>
                    <div className="text-[10px] text-ink-faint">{c.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">Photos</h3>
              <p className="text-[11px] text-ink-muted">Phone photos are fine. They&apos;re resized before sending, so this stays quick on mobile.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TRADE_IN_PHOTO_ANGLES.map((a) => {
                const has = Boolean(photos[a.angle]);
                const busy = busyAngle === a.angle;
                return (
                  <div key={a.angle} className={`relative rounded-lg border overflow-hidden ${has ? "border-emerald-500/50" : "border-border border-dashed"}`}>
                    {has ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photos[a.angle]} alt={a.label} className="h-28 w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setPhotos((cur) => { const next = { ...cur }; delete next[a.angle]; return next; })}
                          className="absolute right-1.5 top-1.5 rounded bg-black/70 p-1 text-white hover:text-rose-400"
                          aria-label={`Remove ${a.label} photo`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1 text-[10px] font-bold text-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> {a.label}
                        </div>
                      </>
                    ) : (
                      <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1 px-2 text-center hover:bg-surface-elevated">
                        {busy ? <Loader2 className="h-5 w-5 animate-spin text-emerald-400" /> : <Camera className="h-5 w-5 text-ink-faint" />}
                        <span className="text-[11px] font-bold text-ink-light">{a.label}</span>
                        <span className="text-[10px] leading-tight text-ink-faint">{a.hint}</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          disabled={busy}
                          onChange={(e) => handlePhoto(a.angle, e.target.files?.[0] || null)}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            {photoError && <p className="text-[11px] text-rose-400">{photoError}</p>}
          </section>

          <label className="block space-y-1">
            <span className={label}>Anything the dealer should know (optional)</span>
            <textarea className={`${field} min-h-[60px]`} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recent service, known issues, accessories included…" />
          </label>

          {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-elevated px-6 py-4">
          <button type="button" onClick={onClose} className="text-xs font-bold text-ink-muted hover:text-white">Not now</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center gap-2"
          >
            {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : `Send to ${dealerName}`}
          </button>
        </div>
      </div>
    </div>
  );
};
