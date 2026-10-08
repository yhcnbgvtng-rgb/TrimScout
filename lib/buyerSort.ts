/**
 * Sorting the buyer /search results by clicking a column header. Pure — the page, the route and the box query all share it.
 *
 * Click cycle: first click ascending (A→Z, low→high), second descending, third clears the sort.
 * The sort is applied by the server to the WHOLE result set (the box's ORDER BY), not just the page on screen — except Distance,
 * which has no database column (it is computed from the dealer's city/state), so it orders the rows of the page(s) loaded.
 * A blank value sorts after every real value in both directions.
 */
export type SortDir = "asc" | "desc";

/** table column key -> the sort key the box understands (inventoryListQuery.js). "pick" (the checkbox) is not sortable. */
export const SORT_KEY_BY_COLUMN = {
  days: "days", vehicleId: "vehicleid", vin: "vin", year: "year", make: "make", model: "model", trim: "trim", ext: "ext", int: "int",
  mileage: "mileage", price: "price", dealer: "dealer", state: "state", contact: "contact", listing: "listing", distance: "distance",
} as const;
export type SortableColumn = keyof typeof SORT_KEY_BY_COLUMN;
export type SortKey = (typeof SORT_KEY_BY_COLUMN)[SortableColumn];

const KEYS = new Set<string>(Object.values(SORT_KEY_BY_COLUMN));
const COLUMN_BY_KEY = Object.fromEntries(Object.entries(SORT_KEY_BY_COLUMN).map(([c, k]) => [k, c])) as Record<SortKey, SortableColumn>;

export const isSortableColumn = (key: string): key is SortableColumn => Object.prototype.hasOwnProperty.call(SORT_KEY_BY_COLUMN, key);

export interface Sort { key: SortKey; dir: SortDir }

/** "price:asc" | "price:desc" | "distance" (ascending) | "distance:desc" -> a Sort; anything else (empty, unknown key, junk) -> null. */
export function parseSort(raw: string | null | undefined): Sort | null {
  if (!raw) return null;
  const parts = String(raw).split(":");
  if (parts.length > 2) return null;
  const [key, dir] = parts;
  if (!KEYS.has(key)) return null;
  if (dir !== undefined && dir !== "asc" && dir !== "desc") return null;
  return { key: key as SortKey, dir: dir === "desc" ? "desc" : "asc" };
}

/** The string stored in the filters and sent as ?sort= — "distance" stays the existing ascending value the Sort menu already uses. */
export function formatSort(s: Sort): string {
  return s.key === "distance" && s.dir === "asc" ? "distance" : `${s.key}:${s.dir}`;
}

/** The next click on a column header: another column or no sort -> ascending; ascending -> descending; descending -> cleared (""). */
export function nextSort(current: string, column: SortableColumn): string {
  const cur = parseSort(current);
  const key = SORT_KEY_BY_COLUMN[column];
  if (!cur || cur.key !== key) return formatSort({ key, dir: "asc" });
  if (cur.dir === "asc") return formatSort({ key, dir: "desc" });
  return "";
}

/** Which header shows an arrow, and which way: the column whose sort key matches the current sort. */
export function activeSort(current: string): { column: SortableColumn; dir: SortDir } | null {
  const s = parseSort(current);
  return s ? { column: COLUMN_BY_KEY[s.key], dir: s.dir } : null;
}

export const ariaSortFor = (current: string, column: string): "ascending" | "descending" | "none" => {
  const a = activeSort(current);
  return a && a.column === column ? (a.dir === "asc" ? "ascending" : "descending") : "none";
};

/**
 * Measured on the live box 2026-10-07 (Honda, ~130k in-stock rows): sorting a whole make by most columns takes longer than the
 * box's 20 s query limit (the plain price sort already did before blanks-last existed) because those columns have no index to read
 * in order. These stay fast on a whole make; every other column needs a model (a make+model set, e.g. 19k CR-Vs, sorts in 0.04–6 s).
 */
export const FAST_WITHOUT_MODEL: ReadonlySet<SortKey> = new Set<SortKey>(["dealer", "make", "vin", "contact", "distance"]);

/** null = go ahead; otherwise why this sort is not offered yet (shown to the buyer, no request is made). */
export function sortBlockedReason(column: SortableColumn, hasModel: boolean, label: string): string | null {
  const key = SORT_KEY_BY_COLUMN[column];
  return FAST_WITHOUT_MODEL.has(key) || hasModel ? null : `Pick a model to sort by ${label} — sorting a whole make by that column is too slow.`;
}

export const SORT_TIMEOUT_NOTE = (label: string) => `Sorting by ${label} took too long for this many vehicles, so the sort was not applied. Narrow the search (add a model or state) and try again.`;

/** Distance is computed per row from the dealer's city/state, so it orders the rows loaded, blanks last either way. Stable. */
export function sortByDistance<T extends { distanceMiles: number | null }>(rows: T[], dir: SortDir): T[] {
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = a.r.distanceMiles, y = b.r.distanceMiles;
      if (x == null && y == null) return a.i - b.i;
      if (x == null) return 1;
      if (y == null) return -1;
      return x === y ? a.i - b.i : (x - y) * sign;
    })
    .map((e) => e.r);
}
