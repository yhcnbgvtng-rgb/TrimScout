"use client";

import React, { useState } from "react";
import {
  DRIVETRAIN_LABELS, INTENT_LABELS, OWNERSHIP_LABELS, SERVICE_LABELS, TIRE_BRAKE_LABELS, TITLE_LABELS, TRADE_CONDITION_COPY, TRADE_OPTION_LABELS, type TradeInRecord, type TradePhoto,
} from "../../lib/trade/types";
import { photoProgressLabel, requiredPhotoProgress } from "../../lib/trade/validate";

export interface SignedView { slot: TradePhoto["slot"]; label: string; required: boolean; url: string }
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Read-only trade summary: everything the buyer told us, then the labelled photo gallery with a lightbox. */
export function TradeSummary({ trade, signed }: { trade: TradeInRecord; signed: SignedView[] }) {
  const [open, setOpen] = useState<SignedView | null>(null);
  const progress = requiredPhotoProgress(trade.photos);
  const row = (k: string, v: React.ReactNode) => v ? <div className="flex justify-between gap-3 border-b border-border/40 py-1.5"><dt className="text-ink-muted">{k}</dt><dd className="text-right text-white">{v}</dd></div> : null;
  const options = [trade.drivetrain ? DRIVETRAIN_LABELS[trade.drivetrain] : null, ...trade.options.filter((o) => o !== "other").map((o) => TRADE_OPTION_LABELS[o]), trade.optionsOther].filter(Boolean).join(", ");
  const required = signed.filter((s) => s.required), extras = signed.filter((s) => !s.required);
  return (
    <div className="space-y-4" data-testid="trade-summary">
      <div>
        <p className="text-sm font-bold text-white">{[trade.year, trade.make, trade.model, trade.trim].filter(Boolean).join(" ")}</p>
        <p className="font-mono text-[11px] text-ink-muted">VIN {trade.vin}</p>
      </div>
      <dl className="text-xs">
        {row("Mileage", `${trade.mileage.toLocaleString()} mi`)}
        {row("Vehicle ZIP", trade.zip)}
        {row("Condition", `${TRADE_CONDITION_COPY[trade.conditionBand].label}: ${TRADE_CONDITION_COPY[trade.conditionBand].line}`)}
        {row("Title", TITLE_LABELS[trade.titleStatus])}
        {row("Ownership", OWNERSHIP_LABELS[trade.ownership])}
        {trade.ownership !== "owned" ? row("Lender / est. payoff", `${trade.lenderName || "—"} · ${usd(trade.payoffEstimate)} (estimate; verify)`) : null}
        {row("Keys", trade.keys === "2+" ? "2 or more" : "1")}
        {row("Accident / airbag / flood", trade.historyFlag === "no" ? "No" : trade.historyFlag === "not_sure" ? "Not sure" : `Yes: ${trade.historyNotes || ""}`)}
        {row("Options", options || "None listed")}
        {row("Colors", [trade.extColor, trade.intColor].filter(Boolean).join(" / "))}
        {row("Service history", trade.serviceHistory ? `${SERVICE_LABELS[trade.serviceHistory]}${trade.serviceNotes ? `: ${trade.serviceNotes}` : ""}` : trade.serviceNotes)}
        {row("Tires / brakes", trade.tireBrake ? TIRE_BRAKE_LABELS[trade.tireBrake] : null)}
        {row("Aftermarket mods", trade.mods)}
        {row("Warning lights", trade.warningLights ? (trade.warningLights.on ? `On${trade.warningLights.which ? `: ${trade.warningLights.which}` : ""}` : "None") : null)}
        {row("Buyer's intent", INTENT_LABELS[trade.intent])}
      </dl>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${progress.complete ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`} data-testid="required-photos-chip">{progress.have}/{progress.total} required photos</span>
          {extras.length ? <span className="text-[11px] text-ink-muted">+ {extras.length} extra</span> : null}
          <span className="sr-only">{photoProgressLabel(trade.photos)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="trade-gallery">
          {[...required, ...extras].map((p) => (
            <button key={p.slot} type="button" onClick={() => setOpen(p)} className="group relative overflow-hidden rounded-lg border border-border text-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.label} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1 text-[10px] font-bold text-white">{p.label}</span>
            </button>
          ))}
        </div>
      </div>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label={`${open.label} photo`} onClick={() => setOpen(null)} data-testid="lightbox">
          <div className="max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.url} alt={open.label} className="max-h-[80vh] rounded-lg object-contain" />
            <div className="mt-2 flex items-center justify-between text-xs text-white"><span className="font-bold">{open.label}</span><button type="button" onClick={() => setOpen(null)} className="rounded-lg border border-white/30 px-3 py-1.5 font-bold">Close</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
