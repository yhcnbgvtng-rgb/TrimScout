// Content-fit column widths for the admin Vehicles table (app/admin/crawl/VehiclesSheet.tsx). The table is a
// flex grid (not a <table>), so widths are measured here from the rows on the page instead: longest value per
// column, clamped between the header's own width and a per-column cap. Computed before the first paint of a page of
// rows, so nothing jumps while it loads. A column that is blank on every row collapses to its header.

export type WidthCol = { key: string; label: string; sortable?: boolean };

const CELL_PAD = 22; // px-2.5 each side + the right border
const HEADER_CHAR = 7.6; // 10.5px uppercase, black weight, tracked
const SORT_ICON = 16;
const TEXT_CHAR = 6.6; // 11.5px body text
const MONO_CHAR = 7.0;
const MONO_KEYS = new Set(["vin", "stockNumber", "vehicleId"]);
// Longest a column may grow before it truncates (full text is on hover). DEFAULT_MAX covers everything else.
const MAX_W: Record<string, number> = { dealerName: 300, dealerCity: 180, model: 200, trim: 240, options: 320, vdpUrl: 300, engine: 240, transmission: 240 };
const DEFAULT_MAX = 260;
export const NUMERIC_KEYS = new Set(["price", "priceDiff", "msrp", "mileage", "daysOnLot", "optionsTotal"]);

export function headerWidth(col: WidthCol): number {
  return Math.ceil(col.label.length * HEADER_CHAR + CELL_PAD + (col.sortable ? SORT_ICON + 4 : 0));
}

// texts: key -> the displayed text of every row. extra: key -> fixed extra px a cell may carry (e.g. a badge).
export function computeColWidths(cols: WidthCol[], texts: Record<string, string[]>, extra: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cols) {
    const head = headerWidth(c);
    let longest = 0;
    for (const t of texts[c.key] || []) if (t.length > longest) longest = t.length;
    const content = longest === 0 ? 0 : Math.ceil(longest * (MONO_KEYS.has(c.key) ? MONO_CHAR : TEXT_CHAR) + CELL_PAD + (extra[c.key] || 0));
    out[c.key] = Math.max(head, Math.min(content, Math.max(head, MAX_W[c.key] ?? DEFAULT_MAX)));
  }
  return out;
}
