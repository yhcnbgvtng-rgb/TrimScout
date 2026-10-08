"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import QRCode from "qrcode";
import { useTradeDraft, type Fields } from "./useTradeDraft";
import { TradePhotoSlots } from "./TradePhotoSlots";
import {
  DRIVETRAIN_LABELS, DRIVETRAINS, HISTORY_FLAGS, INTENT_LABELS, KEYS, OWNERSHIP_LABELS, OWNERSHIPS, SERVICE_HISTORIES, SERVICE_LABELS, TIRE_BRAKES, TIRE_BRAKE_LABELS, TITLE_LABELS, TITLE_STATUSES,
  TRADE_CONDITIONS, TRADE_CONDITION_COPY, TRADE_INTENTS, TRADE_OPTIONS, TRADE_OPTION_LABELS, TRADE_PHOTO_COPY, TRADE_PRIVACY_COPY,
} from "../../lib/trade/types";
import { isValidVin, parseTradeFields, requiredPhotoProgress } from "../../lib/trade/validate";

export interface TradeStepState { ready: boolean; draftId: string | null; token: string | null; firstError: string | null }

const inputCls = "w-full rounded-xl border border-border bg-background py-2.5 px-3.5 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none";
const labelCls = "text-xs font-semibold text-ink-light";
const errCls = "mt-1 text-[11px] text-rose-400";

