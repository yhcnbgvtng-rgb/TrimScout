"use client";

import React from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { MUST_CONFIRM_COPY, type MustConfirmAck, type MustConfirmItem } from "../lib/mustConfirm";

/**
 * The buyer's must-confirm checklist for a used car, read-only. Shown on
 * the deal page and the dealer's quote page; with acknowledgements it
 * shows what the dealer confirmed or couldn't.
 */
export function MustConfirmList({ items, acks, compact = false }: { items: MustConfirmItem[]; acks?: MustConfirmAck[] | null; compact?: boolean }) {
  if (items.length === 0) return null;
  const byId = new Map((acks || []).map((a) => [a.id, a]));
  return (
    <div className="space-y-1.5" data-testid="must-confirm-list">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Must confirm</p>
      {!compact ? <p className="text-[10px] text-ink-faint">{MUST_CONFIRM_COPY}</p> : null}
      <ul className="space-y-1">
        {items.map((it) => {
          const a = byId.get(it.id);
          return (
            <li key={it.id} className="flex items-start gap-1.5 text-[11px] text-white">
              {a?.status === "confirmed" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : a?.status === "cannot_confirm" ? (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              ) : (
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
              )}
              <span>
                {it.label}
                {a?.status === "cannot_confirm" ? <span className="block text-[10px] text-amber-200">Dealer can&apos;t confirm{a.note ? `: “${a.note}”` : ""}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
