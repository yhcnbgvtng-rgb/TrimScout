"use client";

import React, { useState } from "react";
import { Car, CheckCircle2, Loader2 } from "lucide-react";
import { formatCurrency, getEstimatedTaxRate, getStateTaxRate } from "../lib/otdCalculator";
import type { TradeInSubmission, TradeInAppraisalRecord } from "../lib/types";
import { TradeInRevisedOtd } from "./TradeInRevisedOtd";

interface TradeInAppraisalPanelProps {
  dealId: string;
  tradeIn: TradeInSubmission;
  appraisal: TradeInAppraisalRecord | null;
  /** The quoted OTD the dealer won with — vehicle plus dealer fees, no tax or registration. */
  quotedOtdPrice: number;
  /** Buyer's registration state, for the tax preview. */
  buyerState: string | null;
  buyerZip?: string | null;
  onAppraised: (appraisal: TradeInAppraisalRecord) => void;
}

const CONDITION_LABEL: Record<TradeInSubmission["condition"], string> = {
  excellent: "Excellent",
  very_good: "Very good",
  good: "Good",
  fair: "Fair",
};

/**
 * What the winning dealer sees for a buyer's trade-in: the details, the
 * photos, and one number to enter. The revised-OTD preview below the form
 * is the exact breakdown the buyer will see, so there's no surprise on
 * either side.
 */
export const TradeInAppraisalPanel: React.FC<TradeInAppraisalPanelProps> = ({
  dealId,
  tradeIn,
  appraisal,
  quotedOtdPrice,
  buyerState,
  buyerZip,
  onAppraised,
}) => {
  const [allowance, setAllowance] = useState(appraisal ? String(appraisal.allowance) : "");
  const [loanPayoff, setLoanPayoff] = useState(String(appraisal?.loanPayoff ?? tradeIn.loanPayoff ?? 0));
  const [notes, setNotes] = useState(appraisal?.notes || "");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowanceNum = Number(allowance.replace(/[^\d]/g, "")) || 0;
  const payoffNum = Number(loanPayoff.replace(/[^\d]/g, "")) || 0;
  // The buyer's exact ZIP is withheld from dealers; their state isn't. Use the
  // ZIP when a caller has it, the state otherwise — never the 94107 default.
  const taxRate = buyerZip && /^\d{5}$/.test(buyerZip) ? getEstimatedTaxRate(buyerZip) : getStateTaxRate(buyerState);

  const submit = async () => {
    if (!(allowanceNum > 0) || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/trade-in/appraisal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowance: allowanceNum, loanPayoff: payoffNum, notes: notes.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't save the appraisal.");
      onAppraised(json.deal?.tradeInAppraisal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the appraisal.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = [tradeIn.year, tradeIn.make, tradeIn.model, tradeIn.trim].filter(Boolean).join(" ");

  return (
    <div className="rounded-2xl border-2 border-amber-500/40 bg-surface p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-300">
            <Car className="h-4 w-4" /> Buyer&apos;s trade-in
          </div>
          <h3 className="text-base font-black text-white mt-0.5">{title}</h3>
          <p className="text-xs text-ink-muted">
            {tradeIn.mileage.toLocaleString("en-US")} mi · {CONDITION_LABEL[tradeIn.condition]}
            {tradeIn.vin ? <> · <span className="font-mono">{tradeIn.vin}</span></> : null}
            {tradeIn.loanPayoff > 0 ? <> · buyer reports {formatCurrency(tradeIn.loanPayoff)} owed</> : null}
          </p>
          {tradeIn.notes && <p className="mt-1 text-[11px] italic text-ink-muted">&quot;{tradeIn.notes}&quot;</p>}
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase border ${
            appraisal ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300" : "border-amber-500/40 bg-amber-950/30 text-amber-300"
          }`}
        >
          {appraisal ? `Appraised ${formatCurrency(appraisal.allowance)}` : "Needs your number"}
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {tradeIn.photos.map((p) => (
          <button key={p.id} type="button" onClick={() => setLightbox(p.imageUrl)} className="group relative overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.imageUrl} alt={p.label} className="h-24 w-full object-cover transition-transform group-hover:scale-105" />
            <span className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">{p.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Trade-in allowance</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-faint">$</span>
              <input
                inputMode="numeric"
                value={allowance ? Number(allowance.replace(/[^\d]/g, "")).toLocaleString("en-US") : ""}
                onChange={(e) => setAllowance(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                placeholder="18,500"
                className="w-full rounded-lg border border-border bg-background py-2 pl-6 pr-3 text-sm font-bold text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
              />
            </div>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Loan payoff you&apos;ll handle</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-faint">$</span>
              <input
                inputMode="numeric"
                value={loanPayoff ? Number(loanPayoff.replace(/[^\d]/g, "")).toLocaleString("en-US") : ""}
                onChange={(e) => setLoanPayoff(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                placeholder="0"
                className="w-full rounded-lg border border-border bg-background py-2 pl-6 pr-3 text-xs text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
              />
            </div>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Note to the buyer (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              placeholder="Allowance assumes the condition shown; subject to in-person inspection at delivery."
              className="w-full min-h-[56px] rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-ink-light placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
          </label>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={!(allowanceNum > 0) || isSubmitting}
            className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : appraisal ? <><CheckCircle2 className="h-4 w-4" /> Update appraisal</> : "Send appraisal to buyer"}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-surface-elevated p-3.5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-faint">What the buyer will see</div>
          <TradeInRevisedOtd
            compact
            input={{
              quotedOtdPrice,
              taxRate,
              registrationState: buyerState,
              appraisal: { allowance: allowanceNum, loanPayoff: payoffNum },
            }}
          />
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Trade-in photo" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
};
