// Auto-fit widths for the /search results grid: each text column is as wide as its widest header or cell among the rows loaded,
// never narrower than FIT_MIN_PX nor wider than FIT_MAX_PX (past the max the cell truncates and the full value is in its title).
export const FIT_MIN_PX = 60;
export const FIT_MAX_PX = 280;
/** Cell padding (px-2.5 on both sides) plus the 1px right border. */
export const CELL_CHROME_PX = 21;
/** Room in a sortable header for the gap and the 12px direction arrow. */
export const SORT_ARROW_PX = 16;

export type FitColumn = {
  key: string;
  /** Fixed columns (the pick checkbox, the listing link) keep this width and are never measured. */
  fixedW?: number;
  /** Pixel width of the header label as drawn (uppercase, bold, tracked). */
  headerPx: number;
  sortable: boolean;
  /** Pixel width of the widest cell among the rows (use maxCellPx). */
  cellPx: number;
  /** Numeric/monospace columns that must show whole (VIN): the max does not apply. */
  noMax?: boolean;
};

/** One column's width in whole pixels. */
export function fitColumnWidth(c: FitColumn): number {
  if (c.fixedW != null) return c.fixedW;
  const header = c.headerPx + CELL_CHROME_PX + (c.sortable ? SORT_ARROW_PX : 0);
  const cell = c.cellPx + CELL_CHROME_PX;
  const wide = Math.ceil(Math.max(header, cell, FIT_MIN_PX));
  return c.noMax ? wide : Math.min(FIT_MAX_PX, wide);
}

/** Widest of the measured strings, memoising repeats (a 1,000-row page has a few dozen distinct makes, models, states and colours). */
export function maxCellPx(texts: Iterable<string>, measure: (s: string) => number): number {
  const seen = new Set<string>();
  let max = 0;
  for (const t of texts) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const w = measure(t);
    if (w > max) max = w;
  }
  return max;
}

/** Keeps a column from shrinking while more pages append to the same search, so rows already on screen never shift. */
export function growOnly(prev: Record<string, number> | null, next: Record<string, number>): Record<string, number> {
  if (!prev) return next;
  const out: Record<string, number> = {};
  for (const k of Object.keys(next)) out[k] = Math.max(next[k], prev[k] ?? 0);
  return out;
}
