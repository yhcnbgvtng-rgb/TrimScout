"use client";

import React from "react";
import { TAX_PROMPT_COPY } from "../lib/counterSheet";

/**
 * Dealer revise form: the buyer's counter moved the price, so the sales-tax line is stale.
 * The dealer edits the tax or confirms it as quoted before the revised quote can go out.
 */
export function TaxUpdatePrompt({ pending, confirmed, onConfirm }: { pending: boolean; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-[11px] ${pending ? "border-amber-500/50 bg-amber-950/30 text-amber-100" : "border-border bg-background/40 text-ink-muted"}`} data-testid="tax-update-prompt" data-pending={pending ? "true" : "false"}>
      <p className="font-bold">{TAX_PROMPT_COPY}</p>
      <p className="mt-0.5">The buyer&apos;s counter changed the selling price. Update the sales tax line, or confirm it&apos;s still right as quoted.</p>
      <label className="mt-1.5 flex items-start gap-2">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" data-testid="tax-confirm" />
        <span>Sales tax is correct for the new price as it stands</span>
      </label>
    </div>
  );
}
