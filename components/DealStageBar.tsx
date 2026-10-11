import React from "react";
import { stageProgress, type DealStageState } from "../lib/dealStages";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/**
 * The Cash / Finance progress bar: Out-the-door price -> Trade-in -> Payment, each step upcoming / current / locked /
 * skipped (no trade-in) / walked, with the number it locked at. Shared by the buyer's tracker, the compare view and the
 * dealer's quote page so all three show the same thing.
 */
export function DealStageBar({ state, compact = false }: { state: DealStageState; compact?: boolean }) {
  const steps = stageProgress(state);
  const paymentValue = (v: number | null) => (v == null ? null : state.payment.method === "finance" ? `${usd(v)}/mo` : usd(v));
  return (
    <ol className="grid grid-cols-3 gap-1.5" data-testid="deal-stage-bar" aria-label="Deal progress">
      {steps.map((s, i) => {
        const tone =
          s.state === "locked" ? "border-brand-500/60 bg-brand-500/10 text-white"
          : s.state === "current" ? "border-sky-500/60 bg-sky-500/10 text-white"
          : s.state === "walked" ? "border-rose-500/50 bg-rose-950/20 text-rose-200"
          : s.state === "skipped" ? "border-border/60 text-ink-faint line-through decoration-ink-faint/50"
          : "border-border text-ink-faint";
        const value = s.value == null ? null : s.id === "payment" ? paymentValue(s.value) : usd(s.value);
        return (
          <li key={s.id} className={`rounded-lg border px-2 ${compact ? "py-1" : "py-1.5"} ${tone}`} data-stage={s.id} data-state={s.state}>
            <span className="block text-[9px] font-bold uppercase tracking-wide opacity-70">{i + 1}. {s.state === "skipped" ? "No trade-in" : s.label}</span>
            <span className="block text-[11px] font-bold">
              {s.state === "locked" ? (value ? `Locked ${value}` : "Locked") : s.state === "current" ? "In progress" : s.state === "walked" ? "Walked away" : s.state === "skipped" ? "Skipped" : "Next"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
