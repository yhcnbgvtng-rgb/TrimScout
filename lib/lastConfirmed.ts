/**
 * How old a buyer-search car's last sighting may be, from `last_seen_at` (the last night a crawl actually saw it listed):
 *   under 3 days  -> no label
 *   3 to 7 days   -> a small grey "Last seen <Mon D>" under the dealer name
 *   over 7 days   -> hidden from buyer search, from its count and from the facets (the box filters on `seenWithinDays`)
 * Admin views and a car's direct page still show a hidden car, with the label.
 * Ages are elapsed time; the label date is the calendar date in US Eastern.
 */

/** A car last seen more than this many days ago is hidden from buyer search. The one place the number lives: the web query sends it to the box as `seenWithinDays`, and the box's catalog rebuild default (STALE_HIDE_DAYS in deals_api_server.js) is pinned to it by lastConfirmed.test.ts. */
export const STALE_HIDE_DAYS = 7;
/** The tighter hide line used when the last-seen staleness rule is on (STALE_RULE=1, server-side env; see scrapers/lightsail-crawler/src/staleRule.js). */
export const STALE_RULE_HIDE_DAYS = 4;
/** How many days back buyer search reaches: 7 (STALE_HIDE_DAYS) while the rule is off, STALE_RULE_HIDE_DAYS once STALE_RULE=1. Server-side only. */
export function buyerHideDays(env: Record<string, string | undefined> = process.env): number {
  if (env.STALE_RULE !== "1") return STALE_HIDE_DAYS;
  const n = Number(env.STALE_RULE_HIDE_DAYS);
  return Number.isInteger(n) && n >= 2 && n <= 30 ? n : STALE_RULE_HIDE_DAYS;
}
/** Cars last seen this many days ago or longer carry the "Last seen" label. */
export const LAST_SEEN_LABEL_AFTER_DAYS = 3;

const DAY_MS = 86_400_000;
const ET = "America/New_York";

const ageMs = (lastSeenAt: string | null | undefined, now: number): number | null => {
  if (!lastSeenAt) return null;
  const t = Date.parse(lastSeenAt);
  return Number.isFinite(t) ? now - t : null;
};

/** True when the car was last seen more than STALE_HIDE_DAYS ago — buyer search leaves it out. A missing/unusable date is never hidden. */
export function isHiddenFromBuyerSearch(lastSeenAt: string | null | undefined, now: number = Date.now()): boolean {
  const age = ageMs(lastSeenAt, now);
  return age !== null && age > buyerHideDays() * DAY_MS;
}

/** "Last seen Oct 7" (with the year when it is not the current one, in ET), or null when the car was seen under 3 days ago / the date is unusable. Still returns the label for a car older than 7 days, for the admin and direct-page views. */
export function lastSeenLabel(lastSeenAt: string | null | undefined, now: number = Date.now()): string | null {
  const age = ageMs(lastSeenAt, now);
  if (age === null || age < LAST_SEEN_LABEL_AFTER_DAYS * DAY_MS) return null;
  const parts = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "short", day: "numeric" }).formatToParts(ms).map((p) => [p.type, p.value]));
  const d = parts(Date.parse(lastSeenAt as string));
  return `Last seen ${d.month} ${d.day}${d.year === parts(now).year ? "" : `, ${d.year}`}`;
}
