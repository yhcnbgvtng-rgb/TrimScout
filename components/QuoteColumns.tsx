import React from "react";

/**
 * Dealers as COLUMNS: the first column is the line-item label (pinned left), every
 * further column is one dealer's quote, so a buyer reads one line item straight
 * across dealers. The header stays pinned while the table scrolls vertically, and
 * the whole thing scrolls sideways past ~3 dealers instead of wrapping. Pure layout —
 * the callers decide what each cell says.
 */
export interface QuoteColumn {
  id: string;
  kind: string;
  /** Header: dealer name, status badge, expiry. */
  header: React.ReactNode;
  /** One cell per row key; missing keys render a dash. */
  cells: Record<string, React.ReactNode>;
  /** Row keys whose cell is the best on that line (highlighted). */
  best?: string[];
  muted?: boolean;
  picked?: boolean;
  /** Choose / Counter / Walk away. */
  footer?: React.ReactNode;
  /** Itemized detail for this quote only; rendered in its own column when set. */
  detail?: React.ReactNode;
}
export interface QuoteRowDef { key: string; label: string; total?: boolean }

export const COLUMN_W = "w-[15.5rem] min-w-[15.5rem] max-w-[15.5rem]";

export function QuoteColumns({ rows, columns, testId, caption }: { rows: QuoteRowDef[]; columns: QuoteColumn[]; testId: string; caption?: string }) {
  const anyDetail = columns.some((c) => c.detail);
  const anyFooter = columns.some((c) => c.footer);
  return (
    <div className="max-h-[80vh] overflow-auto rounded-2xl border border-border bg-surface" data-testid={testId} data-columns={columns.length}>
      <table className="border-separate border-spacing-0 text-left text-xs">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-30 w-36 min-w-[9rem] border-b border-r border-border bg-surface px-3 py-3 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Line item</th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className={`sticky top-0 z-20 ${COLUMN_W} border-b border-border bg-surface px-3 py-3 align-top font-normal ${c.muted ? "opacity-60" : ""} ${c.picked ? "bg-brand-500/5" : ""}`} data-testid={`quote-col-${c.kind}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-row={r.key}>
              <th scope="row" className={`sticky left-0 z-10 w-36 min-w-[9rem] border-b border-r border-border/60 bg-surface px-3 py-2.5 align-top text-[10px] font-bold uppercase tracking-wide ${r.total ? "text-white" : "text-ink-faint"}`}>{r.label}</th>
              {columns.map((c) => (
                <td key={c.id} className={`${COLUMN_W} border-b border-border/60 px-3 py-2.5 align-top tabular-nums leading-snug ${c.muted ? "opacity-50" : ""} ${c.best?.includes(r.key) ? "bg-brand-500/10 font-extrabold text-brand-300" : r.total ? "font-extrabold text-white" : ""}`}>
                  {c.cells[r.key] ?? <span className="text-ink-faint">—</span>}
                </td>
              ))}
            </tr>
          ))}
          {anyDetail ? (
            <tr data-row="detail" data-testid="quote-detail-row">
              <th scope="row" className="sticky left-0 z-10 w-36 min-w-[9rem] border-b border-r border-border/60 bg-surface px-3 py-2.5 align-top text-[10px] font-bold uppercase tracking-wide text-ink-faint">Itemized detail</th>
              {columns.map((c) => (
                <td key={c.id} className={`${COLUMN_W} border-b border-border/60 bg-background/60 px-3 py-2.5 align-top text-[11px] text-ink-light`}>{c.detail ?? null}</td>
              ))}
            </tr>
          ) : null}
          {anyFooter ? (
            <tr data-row="actions">
              <th scope="row" className="sticky bottom-0 left-0 z-30 w-36 min-w-[9rem] border-r border-t border-border bg-surface px-3 py-2.5" />
              {columns.map((c) => (
                <td key={c.id} className={`sticky bottom-0 z-20 ${COLUMN_W} border-t border-border bg-surface px-3 py-3 align-top`} data-testid="quote-col-footer">{c.footer ?? null}</td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