function Chips<T extends string>({ value, options, labels, onChange, testId, multi }: { value: T | T[] | null | undefined; options: readonly T[]; labels: Record<string, string>; onChange: (v: T) => void; testId?: string; multi?: boolean }) {
  const on = (o: T) => (Array.isArray(value) ? value.includes(o) : value === o);
  return (
    <div className="flex flex-wrap gap-2" role={multi ? "group" : "radiogroup"} data-testid={testId}>
      {options.map((o) => (
        <button key={o} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on(o)} onClick={() => onChange(o)}
          className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition-all ${on(o) ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light hover:border-border-strong"}`}>{labels[o]}</button>
      ))}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <section className="space-y-3 border-t border-border/60 pt-4 first:border-t-0 first:pt-0"><div><h4 className="text-sm font-bold text-white">{title}</h4>{hint ? <p className="text-[11px] text-ink-muted">{hint}</p> : null}</div>{children}</section>;
}

/**
 * The Trade-In step of Configure Quote Request. Toggle "I have a trade-in" (off = nothing is collected or sent).
 * On: required details + six required photos (nothing sends until both are complete) + optional sharper-number fields.
 */
export function TradeInStep({ enabled, onToggle, defaultZip, attempted, onState }: { enabled: boolean; onToggle: (on: boolean) => void; defaultZip?: string | null; attempted: boolean; onState: (s: TradeStepState) => void }) {
  const draft = useTradeDraft(enabled, { poll: true });
  const f = draft.fields as Fields & Record<string, any>;
  const set = (patch: Fields) => draft.setFields((prev) => ({ ...prev, ...patch }));
  const [decode, setDecode] = useState<{ state: "idle" | "loading" | "ok" | "fail"; text?: string }>({ state: "idle" });
  const [manual, setManual] = useState(false);
  const [guided, setGuided] = useState(false);
  const [handoff, setHandoff] = useState<{ link: string; qr: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setGuided(typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches); }, []);
  // ZIP defaults to the account ZIP but stays editable.
  useEffect(() => { if (enabled && !f.zip && defaultZip && /^\d{5}$/.test(defaultZip)) set({ zip: defaultZip }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [enabled, defaultZip, draft.ref?.id]);

  // Decode the VIN to year/make/model/trim once it's a valid VIN.
  const vin = String(f.vin || "").toUpperCase().trim();
  useEffect(() => {
    if (!enabled || manual) return;
    if (!isValidVin(vin)) { setDecode({ state: "idle" }); return; }
    let live = true;
    setDecode({ state: "loading" });
    fetch(`/api/vin-decode?vin=${vin}`).then((r) => r.json()).then((j) => {
      if (!live) return;
      const d = j?.data;
      if (j?.success && d?.year && d?.make && d?.model) {
        set({ year: d.year, make: d.make, model: d.model, trim: d.trim || f.trim || "", decodedFromVin: true });
        setDecode({ state: "ok", text: [d.year, d.make, d.model, d.trim].filter(Boolean).join(" ") });
      } else { setDecode({ state: "fail" }); setManual(true); }
    }).catch(() => { if (live) { setDecode({ state: "fail" }); setManual(true); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vin, enabled, manual]);

  const parsed = useMemo(() => parseTradeFields(f), [f]);
  const progress = requiredPhotoProgress(draft.photos);
  const errors = parsed.ok ? {} : parsed.errors;
  const firstError = !enabled ? null : !parsed.ok ? Object.values(errors)[0] ?? "Finish the trade-in details." : !progress.complete ? `Add the ${progress.firstMissing?.replace("_", " ")} photo (${progress.have} of ${progress.total} required photos).` : null;
  const ready = enabled && parsed.ok && progress.complete && !draft.busySlot;
  useEffect(() => {
    onState({ ready: !enabled || ready, draftId: draft.ref?.id ?? null, token: draft.ref?.token ?? null, firstError: ready || !enabled ? null : firstError });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, draft.ref?.id, firstError]);

  const show = (k: string) => (attempted || f[`__t_${k}`] ? (errors as Record<string, string>)[k] : undefined);
  const touch = (k: string) => () => set({ [`__t_${k}`]: true });
  const Err = ({ k }: { k: string }) => (show(k) ? <p className={errCls} role="alert" data-testid={`err-${k}`}>{show(k)}</p> : null);
  const financed = f.ownership === "financed" || f.ownership === "leased";
  const years = useMemo(() => { const y = new Date().getFullYear() + 1; return Array.from({ length: y - 1980 }, (_, i) => y - i); }, []);

  const openHandoff = async () => {
    if (!draft.ref) return;
    const link = `${window.location.origin}/trade/draft/${draft.ref.id}?k=${draft.ref.token}`;
    setHandoff({ link, qr: await QRCode.toDataURL(link, { margin: 1, width: 192 }) });
  };

  return (
    <div className="space-y-4" data-testid="trade-in-step">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">Trade-in</p>
          <p className="text-[11px] text-ink-muted">Dealers show it as its own line next to the price, never buried in the monthly.</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="I have a trade-in" onClick={() => onToggle(!enabled)} data-testid="trade-toggle"
          className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${enabled ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light"}`}>
          <span className={`inline-block h-4 w-7 rounded-full p-0.5 transition-colors ${enabled ? "bg-brand-500" : "bg-border"}`}><span className={`block h-3 w-3 rounded-full bg-white transition-transform ${enabled ? "translate-x-3" : ""}`} /></span>
          I have a trade-in
        </button>
      </div>

      {!enabled ? null : draft.error ? <p className="text-xs text-rose-300" role="alert">{draft.error}</p> : draft.loading && !draft.ref ? <p className="text-xs text-ink-muted">Loading your trade-in…</p> : (
        <div className="space-y-5 rounded-2xl border border-border bg-surface/40 p-4">
          <p className="flex items-start gap-2 text-[11px] text-ink-muted" data-testid="trade-privacy"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />{TRADE_PRIVACY_COPY} We don&apos;t ask for title documents, SSN or loan account numbers.</p>
          <p className="text-[10px] text-ink-faint">{draft.saving === "saving" ? "Saving…" : draft.saving === "saved" ? "Draft saved. You can leave and come back on any device." : "Your draft saves automatically."}</p>

          <Block title="The vehicle">
            <div className="space-y-1.5">
              <label className={labelCls} htmlFor="trade-vin">VIN</label>
              <input id="trade-vin" value={String(f.vin || "")} onChange={(e) => { set({ vin: e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 17), decodedFromVin: false }); setManual(false); }} onBlur={touch("vin")} maxLength={17} placeholder="17-character VIN" className={`${inputCls} font-mono uppercase`} data-testid="trade-vin" />
              <Err k="vin" />
              {decode.state === "loading" ? <p className="text-[11px] text-ink-muted">Decoding…</p> : null}
              {!manual && f.decodedFromVin && decode.state !== "loading" && f.year ? (
                <p className="rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-white" data-testid="trade-decoded">
                  {[f.year, f.make, f.model, f.trim].filter(Boolean).join(" ")} <button type="button" onClick={() => setManual(true)} className="ml-2 text-[11px] font-bold text-brand-300 hover:text-brand-200" data-testid="trade-manual">Not right? Enter manually</button>
                </p>
              ) : null}
            </div>
            {manual || (!f.decodedFromVin && isValidVin(vin) && decode.state === "fail") ? (
              <div className="grid grid-cols-2 gap-3" data-testid="trade-manual-fields">
                <div><label className={labelCls}>Year</label>
                  <select value={String(f.year || "")} onChange={(e) => set({ year: Number(e.target.value), decodedFromVin: false })} className={inputCls} aria-label="Trade-in year"><option value="">Year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select><Err k="year" /></div>
                <div><label className={labelCls}>Make</label><input value={String(f.make || "")} onChange={(e) => set({ make: e.target.value, decodedFromVin: false })} className={inputCls} aria-label="Trade-in make" /><Err k="make" /></div>
                <div><label className={labelCls}>Model</label><input value={String(f.model || "")} onChange={(e) => set({ model: e.target.value, decodedFromVin: false })} className={inputCls} aria-label="Trade-in model" /><Err k="model" /></div>
                <div><label className={labelCls}>Trim</label><input value={String(f.trim || "")} onChange={(e) => set({ trim: e.target.value, decodedFromVin: false })} className={inputCls} aria-label="Trade-in trim" /><Err k="trim" /></div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls} htmlFor="trade-mileage">Mileage</label><input id="trade-mileage" inputMode="numeric" value={String(f.mileage ?? "")} onChange={(e) => set({ mileage: e.target.value.replace(/[^\d]/g, "") })} onBlur={touch("mileage")} className={inputCls} data-testid="trade-mileage" /><Err k="mileage" /></div>
              <div><label className={labelCls} htmlFor="trade-zip">ZIP where the vehicle is</label><input id="trade-zip" inputMode="numeric" maxLength={5} value={String(f.zip || "")} onChange={(e) => set({ zip: e.target.value.replace(/[^\d]/g, "").slice(0, 5) })} onBlur={touch("zip")} className={inputCls} data-testid="trade-zip" /><Err k="zip" /></div>
            </div>
          </Block>

          <Block title="Condition">
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Condition" data-testid="trade-condition">
              {TRADE_CONDITIONS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={f.conditionBand === c} onClick={() => set({ conditionBand: c })} className={`rounded-xl border p-3 text-left ${f.conditionBand === c ? "border-brand-500 bg-brand-500/10" : "border-border hover:border-border-strong"}`}>
                  <span className="block text-xs font-bold text-white">{TRADE_CONDITION_COPY[c].label}</span><span className="block text-[11px] text-ink-muted">{TRADE_CONDITION_COPY[c].line}</span>
                </button>
              ))}
            </div><Err k="conditionBand" />
          </Block>

          <Block title="Title and ownership">
            <div className="space-y-1.5"><label className={labelCls}>Title status</label><Chips value={f.titleStatus} options={TITLE_STATUSES} labels={TITLE_LABELS} onChange={(v) => set({ titleStatus: v })} testId="trade-title" /><Err k="titleStatus" /></div>
            <div className="space-y-1.5"><label className={labelCls}>Ownership</label><Chips value={f.ownership} options={OWNERSHIPS} labels={OWNERSHIP_LABELS} onChange={(v) => set({ ownership: v })} testId="trade-ownership" /><Err k="ownership" /></div>
            {financed ? (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="trade-lien">
                <div><label className={labelCls}>Lender name</label><input value={String(f.lenderName || "")} onChange={(e) => set({ lenderName: e.target.value })} onBlur={touch("lenderName")} className={inputCls} data-testid="trade-lender" /><Err k="lenderName" /></div>
                <div><label className={labelCls}>Approximate payoff ($)</label><input inputMode="decimal" value={String(f.payoffEstimate ?? "")} onChange={(e) => set({ payoffEstimate: e.target.value.replace(/[^\d.]/g, "") })} onBlur={touch("payoffEstimate")} className={inputCls} data-testid="trade-payoff" /><Err k="payoffEstimate" />
                  <p className="mt-1 text-[11px] text-ink-faint">An estimate is fine. The dealer verifies the exact payoff.</p></div>
              </div>
            ) : null}
            <div className="space-y-1.5"><label className={labelCls}>Number of keys</label><Chips value={f.keys} options={KEYS} labels={{ "1": "1", "2+": "2 or more" }} onChange={(v) => set({ keys: v })} testId="trade-keys" /><Err k="keys" /></div>
          </Block>

          <Block title="History and options">
            <div className="space-y-1.5"><label className={labelCls}>Accident, airbag or flood history?</label><Chips value={f.historyFlag} options={HISTORY_FLAGS} labels={{ no: "No", yes: "Yes", not_sure: "Not sure" }} onChange={(v) => set({ historyFlag: v })} testId="trade-history" /><Err k="historyFlag" />
              {f.historyFlag === "yes" ? <><textarea rows={2} maxLength={500} value={String(f.historyNotes || "")} onChange={(e) => set({ historyNotes: e.target.value })} onBlur={touch("historyNotes")} placeholder="What happened, and when?" className={`${inputCls} resize-none`} data-testid="trade-history-notes" /><Err k="historyNotes" /></> : null}</div>
            <div className="space-y-1.5"><label className={labelCls}>Drivetrain</label><Chips value={f.drivetrain} options={DRIVETRAINS} labels={DRIVETRAIN_LABELS} onChange={(v) => set({ drivetrain: v })} testId="trade-drivetrain" /><Err k="drivetrain" /></div>
            <div className="space-y-1.5"><label className={labelCls}>Options that move the value</label>
              <Chips multi value={(f.options as string[]) || []} options={TRADE_OPTIONS} labels={TRADE_OPTION_LABELS} onChange={(v) => { const cur = ((f.options as string[]) || []); set({ options: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }); }} testId="trade-options" />
              {((f.options as string[]) || []).includes("other") ? <><input value={String(f.optionsOther || "")} onChange={(e) => set({ optionsOther: e.target.value })} onBlur={touch("optionsOther")} placeholder="What else?" className={inputCls} /><Err k="optionsOther" /></> : null}</div>
          </Block>

          <Block title="Photos" hint={TRADE_PHOTO_COPY}>
            <TradePhotoSlots photos={draft.photos} urls={draft.urls} busySlot={draft.busySlot} slotError={draft.slotError} onPick={draft.uploadPhoto} onRemove={draft.removePhoto} guided={guided} pointAtMissing={attempted && !progress.complete} />
            {!guided ? (
              <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3" data-testid="trade-handoff">
                <p className="text-xs font-bold text-white">Easier on your phone</p>
                <p className="text-[11px] text-ink-muted">Open this draft on your phone to take the photos with its camera. They show up here as you add them.</p>
                {handoff ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={handoff.qr} alt="QR code to continue on your phone" width={96} height={96} className="rounded bg-white p-1" data-testid="handoff-qr" />
                    <div className="space-y-1.5"><p className="break-all text-[10px] text-ink-faint">{handoff.link}</p>
                      <button type="button" onClick={async () => { await navigator.clipboard?.writeText(handoff.link).catch(() => undefined); setCopied(true); }} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-ink-light hover:text-white">{copied ? "Copied" : "Copy link"}</button></div>
                  </div>
                ) : <button type="button" onClick={openHandoff} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white" data-testid="handoff-open">Continue on my phone</button>}
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-xs text-ink-light"><input type="checkbox" checked={f.odometerConfirmed === true} onChange={(e) => set({ odometerConfirmed: e.target.checked })} className="mt-0.5" data-testid="trade-odometer-confirm" />Mileage in photo matches what I entered</label>
            <Err k="odometerConfirmed" />
          </Block>

          <Block title="Helps you get a sharper number" hint="Optional.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={labelCls}>Exterior color</label><input value={String(f.extColor || "")} onChange={(e) => set({ extColor: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Interior color</label><input value={String(f.intColor || "")} onChange={(e) => set({ intColor: e.target.value })} className={inputCls} /></div>
            </div>
            <div className="space-y-1.5"><label className={labelCls}>Service history</label><Chips value={f.serviceHistory} options={SERVICE_HISTORIES} labels={SERVICE_LABELS} onChange={(v) => set({ serviceHistory: v })} />
              <input value={String(f.serviceNotes || "")} onChange={(e) => set({ serviceNotes: e.target.value })} placeholder="Major work done (timing belt, transmission…)" className={inputCls} /><Err k="serviceNotes" /></div>
            <div className="space-y-1.5"><label className={labelCls}>Tire and brake life</label><Chips value={f.tireBrake} options={TIRE_BRAKES} labels={TIRE_BRAKE_LABELS} onChange={(v) => set({ tireBrake: v })} /></div>
            <div><label className={labelCls}>Aftermarket mods</label><input value={String(f.mods || "")} onChange={(e) => set({ mods: e.target.value })} className={inputCls} /><Err k="mods" /></div>
            <div className="space-y-1.5"><label className={labelCls}>Any warning lights on?</label>
              <Chips value={f.warningLights?.on === true ? "yes" : f.warningLights?.on === false ? "no" : null} options={["yes", "no"] as const} labels={{ yes: "Yes", no: "No" }} onChange={(v) => set({ warningLights: { on: v === "yes", which: f.warningLights?.which || "" } })} />
              {f.warningLights?.on ? <input value={String(f.warningLights?.which || "")} onChange={(e) => set({ warningLights: { on: true, which: e.target.value } })} placeholder="Which ones?" className={inputCls} /> : null}<Err k="warningLights" /></div>
            <div className="space-y-1.5"><label className={labelCls}>What do you want to do with it?</label><Chips value={f.intent || "apply_to_deal"} options={TRADE_INTENTS} labels={INTENT_LABELS} onChange={(v) => set({ intent: v })} testId="trade-intent" /></div>
          </Block>

          {attempted && firstError ? <p className="text-xs font-semibold text-amber-300" role="alert" data-testid="trade-first-error">{firstError}</p> : null}
        </div>
      )}
    </div>
  );
}
