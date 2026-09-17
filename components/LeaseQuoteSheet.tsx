"use client";

import React, { useState } from "react";
import { CheckCircle2, Lock, Pencil } from "lucide-react";
import type { RfqRequest } from "../lib/rfq";
import { LEASE_DAS_INTENTS, LEASE_DAS_INTENT_LABELS, LEASE_MILES, LEASE_TERMS, type LeaseDueAtSigningIntent, type LeaseMiles, type LeaseRequestPrefs, type LeaseTerm } from "../lib/leaseQuote";
import { CREDIT_BANDS, CREDIT_BAND_COPY, CREDIT_BAND_LABELS, type CreditBand } from "../lib/creditBand";
import { LEASE_SHEET_RULES, LEASE_TIMELINE_LABELS, leaseSheetRows, rfqDealNumber, rfqVehicles, vehicleLine } from "../lib/rfqTracker";

export const SHEET_UNLOCKED_COPY = "You can still adjust this lease request until a dealer opens it.";
export const SHEET_LOCKED_COPY = "Locked — a dealer has viewed this request. New terms need a new quote request.";

/** Whether the buyer may still change the lease ask: not locked, still collecting. */
export function sheetEditable(rfq: Pick<RfqRequest, "leaseSheetLockedAt" | "status">): boolean {
  return !rfq.leaseSheetLockedAt && rfq.status === "collecting";
}

/**
 * The fixed, read-only sheet a lease quote request is made of — what the
 * buyer asked for and what every dealer quotes against through the lease
 * calculator. Vehicles with their desks, the Step 2 prefs, and the rules
 * line. Editable by the buyer until the first dealer opens their quote
 * link; then frozen with the timestamp. No dealer-site price, no
 * competitive-sale language, contacts stay masked.
 */
