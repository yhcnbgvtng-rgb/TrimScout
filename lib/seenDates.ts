/**
 * Crawl dates (first_seen / last_seen) are never sent to buyers. The age of a car works behind the page (lastConfirmed.ts) and
 * the admin Vehicles tab shows the dates. This drops every such key, at any depth, from a payload bound for a public caller.
 */
const SEEN_DATE_KEY = /^(first|last)_?seen(_?at|_?date)?$/i;

export function withoutSeenDates<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutSeenDates) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !SEEN_DATE_KEY.test(k)).map(([k, v]) => [k, withoutSeenDates(v)])) as T;
  }
  return value;
}
