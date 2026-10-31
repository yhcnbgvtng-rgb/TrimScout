// Which /search grid columns show before the shopper opens the Columns menu. Vehicle ID stays available there, but starts hidden.
// There is no Days on market column: the API no longer sends days on lot. First-seen / last-seen dates are never a column: buyers do not see crawl dates (see lib/noPublicSeenDates.test.ts).

export const HIDDEN_BY_DEFAULT: readonly string[] = ["vehicleId"];

/** Columns the menu may not turn off: the pick checkbox is the only way to select a car. */
export const ALWAYS_VISIBLE: readonly string[] = ["pick"];

/** The column keys to draw: everything except the ones the shopper has hidden (null = still on the defaults). */
export function visibleColumnKeys<T extends { key: string }>(all: readonly T[], hidden: readonly string[] | null): string[] {
  const off = new Set(hidden ?? HIDDEN_BY_DEFAULT);
  return all.filter((c) => ALWAYS_VISIBLE.includes(c.key) || !off.has(c.key)).map((c) => c.key);
}

/** Toggle one column in the hidden list (starting from the defaults the first time). */
export function toggleColumn(hidden: readonly string[] | null, key: string): string[] {
  const cur = hidden ?? HIDDEN_BY_DEFAULT;
  if (ALWAYS_VISIBLE.includes(key)) return [...cur];
  return cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
}