export function LeaseQuoteSheet({ rfq, compact = false, onSaved }: { rfq: RfqRequest; compact?: boolean; onSaved?: (rfq: RfqRequest) => void }) {
  const prefs = rfq.leasePrefs;
  const [editing, setEditing] = useState(false);
  if (!prefs) return null;
  // One row per VIN. A dealer group listing the same car at two rooftops (or a request that
  // pasted the same VIN twice) used to render twin rows both tagged "Unconfirmed build" —
  // which read as a glitch. Now the car is shown once with every rooftop quoting it under it.
  const vehicles = Object.values(
    rfqVehicles(rfq).reduce<Record<string, ReturnType<typeof rfqVehicles>[number] & { dealers: Array<{ name: string; state: string | null }> }>>((acc, v) => {
      const row = acc[v.vin] || (acc[v.vin] = { ...v, dealers: [] });
      if (v.dealerName && !row.dealers.some((d) => d.name === v.dealerName)) row.dealers.push({ name: v.dealerName, state: v.dealerState });
      if (v.factoryVerified) row.factoryVerified = true;
      return acc;
    }, {})
  );
  const anyUnconfirmed = vehicles.some((v) => !v.factoryVerified);
  const deskFor = (dealerName: string | null) => rfq.invites.find((i) => i.dealerName === dealerName)?.desk || null;
  const editable = sheetEditable(rfq);
  const lockedBy = rfq.leaseSheetLockedByInviteId ? rfq.invites.find((i) => i.id === rfq.leaseSheetLockedByInviteId)?.dealerName : null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 space-y-4" data-testid="lease-quote-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-white">Lease quote sheet</h2>
        <span className="font-mono text-[11px] text-ink-muted">{rfqDealNumber(rfq)}</span>
      </div>

      {rfq.leaseSheetLockedAt ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] text-ink-light" data-testid="sheet-locked">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />
          <span>
            {SHEET_LOCKED_COPY}
            <span className="block text-[10px] text-ink-faint">
              Locked when {lockedBy ? `${lockedBy} viewed` : "a dealer viewed"} · {new Date(rfq.leaseSheetLockedAt).toLocaleString()}
            </span>
          </span>
        </p>
      ) : editable ? (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-ink-light" data-testid="sheet-unlocked">
          <span>{SHEET_UNLOCKED_COPY}</span>
          {!editing && !compact ? (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300">
              <Pencil className="h-3 w-3" /> Adjust
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Vehicle{vehicles.length === 1 ? "" : "s"}</p>
        <ul className="space-y-1.5">
          {vehicles.map((v) => {
            return (
              <li key={v.vin} className="rounded-lg border border-border bg-surface-elevated px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-white">{vehicleLine(v)}</span>
                  {v.factoryVerified ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Factory verified
                    </span>
                  ) : (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">Unconfirmed build</span>
                  )}
                </div>
                <div className="text-[10px] text-ink-muted">
                  VIN <span className="font-mono">{v.vin}</span>
                  {v.dealers.length ? (
                    v.dealers.map((d) => {
                      const dDesk = deskFor(d.name);
                      return (
                        <span key={d.name}>
                          {" · "}
                          {d.name}
                          {d.state ? ` (${d.state})` : ""}
                          {dDesk && !compact ? (
                            <span>
                              {" · "}to {dDesk.contactName}
                              {dDesk.emailMasked ? <span className="font-mono"> · {dDesk.emailMasked}</span> : null}
                            </span>
                          ) : null}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-amber-300"> · no dealership attached</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {anyUnconfirmed ? (
          <p className="text-[10px] leading-snug text-ink-muted" data-testid="unconfirmed-build-help">
            <span className="font-bold text-amber-300">Unconfirmed build</span> means the factory window sticker isn&apos;t published for this VIN yet, so the trim and options come from the VIN decode rather than the factory record. It doesn&apos;t hold anything up: dealers quote the car as it sits, you can choose any quote, and the dealer confirms the build when you sign.
          </p>
        ) : null}
      </div>

      {editing && editable ? (
        <LeasePrefsEditor
          rfq={rfq}
          prefs={prefs}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false);
            onSaved?.(next);
          }}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Lease preferences</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {leaseSheetRows(prefs).map((r) => (
              <div key={r.label}>
                <dt className="text-[10px] text-ink-faint">{r.label}</dt>
                <dd className="text-[11px] font-semibold text-white">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="border-t border-border/60 pt-3 text-[11px] leading-snug text-ink-muted">{LEASE_SHEET_RULES}</p>
    </section>
  );
}

/** Term · miles · due-at-signing intent · credit band · ZIP · timeline — the same locks as Step 2, saved through PATCH /api/rfqs/:id/lease-prefs. */
function LeasePrefsEditor({ rfq, prefs, onCancel, onSaved }: { rfq: RfqRequest; prefs: LeaseRequestPrefs; onCancel: () => void; onSaved: (rfq: RfqRequest) => void }) {
  const [term, setTerm] = useState<LeaseTerm>(prefs.termMonths);
  const [miles, setMiles] = useState<LeaseMiles>(prefs.milesPerYear);
  const [zip, setZip] = useState(prefs.zip || "");
  const [timeline, setTimeline] = useState<NonNullable<LeaseRequestPrefs["timeline"]> | "">(prefs.timeline || "");
  const [dasIntent, setDasIntent] = useState<"" | LeaseDueAtSigningIntent>(prefs.dueAtSigningIntent || "");
  const [band, setBand] = useState<"" | CreditBand>(prefs.creditBand || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zipOk = zip === "" || /^\d{5}$/.test(zip);
  const input = "w-full rounded-lg border border-border bg-background py-2 px-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none";
  const label = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";

  const save = async () => {
    setSaving(true);
    setError(null);
    const leasePrefs: LeaseRequestPrefs = { termMonths: term, milesPerYear: miles, zip, timeline: timeline || null, dueAtSigningIntent: dasIntent || null, creditBand: band || null };
    try {
      const res = await fetch(`/api/rfqs/${rfq.id}/lease-prefs`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leasePrefs }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.rfq) throw new Error(json.error || "Could not save your changes.");
      onSaved(json.rfq as RfqRequest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your changes.");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-background p-3" data-testid="lease-prefs-editor">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Adjust lease preferences</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <label className="space-y-1">
          <span className={label}>Term</span>
          <select value={term} onChange={(e) => setTerm(Number(e.target.value) as LeaseTerm)} className={input}>
            {LEASE_TERMS.map((t) => (
              <option key={t} value={t}>{t} months</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>Miles / year</span>
          <select value={miles} onChange={(e) => setMiles(Number(e.target.value) as LeaseMiles)} className={input}>
            {LEASE_MILES.map((m) => (
              <option key={m} value={m}>{m.toLocaleString()}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>Due at signing</span>
          <select value={dasIntent} onChange={(e) => setDasIntent(e.target.value as "" | LeaseDueAtSigningIntent)} className={input} data-testid="sheet-das-intent">
            <option value="">Choose what you intend up front</option>
            {LEASE_DAS_INTENTS.map((i) => (
              <option key={i} value={i}>{LEASE_DAS_INTENT_LABELS[i]}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>Credit band</span>
          <select value={band} onChange={(e) => setBand(e.target.value as "" | CreditBand)} className={input} data-testid="sheet-credit-band" title={CREDIT_BAND_COPY}>
            <option value="">Choose your band</option>
            {CREDIT_BANDS.map((b) => (
              <option key={b} value={b}>{CREDIT_BAND_LABELS[b]}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>ZIP (tax context)</span>
          <input type="text" inputMode="numeric" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} className={`${input} font-mono`} />
        </label>
        <label className="space-y-1">
          <span className={label}>Timeline</span>
          <select value={timeline} onChange={(e) => setTimeline(e.target.value as NonNullable<LeaseRequestPrefs["timeline"]> | "")} className={input}>
            <option value="">Optional — pick if you know</option>
            {(Object.keys(LEASE_TIMELINE_LABELS) as Array<keyof typeof LEASE_TIMELINE_LABELS>).map((k) => (
              <option key={k} value={k}>{LEASE_TIMELINE_LABELS[k]}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving || !zipOk || !dasIntent || !band} className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-50">
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}
