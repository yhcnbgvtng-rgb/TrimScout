import React from "react";
import { overrideDifference, OVERRIDE_LABELS, type FeeOverride } from "../lib/feeOverride";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * The buyer's flag on a fee the dealer replaced (lib/feeOverride.ts): "Dealer adjusted", TrimScout's original amount, the
 * dealer's new amount, the difference and the dealer's reason. Shown under the line it belongs to in the compare.
 */
export function DealerAdjustedFlag({ overrides }: { overrides: FeeOverride[] }) {
  if (!overrides.length) return null;
  return (
    <div className="mt-1 space-y-1" data-testid="dealer-adjusted-flags">
      {overrides.map((o) => {
        const d = overrideDifference(o);
        return (
          <div key={o.key} className="max-w-[12rem] whitespace-normal break-words rounded-md border border-amber-500/40 bg-amber-950/30 px-2 py-1 text-[10px] leading-snug text-amber-100" data-testid={`dealer-adjusted-${o.key}`}>
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200">Dealer adjusted</span>
            <span className="ml-1 font-semibold">{OVERRIDE_LABELS[o.key]}</span>
            <span className="mt-0.5 block tabular-nums">
              TrimScout <span data-testid="adjusted-original">{money(o.calculated)}</span> → dealer <strong data-testid="adjusted-new">{money(o.amount)}</strong>{" "}
              (<span data-testid="adjusted-diff">{d < 0 ? "−" : "+"}{money(Math.abs(d))}</span>)
            </span>
            <span className="block text-amber-200/90" data-testid="adjusted-reason">Dealer&apos;s reason: &ldquo;{o.reason}&rdquo;</span>
          </div>
        );
      })}
    </div>
  );
}
