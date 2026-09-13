"use client";

import React from "react";
import { CheckCircle2 } from "lucide-react";
import type { RfqRequest } from "../lib/rfq";
import { LEASE_SHEET_RULES, leaseSheetRows, rfqDealNumber, rfqVehicles, vehicleLine } from "../lib/rfqTracker";

/**
 * The fixed, read-only sheet a lease quote request is made of — what the
 * buyer asked for and what every dealer quotes against through the lease
 * calculator. Vehicles with their desks, the Step 2 prefs, and the rules
 * line. No dealer-site price, no competitive-sale language, contacts stay masked.
 */
export function LeaseQuoteSheet({ rfq, compact = false }: { rfq: RfqRequest; compact?: boolean }) {
  const prefs = rfq.leasePrefs;
  if (!prefs) return null;
  const vehicles = rfqVehicles(rfq);
  const deskFor = (dealerName: string | null) => rfq.invites.find((i) => i.dealerName === dealerName)?.desk || null;
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 space-y-4" data-testid="lease-quote-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-white">Lease quote sheet</h2>
        <span className="font-mono text-[11px] text-ink-muted">{rfqDealNumber(rfq)}</span>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Vehicle{vehicles.length === 1 ? "" : "s"}</p>
        <ul className="space-y-1.5">
          {vehicles.map((v) => {
            const desk = deskFor(v.dealerName);
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
                  {v.dealerName ? (
                    <>
                      {" · "}
                      {v.dealerName}
                      {v.dealerState ? ` (${v.dealerState})` : ""}
                      {desk && !compact ? (
                        <span>
                          {" · "}to {desk.contactName}
                          {desk.emailMasked ? <span className="font-mono"> · {desk.emailMasked}</span> : null}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-amber-300"> · no dealership attached</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

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

      <p className="border-t border-border/60 pt-3 text-[11px] leading-snug text-ink-muted">{LEASE_SHEET_RULES}</p>
    </section>
  );
}
