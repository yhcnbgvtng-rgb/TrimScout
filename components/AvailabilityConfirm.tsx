"use client";

import React, { useState } from "react";
import { AVAILABILITY_COPY, AVAILABILITY_REQUIRED_ERROR, resolveAvailability } from "../lib/quoteAvailability";

/**
 * The required first question on the dealer's quote sheet: is this exact car (VIN shown) in stock? Yes -> quote it. No -> decline the
 * request, or quote a comparable car under its own VIN (shown to the buyer as a different vehicle). Controlled by the form that owns
 * the submit, so an unanswered question blocks the submit like any other required field.
 */
export type AvailabilityState = { choice: "" | "yes" | "no"; then: "" | "alternative"; altVin: string };
export const EMPTY_AVAILABILITY: AvailabilityState = { choice: "", then: "", altVin: "" };

export function useAvailability() {
  return useState<AvailabilityState>(EMPTY_AVAILABILITY);
}

/** The body the quote routes expect (null until the dealer has answered completely). */
export function availabilityAnswer(s: AvailabilityState): { answer: "yes" } | { answer: "alternative"; alternativeVin: string } | null {
  if (s.choice === "yes") return { answer: "yes" };
  if (s.choice === "no" && s.then === "alternative") return { answer: "alternative", alternativeVin: s.altVin.trim().toUpperCase() };
  return null;
}

/** The VIN the quote is for: the comparable car's when the dealer is offering one, else what the sheet's VIN field holds. */
export function availabilityQuoteVin(s: AvailabilityState, sheetVin: string): string {
  return s.choice === "no" && s.then === "alternative" ? s.altVin.trim().toUpperCase() : sheetVin;
}

/** Client-side mirror of the server's rule, so the dealer sees the problem before sending. */
export function availabilityErrors(s: AvailabilityState, requestedVin: string, sheetVin: string): string[] {
  if (s.choice === "no" && s.then === "") return ["You said the vehicle is unavailable: decline this quote request, or offer a comparable vehicle with its VIN."];
  const answer = availabilityAnswer(s);
  if (!answer) return [AVAILABILITY_REQUIRED_ERROR];
  const r = resolveAvailability(answer, { requestedVin, quoteVin: availabilityQuoteVin(s, sheetVin) });
  return r.ok ? [] : [r.error];
}

export function AvailabilityConfirm({
  value,
  onChange,
  requestedVin,
  sheetVin,
  onDecline,
  declining = false,
  invalid = false,
}: {
  value: AvailabilityState;
  onChange: (next: AvailabilityState) => void;
  /** The VIN the buyer asked about ("" for an open-to-alternatives request: the sheet's VIN is then the car being confirmed). */
  requestedVin: string;
  sheetVin: string;
  onDecline?: () => void;
  declining?: boolean;
  invalid?: boolean;
}) {
  const shownVin = (requestedVin || sheetVin || "").toUpperCase();
  const radio = "mt-0.5 h-3.5 w-3.5";
  return (
    <fieldset className={`space-y-2.5 rounded-xl border px-3.5 py-3 ${invalid ? "border-rose-500/50 bg-rose-950/10" : "border-brand-500/40 bg-brand-500/5"}`} data-testid="availability-confirm">
      <legend className="px-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Required · Availability</legend>
      <p className="text-xs font-bold text-white">
        Is this vehicle in stock? <span className="ml-1 font-mono text-[11px] font-normal text-ink-light" data-testid="availability-vin">VIN {shownVin || "not entered yet"}</span>
      </p>
      <label className="flex items-start gap-2 text-xs text-ink-light">
        <input type="radio" name="availability" className={radio} checked={value.choice === "yes"} onChange={() => onChange({ choice: "yes", then: "", altVin: "" })} data-testid="availability-yes" />
        <span>{AVAILABILITY_COPY.yes}</span>
      </label>
      <label className="flex items-start gap-2 text-xs text-ink-light">
        <input type="radio" name="availability" className={radio} checked={value.choice === "no"} onChange={() => onChange({ choice: "no", then: "", altVin: "" })} data-testid="availability-no" />
        <span>{AVAILABILITY_COPY.no}</span>
      </label>
      {value.choice === "no" ? (
        <div className="ml-5 space-y-2 border-l border-border/60 pl-3" data-testid="availability-no-options">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onDecline} disabled={!onDecline || declining} className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-500/10 disabled:opacity-50" data-testid="availability-decline">
              {declining ? "Recording…" : AVAILABILITY_COPY.decline}
            </button>
            <span className="text-[10px] text-ink-faint">or</span>
            <label className="flex items-center gap-2 text-xs text-ink-light">
              <input type="radio" name="availability-then" className={radio} checked={value.then === "alternative"} onChange={() => onChange({ ...value, then: "alternative" })} data-testid="availability-alternative" />
              <span>{AVAILABILITY_COPY.alternative}</span>
            </label>
          </div>
          {value.then === "alternative" ? (
            <div className="space-y-1" data-testid="availability-alt-fields">
              <input
                type="text"
                value={value.altVin}
                maxLength={17}
                onChange={(e) => onChange({ ...value, altVin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                placeholder="VIN of the comparable vehicle (17 characters)"
                aria-label="VIN of the comparable vehicle"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none"
                data-testid="availability-alt-vin"
              />
              <p className="text-[10px] font-bold text-amber-200" data-testid="availability-different-car">{AVAILABILITY_COPY.differentCar}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
