import React from "react";
import { CheckCircle2, MinusCircle } from "lucide-react";
import { ON_SUBMIT_NOTE, previewCounts, type PreviewRow } from "../lib/selectionPreview";

/**
 * Pre-submit review: every selected vehicle, its dealership, and whether it will get an invitation.
 * "Known" restrictions are stated now; checks that can only finish on submit are marked as such.
 */
export function SelectionPreview({ rows }: { rows: PreviewRow[] }) {
  if (rows.length === 0) return null;
  const c = previewCounts(rows);
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-background/40 p-3" data-testid="selection-preview">
      <p className="text-[11px] font-bold text-white" data-testid="selection-preview-headline">
        {c.vehicles} vehicle{c.vehicles === 1 ? "" : "s"} selected · {c.willInvite} will get an invitation{c.restricted ? ` · ${c.restricted} won't` : ""}
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.vin} className="rounded-lg border border-border/70 px-2.5 py-2" data-testid="selection-preview-row" data-verdict={r.verdict}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-ink-light">{r.title || "Selected vehicle"}</p>
                <p className="text-[10px] text-ink-muted"><span className="font-mono">{r.vin}</span> · {r.dealerName || "dealership unknown"}</p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${r.verdict === "will_invite" ? "bg-brand-500/15 text-brand-300" : "bg-amber-500/15 text-amber-300"}`}>
                {r.verdict === "will_invite" ? <CheckCircle2 className="h-3 w-3" /> : <MinusCircle className="h-3 w-3" />}
                {r.verdict === "will_invite" ? "Will be invited" : "Won't be invited"}
              </span>
            </div>
            {r.reason ? (
              <p className="mt-1 text-[10px] leading-snug text-amber-200/90" data-testid="selection-preview-reason">
                {r.reason}
                {r.resolvable ? " You can change this above." : ""}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-[10px] leading-snug text-ink-faint" data-testid="selection-preview-note">{ON_SUBMIT_NOTE}</p>
    </div>
  );
}
