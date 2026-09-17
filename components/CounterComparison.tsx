"use client";

import React from "react";
import { counterDiff, rowMoved, type CounterSheet, type DiffRow } from "../lib/counterSheet";

/**
 * Before vs after, line by line: what the dealer quoted, what the buyer
 * countered, and the difference. Changed lines are highlighted, locked
 * lines greyed with "fixed", and the bottom line(s) ruled off. The same
 * table serves the buyer's deal page, the counter review page and the
 * dealer's quote page, so both sides read identical numbers.
 */
export function fmtRow(v: number | null, format?: DiffRow["format"]): string {
  if (v == null) return "—";
  if (format === "mf") return v.toFixed(5);
  if (format === "pct") return `${v}%`;
  if (format === "int") return v.toLocaleString();
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function CounterComparison({ sheet, beforeLabel = "Dealer quoted", afterLabel = "Your counter", compact = false }: { sheet: CounterSheet; beforeLabel?: string; afterLabel?: string; compact?: boolean }) {
  const rows = counterDiff(sheet);
  const shown = compact ? rows.filter((r) => r.total || rowMoved(r)) : rows;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background" data-testid="counter-comparison" data-kind={sheet.kind}>
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr className="text-[9px] font-bold uppercase tracking-wide text-ink-faint">
            <th className="px-3 py-2 text-left">Line</th>
            <th className="px-3 py-2 text-right">{beforeLabel}</th>
            <th className="px-3 py-2 text-right">{afterLabel}</th>
            <th className="px-3 py-2 text-right">Δ</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const moved = rowMoved(r);
            const tone = r.total ? "border-t border-border font-bold text-white" : r.locked ? "text-ink-faint" : moved ? "text-white" : "text-ink-muted";
            return (
              <tr key={r.key} className={tone} data-row={r.key} data-moved={moved ? "true" : "false"}>
                <td className="px-3 py-1.5">
                  {r.label}
                  {r.locked ? <span className="ml-1 text-[9px] uppercase tracking-wide text-ink-faint">fixed</span> : null}
                </td>
                <td className="px-3 py-1.5 text-right">{fmtRow(r.before, r.format)}</td>
                <td className={`px-3 py-1.5 text-right ${moved && !r.total ? "text-sky-200" : ""}`}>{fmtRow(r.after, r.format)}</td>
                <td className={`px-3 py-1.5 text-right ${moved ? (r.delta < 0 ? "text-emerald-300" : "text-amber-300") : "text-ink-faint"}`}>{moved ? fmtRow(r.delta, r.format) : "·"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
