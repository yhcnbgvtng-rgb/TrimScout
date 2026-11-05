import React from "react";
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { deliveryLine, hasUnexplainedGap, isPartial, summarizeRows, summaryHeadline, type VehicleRow } from "../lib/selectionOutcomes";
import { vehicleTitle } from "../lib/vehicleTitle";

const TONE: Record<string, string> = {
  quoted: "bg-positive-500/15 text-positive-300",
  queued: "bg-sky-500/15 text-sky-300",
  sent: "bg-sky-500/15 text-sky-300",
  viewed: "bg-sky-500/15 text-sky-300",
  declined: "bg-border text-ink-muted",
  expired: "bg-border text-ink-muted",
  excluded: "bg-amber-500/15 text-amber-300",
  unrecorded: "bg-border text-ink-muted",
};

/**
 * One row per selected vehicle, whatever happened to it: invited, quoted, or not invited with the reason.
 * The same component renders the buyer's results panel, the Deal Tracker card and the admin diagnostic, so they agree.
 * Alternates are labelled and listed apart from the exact build — their quotes are never compared against it.
 */
export function SelectionOutcomes({ rows, title = "Your selected vehicles", showCodes = false, compact = false }: { rows: VehicleRow[]; title?: string; showCodes?: boolean; compact?: boolean }) {
  if (rows.length === 0) return null;
  const summary = summarizeRows(rows);
  const partial = isPartial(summary);
  const delivery = deliveryLine(summary);
  const exact = rows.filter((r) => r.role === "exact");
  const alternates = rows.filter((r) => r.role === "alternate");
  const group = (label: string, list: VehicleRow[]) =>
    list.length === 0 ? null : (
      <div className="space-y-1.5" data-testid={`selection-group-${label === "Exact build" ? "exact" : "alternate"}`}>
        {rows.some((r) => r.role === "exact") && rows.some((r) => r.role === "alternate") ? <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{label}</p> : null}
        <ul className="space-y-1.5">
          {list.map((r) => (
            <li key={r.vehicle.vin} className="rounded-lg border border-border/70 bg-background/40 px-3 py-2" data-testid="selection-row" data-status={r.status}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-white">{vehicleTitle(r.vehicle) || "Selected vehicle"}</p>
                  <p className="text-[10px] text-ink-muted">
                    <span className="font-mono">{r.vehicle.vin}</span>
                    {r.dealerName ? ` · ${r.dealerName}${r.vehicle.dealerState ? `, ${r.vehicle.dealerState}` : ""}` : " · dealership unknown"}
                  </p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TONE[r.status] || TONE.excluded}`} data-testid="selection-status">
                  {r.status === "excluded" ? <MinusCircle className="h-3 w-3" /> : r.status === "unrecorded" ? <MinusCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                  {r.statusLabel}
                </span>
              </div>
              {r.reason ? (
                <p className="mt-1 text-[11px] leading-snug text-amber-200/90" data-testid="selection-reason">
                  {r.reason}
                  {showCodes && r.code ? <span className="ml-1 font-mono text-[9px] text-ink-faint">[{r.code}]</span> : null}
                </p>
              ) : null}
              {r.quote ? (
                <p className="mt-1 text-[11px] text-positive-300" data-testid="selection-quote">
                  Quote for this vehicle: ${(r.quote.totalOtdPrice || r.quote.price).toLocaleString()} out the door
                  {r.role === "alternate" ? " · alternate, not an exact-build comparison" : ""}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className={`space-y-2 rounded-xl border ${partial ? "border-amber-500/40 bg-amber-950/20" : "border-brand-500/40 bg-brand-500/5"} ${compact ? "p-3" : "p-4"}`} data-testid="selection-outcomes" data-partial={partial ? "1" : "0"}>
      <div className="flex items-start gap-2">
        {partial ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />}
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-white">{title}</h3>
          <p className="text-[11px] font-semibold text-ink-light" data-testid="selection-headline">{summaryHeadline(summary)}</p>
          {delivery ? <p className="text-[10px] text-ink-muted" data-testid="selection-delivery">{delivery}</p> : null}
          {hasUnexplainedGap(rows) ? <p className="text-[10px] text-ink-muted">This request was saved before reasons were recorded, so some vehicles show “Reason unavailable”.</p> : null}
        </div>
      </div>
      {group("Exact build", exact)}
      {group("Alternates", alternates)}
    </section>
  );
}
