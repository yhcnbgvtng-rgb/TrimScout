/**
 * Column sorting for the buyer search table. Two kinds of column:
 *   - SERVER columns the box can order the WHOLE result set by (days on market, year, make, model, trim, mileage,
 *     price, dealer): clicking re-runs the search on page 1 with sort=<key>:<dir>.
 *   - every other column (VIN, vehicle ID, colors, state, contact, distance): the box has no sort for it, so the
 *     rows already loaded are re-ordered in the browser. Said so in the header tooltip.
 * Pure, so the rules (direction toggle, blanks always last, case-insensitive text, numbers as numbers) are tested.
 */
export type SortDir = "asc" | "desc";

/** Table column key -> the box's sort key. */
export const SERVER_SORT_KEYS: Record<string, string> = {
  days: "days", year: "year", make: "make", model: "model", trim: "trim", mileage: "mileage", price: "price", dealer: "dealer",
};

export const isServerSortColumn = (key: string) => key in SERVER_SORT_KEYS;

/** First click on a column sorts ascending; clicking the active column flips it. */
export function nextDir(current: SortDir | null): SortDir {
  return current === "asc" ? "desc" : "asc";
}

/** "price:desc" -> { column: "price", dir: "desc" } for a server column; null for anything else (incl. "distance", ""). */
export function parseServerSort(sort: string): { column: string; dir: SortDir } | null {
  const [k, d] = (sort || "").split(":");
  const column = Object.keys(SERVER_SORT_KEYS).find((c) => SERVER_SORT_KEYS[c] === k);
  if (!column) return null;
  return { column, dir: d === "desc" ? "desc" : "asc" };
}

type Cell = string | number | boolean | null | undefined;

/** Blanks (null / undefined / "") sort last in BOTH directions; text compares case-insensitively, numbers numerically. */
export function compareCells(a: Cell, b: Cell, dir: SortDir): number {
  const blank = (v: Cell) => v === null || v === undefined || v === "";
  if (blank(a) && blank(b)) return 0;
  if (blank(a)) return 1;
  if (blank(b)) return -1;
  const n = typeof a === "number" && typeof b === "number"
    ? a - b
    : typeof a === "boolean" || typeof b === "boolean"
      ? Number(a) - Number(b)
      : String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
  return dir === "asc" ? n : -n;
}

/** Stable sort of a copy; `get` pulls the cell for the active column. */
export function sortRows<T>(rows: T[], get: (row: T) => Cell, dir: SortDir): T[] {
  return rows.map((row, i) => ({ row, i })).sort((x, y) => compareCells(get(x.row), get(y.row), dir) || x.i - y.i).map((x) => x.row);
}
